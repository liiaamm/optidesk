const fs = require('node:fs');
const path = require('node:path');

const { getGuildConfig } = require('./guildConfig');
const { reportCriticalFailure } = require('./telemetry');

// utils/emojis.js is the live, gitignored copy — `npm run emojis` writes the
// uploaded application emoji IDs into it, and updates can't clobber it.
// utils/emojis.example.js is the tracked default, used when setup hasn't run.
const LOCAL_EMOJIS_PATH = path.join(__dirname, 'emojis.js');
const emojiSets = fs.existsSync(LOCAL_EMOJIS_PATH)
    ? require('./emojis.js')
    : require('./emojis.example.js');

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
            { guild_id: guildId, setName, availableSets: Object.keys(emojiSets) }
        );
        console.warn(`[emojiLoader] Emoji set "${setName}" not found for guild ${guildId}, falling back to OptiDeskEmojis (available: ${Object.keys(emojiSets).join(', ')})`);
        console.warn('[emojiLoader] On a self-host, OptiDeskEmojis IDs belong to the official OptiDesk application and will NOT render. '
            + `Regenerate the set with: npm run emojis -- --color "#9DE8E4" --upload --prefix local_ --set ${setName}`);
        return emojiSets.OptiDeskEmojis;
    }

    return selectedSet;
}

module.exports = { loadEmojis };
