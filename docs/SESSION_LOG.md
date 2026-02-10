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

## Session 2 — Full Rebuild & Implementation Pass
**Date**: 2026-02-10
**Status**: IN PROGRESS

### Overview
Second agent session rebuilding the project from the ground up — scaffolding, polished README, full module implementations, and pushing to GitHub.

### Task List (agent's queue)
1. ~~Create scaffolding files (.gitignore, .env.example, server/__init__.py)~~ **DONE**
2. Write portfolio-quality README.md — **IN PROGRESS**
3. Delete `nul` artifact and `git init` + GitHub push
4. Create `config/settings.json` and `requirements.txt`
5. Implement `server/brain.py` (Claude AI Brain)
6. Implement `server/voice.py` (Voice Pipeline)
7. Implement `bot/bot.js` (Main Bot Entry Point)
8. Implement `server/main.py` (Orchestrator)
9. Create `start.bat` and final git commit + push
10. ~~Install Python 3.11~~ **DONE**

### Notes
- Python 3.11 installed on the system this session
- Agent is doing a clean rebuild — not just patching Session 1 output
- `nul` file is a Windows artifact that will be cleaned up in step 3
- Repo will be initialized and pushed to GitHub this session

### Completed
*(will be filled in as work finishes)*

### Key Decisions
*(will be filled in as decisions are made)*
