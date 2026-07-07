const fs = require('node:fs');
const path = require('node:path');
const { getEntry } = require('./registry');
const { buildContext } = require('./context');
const bus = require('./bus');
const { getGuildConfig } = require('../guildConfig');

const INTEGRATIONS_ROOT = path.join(__dirname, '..', '..', 'integrations');
const SUPPORTED_API_VERSION = 1;
const NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

function readManifest(name) {
    if (!NAME_PATTERN.test(name)) {
        throw new Error(`invalid module folder name "${name}"`);
    }

    const manifestPath = path.join(INTEGRATIONS_ROOT, name, 'integration.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (manifest.apiVersion !== SUPPORTED_API_VERSION) {
        throw new Error(`unsupported apiVersion (expected ${SUPPORTED_API_VERSION})`);
    }
    if (!Array.isArray(manifest.scopes)) {
        throw new Error('manifest scopes must be an array');
    }

    const entry = manifest.entry ?? 'index.js';
    if (typeof entry !== 'string' || entry.includes('..') || path.isAbsolute(entry)) {
        throw new Error(`invalid entry path "${entry}"`);
    }

    return { ...manifest, entry };
}

async function loadIntegrations() {
    bus.setGuildGate(async (guildId) => {
        const config = await getGuildConfig(guildId);
        return !!config?.settings?.integrationsEnabled;
    });

    if (!fs.existsSync(INTEGRATIONS_ROOT)) return;

    const folders = fs.readdirSync(INTEGRATIONS_ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_'));

    for (const dir of folders) {
        const name = dir.name;
        try {
            const manifest = readManifest(name);

            const registryEntry = getEntry(name);
            if (!registryEntry?.enabled) {
                console.log(`[integrations] ${name}: not registered/enabled, skipping`);
                continue;
            }

            // Cap
            const grantedScopes = (registryEntry.scopes ?? []).filter(s => manifest.scopes.includes(s));

            const ctx = buildContext(name, grantedScopes, registryEntry);
            const modulePath = path.join(INTEGRATIONS_ROOT, name, manifest.entry);
            const mod = require(modulePath);

            if (typeof mod.setup !== 'function') {
                throw new Error('module does not export an async setup(ctx) function');
            }

            await mod.setup(ctx);
            console.log(`[integrations] loaded ${name} — scopes: ${grantedScopes.join(', ') || '(none)'}`);
        } catch (err) {
            console.warn(`[integrations] failed to load ${name}: ${err.message}`);
        }
    }
}

module.exports = { loadIntegrations };
