const DEFAULT_TIMEOUT_MS = 10_000;

const subscribers = new Map(); // [{ module, fn }]

let guildGate = async () => true;

function setGuildGate(fn) {
    guildGate = fn;
}

function subscribe(module, event, fn) {
    if (!subscribers.has(event)) subscribers.set(event, []);
    subscribers.get(event).push({ module, fn });
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
}

function emit(event, payload) {
    const subs = subscribers.get(event);
    if (!subs?.length) return;

    setImmediate(async () => {
        for (const { module, fn } of subs) {
            try {
                if (!await guildGate(payload.guildId)) continue;
                await withTimeout(fn(payload), DEFAULT_TIMEOUT_MS);
            } catch (err) {
                console.warn(`[integrations] ${module} handler for ${event} failed:`, err?.message);
            }
        }
    });
}

module.exports = { subscribe, emit, setGuildGate };
