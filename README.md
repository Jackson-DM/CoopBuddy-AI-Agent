# CoopBuddy AI Agent

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Minecraft](https://img.shields.io/badge/Minecraft-Java%201.20.4-brightgreen?logo=mojang-studios)
![Claude](https://img.shields.io/badge/AI-Claude%20Sonnet-orange?logo=anthropic)
![License](https://img.shields.io/badge/License-MIT-yellow)

**An AI companion that joins your Minecraft server and plays alongside you like a real friend.**

Talk to it with push-to-talk, it responds with voice and in-game chat. It reacts to mobs, weather, deaths, and follows you around the world.

```
                        ┌─────────────────────┐
   Mic (push-to-talk)   │   Python Brain       │
   ─────────────────────▶  faster-whisper STT  │
                        │  Claude Sonnet LLM   │       ┌──────────────┐
                        │  ElevenLabs TTS      │◀─────▶│  Minecraft   │
                        │                      │  WS   │  Server      │
   Speakers             │  WebSocket Server    │       │  (1.20.4)    │
   ◀─────────────────────  (port 8765)         │       └──────┬───────┘
                        └─────────────────────┘              │
                                                     ┌──────┴───────┐
                                                     │  Mineflayer  │
                                                     │  Bot (Node)  │
                                                     └──────────────┘
```

## Features

- **Voice Chat** — Hold V to talk, get spoken responses via ElevenLabs TTS (free pyttsx3 fallback)
- **AI Personality** — Chill co-op buddy powered by Claude, never breaks character
- **Game Awareness** — Reacts to hostile mobs, deaths, weather, low health, biome changes, and more (13 event types)
- **Combat AI** — Auto-defends when attacked, threat prioritization, flees creepers and low HP
- **Follows You** — Pathfinder-based movement, stays 3 blocks behind
- **In-Game Chat** — Every voice response echoed in Minecraft chat
- **Proactive Events** — Rate-limited reactions so it doesn't spam

## Tech Stack

| Component | Technology |
|-----------|-----------|
| AI Brain | Claude Sonnet 4.5 (Anthropic API) |
| Speech-to-Text | faster-whisper base.en (local, ~500ms) |
| Text-to-Speech | ElevenLabs streaming / pyttsx3 fallback |
| Bot Framework | Mineflayer + mineflayer-pathfinder + mineflayer-pvp |
| IPC Bridge | WebSocket (Python server ↔ Node client) |
| Voice Capture | sounddevice + keyboard (global hotkey) |

## Quick Start

### Prerequisites

- Python 3.11+ with pip
- Node.js 18+
- Minecraft Java Edition server (1.20.4, `online-mode=false`)
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- ElevenLabs API key (optional — falls back to free local TTS)

### Setup

```bash
# 1. Clone
git clone https://github.com/Jackson-DM/CoopBuddy-AI-Agent.git
cd CoopBuddy-AI-Agent

# 2. Configure
cp .env.example .env
# Edit .env with your API keys

# 3. Run (Windows)
start.bat
```

### Manual Setup

```bash
# Python dependencies
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Node dependencies
cd bot
npm install
cd ..

# Terminal 1: Python brain + voice
python -m server.main

# Terminal 2: Minecraft bot
cd bot && node bot.js
```

## Project Structure

```
CoopBuddy-AI-Agent/
├── server/               # Python — AI brain, voice, WebSocket server
│   ├── main.py           # Orchestrator (entry point)
│   ├── brain.py          # Claude AI personality engine
│   ├── voice.py          # PTT → STT → TTS pipeline
│   ├── ws_server.py      # WebSocket server (port 8765)
│   └── message_schema.py # Typed message envelopes
├── bot/                  # Node.js — Mineflayer Minecraft bot
│   ├── bot.js            # Bot entry point
│   ├── wsClient.js       # WebSocket client (connects to Python)
│   ├── actions/          # Bot action handlers
│   │   ├── movement.js   # Follow player via pathfinder
│   │   └── combat.js     # Attack/flee/auto-defend via pvp
│   └── context/          # Game state tracking
│       └── gameState.js  # Rolling world snapshot
├── config/
│   └── settings.json     # Runtime configuration
├── docs/                 # Design docs and session logs
├── start.bat             # One-click Windows launcher
├── requirements.txt      # Python dependencies
└── .env.example          # Environment variable template
```

## Roadmap

- [x] **Phase 1** — MVP: Voice chat + follow + mob reactions
- [x] **Phase 2a** — Game awareness (inventory, potion effects, 11 event types)
- [x] **Phase 2b** — Combat AI (auto-defend, attack/flee, threat priorities, 13 event types)
- [ ] **Phase 3** — Memory & mood (session memory, dynamic personality)
- [ ] **Phase 4** — Advanced voice (VAD, wake word)
- [ ] **Phase 5** — Multi-player & web dashboard
- [ ] **Phase 6** — Autonomous actions (gathering, building)

## License

MIT
