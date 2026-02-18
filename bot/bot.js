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
const pvp = require('mineflayer-pvp').plugin;
const wsClient = require('./wsClient');
const gameState = require('./context/gameState');
const { followPlayer, stopFollowing } = require('./actions/movement');
const combat = require('./actions/combat');

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

// Set on spawn — used by action handlers (e.g. eat)
let mcData = null;

// ── Create bot ──────────────────────────────────────────────────────────────

console.log(`[Bot] Connecting to ${MC_HOST}:${MC_PORT} as ${BOT_USERNAME}...`);

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  version: MC_VERSION,
  auth: 'offline',
});

// ── Load plugins ────────────────────────────────────────────────────────────

bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);

bot.once('spawn', () => {
  mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;       // Don't grief the world
  moves.allowParkour = true;
  moves.allowSprinting = true;
  bot.pathfinder.setMovements(moves);

  console.log(`[Bot] Spawned at ${bot.entity.position}`);

  // Register pvp listeners for combat state tracking
  combat.registerPvpListeners(bot);

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
let _lastRespawnTime = 0;
let _lastHealth = 20;
let _lastFood = 20;

// ── Game event listeners ────────────────────────────────────────────────────

// Chat messages (real player messages only — filter bot and system/empty-username messages)
bot.on('chat', (username, message) => {
  if (!username) return;              // system messages (death, join, etc.) have no username
  if (username === bot.username) return;
  sendGameEvent('player_message', { username, message });
});

// Hostile mob spawns within 16 blocks (debounced)
bot.on('entitySpawn', (entity) => {
  if (!gameState.HOSTILE_MOBS.has(entity.name)) return;

  const dist = bot.entity.position.distanceTo(entity.position);
  if (dist > 16) return;

  if (!shouldSendEvent('mob_spawn', COOLDOWNS.mob_spawn * 1000)) return;

  sendGameEvent('mob_spawn', {
    name: entity.name,
    distance: Math.round(dist),
  });
});

// Health changes — only alert on actual drops, mutually exclusive, skip post-respawn
bot.on('health', () => {
  const currentHealth = bot.health;
  const currentFood = bot.food;
  gameState.update({
    playerHealth: currentHealth,
    playerFood: currentFood,
  });

  // Food low — fire periodically while hungry (cooldown prevents spam)
  if (currentFood < 14 && shouldSendEvent('food_low', COOLDOWNS.food_low * 1000)) {
    sendGameEvent('food_low', { food: Math.round(currentFood) });
  }
  _lastFood = currentFood;

  // Only alert when health actually decreased
  if (currentHealth >= _lastHealth) {
    _lastHealth = currentHealth;
    return;
  }
  _lastHealth = currentHealth;

  // Skip health alerts for 5s after respawn
  if (Date.now() - _lastRespawnTime < 5000) return;
  if (currentHealth <= 0) return;

  // Mutually exclusive: critical takes priority over low
  if (currentHealth <= 6 && shouldSendEvent('health_critical', COOLDOWNS.health_critical * 1000)) {
    sendGameEvent('health_critical', { health: Math.round(currentHealth) });
  } else if (currentHealth <= 10 && shouldSendEvent('health_low', COOLDOWNS.health_low * 1000)) {
    sendGameEvent('health_low', { health: Math.round(currentHealth) });
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
  _lastRespawnTime = Date.now();
  _lastHealth = 20;
  gameState.update({ lastRespawn: _lastRespawnTime });
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

wsClient.onAction('eat', async () => {
  const food = bot.inventory.items().find(i => mcData && i.name in mcData.foodsByName);
  if (!food) {
    console.log('[Bot] No food in inventory');
    return;
  }
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log(`[Bot] Ate ${food.name}`);
  } catch (e) {
    console.log(`[Bot] Failed to eat: ${e.message}`);
  }
});

wsClient.onAction('attack_mob', (params) => {
  const mobName = params.name || null;
  const result = combat.attackNearest(bot, mobName);
  if (!result.success) {
    console.log(`[Bot] Cannot attack: ${result.reason}`);
    if (result.reason === 'health_too_low') {
      combat.fleeToPlayer(bot, PLAYER_NAME);
    }
  }
});

wsClient.onAction('flee', () => {
  combat.fleeToPlayer(bot, PLAYER_NAME);
});

wsClient.onAction('stop_attack', () => {
  combat.stopCombat(bot);
  console.log('[Bot] Stopped combat');
});

// ── Auto-defend: fight back when hit by a mob ────────────────────────────────

bot.on('entityHurt', (entity) => {
  if (entity !== bot.entity) return;

  // Find who hit us — check for nearest hostile within 5 blocks
  const botPos = bot.entity.position;
  let attacker = null;
  let closestDist = 5;

  for (const e of Object.values(bot.entities)) {
    if (!e || !e.position || e === bot.entity) continue;
    if (!gameState.HOSTILE_MOBS.has(e.name)) continue;
    const dist = botPos.distanceTo(e.position);
    if (dist < closestDist) {
      closestDist = dist;
      attacker = e;
    }
  }

  if (!attacker) return;

  const action = combat.onHurt(bot, attacker, PLAYER_NAME);
  if (action) {
    if (shouldSendEvent('under_attack', COOLDOWNS.under_attack * 1000)) {
      sendGameEvent('under_attack', {
        attacker: attacker.name,
        health: Math.round(bot.health),
        action_taken: action,
      });
    }
  }
});

// ── Mob killed event ─────────────────────────────────────────────────────────

bot.on('entityDead', (entity) => {
  if (!entity || !gameState.HOSTILE_MOBS.has(entity.name)) return;

  // Only report if we were fighting this mob or it's nearby
  const dist = bot.entity.position.distanceTo(entity.position);
  if (dist > 10) return;

  if (shouldSendEvent('mob_killed', COOLDOWNS.mob_killed * 1000)) {
    sendGameEvent('mob_killed', {
      mob: entity.name,
      distance: Math.round(dist),
    });
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
    const pos = bot.entity.position.floored();
    const block = bot.blockAt(pos);
    if (block && block.biome && block.biome.name) return block.biome.name;
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
