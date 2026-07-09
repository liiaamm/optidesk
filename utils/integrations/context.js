const bus = require('./bus');
const { version } = require('../../package.json');
const { createExternalTicket } = require('./tickets');

function buildContext(name, scopes, registryEntry, getClient = () => null) {
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

    if (scopes.includes('tickets.write')) {
        ctx.tickets = Object.freeze({
            create: (input) => createExternalTicket(getClient, name, input),
        });
    }

    return Object.freeze(ctx);
}

module.exports = { buildContext };
