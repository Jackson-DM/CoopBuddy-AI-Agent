# CoopBuddy — Project Plan

## Overview
CoopBuddy is an AI companion agent that plays Minecraft alongside the user. It responds to voice input via push-to-talk (hold V) and reacts proactively to in-game events. The personality is a chill older brother / hype friend — human, imperfect, occasionally sarcastic.

## Architecture
```
Mic (hold V) → server/voice.py (AudioCapture)
             → server/voice.py (STT — faster-whisper)
             → server/brain.py (Claude API)
             → server/voice.py (TTS — ElevenLabs/pyttsx3)
             → Speakers

Minecraft events → bot/bot.js (event listeners)
               → bot/wsClient.js (WebSocket client)
               → server/ws_server.py (WebSocket server, port 8765)
               → server/main.py (orchestrator)
               → server/brain.py (proactive gate → Claude)
               → TTS + in-game chat echo
```

## Tech Stack
- **Python 3.11**: AI brain, voice pipeline, WebSocket server
- **Node.js 18+**: Mineflayer bot (joins game as real player)
- **IPC**: WebSocket (persistent, bidirectional, port 8765)
- **STT**: faster-whisper base.en (local, ~400-800ms CPU)
- **LLM**: Claude claude-sonnet-4-5-20250929 (Anthropic API)
- **TTS**: ElevenLabs streaming API
- **MC**: Java 1.20.4, online-mode=false

## Phases

### Phase 1 — MVP
- [x] Docs files
- [x] WebSocket bridge (Python server + Node client)
- [x] Mineflayer bot connects + follows player (VERIFIED IN-GAME)
- [x] Voice capture (push-to-talk V key) + STT (code complete, untested)
- [x] Claude brain (reactive + proactive) (code complete, needs API credits)
- [x] TTS output: ElevenLabs + pyttsx3 fallback (code complete, untested)
- [x] Proactive events: mob_spawn, health_low, player_death, weather_change, player_join
- [x] Event debouncing (bot-side + brain-side cooldowns)
- [x] In-game chat echo
- [x] Startup scripts + .env template
- [x] GitHub repo: https://github.com/Jackson-DM/CoopBuddy-AI-Agent
- [x] Anthropic API credits loaded — brain responds in character ✓
- [ ] **TODO**: Debounce weather_change events
- [ ] **TODO**: Test voice pipeline end-to-end
- [ ] **TODO**: Test on normal difficulty with working brain

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
