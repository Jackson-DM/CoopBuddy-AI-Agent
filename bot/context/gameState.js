/**
 * Rolling game state snapshot.
 *
 * Maintains the last-known state of the Minecraft world from the bot's perspective.
 * State is updated by eventHandlers.js and read by wsClient event messages.
 */

const state = {
  // Player info
  playerName: null,
  playerHealth: 20,
  playerFood: 20,
  playerPosition: null,

  // World info
  biome: 'unknown',
  timeOfDay: 0,        // 0-24000 ticks (0=dawn, 6000=noon, 13000=dusk, 18000=midnight)
  isRaining: false,
  dimension: 'overworld',

  // Nearby entities (updated by entitySpawn/entityGone events)
  nearbyHostile: [],   // [{ name, distance, position }]
  nearbyPassive: [],

  // Session events
  lastDeath: null,
  lastRespawn: null,
};

/**
 * Get a minimal snapshot for injecting into AI context.
 * @returns {object}
 */
function getSnapshot() {
  return {
    playerHealth: state.playerHealth,
    playerFood: state.playerFood,
    biome: state.biome,
    timeOfDay: _formatTime(state.timeOfDay),
    dimension: state.dimension,
    isRaining: state.isRaining,
    nearbyHostile: state.nearbyHostile.slice(0, 5),   // cap at 5 for context
    nearbyPassive: state.nearbyPassive.slice(0, 3),
  };
}

/**
 * Update state fields. Accepts partial updates.
 * @param {object} updates
 */
function update(updates) {
  Object.assign(state, updates);
}

/**
 * Update nearby entities from bot.entities scan.
 * @param {object} bot - mineflayer bot instance
 * @param {number} maxDistance - only include entities within this range
 */
function refreshEntities(bot, maxDistance = 20) {
  const hostiles = [];
  const passives = [];
  const botPos = bot.entity.position;

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position || entity === bot.entity) continue;
    if (entity.type !== 'mob') continue;

    const dist = botPos.distanceTo(entity.position);
    if (dist > maxDistance) continue;

    const entry = {
      name: entity.name || entity.type,
      distance: Math.round(dist),
    };

    if (HOSTILE_MOBS.has(entity.name)) {
      hostiles.push(entry);
    } else {
      passives.push(entry);
    }
  }

  // Sort by distance
  hostiles.sort((a, b) => a.distance - b.distance);
  passives.sort((a, b) => a.distance - b.distance);

  state.nearbyHostile = hostiles;
  state.nearbyPassive = passives;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _formatTime(ticks) {
  if (ticks < 1000) return 'dawn';
  if (ticks < 6000) return 'morning';
  if (ticks < 12000) return 'afternoon';
  if (ticks < 13000) return 'dusk';
  if (ticks < 18000) return 'night';
  return 'late night';
}

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'witch', 'blaze', 'ghast', 'phantom', 'drowned', 'husk', 'stray',
  'pillager', 'ravager', 'vindicator', 'evoker', 'vex', 'zombie_villager',
  'warden', 'piglin_brute', 'hoglin', 'zoglin', 'slime', 'magma_cube',
]);

module.exports = { getSnapshot, update, refreshEntities, HOSTILE_MOBS, state };
