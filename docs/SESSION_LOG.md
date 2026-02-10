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
