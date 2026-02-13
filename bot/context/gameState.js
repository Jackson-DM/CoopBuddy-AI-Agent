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

  // Inventory & effects
  inventory: [],       // [{ name, count }]
  potionEffects: [],   // [{ name, amplifier }]

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
    inventory: state.inventory,
    potionEffects: state.potionEffects,
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

// ── Notable items (for inventory highlights and pickup events) ──────────────

const NOTABLE_ITEMS = new Set([
  'diamond', 'diamond_sword', 'diamond_pickaxe', 'diamond_axe', 'diamond_shovel',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
  'netherite_ingot', 'netherite_sword', 'netherite_pickaxe', 'netherite_axe',
  'netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots',
  'totem_of_undying', 'elytra', 'enchanted_golden_apple', 'nether_star',
  'trident', 'beacon', 'dragon_egg', 'end_crystal',
]);

/**
 * Refresh inventory snapshot from bot.
 * Highlights notable items + equipped gear + top resources.
 * @param {object} bot - mineflayer bot instance
 */
function refreshInventory(bot) {
  const items = bot.inventory.items();
  const notable = [];
  const resources = [];

  for (const item of items) {
    const entry = { name: item.name, count: item.count };
    if (NOTABLE_ITEMS.has(item.name)) {
      notable.push(entry);
    } else {
      resources.push(entry);
    }
  }

  // Add equipped armor + offhand
  const armorSlots = [5, 6, 7, 8, 45]; // helmet, chest, legs, boots, offhand
  for (const slot of armorSlots) {
    const item = bot.inventory.slots[slot];
    if (item) {
      notable.push({ name: item.name, count: item.count });
    }
  }

  // Sort resources by count descending, take top 5
  resources.sort((a, b) => b.count - a.count);
  const compact = [...notable, ...resources.slice(0, 5)];

  state.inventory = compact;
}

/**
 * Refresh active potion effects from bot entity.
 * @param {object} bot - mineflayer bot instance
 */
function refreshPotionEffects(bot) {
  const effects = [];
  const entityEffects = bot.entity.effects;
  if (!entityEffects || entityEffects.length === 0) {
    state.potionEffects = [];
    return;
  }

  for (const effect of entityEffects) {
    let name = `effect_${effect.id}`;
    try {
      const reg = bot.registry.effects[effect.id];
      if (reg && reg.name) name = reg.name;
    } catch (e) { /* fallback to id */ }
    effects.push({ name, amplifier: effect.amplifier });
  }

  state.potionEffects = effects;
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

module.exports = {
  getSnapshot, update, refreshEntities, refreshInventory, refreshPotionEffects,
  HOSTILE_MOBS, NOTABLE_ITEMS, state,
};
