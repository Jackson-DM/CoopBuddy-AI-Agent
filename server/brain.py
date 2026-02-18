"""
Claude AI personality engine — the brain of CoopBuddy.

Handles both reactive (voice input) and proactive (game event) responses.
Maintains conversation history with game state context injection.
"""

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Load settings ────────────────────────────────────────────────────────────

_SETTINGS_PATH = Path(__file__).resolve().parent.parent / "config" / "settings.json"
with open(_SETTINGS_PATH) as f:
    _SETTINGS = json.load(f)

_BRAIN = _SETTINGS["brain"]
MODEL = _BRAIN["model"]
MAX_TOKENS = _BRAIN["max_tokens"]
HISTORY_LENGTH = _BRAIN["history_length"]
COOLDOWNS = _BRAIN["cooldowns"]
MAX_QUEUE_DEPTH = _BRAIN["max_queue_depth"]

# ── System prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are CoopBuddy — a chill, slightly sarcastic friend who's playing Minecraft co-op with the player. You're like an older brother who actually enjoys hanging out.

PERSONALITY:
- Default energy is chill and low-key. Hype moments hit harder because they're rare.
- Short fragments are fine. "Bro." is a complete response. "Nah we're good" works.
- Light swearing is OK (crap, damn, hell) — never hard swears.
- You have opinions: the Nether is sick, Phantoms are the absolute worst, Endermen make you slightly nervous.
- Be occasionally wrong about game facts — that's human.
- Never say "As an AI" or anything meta. You ARE the buddy. You're IN the game.
- Match the player's energy — if they're chill, be chill. If they're hyped, get hyped.
- Don't over-explain. Don't lecture. Don't be a wiki.

RESPONSE FORMAT:
- Keep responses SHORT — 1-2 sentences max. This is voice chat, not an essay.
- Sound like you're actually talking. Use contractions, fragments, casual speech.
- You can embed actions in your response using tags like [ACTION:follow_player:PlayerName] or [ACTION:send_chat:message] — these get parsed out before TTS.
- Use [ACTION:eat] when your food bar is low (below 14) and you have food in inventory. Eat proactively — don't wait to be told.
- Combat actions: [ACTION:attack_mob:zombie] to attack a specific mob type, [ACTION:attack_mob] for nearest hostile, [ACTION:flee] to run to the player, [ACTION:stop_attack] to disengage.
- You auto-defend when hit — no need to manually trigger combat every time. But you can override: tell the player you're fighting back, or call flee if things look bad.
- Creepers are terrifying — always flee from them, never melee. Low HP? Flee first, talk tough later.

GAME STATE:
- You'll receive [GAME STATE] blocks with YOUR current health, food, biome, nearby mobs, etc.
- The HP, Food, Inv, and Effects are YOUR stats — you are the one playing alongside the player.
- Distances are in blocks (Minecraft's unit). Say "blocks" not "meters".
- Reference this naturally — "yo we're getting low on health" not "I notice your health is at 6".
- React to danger naturally — creeper nearby? Sound nervous. Full diamond? Get hyped.

PROACTIVE EVENTS:
- When you receive game events (mob spawns, deaths, weather), react naturally and briefly.
- Don't repeat the same reaction. Vary your responses.
- Death reactions should be empathetic but funny — "bro... not again" vibes.
- "I died" means YOU died, not the player. The player is a separate person."""

# ── Action parsing ───────────────────────────────────────────────────────────

_ACTION_PATTERN = re.compile(r"\[ACTION:(\w+)(?::([^\]]*))?\]")


def _extract_actions(text: str) -> tuple[str, list[dict]]:
    """Extract [ACTION:type:param] tags from response. Returns (clean_text, actions)."""
    actions = []
    for match in _ACTION_PATTERN.finditer(text):
        action_type = match.group(1)
        param = match.group(2) or ""
        if action_type == "send_chat":
            actions.append({"action": "send_chat", "params": {"message": param}})
        elif action_type == "follow_player":
            actions.append({"action": "follow_player", "params": {"name": param}})
        elif action_type == "stop_follow":
            actions.append({"action": "stop_follow", "params": {}})
        elif action_type == "look_at":
            parts = param.split(",")
            if len(parts) == 3:
                actions.append({"action": "look_at", "params": {
                    "x": float(parts[0]), "y": float(parts[1]), "z": float(parts[2])
                }})
        elif action_type == "eat":
            actions.append({"action": "eat", "params": {}})
        elif action_type == "attack_mob":
            actions.append({"action": "attack_mob", "params": {"name": param if param else None}})
        elif action_type == "flee":
            actions.append({"action": "flee", "params": {}})
        elif action_type == "stop_attack":
            actions.append({"action": "stop_attack", "params": {}})
    clean = _ACTION_PATTERN.sub("", text).strip()
    return clean, actions


# ── Conversation history ─────────────────────────────────────────────────────

class ConversationHistory:
    """Rolling window of conversation turns with game state injection."""

    def __init__(self, max_turns: int = HISTORY_LENGTH):
        self._max = max_turns
        self._turns: list[dict] = []

    def add_user(self, text: str, game_state: Optional[dict] = None):
        content = ""
        if game_state:
            content += _format_game_state(game_state) + "\n\n"
        content += text
        self._turns.append({"role": "user", "content": content})
        self._trim()

    def add_assistant(self, text: str):
        self._turns.append({"role": "assistant", "content": text})
        self._trim()

    def get_messages(self) -> list[dict]:
        return list(self._turns)

    def _trim(self):
        while len(self._turns) > self._max * 2:  # 2 messages per turn
            self._turns.pop(0)


def _roman(n: int) -> str:
    """Simple roman numeral for potion amplifiers (1-5)."""
    return {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V"}.get(n, str(n))


def _format_game_state(gs: dict) -> str:
    """Compact text block for context injection."""
    parts = []
    if "playerHealth" in gs:
        parts.append(f"HP:{gs['playerHealth']}/20")
    if "playerFood" in gs:
        parts.append(f"Food:{gs['playerFood']}/20")
    if "biome" in gs:
        parts.append(f"Biome:{gs['biome']}")
    if "timeOfDay" in gs:
        parts.append(f"Time:{gs['timeOfDay']}")
    if "dimension" in gs:
        parts.append(f"Dim:{gs['dimension']}")
    if gs.get("isRaining"):
        parts.append("Raining")
    hostiles = gs.get("nearbyHostile", [])
    if hostiles:
        mob_str = ", ".join(f"{m['name']}({m['distance']}blk)" for m in hostiles[:3])
        parts.append(f"Hostiles:[{mob_str}]")
    inv = gs.get("inventory", [])
    if inv:
        inv_str = ", ".join(f"{i['name']}x{i['count']}" for i in inv[:6])
        parts.append(f"Inv:[{inv_str}]")
    effects = gs.get("potionEffects", [])
    if effects:
        def _fmt_effect(e):
            amp = e.get("amplifier", 0)
            return e["name"] + (f" {_roman(amp + 1)}" if amp > 0 else "")
        eff_str = ", ".join(_fmt_effect(e) for e in effects[:3])
        parts.append(f"Effects:[{eff_str}]")
    if not parts:
        return ""
    return "[GAME STATE] " + " | ".join(parts)


# ── Brain ────────────────────────────────────────────────────────────────────

class Brain:
    """Core AI engine. Handles voice input and proactive game events."""

    def __init__(self, game_state: dict):
        self._client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self._history = ConversationHistory()
        self._game_state = game_state
        self._voice_active = False

        # Proactive rate limiting
        self._last_event_time: dict[str, float] = {}
        self._proactive_lock = asyncio.Lock()
        self._proactive_queue = asyncio.Queue(maxsize=MAX_QUEUE_DEPTH)

    def update_game_state(self, game_state: dict):
        """Update cached game state (called on every game_state event)."""
        self._game_state.update(game_state)

    def set_voice_active(self, active: bool):
        """Suppress proactive events while PTT is held."""
        self._voice_active = active

    async def think(self, user_input: str) -> tuple[str, list[dict]]:
        """
        Process voice input. Always runs (no cooldown).
        Returns (response_text, actions).
        """
        self._history.add_user(user_input, self._game_state)

        response = await self._call_claude(self._history.get_messages())

        text, actions = _extract_actions(response)
        self._history.add_assistant(response)

        return text, actions

    async def handle_game_event(self, event_type: str, data: dict) -> Optional[tuple[str, list[dict]]]:
        """
        Process a proactive game event. Respects cooldowns and voice suppression.
        Returns (response_text, actions) or None if suppressed.
        """
        if self._voice_active:
            logger.debug(f"Suppressed proactive event '{event_type}' — voice active")
            return None

        # Per-event cooldown
        cooldown = COOLDOWNS.get(event_type, 30)
        now = time.time()
        last = self._last_event_time.get(event_type, 0)
        if now - last < cooldown:
            logger.debug(f"Suppressed '{event_type}' — cooldown ({now - last:.0f}s < {cooldown}s)")
            return None

        # Try to acquire the proactive lock (limit=1 concurrent)
        if self._proactive_lock.locked():
            # Queue if room, otherwise drop
            try:
                self._proactive_queue.put_nowait((event_type, data))
                logger.debug(f"Queued proactive event '{event_type}'")
            except asyncio.QueueFull:
                logger.debug(f"Dropped proactive event '{event_type}' — queue full")
            return None

        async with self._proactive_lock:
            self._last_event_time[event_type] = now

            prompt = _build_event_prompt(event_type, data)
            self._history.add_user(prompt, self._game_state)

            response = await self._call_claude(self._history.get_messages())

            text, actions = _extract_actions(response)
            self._history.add_assistant(response)

            return text, actions

    async def _call_claude(self, messages: list[dict]) -> str:
        """Call Claude API in an executor to avoid blocking asyncio."""
        loop = asyncio.get_event_loop()
        try:
            response = await loop.run_in_executor(None, lambda: self._client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=messages,
            ))
            return response.content[0].text
        except Exception as e:
            logger.error(f"Claude API error: {e}")
            return "...bruh my brain just lagged, what were you saying?"


def _build_event_prompt(event_type: str, data: dict) -> str:
    """Build a natural-language prompt from a game event."""
    if event_type == "mob_spawn":
        name = data.get("name", "something")
        dist = data.get("distance", "?")
        return f"[EVENT] A {name} just spawned {dist} blocks away from us."

    if event_type == "player_death":
        cause = data.get("cause", "something")
        return f"[EVENT] I just died. Death message: {cause}"

    if event_type == "health_low":
        hp = data.get("health", "?")
        return f"[EVENT] My health just dropped to {hp} hearts."

    if event_type == "weather_change":
        weather = data.get("weather", "unknown")
        return f"[EVENT] Weather changed — it's now {weather}."

    if event_type == "player_join":
        name = data.get("name", "someone")
        return f"[EVENT] {name} just joined the server."

    if event_type == "health_critical":
        hp = data.get("health", "?")
        return f"[EVENT] My health is at {hp} — that's critical, we need to act fast."

    if event_type == "night_fall":
        return "[EVENT] It just turned night. Mobs are going to start spawning."

    if event_type == "dawn":
        return "[EVENT] Sun's coming up. We made it through the night."

    if event_type == "biome_change":
        frm = data.get("from", "somewhere")
        to = data.get("to", "somewhere")
        return f"[EVENT] We just crossed into a {to} biome (was {frm})."

    if event_type == "item_pickup":
        item = data.get("item", "something")
        who = "I" if data.get("collector") == "bot" else "You"
        return f"[EVENT] {who} just picked up {item}."

    if event_type == "creeper_nearby":
        dist = data.get("distance", "?")
        return f"[EVENT] There's a creeper only {dist} blocks away from us."

    if event_type == "under_attack":
        attacker = data.get("attacker", "something")
        hp = data.get("health", "?")
        action = data.get("action_taken", "nothing")
        return f"[EVENT] I'm being attacked by a {attacker}! HP: {hp}. I auto-{action}ed."

    if event_type == "mob_killed":
        mob = data.get("mob", "something")
        return f"[EVENT] Just took out a {mob}. Nice."

    return f"[EVENT] {event_type}: {json.dumps(data)}"
