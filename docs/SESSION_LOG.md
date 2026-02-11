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

### Current State
- **Bot**: In-game, following player, surviving on peaceful ✓
- **WS Bridge**: Connected and relaying events ✓
- **Brain**: WORKING — responds in character via in-game chat, ~2-3s response time ✓
- **Voice**: Pipeline initialized, PTT key registered, untested end-to-end
- **TTS**: pyttsx3 fallback ready, ElevenLabs needs API key

### Next Session
- Debounce weather_change events
- Test voice pipeline (PTT → STT → brain → TTS)
- Test on normal/hard difficulty with working brain
- Consider Phase 2 features based on how it feels
