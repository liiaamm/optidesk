const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { VALID_SCOPES, requiresToken } = require('../utils/integrations/scopes');
const { generateToken, getEntry, setEntry, removeEntry, generateRegistry } = require('../utils/integrations/registry');

const INTEGRATIONS_ROOT = path.join(__dirname, '..', 'integrations');
const NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

function readManifest(name) {
    if (!NAME_PATTERN.test(name)) {
        throw new Error(`invalid module name "${name}"`);
    }
    const manifestPath = path.join(INTEGRATIONS_ROOT, name, 'integration.json');
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

async function cmdList() {
    const registry = generateRegistry();
    const names = Object.keys(registry);
    if (!names.length) {
        console.log('No integrations registered.');
        return;
    }
    for (const name of names) {
        const entry = registry[name];
        const tokenTag = entry.tokenHash ? '  [has token]' : '';
        console.log(`${name}  [${entry.enabled ? 'enabled' : 'disabled'}]  scopes: ${(entry.scopes ?? []).join(', ') || '(none)'}${tokenTag}`);
    }
}

async function cmdRegister(name) {
    const manifest = readManifest(name);
    const scopes = Array.isArray(manifest.scopes) ? manifest.scopes : [];
    const unknown = scopes.filter(s => !VALID_SCOPES.includes(s));

    console.log(`${name} requests scopes: ${scopes.join(', ') || '(none)'}`);
    if (unknown.length) {
        console.warn(`Warning: unrecognized scope(s), ignoring: ${unknown.join(', ')}`);
    }

    const answer = (await ask('Grant these scopes and register this integration? (y/N): ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
        console.log('Aborted.');
        return;
    }

    const existing = getEntry(name);
    const config = existing?.config ?? {};

    if (!requiresToken(scopes)) {
        setEntry(name, { enabled: true, scopes, config });
        console.log(`Registered ${name}.`);
    } else if (existing?.tokenHash) {
        // Re-registering (e.g. after a manual `git pull`) must not rotate a live token.
        setEntry(name, { ...existing, enabled: true, scopes, config });
        console.log(`Registered ${name}. Existing token kept — use "rotate-token" to invalidate it.`);
    } else {
        const { token, tokenHash } = generateToken();
        setEntry(name, { enabled: true, scopes, tokenHash, config });
        console.log(`Registered ${name}.`);
        console.log(`Token (shown once): ${token}`);
    }
}

async function cmdEnable(name) {
    const entry = getEntry(name);
    if (!entry) throw new Error(`${name} is not registered — run "register" first`);
    setEntry(name, { ...entry, enabled: true });
    console.log(`${name} enabled.`);
}

async function cmdDisable(name) {
    const entry = getEntry(name);
    if (!entry) throw new Error(`${name} is not registered`);
    setEntry(name, { ...entry, enabled: false });
    console.log(`${name} disabled.`);
}

async function cmdRemove(name) {
    if (!getEntry(name)) throw new Error(`${name} is not registered`);
    removeEntry(name);
    console.log(`${name} removed from the registry. The folder in integrations/ was left untouched.`);
}

async function cmdRotateToken(name) {
    const entry = getEntry(name);
    if (!entry) throw new Error(`${name} is not registered`);
    if (!requiresToken(entry.scopes ?? [])) {
        throw new Error(`${name} has no network scopes — it was never issued a token`);
    }
    const { token, tokenHash } = generateToken();
    setEntry(name, { ...entry, tokenHash });
    console.log(`Token rotated for ${name}.`);
    console.log(`New token (shown once, store it now): ${token}`);
}

async function main() {
    const [command, name] = process.argv.slice(2);

    try {
        switch (command) {
            case 'list':
                await cmdList();
                break;
            case 'register':
                if (!name) throw new Error('usage: integrations register <name>');
                await cmdRegister(name);
                break;
            case 'enable':
                if (!name) throw new Error('usage: integrations enable <name>');
                await cmdEnable(name);
                break;
            case 'disable':
                if (!name) throw new Error('usage: integrations disable <name>');
                await cmdDisable(name);
                break;
            case 'remove':
                if (!name) throw new Error('usage: integrations remove <name>');
                await cmdRemove(name);
                break;
            case 'rotate-token':
                if (!name) throw new Error('usage: integrations rotate-token <name>');
                await cmdRotateToken(name);
                break;
            default:
                console.log('Usage: node scripts/integrations.js <list|register|enable|disable|remove|rotate-token> [name]');
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
    } finally {
        rl.close();
    }
}

main();
