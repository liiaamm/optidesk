const { execSync } = require('node:child_process');
const { dynamo, posthog } = require('./db');
const { getConfig, IS_DEV } = require('./config');
const { TABLE_PERFORMANCE } = require('./constants');

let _gitBranch;
function warnTelemetry(message, details) {
    if (process.env.NODE_ENV === 'test') return;
    console.warn(message, details);
}

function gitBranch() {
    if (!IS_DEV) return undefined;
    if (_gitBranch !== undefined) return _gitBranch;
    try {
        _gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
        _gitBranch = 'unknown';
    }
    return _gitBranch;
}

async function logTiming(commandName, duration) {
    const params = {
        TableName: TABLE_PERFORMANCE,
        Item: {
            id: `${Date.now()}-${Math.random()}`,
            command: commandName,
            duration: duration,
        }
    };
    await dynamo.put(params).promise();
}

// Track which guilds we've already groupIdentify'd this process so the
// lazy first-fire guard in captureEvent/captureException is cheap
const _identifiedGuilds = new Set();

// Auto-resolve the `guild` group for an event. Sources, in order:
//   1. explicit `options.groups` override
//   2. `guild_id` / `guildId` already in event properties
//   3. distinctId formatted as `guild:<id>` (the project convention)
function resolveGroups(distinctId, properties, override) {
    if (override) return override;
    const fromProps = properties.guild_id ?? properties.guildId;
    if (fromProps) return { guild: String(fromProps) };
    if (typeof distinctId === 'string' && distinctId.startsWith('guild:')) {
        return { guild: distinctId.slice('guild:'.length) };
    }
    return undefined;
}

// Lazy first-fire guild registration
function ensureGuildIdentified(distinctId) {
    if (typeof distinctId !== 'string' || !distinctId.startsWith('guild:')) return;
    const key = distinctId.slice('guild:'.length);
    if (!key || _identifiedGuilds.has(key)) return;
    try {
        posthog.groupIdentify({ groupType: 'guild', groupKey: key, distinctId: `guild:${key}`, properties: {} });
    } catch (err) {
        warnTelemetry('[telemetry] Failed to identify guild group:', {
            guildId: key,
            message: err?.message,
        });
    }
    _identifiedGuilds.add(key);
}

function captureEvent(distinctId, event, properties = {}, options = {}) {
    if (!getConfig().posthogEnabled) return;
    const branch = gitBranch();
    const groups = resolveGroups(distinctId, properties, options.groups);
    ensureGuildIdentified(distinctId);
    try {
        posthog.capture({
            distinctId,
            event,
            properties: { ...properties, hosting: getConfig().hosting ?? 'unknown', ...(branch !== undefined && { git_branch: branch }) },
            ...(groups && { groups }),
        });
    } catch (err) {
        warnTelemetry('[telemetry] Failed to capture event:', {
            distinctId,
            event,
            message: err?.message,
        });
    }
}

function captureException(error, distinctId, properties = {}, options = {}) {
    if (!getConfig().posthogEnabled) return;
    const branch = gitBranch();
    const groups = resolveGroups(distinctId, properties, options.groups);
    ensureGuildIdentified(distinctId);
    try {
        posthog.captureException(error, distinctId, {
            ...properties,
            hosting: getConfig().hosting ?? 'unknown',
            ...(branch !== undefined && { git_branch: branch }),
            ...(groups && { $groups: groups }),
        });
    } catch (err) {
        warnTelemetry('[telemetry] Failed to capture exception:', {
            distinctId,
            originalError: error?.message,
            message: err?.message,
        });
    }
}

function reportCriticalFailure(error, component, failure_type, props = {}) {
    if (!getConfig().posthogEnabled) return;
    const { distinctId, ...rest } = props;
    const id = distinctId ?? (rest.guild_id ? `guild:${rest.guild_id}` : 'system');
    const payload = {
        component,
        failure_type,
        severity: rest.severity ?? 'critical',
        ...(error && { error_code: error.code, error_message: error.message }),
        ...rest,
    };
    captureEvent(id, 'critical_failure', payload);
    captureException(error, id, payload);
}

// POSTHOG!!! (more telemetry, but for guilds)
function identifyGuild(guildId, properties = {}) {
    if (!getConfig().posthogEnabled) return;
    if (guildId == null) return;
    const key = String(guildId);
    try {
        posthog.groupIdentify({
            groupType: 'guild',
            groupKey: key,
            distinctId: `guild:${key}`,
            properties,
        });
        _identifiedGuilds.add(key);
    } catch (err) {
        warnTelemetry('[telemetry] Failed to identify guild:', {
            guildId: key,
            message: err?.message,
        });
    }
}

function hasIdentifiedGuild(guildId) {
    return _identifiedGuilds.has(String(guildId));
}

module.exports = { logTiming, captureEvent, captureException, reportCriticalFailure, identifyGuild, hasIdentifiedGuild };
