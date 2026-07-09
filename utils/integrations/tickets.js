const { getGuildConfig } = require('../guildConfig');
const { captureEvent, reportCriticalFailure } = require('../telemetry');
const { getConfig } = require('../config');
const { checkUserNetBan, checkServerBan } = require('../enforcement');
const { isServerLicensed } = require('../licensing');
const { consume } = require('../rateLimiter');
const { COSTS } = require('../rateLimitWeights');

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 5000;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_BYTES = 4096;

const stores = new Map();

function storeFor(integrationName) {
    if (!stores.has(integrationName)) stores.set(integrationName, new Map());
    return stores.get(integrationName);
}

function prune(store) {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (entry.expiresAt <= now) store.delete(key);
    }
    while (store.size > IDEMPOTENCY_MAX_ENTRIES) {
        store.delete(store.keys().next().value);
    }
}

function validateInput(input) {
    if (!input || typeof input !== 'object') throw new Error('tickets.create requires an input object');
    const { guildId, userId, category, subject, idempotencyKey, source, metadata, attachments } = input;

    if (typeof guildId !== 'string' || !guildId) throw new Error('guildId (string) is required');
    if (typeof userId !== 'string' || !userId) throw new Error('userId (string) is required — resolve the external identity to a Discord user first');
    if (typeof category !== 'string' || !category) throw new Error('category (string) is required');
    if (typeof subject !== 'string' || !subject.trim()) throw new Error('subject (string) is required');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) throw new Error('idempotencyKey (string) is required');
    if (typeof source !== 'string' || !source) throw new Error('source (string) is required');

    if (metadata !== undefined) {
        if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata must be a plain object');
        let size;
        try {
            size = Buffer.byteLength(JSON.stringify(metadata));
        } catch {
            throw new Error('metadata must be JSON-serializable');
        }
        if (size > MAX_METADATA_BYTES) throw new Error(`metadata too large (max ${MAX_METADATA_BYTES} bytes)`);
    }

    if (attachments !== undefined) {
        if (!Array.isArray(attachments)) throw new Error('attachments must be an array');
        if (attachments.length > MAX_ATTACHMENTS) throw new Error(`too many attachments (max ${MAX_ATTACHMENTS})`);
        for (const a of attachments) {
            if (!a || typeof a.name !== 'string' || !a.name) throw new Error('each attachment needs a name');
            const data = a.data;
            if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) throw new Error(`attachment "${a.name}" data must be a Buffer or Uint8Array`);
            if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`attachment "${a.name}" too large (max ${MAX_ATTACHMENT_BYTES} bytes)`);
        }
    }
}

function buildInteractionAdapter(guild, member, traceId) {
    const replies = [];
    const adapter = {
        id: traceId,
        guild,
        guildId: guild.id,
        member,
        user: member.user,
        channel: null,
        deferred: false,
        replied: false,
        deferReply: async () => { adapter.deferred = true; },
        reply: async (payload) => { adapter.replied = true; replies.push(payload); return null; },
        editReply: async (payload) => { replies.push(payload); return null; },
        followUp: async (payload) => { replies.push(payload); return null; },
    };
    return { adapter, replies };
}

function extractReplyText(replies) {
    const texts = [];
    for (const payload of replies) {
        if (typeof payload === 'string') { texts.push(payload); continue; }
        if (typeof payload?.content === 'string') texts.push(payload.content);
        for (const component of payload?.components ?? []) {
            try {
                const json = typeof component.toJSON === 'function' ? component.toJSON() : component;
                const walk = (node) => {
                    if (!node || typeof node !== 'object') return;
                    if (typeof node.content === 'string') texts.push(node.content);
                    for (const child of node.components ?? []) walk(child);
                };
                walk(json);
            } catch {
                continue;
            }
        }
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim();
}

async function enforceAccess(input) {
    const config = getConfig();

    if (config.hostedEnforcementEnabled) {
        const [userBan, serverBan] = await Promise.all([
            checkUserNetBan(input.userId),
            checkServerBan(input.guildId),
        ]);
        if (userBan.netBan) throw new Error(`user ${input.userId} is restricted from using OptiDesk`);
        if (serverBan.banned) throw new Error(`guild ${input.guildId} is restricted from using OptiDesk`);
    }

    if (config.licensingEnabled && !await isServerLicensed(input.guildId)) {
        throw new Error(`guild ${input.guildId} is not licensed`);
    }

    if (config.rateLimitEnabled) {
        const result = consume(input.userId, 'openTicketModal', COSTS.openTicketModal);
        if (!result.allowed) {
            throw new Error(`ticket creation rate limit exceeded; retry in ${Math.ceil(result.retryAfterMs / 1000)}s`);
        }
    }
}

async function doCreate(getClient, integrationName, input) {
    const client = getClient();
    if (!client?.isReady()) {
        throw new Error('OptiDesk is not connected to Discord — retry shortly');
    }

    await enforceAccess(input);

    const guildConfig = await getGuildConfig(input.guildId);
    if (!guildConfig?.settings?.integrationsEnabled) {
        throw new Error(`guild ${input.guildId} has not enabled integrations`);
    }

    let guild;
    try {
        guild = await client.guilds.fetch(input.guildId);
    } catch {
        throw new Error(`guild ${input.guildId} not found — is OptiDesk in that server?`);
    }

    let member;
    try {
        member = await guild.members.fetch(input.userId);
    } catch {
        throw new Error(`user ${input.userId} is not a member of guild ${input.guildId}`);
    }

    const traceId = `integration-${integrationName}-${input.idempotencyKey}`;
    const { adapter, replies } = buildInteractionAdapter(guild, member, traceId);

    const { openTicket } = require('../../tickets/open');
    const result = await openTicket(adapter, input.category, input.subject);

    if (!result || typeof result.isThread !== 'function' || !result.isThread()) {
        const reason = extractReplyText(replies) || 'ticket creation failed';
        throw new Error(reason);
    }
    const ticket = result;

    const metadataEntries = Object.entries(input.metadata ?? {})
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .slice(0, 10);
    if (metadataEntries.length || input.attachments?.length) {
        try {
            const lines = metadataEntries.map(([k, v]) => `${String(k).slice(0, 40)}: ${String(v).slice(0, 120)}`);
            await ticket.send({
                content: `-# Opened via **${integrationName}**${lines.length ? `\n\`\`\`${lines.join('\n')}\`\`\`` : ''}`,
                files: (input.attachments ?? []).map(a => ({ attachment: Buffer.from(a.data), name: a.name })),
                allowedMentions: { parse: [] },
            });
        } catch (err) {
            console.warn(`[integrations:${integrationName}] failed to post context/attachments:`, {
                guildId: input.guildId,
                threadId: ticket.id,
                message: err?.message,
            });
        }
    }

    captureEvent(`guild:${input.guildId}`, 'integration_ticket_created', {
        integration: integrationName,
        source: input.source,
        category: input.category,
        trace_id: traceId,
    });

    return {
        ticketId: ticket.id,
        channelId: ticket.id,
        url: `https://discord.com/channels/${input.guildId}/${ticket.id}`,
    };
}

async function createExternalTicket(getClient, integrationName, input) {
    validateInput(input);

    const store = storeFor(integrationName);
    prune(store);

    const existing = store.get(input.idempotencyKey);
    if (existing) return existing.promise;

    const promise = doCreate(getClient, integrationName, input);
    store.set(input.idempotencyKey, { promise, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });

    try {
        return await promise;
    } catch (err) {
        store.delete(input.idempotencyKey);
        try {
            reportCriticalFailure(err, 'integrations/tickets', 'external_ticket_create', {
                guild_id: input.guildId,
                integration: integrationName,
                source: input.source,
                severity: 'warning',
            });
        } catch (telemetryError) {
            void telemetryError;
        }
        throw err;
    }
}

module.exports = { createExternalTicket };
