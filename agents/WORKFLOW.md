# CoopBuddy — Dev-Time Multi-LLM Workflow

## Overview

Three tools, three lanes. Claude Code acts as orchestrator and signals when to
hand off to Codex or Gemini. When not using OpenClaw, Claude Code drives the
session and explicitly tells you when to switch tools and what prompt to give them.

---

## Tool Roles

### Claude Code
**Use for:** Architecture decisions, complex debugging, async/system reasoning,
integration work that touches multiple existing files, writing specs and plans,
verifying correctness of tricky logic, orchestrating the session.

**Do NOT use for:** Writing boilerplate from a fully-defined spec, mechanical
refactors, reading large amounts of existing code just to summarize it.

---

### Codex CLI
**Use for:** Implementing well-defined specs (the design doc says exactly what
to build), creating new files from scratch when structure is clear, mechanical
refactoring, small isolated changes where intent is unambiguous.

**Prompt pattern:**
```
Read [file(s) for context].
Implement [task] exactly as described in [spec/doc].
Do not add features beyond the spec. Match the existing code style.
```

**Do NOT use for:** Tasks that require reasoning about tradeoffs, debugging
unknown issues, architecture decisions, anything touching multiple systems
simultaneously.

---

### Gemini CLI
**Use for:** Reading large amounts of existing code before a change (its 1M
token context fits the whole codebase), summarizing what currently exists,
searching across many files, generating documentation from code.

**Prompt pattern:**
```
Read these files: [list].
Summarize / Find / Explain [specific question].
Do not make any changes.
```

**Do NOT use for:** Implementing features, making code changes, complex
reasoning about system behavior.

---

## Decision Rule

```
Do I know exactly what code to write?
  YES → Codex CLI
  NO  → Do I need to read a lot of existing code first?
          YES → Gemini CLI (read/summarize) → then Codex CLI (implement)
          NO  → Claude Code (reason → plan → implement)
```

---

## Handoff Signals

Claude Code will explicitly signal handoffs in this format:

  -> Switch to Codex CLI — prompt: "..."
  -> Switch to Gemini CLI — run: "..."
  -> Back to Claude Code — paste output and continue

---

## Phase 3 Task Split (reference)

| Task                                              | Tool        |
|---------------------------------------------------|-------------|
| Read brain.py + main.py + spec, summarize delta   | Gemini CLI  |
| Write server/mood.py (specced state machine)      | Codex CLI   |
| Write server/memory.py (specced data structure)   | Codex CLI   |
| Integrate mood + memory into brain.py             | Claude Code |
| Wire MoodTracker + MemoryBank into main.py        | Codex CLI   |
| Update config/settings.json                       | Codex CLI   |
| Verify integration, test plan, edge cases         | Claude Code |

---

## Notes

- OpenClaw handles this orchestration automatically when available.
- In manual mode, Claude Code plays the orchestrator role for the session.
- Always paste Codex/Gemini output back to Claude Code before integration
  work so it can verify correctness before files are committed.
