"""
CoopBuddy Orchestrator — wires everything together.

Voice transcript → brain.think() → TTS speak + send_chat + execute actions
Game events → brain.handle_game_event() → TTS speak + send_chat + execute actions
Game state events update internal cache silently.

Run as: python -m server.main
"""

import asyncio
import json
import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# Windows asyncio compatibility
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ── Logging ──────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("coopbuddy")

# ── Imports (after logging setup) ────────────────────────────────────────────

from server.ws_server import WSServer
from server.brain import Brain
from server.voice import VoicePipeline

# ── Game state cache ─────────────────────────────────────────────────────────

game_state: dict = {}

# ── Core components ──────────────────────────────────────────────────────────

brain = Brain(game_state)
ws_server: WSServer = None  # set in main()


# ── Response handler ─────────────────────────────────────────────────────────

async def handle_response(text: str, actions: list[dict], voice_pipeline: VoicePipeline):
    """Send AI response to TTS, in-game chat, and execute any actions."""
    if not text:
        return

    # Collapse newlines into a single line — prevents mineflayer from splitting
    # into multiple chat messages (which causes TTS to only speak the last one)
    clean = " ".join(text.split())

    # TTS and chat in parallel
    tts_task = asyncio.create_task(voice_pipeline.tts.speak(clean))
    chat_task = asyncio.create_task(ws_server.send_chat(clean))

    # Execute extracted actions (skip send_chat — already handled above)
    for action in actions:
        if action["action"] == "send_chat":
            continue
        await ws_server.send_action(action["action"], action.get("params", {}))

    await tts_task
    await chat_task


# ── Voice transcript callback ────────────────────────────────────────────────

async def on_transcript(transcript: str):
    """Called when STT produces a transcript from voice input."""
    logger.info(f"Voice: '{transcript}'")

    text, actions = await brain.think(transcript)
    logger.info(f"Brain: '{text}'")

    await handle_response(text, actions, _voice_pipeline)


# ── Game event handler ───────────────────────────────────────────────────────

async def on_game_event(msg: dict):
    """Called when a game event arrives from the Mineflayer bot."""
    event_type = msg.get("event_type", "")
    data = msg.get("data", {})

    # Game state updates — cache silently, no AI response
    if event_type == "game_state":
        game_state.update(data)
        brain.update_game_state(data)
        return

    # Bot connection events — log only
    if event_type in ("bot_joined", "bot_disconnected"):
        logger.info(f"Bot event: {event_type} — {data}")
        if event_type == "bot_joined":
            player = data.get("playerName", "")
            if player:
                await ws_server.send_action("follow_player", {"name": player})
        return

    # Player chat — treat as voice input equivalent
    if event_type == "player_message":
        username = data.get("username", "")
        message = data.get("message", "")
        if message:
            logger.info(f"Chat from {username}: '{message}'")
            text, actions = await brain.think(f"{username} says in chat: {message}")
            logger.info(f"Brain: '{text}'")
            await handle_response(text, actions, _voice_pipeline)
        return

    # Proactive events — rate-limited AI response
    logger.info(f"Game event: {event_type} — {data}")
    result = await brain.handle_game_event(event_type, data)
    if result:
        text, actions = result
        logger.info(f"Brain (proactive): '{text}'")
        await handle_response(text, actions, _voice_pipeline)


# ── PTT callbacks ────────────────────────────────────────────────────────────

def on_ptt_start():
    brain.set_voice_active(True)
    logger.debug("PTT pressed — proactive suppressed")


def on_ptt_stop():
    brain.set_voice_active(False)
    logger.debug("PTT released — proactive resumed")


# ── Main ─────────────────────────────────────────────────────────────────────

_voice_pipeline: VoicePipeline = None


async def main():
    global ws_server, _voice_pipeline

    logger.info("=" * 50)
    logger.info("  CoopBuddy AI Agent starting...")
    logger.info("=" * 50)

    # WebSocket server
    ws_server = WSServer(on_game_event=on_game_event)
    await ws_server.start()

    # Voice pipeline
    loop = asyncio.get_event_loop()
    _voice_pipeline = VoicePipeline(
        on_transcript=on_transcript,
        on_ptt_start=on_ptt_start,
        on_ptt_stop=on_ptt_stop,
    )
    _voice_pipeline.start(loop)

    logger.info("CoopBuddy is ready! Hold 'V' to talk.")
    logger.info("Waiting for Minecraft bot to connect on ws://localhost:8765...")

    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        await ws_server.stop()


if __name__ == "__main__":
    asyncio.run(main())
