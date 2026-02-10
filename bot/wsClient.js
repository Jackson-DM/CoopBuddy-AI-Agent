/**
 * WebSocket client — Node.js side of the IPC bridge.
 *
 * Connects to Python server at ws://localhost:8765.
 * Implements exponential backoff: 1 → 2 → 4 → 8 → 30s (max).
 * 15s ping/pong heartbeat to detect dead connections.
 *
 * Usage:
 *   const wsClient = require('./wsClient');
 *   wsClient.connect(bot);
 *   wsClient.send({ type: 'game_event', event_type: 'mob_spawn', data: {...}, timestamp: Date.now() / 1000 });
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8765';
const PING_INTERVAL_MS = 15_000;
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 30_000]; // ms

let ws = null;
let bot = null;
let reconnectAttempt = 0;
let pingTimer = null;
let pongReceived = true; // assume healthy until proven otherwise
let intentionallyClosed = false;

// Callbacks registered by eventHandlers / bot.js
const actionHandlers = {};

/**
 * Register a handler for a specific action type from Python.
 * @param {string} action - e.g. "send_chat", "follow_player"
 * @param {Function} handler - function(params)
 */
function onAction(action, handler) {
  actionHandlers[action] = handler;
}

/**
 * Connect to the Python WebSocket server.
 * @param {object} botInstance - the mineflayer bot (used in action handlers)
 */
function connect(botInstance) {
  bot = botInstance;
  intentionallyClosed = false;
  _connect();
}

function _connect() {
  if (intentionallyClosed) return;

  console.log(`[WSClient] Connecting to ${WS_URL} (attempt ${reconnectAttempt + 1})`);

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('[WSClient] Connected to Python bridge');
    reconnectAttempt = 0;
    pongReceived = true;
    _startHeartbeat();
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      console.warn('[WSClient] Non-JSON message received:', data.toString().slice(0, 100));
      return;
    }

    if (msg.type === 'ping') {
      _send({ type: 'pong', ping_timestamp: msg.timestamp, timestamp: Date.now() / 1000 });
      return;
    }

    if (msg.type === 'pong') {
      pongReceived = true;
      return;
    }

    if (msg.type === 'action') {
      _handleAction(msg);
      return;
    }

    console.debug('[WSClient] Unhandled message type:', msg.type);
  });

  ws.on('close', (code, reason) => {
    console.log(`[WSClient] Disconnected (code=${code}): ${reason}`);
    _stopHeartbeat();
    ws = null;
    if (!intentionallyClosed) {
      _scheduleReconnect();
    }
  });

  ws.on('error', (err) => {
    // 'close' fires after 'error', so let reconnect happen there
    if (err.code !== 'ECONNREFUSED') {
      console.error('[WSClient] Error:', err.message);
    }
  });
}

function _handleAction(msg) {
  const { action, params } = msg;
  const handler = actionHandlers[action];
  if (handler) {
    try {
      handler(params, bot);
    } catch (e) {
      console.error(`[WSClient] Error in action handler '${action}':`, e.message);
    }
  } else {
    console.warn(`[WSClient] No handler registered for action: ${action}`);
  }
}

function _startHeartbeat() {
  _stopHeartbeat();
  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!pongReceived) {
      console.warn('[WSClient] Pong not received — closing stale connection');
      ws.terminate();
      return;
    }
    pongReceived = false;
    _send({ type: 'ping', timestamp: Date.now() / 1000 });
  }, PING_INTERVAL_MS);
}

function _stopHeartbeat() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function _scheduleReconnect() {
  const delay = BACKOFF_STEPS[Math.min(reconnectAttempt, BACKOFF_STEPS.length - 1)];
  reconnectAttempt++;
  console.log(`[WSClient] Reconnecting in ${delay / 1000}s...`);
  setTimeout(_connect, delay);
}

/**
 * Send a message to Python. Returns true if sent, false if not connected.
 * @param {object} msg - JSON-serializable object
 */
function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch (e) {
    console.error('[WSClient] Send error:', e.message);
    return false;
  }
}

/**
 * Alias for internal use (avoids name collision with module.exports.send).
 */
function _send(msg) {
  return send(msg);
}

/**
 * Gracefully disconnect (no reconnect).
 */
function disconnect() {
  intentionallyClosed = true;
  _stopHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
  }
}

/**
 * Returns true if currently connected.
 */
function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

module.exports = { connect, disconnect, send, onAction, isConnected };
