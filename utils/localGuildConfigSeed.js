'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TABLE_CONFIGS } = require('./constants');

// Starter guild config sources, in priority order: the operator's own
// gitignored copy first, then the committed template as a fallback.
const DEFAULT_STARTER_CONFIG_PATHS = [
    path.join(__dirname, '..', 'data', 'guild-config.json'),
    path.join(__dirname, '..', 'data', 'guild-config.example.json'),
];

function parseStarterConfig(configPath) {
    let raw;
    try {
        raw = fs.readFileSync(configPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw new Error(`Unable to read starter guild config ${configPath}: ${err.message}`);
    }

    let starter;
    try {
        starter = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Invalid starter guild config JSON in ${configPath}: ${err.message}`);
    }

    if (!starter || typeof starter !== 'object' || Array.isArray(starter)) {
        throw new Error(`Starter guild config ${configPath} must contain a JSON object`);
    }

    return {
        starter,
        source: configPath,
        sourceName: path.basename(configPath),
    };
}

function readStarterGuildConfig(configPaths = DEFAULT_STARTER_CONFIG_PATHS) {
    for (const configPath of configPaths) {
        const found = parseStarterConfig(configPath);
        if (found) return found;
    }
    return null;
}

function starterConfigForGuild(starter, guildId) {
    return {
        ...JSON.parse(JSON.stringify(starter)),
        serverId: String(guildId),
    };
}

async function syncSingleTenantGuildConfig(docClient, config, options = {}) {
    const guildId = config?.guildId ? String(config.guildId) : null;
    if (!guildId) return { status: 'skipped', reason: 'missing-guild-id' };
    if (config.singleTenant === false) {
        return { status: 'skipped', reason: 'not-single-tenant', guildId };
    }

    const found = readStarterGuildConfig(options.configPaths);
    if (!found) return { status: 'skipped', reason: 'missing-config', guildId };

    const item = starterConfigForGuild(found.starter, guildId);
    await docClient.put({
        TableName: options.tableName || TABLE_CONFIGS,
        Item: item,
    }).promise();

    return {
        status: 'synced',
        guildId,
        source: found.source,
        sourceName: found.sourceName,
        item,
    };
}

module.exports = {
    DEFAULT_STARTER_CONFIG_PATHS,
    readStarterGuildConfig,
    syncSingleTenantGuildConfig,
};
