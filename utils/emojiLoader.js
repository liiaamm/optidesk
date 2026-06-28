const emojiSets = require('./emojis.js');
const { getGuildConfig } = require('./guildConfig');
const { reportCriticalFailure } = require('./telemetry');

/**
 * Loads the correct emoji set based on guild configuration. Makes OptiDesk, OptiDesk!
 *
 * @param {string} guildId - The Discord server ID
 * @returns {Promise<Object>} The emoji set object
 */
async function loadEmojis(guildId) {
    // Intentionally NOT wrapped in try/catch — let getGuildConfig failures
    // propagate so the central router's error handling and on-call paging work.
    const config = await getGuildConfig(guildId);

    if (!config) {
        // Expected path: brand-new guild with no config row yet.
        console.warn(`[emojiLoader] No config found for guild ${guildId}, using OptiDeskEmojis as default`);
        return emojiSets.OptiDeskEmojis;
    }

    const setName = config.appearance?.emojiSet || 'OptiDeskEmojis';
    const selectedSet = emojiSets[setName];

    if (!selectedSet) {
        // Config points to an unknown set, config issue
        reportCriticalFailure(
            new Error(`Unknown emoji set: ${setName}`),
            'emojiLoader',
            'unknown_emoji_set',
            { guild_id: guildId, setName }
        );
        console.warn(`[emojiLoader] Emoji set "${setName}" not found for guild ${guildId}, falling back to OptiDeskEmojis`);
        return emojiSets.OptiDeskEmojis;
    }

    return selectedSet;
}

module.exports = { loadEmojis };
