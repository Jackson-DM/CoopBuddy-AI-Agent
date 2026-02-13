/**
 * CoopBuddy Bot — Main entry point.
 *
 * Creates Mineflayer bot, loads pathfinder, wires event listeners
 * and action handlers, connects to the Python brain via WebSocket.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const wsClient = require('./wsClient');
const gameState = require('./context/gameState');
const { followPlayer, stopFollowing } = require('./actions/movement');

// ── Load settings ───────────────────────────────────────────────────────────

const settings = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'config', 'settings.json'), 'utf8')
);
const COOLDOWNS = settings.brain.cooldowns;
console.log('[Bot] Loaded cooldowns:', COOLDOWNS);

// ── Config ──────────────────────────────────────────────────────────────────

const MC_HOST = process.env.MINECRAFT_HOST || 'localhost';
const MC_PORT = parseInt(process.env.MINECRAFT_PORT || '25565', 10);
const BOT_USERNAME = process.env.BOT_USERNAME || 'CoopBuddy';
const PLAYER_NAME = process.env.PLAYER_NAME || 'Jackson';
const MC_VERSION = '1.20.4';

// ── Create bot ──────────────────────────────────────────────────────────────

console.log(`[Bot] Connecting to ${MC_HOST}:${MC_PORT} as ${BOT_USERNAME}...`);

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  version: MC_VERSION,
  auth: 'offline',
});

// ── Load pathfinder ─────────────────────────────────────────────────────────

bot.loadPlugin(pathfinder);

bot.once('spawn', () => {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;       // Don't grief the world
  moves.allowParkour = true;
  moves.allowSprinting = true;
  bot.pathfinder.setMovements(moves);

  console.log(`[Bot] Spawned at ${bot.entity.position}`);

  // Send spawn event to Python
  sendGameEvent('bot_joined', {
    position: bot.entity.position,
    playerName: PLAYER_NAME,
  });

  // Auto-follow the player
  const player = bot.players[PLAYER_NAME];
  if (player && player.entity) {
    followPlayer(bot, PLAYER_NAME);
    console.log(`[Bot] Auto-following ${PLAYER_NAME}`);
  }

  // Start periodic game state snapshots
  setInterval(() => {
    gameState.refreshEntities(bot);
    gameState.refreshInventory(bot);
    gameState.refreshPotionEffects(bot);
    updatePlayerState();

    // ── Time-of-day transitions ──
    const currentTime = bot.time.timeOfDay;
    if (_lastTimeOfDay < 13000 && currentTime >= 13000 && shouldSendEvent('night_fall', COOLDOWNS.night_fall * 1000)) {
      sendGameEvent('night_fall', { time: currentTime });
    }
    if (_lastTimeOfDay > 22000 && currentTime < 1000 && shouldSendEvent('dawn', COOLDOWNS.dawn * 1000)) {
      sendGameEvent('dawn', { time: currentTime });
    }
    _lastTimeOfDay = currentTime;

    // ── Biome change ──
    const currentBiome = getBiomeName();
    if (currentBiome !== 'unknown' && _lastBiome !== 'unknown' && _lastBiome !== '' && currentBiome !== _lastBiome) {
      if (shouldSendEvent('biome_change', COOLDOWNS.biome_change * 1000)) {
        sendGameEvent('biome_change', { from: _lastBiome, to: currentBiome });
      }
    }
    _lastBiome = currentBiome;

    // ── Creeper proximity alert ──
    const nearbyCreepers = gameState.state.nearbyHostile.filter(
      (m) => m.name === 'creeper' && m.distance <= 8
    );
    if (nearbyCreepers.length > 0 && shouldSendEvent('creeper_nearby', COOLDOWNS.creeper_nearby * 1000)) {
      sendGameEvent('creeper_nearby', { distance: nearbyCreepers[0].distance });
    }

    const snapshot = gameState.getSnapshot();
    sendGameEvent('game_state', snapshot);
  }, 5000);
});

// ── Event debounce tracking ─────────────────────────────────────────────────

const lastEventSent = {};

function shouldSendEvent(eventType, cooldownMs) {
  const now = Date.now();
  const last = lastEventSent[eventType] || 0;
  if (now - last < cooldownMs) return false;
  lastEventSent[eventType] = now;
  return true;
}

// ── Module-level trackers for time/biome transitions ────────────────────────

let _lastTimeOfDay = 0;
let _lastBiome = '';

// ── Game event listeners ────────────────────────────────────────────────────

// Chat messages (from players, not the bot itself)
bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  sendGameEvent('player_message', { username, message });
});

// Hostile mob spawns within 16 blocks (debounced)
bot.on('entitySpawn', (entity) => {
  if (entity.type !== 'mob') return;
  if (!gameState.HOSTILE_MOBS.has(entity.name)) return;

  const dist = bot.entity.position.distanceTo(entity.position);
  if (dist > 16) return;

  if (!shouldSendEvent('mob_spawn', COOLDOWNS.mob_spawn * 1000)) return;

  sendGameEvent('mob_spawn', {
    name: entity.name,
    distance: Math.round(dist),
  });
});

// Health changes — alert when low (debounced: 45s)
bot.on('health', () => {
  gameState.update({
    playerHealth: bot.health,
    playerFood: bot.food,
  });

  if (bot.health <= 8 && bot.health > 0 && shouldSendEvent('health_critical', COOLDOWNS.health_critical * 1000)) {
    sendGameEvent('health_critical', { health: bot.health });
  }
  if (bot.health <= 6 && bot.health > 0 && shouldSendEvent('health_low', COOLDOWNS.health_low * 1000)) {
    sendGameEvent('health_low', { health: bot.health });
  }
});

// Death (debounced: 60s)
bot.on('death', () => {
  gameState.update({ lastDeath: Date.now() });
  if (shouldSendEvent('player_death', COOLDOWNS.player_death * 1000)) {
    sendGameEvent('player_death', { cause: 'Bot died' });
  }
});

// Respawn — auto re-follow after delay
bot.on('respawn', () => {
  gameState.update({ lastRespawn: Date.now() });
  console.log('[Bot] Respawned');

  setTimeout(() => {
    const player = bot.players[PLAYER_NAME];
    if (player && player.entity) {
      followPlayer(bot, PLAYER_NAME);
      console.log(`[Bot] Re-following ${PLAYER_NAME} after respawn`);
    }
  }, 2000);
});

// Weather (debounced: 120s)
bot.on('rain', () => {
  const isRaining = bot.isRaining;
  gameState.update({ isRaining });
  if (shouldSendEvent('weather_change', COOLDOWNS.weather_change * 1000)) {
    sendGameEvent('weather_change', { weather: isRaining ? 'rain' : 'clear' });
  }
});

// Player joins — auto-follow if it's our player
bot.on('playerJoined', (player) => {
  if (player.username === PLAYER_NAME) {
    sendGameEvent('player_join', { name: player.username });

    // Wait for entity to be visible, then follow
    setTimeout(() => {
      const p = bot.players[PLAYER_NAME];
      if (p && p.entity) {
        followPlayer(bot, PLAYER_NAME);
        console.log(`[Bot] ${PLAYER_NAME} joined — following`);
      }
    }, 2000);
  }
});

// Notable item pickups
bot.on('playerCollect', (collector, collected) => {
  if (!collected || !collector) return;
  // Only track pickups by the bot or the player
  const collectorName = collector.username || (collector === bot.entity ? BOT_USERNAME : null);
  if (collectorName !== BOT_USERNAME && collectorName !== PLAYER_NAME) return;

  const item = collected.getDroppedItem && collected.getDroppedItem();
  if (!item) return;
  if (!gameState.NOTABLE_ITEMS.has(item.name)) return;

  if (shouldSendEvent('item_pickup', COOLDOWNS.item_pickup * 1000)) {
    sendGameEvent('item_pickup', {
      item: item.name,
      collector: collectorName === BOT_USERNAME ? 'bot' : 'player',
    });
  }
});

// ── Action handlers (Python → Bot) ─────────────────────────────────────────

wsClient.onAction('send_chat', (params) => {
  const msg = params.message;
  if (msg) {
    bot.chat(msg);
  }
});

wsClient.onAction('follow_player', (params) => {
  const name = params.name || PLAYER_NAME;
  followPlayer(bot, name);
  console.log(`[Bot] Following ${name}`);
});

wsClient.onAction('stop_follow', () => {
  stopFollowing(bot);
  console.log('[Bot] Stopped following');
});

wsClient.onAction('look_at', (params) => {
  const { x, y, z } = params;
  if (x !== undefined && y !== undefined && z !== undefined) {
    const vec3 = require('vec3');
    bot.lookAt(vec3(x, y, z));
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function updatePlayerState() {
  gameState.update({
    playerPosition: bot.entity.position,
    biome: getBiomeName(),
    timeOfDay: bot.time.timeOfDay,
    dimension: bot.game.dimension,
  });
}

function getBiomeName() {
  try {
    const pos = bot.entity.position;
    const biome = bot.blockAt(pos)?.biome;
    if (biome && biome.name) return biome.name;
  } catch (e) {
    // Biome data might not be available
  }
  return 'unknown';
}

function sendGameEvent(eventType, data) {
  wsClient.send({
    type: 'game_event',
    event_type: eventType,
    data: data,
    timestamp: Date.now() / 1000,
  });
}

// ── Connect WebSocket ───────────────────────────────────────────────────────

wsClient.connect(bot);

// ── Error handling ──────────────────────────────────────────────────────────

bot.on('error', (err) => {
  console.error('[Bot] Error:', err.message);
});

bot.on('kicked', (reason) => {
  console.error('[Bot] Kicked:', reason);
});

bot.on('end', () => {
  console.log('[Bot] Disconnected from server');
  wsClient.disconnect();
  process.exit(0);
});

console.log('[Bot] Starting...');
