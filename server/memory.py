import logging
import time

logger = logging.getLogger(__name__)


class MemoryEntry:
    def __init__(self, summary: str, timestamp: float):
        self.summary = summary
        self.timestamp = timestamp


class MemoryBank:
    def __init__(self):
        self._entries = []

    def add(self, event_type, data):
        summary = None

        if event_type == "player_death":
            cause = data.get("cause", "unknown")
            summary = f"died to {cause}"
        elif event_type == "item_pickup":
            item = str(data.get("item", ""))
            item_lower = item.lower()
            if any(name in item_lower for name in ("diamond", "netherite", "totem")):
                who = "I" if data.get("collector") == "bot" else "you"
                summary = f"{who} picked up {item}"
        elif event_type == "mob_killed":
            mob = str(data.get("mob", ""))
            mob_lower = mob.lower()
            if mob_lower in ("creeper", "skeleton", "blaze", "wither_skeleton", "evoker", "pillager"):
                summary = f"killed a {mob}"
        elif event_type == "dawn":
            summary = "survived the night"
        elif event_type == "health_critical":
            hp = data.get("hp", data.get("health", "?"))
            summary = f"close call — HP dropped to {hp}"
        elif event_type == "biome_change":
            biome = data.get("biome", data.get("to", "unknown"))
            summary = f"entered {biome} biome"

        if summary is None:
            return

        self._entries.append(MemoryEntry(summary, time.time()))
        if len(self._entries) > 10:
            self._entries.pop(0)

    def format(self, max_entries=5) -> str:
        if not self._entries:
            return ""

        now = time.time()
        recent = self._entries[-max_entries:]
        lines = ["[MEMORY]"]
        for entry in reversed(recent):
            minutes = int((now - entry.timestamp) // 60)
            if minutes < 0:
                minutes = 0
            lines.append(f"- {minutes} min ago: {entry.summary}")
        return "\n".join(lines)

    def clear(self):
        self._entries.clear()
