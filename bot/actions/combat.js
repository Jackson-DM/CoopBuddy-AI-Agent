/**
 * Combat actions — attack hostiles, flee when in danger.
 *
 * Uses mineflayer-pvp for melee combat and pathfinder for fleeing.
 * Mirrors the movement.js pattern (module-level state, start/stop functions).
 */

const { goals } = require('mineflayer-pathfinder');
const { GoalFollow } = goals;
const gameState = require('../context/gameState');

// Best-to-worst melee weapons for auto-equip
const WEAPON_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword',
  'netherite_axe',   'diamond_axe',   'iron_axe',   'stone_axe',   'golden_axe',   'wooden_axe',
];

/**
 * Equip the best melee weapon in inventory, if any.
 * Falls back to fists silently.
 */
async function _equipBestWeapon(bot) {
  for (const name of WEAPON_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name);
    if (item) {
      await bot.equip(item, 'hand');
      console.log(`[Combat] Equipped ${item.name}`);
      return;
    }
  }
  console.log('[Combat] No weapon found — using fists');
}

// Threat priority — higher = more dangerous. Creeper = always flee.
const THREAT_PRIORITY = {
  creeper: 99,   // never melee
  skeleton: 5,
  wither_skeleton: 6,
  blaze: 5,
  spider: 3,
  cave_spider: 3,
  zombie: 2,
  drowned: 2,
  husk: 2,
  stray: 4,
  phantom: 4,
  pillager: 4,
  vindicator: 5,
  evoker: 6,
  witch: 5,
  enderman: 1,
  slime: 1,
  magma_cube: 1,
};

const FLEE_HP_THRESHOLD = 6;
const ALWAYS_FLEE = new Set(['creeper']);

let combatActive = false;
let currentTarget = null;

/**
 * Attack the nearest hostile mob by name (or any hostile if no name given).
 * @param {object} bot - mineflayer bot
 * @param {string} [mobName] - specific mob type to target, or null for nearest
 * @returns {{ success: boolean, target?: string, reason?: string }}
 */
function attackNearest(bot, mobName) {
  // Low HP → force flee instead
  if (bot.health <= FLEE_HP_THRESHOLD) {
    return { success: false, reason: 'health_too_low' };
  }

  const entity = _findTarget(bot, mobName);
  if (!entity) {
    return { success: false, reason: 'no_target_found' };
  }

  // Never melee creepers
  if (ALWAYS_FLEE.has(entity.name)) {
    return { success: false, reason: 'mob_too_dangerous' };
  }

  combatActive = true;
  currentTarget = entity;

  const dist = Math.round(bot.entity.position.distanceTo(entity.position));
  console.log(`[Combat] Attacking ${entity.name} (${dist} blocks)`);

  // Equip weapon first, then hand off to pvp plugin (both async, fire-and-forget)
  _equipBestWeapon(bot)
    .then(() => bot.pvp.attack(entity))
    .catch(e => {
      combatActive = false;
      currentTarget = null;
      console.log(`[Combat] Attack failed: ${e.message}`);
    });

  return { success: true, target: entity.name };
}

/**
 * Stop attacking and flee to the player.
 * @param {object} bot - mineflayer bot
 * @param {string} playerName - player to flee toward
 */
function fleeToPlayer(bot, playerName) {
  stopCombat(bot);

  const player = bot.players[playerName];
  if (!player || !player.entity) {
    console.log('[Combat] Cannot flee — player not visible');
    return;
  }

  try {
    const goal = new GoalFollow(player.entity, 2);
    bot.pathfinder.setGoal(goal, true);
    console.log(`[Combat] Fleeing to ${playerName}`);
  } catch (e) {
    console.log(`[Combat] Flee pathfinding error: ${e.message}`);
  }
}

/**
 * Stop all combat activity.
 * @param {object} bot - mineflayer bot
 */
function stopCombat(bot) {
  combatActive = false;
  currentTarget = null;
  try {
    bot.pvp.stop();
  } catch (e) {
    // pvp may not be active
  }
}

/**
 * Check if combat is currently active.
 * @returns {boolean}
 */
function isInCombat() {
  return combatActive;
}

/**
 * Get the current target entity.
 * @returns {object|null}
 */
function getTarget() {
  return currentTarget;
}

/**
 * Handle being hit — auto-defend logic.
 * Returns the action taken: 'attack', 'flee', or null.
 * @param {object} bot - mineflayer bot
 * @param {object} attacker - entity that hit the bot
 * @param {string} playerName - player to flee toward if needed
 * @returns {string|null}
 */
function onHurt(bot, attacker, playerName) {
  if (!attacker || !gameState.HOSTILE_MOBS.has(attacker.name)) return null;

  // Already in combat with this target
  if (combatActive && currentTarget && currentTarget.id === attacker.id) return null;

  // Low HP or creeper → flee
  if (bot.health <= FLEE_HP_THRESHOLD || ALWAYS_FLEE.has(attacker.name)) {
    fleeToPlayer(bot, playerName);
    return 'flee';
  }

  // Fight back
  const result = attackNearest(bot, attacker.name);
  return result.success ? 'attack' : null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find the best target entity.
 * If mobName is given, find the nearest of that type.
 * Otherwise, find the nearest hostile sorted by threat priority.
 */
function _findTarget(bot, mobName) {
  const botPos = bot.entity.position;
  let candidates = [];

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position || entity === bot.entity) continue;
    if (!gameState.HOSTILE_MOBS.has(entity.name)) continue;

    const dist = botPos.distanceTo(entity.position);
    if (dist > 20) continue;

    if (mobName && entity.name !== mobName) continue;

    candidates.push({ entity, dist, priority: THREAT_PRIORITY[entity.name] || 0 });
  }

  if (candidates.length === 0) return null;

  // Sort: highest priority first, then closest
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.dist - b.dist;
  });

  return candidates[0].entity;
}

// Listen for pvp stop to clear state
function registerPvpListeners(bot) {
  bot.on('stoppedAttacking', () => {
    combatActive = false;
    currentTarget = null;
  });
}

module.exports = {
  attackNearest,
  fleeToPlayer,
  stopCombat,
  isInCombat,
  getTarget,
  onHurt,
  registerPvpListeners,
  ALWAYS_FLEE,
  FLEE_HP_THRESHOLD,
};
