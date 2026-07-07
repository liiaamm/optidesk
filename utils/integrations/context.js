const bus = require('./bus');
const { version } = require('../../package.json');

function buildContext(name, scopes, registryEntry) {
    const ctx = {
        name,
        config: registryEntry?.config ?? {},
        log: (level, msg) => console.log(`[integrations:${name}] ${level}: ${msg}`),
    };

    if (scopes.includes('events.subscribe')) {
        ctx.events = { on: (event, fn) => bus.subscribe(name, event, fn) };
    }

    if (scopes.includes('instance.info')) {
        ctx.instance = { info: () => ({ version }) };
    }

    return Object.freeze(ctx);
}

module.exports = { buildContext };
