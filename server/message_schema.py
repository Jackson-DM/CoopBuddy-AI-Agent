"""
Typed message envelope definitions for the WebSocket bridge.

All messages are JSON objects with a 'type' field:
  - game_event: Node → Python (game events from Mineflayer)
  - action:     Python → Node (actions for the bot to perform)
  - ping/pong:  heartbeat (either direction)
"""

from typing import Any, Optional
import time


# ── Inbound: Node → Python ─────────────────────────────────────────────────

def make_game_event(event_type: str, data: dict, timestamp: Optional[float] = None) -> dict:
    """
    Wrapper for events flowing from the Mineflayer bot to the Python brain.

    event_type examples:
        "mob_spawn"       — hostile entity appeared nearby
        "player_death"    — local player died
        "player_message"  — in-game chat message received
        "game_state"      — periodic snapshot (health, biome, time, nearby entities)
        "bot_joined"      — bot successfully connected to server
        "bot_disconnected"
    """
    return {
        "type": "game_event",
        "event_type": event_type,
        "data": data,
        "timestamp": timestamp or time.time(),
    }


# ── Outbound: Python → Node ────────────────────────────────────────────────

def make_action(action: str, params: Optional[dict] = None) -> dict:
    """
    Wrapper for actions flowing from the Python brain to the Mineflayer bot.

    action examples:
        "send_chat"       — params: { message: str }
        "follow_player"   — params: { name: str }
        "stop_follow"     — params: {}
        "look_at"         — params: { x, y, z }
    """
    return {
        "type": "action",
        "action": action,
        "params": params or {},
    }


# ── Heartbeat ──────────────────────────────────────────────────────────────

def make_ping() -> dict:
    return {"type": "ping", "timestamp": time.time()}


def make_pong(ping_timestamp: float) -> dict:
    return {"type": "pong", "ping_timestamp": ping_timestamp, "timestamp": time.time()}


# ── Validation helpers ─────────────────────────────────────────────────────

VALID_TYPES = {"game_event", "action", "ping", "pong"}


def validate_message(msg: Any) -> bool:
    """Return True if msg is a dict with a known 'type' field."""
    if not isinstance(msg, dict):
        return False
    return msg.get("type") in VALID_TYPES
