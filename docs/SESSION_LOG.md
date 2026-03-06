# CoopBuddy — Session Log

## Session 1 — Initial Implementation
**Date**: 2026-02-10
**Status**: Phase 1 MVP implemented

### Completed
- Full Phase 1 implementation (all files created)
- WebSocket bridge: Python asyncio server on port 8765, Node WS client with exponential backoff
- Mineflayer bot: joins localhost:25565, follows player via pathfinder
- Voice pipeline: push-to-talk (V key), faster-whisper STT
- Claude brain: reactive voice handler + proactive mob spawn handler
- ElevenLabs TTS: streaming with thinking earcon
- In-game chat echo after TTS
- Startup scripts: start.bat, start.sh, setup.py

### Key Decisions
- WebSocket over HTTP for IPC (persistent connection, zero per-message overhead)
- faster-whisper base.en (local, ~400-800ms, free, private)
- Per-event cooldowns + global queue depth 2 for proactive rate limiting
- Structured [GAME STATE] text block in user message (token-efficient)

### Next Session
- Test end-to-end pipeline
- Tune voice quality and response personality
- Consider Phase 2 event types based on feel

---

## Session 2 — Full Rebuild & GitHub Push
**Date**: 2026-02-10
**Status**: Complete

### Overview
Session 1 built all Phase 1 files but they weren't saved before hitting the token limit. This session rebuilt everything from scratch, set up GitHub, and pushed a working codebase.

### Completed
- Installed Python 3.11.9 via winget, added to Windows user PATH
- Created scaffolding: `.gitignore`, `.env.example`, `server/__init__.py`
- Wrote portfolio-quality `README.md` (badges, ASCII architecture, quick start, roadmap)
- Deleted stray `nul` Windows artifact
- `git init` + pushed to https://github.com/Jackson-DM/CoopBuddy-AI-Agent
- `config/settings.json` — PTT key, MC connection, voice/STT/TTS config, brain model + per-event cooldowns
- `requirements.txt` — 9 Python deps (anthropic, websockets, faster-whisper, elevenlabs, pyttsx3, sounddevice, numpy, keyboard, python-dotenv)
- `server/brain.py` — Claude personality engine, conversation history with game state injection, proactive rate limiting (per-event cooldowns + global lock + queue depth 2), `[ACTION:type:param]` extraction
- `server/voice.py` — AudioCapture (sounddevice), STT (faster-whisper lazy-loaded), TTS (ElevenLabs + pyttsx3 fallback), VoicePipeline with global V key PTT
- `bot/bot.js` — Mineflayer entry point, pathfinder (canDig=false), event listeners (chat, entitySpawn, health, death, respawn, rain, playerJoined), action handlers, 5s game state snapshots
- `server/main.py` — Orchestrator wiring voice→brain→TTS+chat, game events→brain, Windows asyncio compat
- `start.bat` — Prereq checks, auto venv + dep install, launches both processes

### Key Decisions
- Used `winget` for Python install (curl had SSL issues)
- TTS fallback chain: ElevenLabs → pyttsx3 (no API key needed)
- Player chat messages routed through `brain.think()` same as voice (treated as equivalent input)
- Bot auto-follows on spawn, re-follows after respawn with 2s delay

### Next Session
- Set up `.env` with real API keys and test end-to-end
- Install Python deps in venv, install Node deps in bot/
- Test brain standalone, voice standalone, bot standalone, then full pipeline
- Tune personality and response quality

---

## Session 3 — First Live Test & Bug Fixes
**Date**: 2026-02-10
**Status**: Complete

### Overview
Set up `.env`, installed all dependencies, got the bot into a live Minecraft server, and fixed initial bugs. Bot is now following the player in-game.

### Completed
- Created `.env` with Anthropic API key (credits still needed)
- Installed Python deps in venv (all 50+ packages including anthropic, faster-whisper, elevenlabs, pyttsx3, etc.)
- Installed Node deps in bot/ (mineflayer, pathfinder, ws, etc.)
- Launched Python WS server + Node bot — bot joined Minecraft and connected via WebSocket
- **Bug fix**: Added event debouncing in `bot/bot.js` — `health_low` (45s cooldown), `player_death` (60s cooldown), skip health=0
- **Bug fix**: Fixed `PLAYER_NAME` in `.env` — was "Jackson", actual in-game name is "JaxieJ"
- Set server to peaceful mode (bot was dying in a creeper death loop)
- Confirmed bot follows player reliably on peaceful

### Bugs Found & Fixed
1. **health_low spam**: `bot.on('health')` fired on every tick below 6 HP → added `shouldSendEvent()` debounce with 45s cooldown
2. **player_death spam**: Rapid death/respawn loop flooded events → added 60s debounce
3. **Wrong player name**: `.env` had `PLAYER_NAME=Jackson` but in-game username is `JaxieJ` → pathfinder couldn't find target
4. **Creeper explosion crash**: Explosion packet caused `ECONNRESET` → resolved by setting peaceful mode

### Bugs Found & Not Yet Fixed
- **weather_change spam**: `rain` event fires every ~10s, needs debouncing in `bot/bot.js`

### Key Learnings
- Bot WS client auto-reconnects with exponential backoff — worked seamlessly after crash
- Python server survived bot disconnects and reconnects without restart
- pyttsx3 TTS fallback initializes correctly on first use (comtypes SAPI5 setup)
- Anthropic API credits are prepaid, not subscription — $5 goes very far with 150-token responses
- Brain personality nails the vibe out of the box — Gen Z vernacular, emojis, stays in character when tested with off-the-wall messages

### Additional Fixes (same session)
- **weather_change debounced** at 120s in `bot/bot.js`
- **Focusrite mic**: `AudioCapture` auto-detects Focusrite input device (default was Waves SoundGrid virtual driver)
- **pyttsx3 deadlock**: COM objects deadlocked when reused across asyncio executor threads — fixed by creating fresh engine per call

### Voice Pipeline — VERIFIED WORKING
- PTT (hold V) → Focusrite mic capture → faster-whisper STT → Claude brain → pyttsx3 TTS + in-game chat
- STT transcription is accurate, even for long multi-sentence inputs
- ~2-3s total latency from voice release to spoken response
- pyttsx3 speaks every response reliably after the fresh-engine fix

### ElevenLabs TTS Integration
- Signed up for ElevenLabs ($5/mo plan), created custom voice
- Added API key + voice ID to `.env`
- ElevenLabs TTS now active — `eleven_turbo_v2_5` model, PCM 16kHz
- Voice responses sound natural, all API calls returning 200 OK
- pyttsx3 still available as automatic fallback if ElevenLabs key is removed

### Current State — PHASE 1 COMPLETE + ELEVENLABS
- **Bot**: In-game, following player, surviving on peaceful ✓
- **WS Bridge**: Connected and relaying events ✓
- **Brain**: Responds in character via chat, ~2-3s latency ✓
- **Voice**: Full PTT → STT → Brain → ElevenLabs TTS pipeline working ✓
- **TTS**: ElevenLabs primary, pyttsx3 fallback ✓
- **Events**: All debounced (health_low 45s, death 60s, weather 120s) ✓

### Next Session
- Test on normal/hard difficulty with working brain
- Explore Phase 2 features (combat AI, more events, inventory awareness, memory/mood)

---

## Session 4 — Phase 2a: Game Awareness
**Date**: 2026-02-12
**Status**: Complete

### Overview
Implemented Phase 2a — game awareness features. Unified cooldowns to be config-driven, added inventory and potion effect tracking, and added 6 new proactive event types (bringing total from 5 to 11).

### Completed
- **Cooldown unification**: All 11 event cooldowns now live in `config/settings.json` under `brain.cooldowns`. `bot.js` loads settings at startup and uses config values instead of hardcoded milliseconds.
- **Inventory tracking**: `gameState.js` scans `bot.inventory.items()` every 5s, highlights notable items (diamonds, netherite, totems, elytra), includes equipped armor/offhand, and top 5 resources by stack count.
- **Potion effects tracking**: `gameState.js` reads `bot.entity.effects` every 5s, resolves effect names via `bot.registry.effects`.
- **Brain context**: `_format_game_state()` in `brain.py` now includes `Inv:[...]` and `Effects:[...]` lines when present (~15-20 extra tokens).
- **6 new event listeners** in `bot.js`:
  - `health_critical` (<=8 HP, 30s cooldown) — alongside existing `health_low` (<=6 HP)
  - `night_fall` (time crosses 13000 ticks, 300s cooldown)
  - `dawn` (time wraps from >22000 to <1000, 300s cooldown)
  - `biome_change` (biome name changes, 60s cooldown, skips 'unknown')
  - `creeper_nearby` (creeper within 8 blocks, 30s cooldown)
  - `item_pickup` (notable items only, 10s cooldown, tracks bot + player pickups)
- **6 new brain prompts** in `brain.py` `_build_event_prompt()` — natural language for each event type.

### Files Modified
- `config/settings.json` — 6 new cooldown entries
- `bot/bot.js` — settings loader, config-driven cooldowns, module-level time/biome trackers, 6 new event checks, `playerCollect` listener
- `bot/context/gameState.js` — `NOTABLE_ITEMS` set, `refreshInventory()`, `refreshPotionEffects()`, inventory/potionEffects in state + snapshot
- `server/brain.py` — `_roman()` helper, inventory/effects in `_format_game_state()`, 6 new event prompts

### No New Dependencies
All APIs used are already available in mineflayer / Node built-ins.

### Next Session
- Test all 6 new events in-game (verification plan in Phase 2a design doc)
- Phase 2b: combat AI with mineflayer-pvp

---

## Session 5 — Phase 2a Cleanup + Phase 2b Combat AI
**Date**: 2026-02-17
**Status**: Complete

### Overview
Fixed two remaining Phase 2a bugs (biome detection, eat action) and implemented full Phase 2b combat AI system with mineflayer-pvp.

### Phase 2a Cleanup
- **Biome detection fix**: `getBiomeName()` was passing float coords to `bot.blockAt()`, which returned null. Fixed by calling `.floored()` on position before lookup.
- **Eat action**: Added `[ACTION:eat]` — bot finds food in inventory via `foodRecovery > 0`, equips to hand, and consumes. Brain proactively eats when food bar < 14.

### Phase 2b Combat AI — Full Implementation
- **mineflayer-pvp** installed and loaded as plugin
- **`bot/actions/combat.js`** created (mirrors movement.js pattern):
  - `attackNearest(bot, mobName?)` — finds nearest hostile, attacks via `bot.pvp.attack(entity)`
  - `fleeToPlayer(bot, playerName)` — stops combat, paths to player
  - `stopCombat(bot)` — clears combat state
  - `onHurt(bot, attacker, playerName)` — auto-defend logic
  - Threat priority map: creeper (99, always flee) > wither_skeleton/evoker (6) > skeleton/blaze/witch/vindicator (5) > stray/phantom/pillager (4) > spider/cave_spider (3) > zombie/drowned/husk (2) > others (1)
  - Auto-flee when HP <= 6
  - Never melee creepers — always flee
- **3 new action handlers** in `bot.js`: `attack_mob`, `flee`, `stop_attack`
- **Auto-defend**: `entityHurt` listener finds nearest hostile within 5 blocks and auto-attacks (or auto-flees if low HP / creeper)
- **2 new game events**: `under_attack` (15s cooldown), `mob_killed` (10s cooldown)
- **Entity ID tracking**: `gameState.js` now includes `id` field on entity entries for targeting
- **Brain updates**: `_extract_actions()` handles `eat`, `attack_mob`, `flee`, `stop_attack`; `_build_event_prompt()` handles `under_attack`, `mob_killed`; system prompt documents all combat actions and personality notes

### Files Created
- `bot/actions/combat.js` — Combat module

### Files Modified
- `bot/bot.js` — pvp plugin, combat import, action handlers, auto-defend, mob_killed event, biome fix, eat action
- `bot/context/gameState.js` — entity ID in entries
- `server/brain.py` — 4 new action types, 2 new event prompts, combat system prompt
- `config/settings.json` — 2 new cooldowns
- `bot/package.json` / `bot/package-lock.json` — mineflayer-pvp dependency

### Key Design Decisions
- **Auto-defend without brain** — immediate response on hit, brain notified after via `under_attack` event
- **Creeper = always flee** — never attempt melee, threat priority 99
- **Low HP = flee** — below 6 HP, flee to player regardless of mob type
- **Brain can override** — `[ACTION:attack_mob]`, `[ACTION:flee]`, `[ACTION:stop_attack]`
- **pvp stoppedAttacking listener** — clears combat state when pvp plugin finishes

### Next Session
- Test combat on normal difficulty (auto-defend, attack command, flee, creeper flee)
- Phase 3: Memory & mood system

---

## Session 6 — Phase 2b Bug Fixes & Testing
**Date**: 2026-02-18
**Status**: Complete

### Overview
First live test of Phase 2b combat. Found and fixed multiple bugs across combat, WebSocket stability, eating, and death event handling.

### Bugs Found & Fixed

1. **`item.foodRecovery` undefined** — mineflayer item objects don't expose `foodRecovery` directly. The eat handler `bot.inventory.items().find(i => i.foodRecovery > 0)` always returned nothing. Fixed by lifting `mcData` to module scope (was scoped inside the `spawn` callback) and using `mcData.foodsByName` for the lookup.

2. **mineflayer-pvp doesn't equip weapons** — `bot.pvp.attack(entity)` calls `bot.attack()` raw with whatever is currently held. Bot was punching bare-fisted every fight. Fixed by adding `_equipBestWeapon(bot)` in `combat.js` which scans inventory for the best sword/axe (netherite → diamond → iron → stone → golden → wooden) and equips it before handing off to pvp.

3. **Follow interval overriding pvp pathfinding** — `movement.js` runs `setInterval` every 500ms setting a `GoalFollow` for the player. When `bot.pvp.attack()` set its own `GoalFollow` for the mob, the follow interval overwrote it 500ms later — bot stood still instead of chasing mobs. Fixed by making the interval actively pathfind toward `bot.pvp.target` during combat instead of yielding silently.

4. **Pong disconnect cycling** — `ws_server.py` awaited game event handlers inline inside `_dispatch`. Claude API calls take 2-3s, blocking the message loop. Bot's 15s ping timeout would eventually fire and terminate the connection. Fixed by firing game events as `asyncio.create_task` so the message loop (and ping/pong) stay responsive regardless of brain latency.

5. **Death message triggering `brain.think()`** — Minecraft death chat messages (e.g. `"JaxieJ was blown up by Creeper"`) are system messages that mineflayer fires via `bot.on('chat')` with an empty username. The old filter only skipped the bot's own messages, so death messages hit the `player_message` path and called `brain.think()` — concurrently with the `player_death` proactive event. Two concurrent Claude calls, both potentially hitting rate limits, both outputting the error fallback. Fixed by filtering `!username` in the chat handler.

6. **"bruh my brain just lagged" spam on death** — Multiple death-related events (`under_attack`, `health_critical`, `player_death`) queued up and processed sequentially after death. Fixed by clearing the proactive queue when `player_death` fires so stale combat events are discarded.

7. **`bot.pvp.on` is not a function** — `registerPvpListeners` was calling `bot.pvp.on('stoppedAttacking', ...)`. The `stoppedAttacking` event is emitted on `bot`, not `bot.pvp`. Fixed to `bot.on('stoppedAttacking', ...)`. (Was already patched in memory from Session 5.)

### New Feature
- **`food_low` event** — fires when `bot.food < 14`, rate-limited to 60s cooldown. Bot receives `[EVENT] My food bar is at N/20 — I need to eat something.` and the system prompt already instructs it to embed `[ACTION:eat]` proactively. Brain now eats without being told.

### Files Modified
- `bot/actions/combat.js` — `_equipBestWeapon()` + call before `bot.pvp.attack()`
- `bot/actions/movement.js` — pathfind toward `bot.pvp.target` during combat
- `bot/bot.js` — module-level `mcData`, `foodsByName` eat lookup, `_lastFood` tracker, `food_low` event, `!username` chat filter
- `server/ws_server.py` — `asyncio.create_task` for game events, `_run_game_event` wrapper
- `server/brain.py` — clear proactive queue on `player_death`, `food_low` event prompt
- `config/settings.json` — `food_low: 60` cooldown

### Combat — Partially Verified
- Bot equips weapon ✓
- Bot chases and swings at mobs ✓
- Bot got stuck on terrain inside structure (pathfinding limitation, not a bug)
- Auto-flee from creeper — not yet confirmed
- `food_low` proactive eating — not yet confirmed

### Current State
- **Combat**: Weapon equip + movement working. Auto-defend fires. Further testing needed on normal difficulty.
- **Stability**: Pong disconnect cycling resolved. Death event spam resolved.
- **Food**: Proactive `food_low` event added; eat action confirmed working when triggered manually.

### End of Session — Phase 3 Spec Written
Designed full Phase 3 spec (`docs/PHASE3_DESIGN.md`). Remaining Phase 2 items
(creeper flee, food_low confirmation, biome/dawn/weather events) are low-risk
and will be naturally exercised during Phase 3 sessions.

### Next Session
- Implement Phase 3: `server/mood.py`, `server/memory.py`, brain integration
- See `docs/PHASE3_DESIGN.md` for full implementation order and design decisions

---

## Session 7 — Phase 3: Memory & Mood
**Date**: 2026-03-05
**Status**: Complete

### Overview
Implemented Phase 3 in full — mood state machine and session memory bank, both
integrated into the brain. Also established a multi-LLM dev workflow using
Claude Code as orchestrator with Codex CLI and Gemini CLI for delegated tasks.

### Completed

- **`server/mood.py`** — MoodTracker: 4-state machine (chill/hyped/nervous/frustrated),
  transition table driven by 8 game events, 5-minute decay back to chill via `tick()`
- **`server/memory.py`** — MemoryBank: FIFO-capped list (10 entries), stores only
  notable events (6 types, filtered by item/mob significance), formats as `[MEMORY]`
  block with relative timestamps
- **`server/brain.py`** — Integrated mood + memory into context injection:
  - `Mood:X` prepended as first field in every `[GAME STATE]` line
  - `[MEMORY]` block (5 most recent entries) injected into every user message
  - System prompt expanded with MOOD and MEMORY instruction sections
  - `handle_game_event()` calls `mood_tracker.on_event()` + `memory_bank.add()` before building prompt
  - `think()` reads current mood + memory for voice input path too
  - `max_tokens` bumped 150 → 200 to accommodate memory block overhead
- **`server/main.py`** — MoodTracker + MemoryBank instantiated at module level, wired into Brain
- **`config/settings.json`** — `max_tokens: 200`, `mood_decay_minutes: 5`
- **`agents/WORKFLOW.md`** — Documents Claude Code / Codex CLI / Gemini CLI dev-time task split

### Multi-LLM Dev Workflow
Established a 3-tool orchestration pattern for the session (in absence of OpenClaw):
- **Gemini CLI** — read pass over `brain.py`, `main.py`, spec; summarized all integration points before any code was written
- **Codex CLI** — implemented `mood.py` and `memory.py` from spec (well-defined, no ambiguity)
- **Claude Code** — handled `brain.py` integration (async flow, history injection), orchestrated the session, verified all output before commit

### Files Created
- `server/mood.py`
- `server/memory.py`
- `agents/WORKFLOW.md`

### Files Modified
- `server/brain.py`
- `server/main.py`
- `config/settings.json`

### Next Session
- Boot server on normal difficulty and verify:
  - `Mood:chill` appears in logs from start
  - Mood transitions log at DEBUG level on triggering events
  - `[MEMORY]` block grows naturally over a session
  - Claude references past events naturally in conversation
- Phase 4 planning: always-on VAD, wake word
