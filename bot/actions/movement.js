/**
 * Movement actions — follow player via mineflayer-pathfinder.
 *
 * followPlayer(bot, playerName) keeps the bot 3-5 blocks behind the target.
 * stopFollowing(bot) cancels the active goal.
 */

const { goals } = require('mineflayer-pathfinder');
const { GoalFollow } = goals;

// Distance to maintain from target (mineflayer-pathfinder uses blocks)
const FOLLOW_DISTANCE = 3;

let followingInterval = null;

/**
 * Start following a named player.
 * Re-evaluates the goal every 500ms to track the player's new position.
 *
 * @param {object} bot - mineflayer bot
 * @param {string} playerName - exact IGN of the player to follow
 */
function followPlayer(bot, playerName) {
  stopFollowing(bot);

  const _updateGoal = () => {
    const player = bot.players[playerName];
    if (!player || !player.entity) {
      // Player not visible yet — try again next tick
      return;
    }
    try {
      const goal = new GoalFollow(player.entity, FOLLOW_DISTANCE);
      bot.pathfinder.setGoal(goal, true); // dynamic=true re-plans continuously
    } catch (e) {
      // pathfinder may not be ready yet on first call
      console.warn('[Movement] pathfinder not ready:', e.message);
    }
  };

  // Initial attempt
  _updateGoal();

  // Poll so we stay on target as they move
  followingInterval = setInterval(_updateGoal, 500);
}

/**
 * Stop following and clear any active pathfinder goal.
 * @param {object} bot - mineflayer bot
 */
function stopFollowing(bot) {
  if (followingInterval) {
    clearInterval(followingInterval);
    followingInterval = null;
  }
  try {
    bot.pathfinder.setGoal(null);
  } catch (e) {
    // pathfinder might not be initialised yet
  }
}

module.exports = { followPlayer, stopFollowing };
