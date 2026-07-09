const fs = require('node:fs');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { getGuildConfig } = require('../guildConfig');

const COMMAND_NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

const registered = new Map();

function validateCommandsPath(commandsFile) {
    if (typeof commandsFile !== 'string' || commandsFile.includes('..') || path.isAbsolute(commandsFile)) {
        throw new Error(`invalid commands path "${commandsFile}"`);
    }
    return commandsFile;
}

function registerIntegrationCommands(integrationName, ctx, defs) {
    if (!Array.isArray(defs)) {
        throw new Error('commands file must export an array of { data, execute }');
    }
    const accepted = [];
    for (const def of defs) {
        const name = def?.data?.name;
        if (!name || typeof def?.data?.toJSON !== 'function' || typeof def?.execute !== 'function') {
            console.warn(`[integrations] ${integrationName}: skipping malformed command declaration (needs data + execute)`);
            continue;
        }
        if (!COMMAND_NAME_PATTERN.test(name)) {
            console.warn(`[integrations] ${integrationName}: skipping command "${name}" — invalid name`);
            continue;
        }
        if (registered.has(name)) {
            console.warn(`[integrations] ${integrationName}: command "${name}" already registered by ${registered.get(name).integration} — skipping`);
            continue;
        }
        registered.set(name, { integration: integrationName, data: def.data, execute: def.execute, ctx });
        accepted.push(name);
    }
    return accepted;
}

function getIntegrationCommands() {
    return registered;
}

function buildIntegrationCommand(entry) {
    return {
        data: entry.data,
        execute: async (interaction) => {
            const guildConfig = await getGuildConfig(interaction.guildId);
            if (!guildConfig?.settings?.integrationsEnabled) {
                return interaction.reply({
                    content: 'Integrations are disabled in this server.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return entry.execute(interaction, entry.ctx);
        },
    };
}

function collectIntegrationCommandData() {
    const { generateRegistry } = require('./registry');
    const collected = [];
    const seen = new Set();
    const INTEGRATIONS_ROOT = path.join(__dirname, '..', '..', 'integrations');

    for (const [name, entry] of Object.entries(generateRegistry())) {
        if (!entry?.enabled || !(entry.scopes ?? []).includes('commands.register')) continue;
        try {
            const manifestPath = path.join(INTEGRATIONS_ROOT, name, 'integration.json');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest.commands) continue;
            const commandsPath = path.join(INTEGRATIONS_ROOT, name, validateCommandsPath(manifest.commands));
            const defs = require(commandsPath);
            if (!Array.isArray(defs)) throw new Error('commands file must export an array');
            for (const def of defs) {
                const commandName = def?.data?.name;
                if (!commandName || typeof def?.data?.toJSON !== 'function') continue;
                if (!COMMAND_NAME_PATTERN.test(commandName) || seen.has(commandName)) continue;
                seen.add(commandName);
                collected.push(def.data.toJSON());
            }
        } catch (err) {
            console.warn(`[integrations] ${name}: couldn't collect commands for deploy: ${err.message}`);
        }
    }
    return collected;
}

module.exports = { registerIntegrationCommands, getIntegrationCommands, buildIntegrationCommand, collectIntegrationCommandData, validateCommandsPath };
