# Phase 3 — Memory & Mood: Design Spec

## Goal
Make CoopBuddy feel like a real companion with continuity and emotional state.
Right now the bot reacts well moment-to-moment but has zero memory — every session
it's a blank slate, and every event gets the same flat energy regardless of context.
Phase 3 adds two orthogonal systems that feed into the brain without changing the
existing event or voice pipelines.

---

## System 1 — Mood

### States
Four moods, only one active at a time:

| Mood | Vibe | Typical trigger |
|---|---|---|
| `chill` | Default. Relaxed, low energy. | No notable events. |
| `hyped` | Elevated. More excited, punchy. | Good loot, killed something scary, survived the night. |
| `nervous` | Jittery. Short sentences, reactive. | Creeper nearby, health critical, night fell. |
| `frustrated` | Salty. Sarcastic, a bit defeated. | Player or bot died, took repeated hits. |

### Transition Table
```
creeper_nearby    → nervous
health_critical   → nervous
night_fall        → nervous
under_attack      → nervous
player_death      → frustrated
item_pickup       → hyped  (notable items: diamond, netherite, totem only)
mob_killed        → hyped  (only if current mood is nervous — relief payoff)
dawn              → hyped  (survived the night)
```

Events not listed leave mood unchanged.

### Decay
If mood is not `chill` and no triggering event has occurred in **5 minutes**,
mood resets to `chill`. Prevents permanent frustration after a single death.

### Brain Integration
Mood is injected into the `[GAME STATE]` line as the first field:

```
[GAME STATE] Mood:nervous | HP:8/20 | Food:14/20 | Biome:plains | ...
```

System prompt gets a new section describing each mood so Claude interprets
the signal consistently. See §Implementation below.

---

## System 2 — Session Memory

### What Gets Remembered
A rolling list of notable events this session, capped at **10 entries**.
When full, oldest entry is dropped (FIFO).

| Event | Memory summary |
|---|---|
| `player_death` | `"died to {cause}"` |
| `item_pickup` | `"you/I picked up {item}"` (notable items only) |
| `mob_killed` | `"killed a {mob}"` (high-threat only: creeper, skeleton, blaze, wither_skeleton, evoker, pillager) |
| `dawn` | `"survived the night"` |
| `health_critical` | `"close call — HP dropped to {hp}"` |
| `biome_change` | `"entered {biome} biome"` |

Low-priority events (`zombie`, `slime`, weather) are not stored — memory should
feel meaningful, not noisy.

### Injection Format
Injected as a compact block prepended to the user message, after the game state line:

```
[GAME STATE] Mood:hyped | HP:18/20 | ...

[MEMORY]
- 4 min ago: survived the night
- 9 min ago: you picked up a diamond_sword
- 17 min ago: close call — HP dropped to 3
```

Only the **5 most recent** entries are injected per message (token budget).
Older entries stay in the bank for reference but aren't sent to Claude.

### Token Budget
- Game state: ~60 tokens
- Memory (5 entries): ~40 tokens
- Total context overhead increase: ~100 tokens
- `max_tokens` for responses bumped from 150 → 200 to compensate

---

## New Files

### `server/mood.py`
```
MoodTracker
  .mood: str                   — current mood ('chill' / 'hyped' / 'nervous' / 'frustrated')
  .on_event(event_type, data)  — apply transition table, reset decay timer
  .tick()                      — called periodically; decays mood if stale (optional, or lazy-check on access)
```

### `server/memory.py`
```
MemoryBank
  .add(event_type, data)       — creates and stores a MemoryEntry if event is notable
  .format(max_entries=5) -> str — returns [MEMORY] block string, or "" if empty
  .clear()                     — wipe all entries (not used in Phase 3, reserved for future)

MemoryEntry
  .summary: str
  .timestamp: float
```

---

## Modified Files

### `server/brain.py`
- `Brain.__init__` accepts `mood_tracker: MoodTracker` and `memory_bank: MemoryBank`
- `_format_game_state(gs, mood)` — adds `Mood:{mood}` as first field
- New `_format_memory(memory_bank)` — returns formatted memory block
- `ConversationHistory.add_user(text, game_state, mood, memory_bank)` — prepends
  both blocks to user message
- `handle_game_event` calls `mood_tracker.on_event()` and `memory_bank.add()` after
  processing each event (regardless of whether Claude was called)
- System prompt expanded with mood interpretation section (see below)

### `server/main.py`
- Instantiate `MoodTracker` and `MemoryBank` at startup
- Pass both into `Brain()`
- No other changes needed — mood/memory update happens inside brain on each event

### `config/settings.json`
- `brain.max_tokens`: 150 → 200
- `brain.mood_decay_minutes`: 5

---

## System Prompt Addition

Appended to the existing system prompt:

```
MOOD:
You'll see Mood:X in the [GAME STATE] block. Let it color your energy — don't
announce it, just embody it.
- chill: your baseline. relaxed, measured.
- hyped: something good just happened. faster, punchier, more exclamation.
- nervous: danger's close. jittery short sentences, eyes on the surroundings.
- frustrated: things went wrong. salty, a bit sarcastic, but still in it.
Mood shifts should feel natural, not sudden. A single event doesn't flip your
whole personality.

MEMORY:
You'll see a [MEMORY] block with recent session highlights. Reference these
naturally when relevant — "yeah after almost dying to that skeleton..." — but
don't recite them unprompted. They're context, not a script.
```

---

## Event Flow (updated)

```
game event arrives
  → mood_tracker.on_event()     ← updates mood state
  → memory_bank.add()           ← stores notable events
  → brain.handle_game_event()   ← rate-limited Claude call
      → _format_game_state(gs, mood.mood)
      → _format_memory(memory_bank)
      → prepend both to user message
      → Claude sees full context
      → response sent to TTS + chat
```

Voice input follows the same inject path via `brain.think()`.

---

## What Phase 3 Does NOT Include
- Cross-session persistence (no SQLite — memory resets on process restart)
- Autonomous mood-driven speech (bot won't randomly comment when bored — Phase 4)
- Explicit memory commands ("remember that") — Phase 4
- Mood visible in UI/dashboard — Phase 5

---

## Implementation Order
1. `server/mood.py` — MoodTracker (state machine + decay)
2. `server/memory.py` — MemoryBank (entries + formatter)
3. `server/brain.py` — integrate both, update `_format_game_state`, add `_format_memory`, update `add_user`, expand system prompt
4. `server/main.py` — instantiate + wire up
5. `config/settings.json` — bump max_tokens, add mood_decay_minutes
6. Test: verify mood field appears in logs, memory block grows over session, Claude references past events naturally
