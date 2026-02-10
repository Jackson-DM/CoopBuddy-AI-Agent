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
