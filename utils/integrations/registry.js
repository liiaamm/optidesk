const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'data', 'integrations.json');

function readRegistry() {
    try {
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }
}

function generateRegistry() {
    if (!fs.existsSync(REGISTRY_PATH)) {
        fs.writeFileSync(REGISTRY_PATH, '{}\n');
    }
    return readRegistry();
}

function generateToken() {
    const token = `odk_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, tokenHash };
}

function verifyToken(presentedToken) {
    if (!presentedToken) return null;
    const presentedHash = Buffer.from(
        crypto.createHash('sha256').update(presentedToken).digest('hex'),
        'hex'
    );

    for (const [name, entry] of Object.entries(readRegistry())) {
        if (!entry.tokenHash) continue;
        const storedHash = Buffer.from(entry.tokenHash, 'hex');
        if (crypto.timingSafeEqual(storedHash, presentedHash)) return name;
    }
    return null;
}

function getEntry(name) {
    return generateRegistry()[name] ?? null;
}

function setEntry(name, entry) {
    const registry = generateRegistry();
    registry[name] = entry;
    fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

function removeEntry(name) {
    const registry = generateRegistry();
    delete registry[name];
    fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

module.exports = { generateRegistry, generateToken, verifyToken, getEntry, setEntry, removeEntry };
