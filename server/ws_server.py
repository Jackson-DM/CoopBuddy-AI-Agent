"""
WebSocket server — Python side of the IPC bridge.

Listens on ws://localhost:8765
Receives game_event messages from Node/Mineflayer.
Sends action messages to Node/Mineflayer.
"""

import asyncio
import json
import logging
import time
from typing import Optional, Callable, Awaitable

import websockets
from websockets.server import WebSocketServerProtocol

from server.message_schema import make_pong, validate_message

logger = logging.getLogger(__name__)

PORT = 8765
PING_INTERVAL = 15  # seconds


class WSServer:
    def __init__(self, on_game_event: Callable[[dict], Awaitable[None]]):
        """
        Args:
            on_game_event: async callback invoked whenever a game_event arrives.
                           Signature: async def handler(message: dict) -> None
        """
        self._on_game_event = on_game_event
        self._connection: Optional[WebSocketServerProtocol] = None
        self._send_lock = asyncio.Lock()
        self._server = None

    # ── Public API ─────────────────────────────────────────────────────────

    async def send_action(self, action: str, params: Optional[dict] = None) -> bool:
        """Send an action to the Mineflayer bot. Returns False if no connection."""
        if self._connection is None:
            logger.warning("send_action called with no active bot connection")
            return False
        msg = {"type": "action", "action": action, "params": params or {}}
        return await self._send(msg)

    async def send_chat(self, message: str) -> bool:
        """Convenience wrapper: send a chat message via the bot."""
        # Minecraft chat limit is 256 chars; trim to be safe
        truncated = message[:250]
        return await self.send_action("send_chat", {"message": truncated})

    # ── Server lifecycle ───────────────────────────────────────────────────

    async def start(self):
        logger.info(f"WebSocket server starting on ws://localhost:{PORT}")
        self._server = await websockets.serve(
            self._handle_connection,
            "localhost",
            PORT,
            ping_interval=None,   # we do manual ping/pong
            ping_timeout=None,
        )
        logger.info("WebSocket server ready")

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            logger.info("WebSocket server stopped")

    # ── Internal ───────────────────────────────────────────────────────────

    async def _handle_connection(self, websocket: WebSocketServerProtocol):
        remote = websocket.remote_address
        logger.info(f"Bot connected from {remote}")
        self._connection = websocket

        ping_task = asyncio.create_task(self._heartbeat(websocket))

        try:
            async for raw in websocket:
                await self._dispatch(raw)
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"Bot disconnected: {e}")
        finally:
            ping_task.cancel()
            self._connection = None
            logger.info("Bot connection cleaned up")

    async def _dispatch(self, raw: str):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"Received non-JSON message: {raw[:100]}")
            return

        if not validate_message(msg):
            logger.warning(f"Invalid message schema: {msg}")
            return

        msg_type = msg.get("type")

        if msg_type == "ping":
            await self._send(make_pong(msg.get("timestamp", time.time())))

        elif msg_type == "pong":
            pass  # heartbeat acknowledged

        elif msg_type == "game_event":
            # Fire as a background task so the message loop stays responsive to pings
            asyncio.create_task(self._run_game_event(msg))

        else:
            logger.debug(f"Unhandled message type: {msg_type}")

    async def _run_game_event(self, msg: dict):
        """Background task wrapper for game event handler — isolates errors from message loop."""
        try:
            await self._on_game_event(msg)
        except Exception as e:
            logger.error(f"Error in game_event handler: {e}", exc_info=True)

    async def _send(self, msg: dict) -> bool:
        if self._connection is None:
            return False
        try:
            async with self._send_lock:
                await self._connection.send(json.dumps(msg))
            return True
        except websockets.exceptions.ConnectionClosed:
            logger.warning("Tried to send but connection is closed")
            self._connection = None
            return False
        except Exception as e:
            logger.error(f"Send error: {e}")
            return False

    async def _heartbeat(self, websocket: WebSocketServerProtocol):
        """Send a ping every PING_INTERVAL seconds to keep the connection alive."""
        try:
            while True:
                await asyncio.sleep(PING_INTERVAL)
                ping_msg = {"type": "ping", "timestamp": time.time()}
                try:
                    await websocket.send(json.dumps(ping_msg))
                except websockets.exceptions.ConnectionClosed:
                    break
        except asyncio.CancelledError:
            pass
