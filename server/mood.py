import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class MoodTracker:
    def __init__(self, mood_decay_minutes: int = 5):
        self.mood = "chill"
        self._mood_decay_seconds = mood_decay_minutes * 60
        self._last_trigger_time: Optional[float] = None

    def on_event(self, event_type, data):
        next_mood = None

        if event_type in ("creeper_nearby", "health_critical", "night_fall", "under_attack"):
            next_mood = "nervous"
        elif event_type == "player_death":
            next_mood = "frustrated"
        elif event_type == "item_pickup":
            item = str(data.get("item", "")).lower()
            if any(name in item for name in ("diamond", "netherite", "totem")):
                next_mood = "hyped"
        elif event_type == "mob_killed":
            if self.mood == "nervous":
                next_mood = "hyped"
        elif event_type == "dawn":
            next_mood = "hyped"

        if next_mood is not None:
            previous = self.mood
            self.mood = next_mood
            self._last_trigger_time = time.time()
            if self.mood != previous:
                logger.debug("Mood transition: %s -> %s", previous, self.mood)

    def tick(self):
        if self.mood == "chill" or self._last_trigger_time is None:
            return

        if time.time() - self._last_trigger_time > self._mood_decay_seconds:
            previous = self.mood
            self.mood = "chill"
            if self.mood != previous:
                logger.debug("Mood transition: %s -> %s", previous, self.mood)
