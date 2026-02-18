# CoopBuddy — Decisions & Context Notes

## Architecture Decisions

### IPC: WebSocket (not HTTP)
Chose WebSocket over REST/HTTP because:
- Game events are a continuous stream (mob spawns, health ticks, etc.)
- Need bidirectional comms (Python → Node for actions, Node → Python for events)
- Zero per-message overhead after handshake
- Python is WS server (port 8765); Node is client

### STT: faster-whisper base.en
- ~400-800ms on CPU (acceptable for push-to-talk feel)
- Free, local, private — no latency variance from cloud
- base.en model is the sweet spot for speed vs accuracy
- Discard results with avg_logprob < -1.0 or < 3 words (noise filter)

### LLM: Claude claude-sonnet-4-5-20250929
- Best balance of latency and quality
- Context injection via structured [GAME STATE] text block
- max_tokens=150 to enforce short responses
- History: last 10 turns (rolling window in `server/brain.py` ConversationHistory class)
- Action tags embedded in responses: `[ACTION:follow_player:Name]`, parsed and stripped before TTS

### TTS: ElevenLabs Streaming + pyttsx3 Fallback
- ElevenLabs primary: `eleven_turbo_v2_5` model, PCM 16kHz output, played via sounddevice
- pyttsx3 fallback: Windows SAPI5, activates automatically when no ElevenLabs API key
- asyncio.Lock prevents overlapping TTS calls
- Provider configurable in `config/settings.json` (`elevenlabs` / `pyttsx3` / `none`)

### Proactive Rate Limiting
- Per-event-type cooldown dict (e.g., mob_spawn: 30s)
- Global concurrent call limit: 1 at a time
- Max queue depth: 2 (drop events if backed up)
- Proactive events suspended while push-to-talk key held (voice always wins)

### Bot Movement: mineflayer-pathfinder
- Stay 3-5 blocks behind player (goal: FollowEntity, distance 3-5)
- Most mature pathfinding plugin for Mineflayer

### Bot Combat: mineflayer-pvp
- Melee combat via `bot.pvp.attack(entity)`
- Threat priority map determines target selection (creeper=99 always flee, skeleton=5, zombie=2, etc.)
- Auto-defend on `entityHurt` — finds nearest hostile within 5 blocks, attacks or flees
- Flee logic: HP <= 6 or creeper → path to player instead of fighting
- Brain can override with `[ACTION:attack_mob:type]`, `[ACTION:flee]`, `[ACTION:stop_attack]`
- `pvp.stoppedAttacking` event clears combat state

### Event Debouncing (bot-side)
- `bot/bot.js` has a `shouldSendEvent(eventType, cooldownMs)` function
- All 13 event cooldowns live in `config/settings.json` under `brain.cooldowns`
- Brain-side also has per-event cooldowns as a second layer

### Minecraft Version: Java 1.20.4, online-mode=false
- Mineflayer 4.22.0 compatible
- online-mode=false means bot needs no premium account
- Bot can now survive on normal/hard difficulty with combat AI
- Player in-game username: `JaxieJ` (set in `.env` as `PLAYER_NAME`)

## Personality Notes
The personality must feel human, not AI:
- Default energy is chill/low-key — hype hits harder because it's rare
- Short fragments are fine ("Bro." is a complete response)
- Light swearing OK (crap, damn, hell) — hard swears never
- Never say "As an AI" or any meta-commentary
- Be slightly wrong sometimes — that's human
- Has opinions: Nether is sick, Phantoms are the worst, Endermen = slightly nervous

## File Notes
- `.env` holds API keys — never committed (in .gitignore)
- `config/settings.json` holds user-tunable runtime settings (PTT key, cooldowns, model, TTS provider)
- `DISABLE_MINECRAFT=true` in .env skips bot connection for voice-only testing
- GitHub repo: https://github.com/Jackson-DM/CoopBuddy-AI-Agent
- Run with `start.bat` (Windows) or manually: `python -m server.main` + `cd bot && node bot.js`

## Module Map
- `server/main.py` — Orchestrator entry point, wires voice + brain + WS server
- `server/brain.py` — Claude AI engine, conversation history, proactive event handling
- `server/voice.py` — PTT capture → STT → TTS pipeline
- `server/ws_server.py` — Python WebSocket server (port 8765)
- `server/message_schema.py` — Typed message envelopes (game_event, action, ping/pong)
- `bot/bot.js` — Mineflayer bot entry point, event listeners, action handlers
- `bot/wsClient.js` — Node WebSocket client with exponential backoff
- `bot/actions/movement.js` — Follow/stop pathfinder actions
- `bot/actions/combat.js` — Attack/flee/stop combat actions (mineflayer-pvp)
- `bot/context/gameState.js` — Rolling game state snapshot
