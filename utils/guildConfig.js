const { dynamo } = require('./db');
const { TABLE_CONFIGS } = require('./constants');
const { normalizeCategories } = require('./categoryAcl');

const guildConfigCache = new Map();
const CACHE_TTL = 20 * 60 * 1000; // 20 minutes, but fancier
let REFUSE_CACHE = false;

/**
 * Fetch guild/server configuration from DynamoDB with caching.
 * @param {string|number} guildId - The guild ID from Discord.
 * @returns {Promise<Object|null>} - Returns the config object or null if not found.
 */
async function getGuildConfig(guildId) {
    const serverId = guildId

    if (!REFUSE_CACHE) {
        const cached = guildConfigCache.get(serverId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }

    const response = await dynamo.get({
        TableName: TABLE_CONFIGS,
        Key: { serverId }
    }).promise();


    const config = response.Item || null;

    if (config) normalizeCategories(config);

    // Cache the result
    if (!REFUSE_CACHE) {
        if (config) {
            guildConfigCache.set(serverId, {
                data: config,
                timestamp: Date.now()
            });
        }
    }

    return config;
}

/**
 * Clear the cached configuration for a guild.
 * @param {string|number} guildId
 */
function clearGuildCache(guildId) {
    guildConfigCache.delete(String(guildId));
}

module.exports = { getGuildConfig, clearGuildCache };
