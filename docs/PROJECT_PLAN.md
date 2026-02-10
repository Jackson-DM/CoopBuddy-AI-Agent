# CoopBuddy — Project Plan

## Overview
CoopBuddy is an AI companion agent that plays Minecraft alongside the user. It responds to voice input via push-to-talk (hold V) and reacts proactively to in-game events. The personality is a chill older brother / hype friend — human, imperfect, occasionally sarcastic.

## Architecture
```
Mic → voice/input.py (push-to-talk)
    → voice/stt.py (faster-whisper, local)
    → brain/agent.py (Claude API)
    → voice/tts.py (ElevenLabs streaming)
    → Speakers

Minecraft events → bot/eventHandlers.js
               → bot/wsClient.js
               → server/ws_server.py (WebSocket bridge, port 8765)
               → brain/agent.py (proactive gate → Claude)
               → voice/tts.py + in-game chat echo
```

## Tech Stack
- **Python 3.10+**: AI brain, voice pipeline, WebSocket server
- **Node.js 18+**: Mineflayer bot (joins game as real player)
- **IPC**: WebSocket (persistent, bidirectional, port 8765)
- **STT**: faster-whisper base.en (local, ~400-800ms CPU)
- **LLM**: Claude claude-sonnet-4-5-20250929 (Anthropic API)
- **TTS**: ElevenLabs streaming API
- **MC**: Java 1.20.4, online-mode=false

## Phases

### Phase 1 — MVP (Implemented)
- [x] Docs files
- [x] WebSocket bridge (Python server + Node client)
- [x] Mineflayer bot connects + follows player
- [x] Voice capture (push-to-talk V key) + STT
- [x] Claude brain (reactive, voice-only)
- [x] ElevenLabs TTS output
- [x] Proactive event: hostile mob spawn
- [x] In-game chat echo
- [x] Startup scripts + .env template

### Phase 2 — Full Game Awareness (Future)
- Full game state: inventory, effects, dimension
- 8+ proactive event types (player death, diamond found, night falls, biome change, creeper explosion, health critical)
- Bot combat with mineflayer-pvp
- Tunable cooldowns in config/

### Phase 3 — Memory & Mood (Future)
- Short-term mood state injected into system prompt dynamically
- Session memory (key events this session)
- Optional cross-session SQLite memory

### Phase 4 — Advanced Voice (Future)
- Toggle always-on VAD (voice/vad.py activation)
- Optional wake word

### Phase 5 — Multi-Player & Dashboard (Future)
- Multi-player awareness
- Web dashboard (FastAPI + React)

### Phase 6 — Autonomous Actions (Future)
- Autonomous resource gathering
- Building assistance

## Latency Targets
- faster-whisper (5s clip, CPU): < 1.0s
- Claude API (short prompt): < 1.5s
- ElevenLabs first chunk: < 0.8s
- V release → first audio: **< 2.5s total**
