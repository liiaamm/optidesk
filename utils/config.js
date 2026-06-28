'use strict';

// Config loader. The active *profile* is chosen by launch flag / environment:
//
//   - (default, no flag):              ../config.json    — self-hosted / local
//   - --cloud:                         SSM /optidesk/prod/*  — cloud (AWS + S3 + PostHog)
//   - --dev / --dev=config:            ../config.json    — contributor dev
//   - --dev=ssm:                       SSM /optidesk/dev/* (+ shared prod posthogKey)

const _devArg   = process.argv.find(a => a === '--dev' || a.startsWith('--dev='));
const _cloudArg = process.argv.includes('--cloud');

const IS_DEV      = !!_devArg;
const IS_CLOUD    = !IS_DEV && _cloudArg;
const IS_SELFHOST = !IS_DEV && !IS_CLOUD;
// Back-compat alias — historically `IS_PROD` meant "the cloud/production profile".
const IS_PROD     = IS_CLOUD;
const PROFILE     = IS_DEV ? 'dev' : IS_CLOUD ? 'cloud' : 'selfhost';

const DEV_SOURCE_FLAG = (_devArg && _devArg.includes('='))
    ? _devArg.slice('--dev='.length)
    : null;

const DEFAULT_REGION = 'ap-southeast-4';

let _cache = null;

// Profile-level defaults
function profileDefaults(profile) {
    if (profile === 'cloud') {
        return {
            mode:    'cloud',
            hosting: 'aws',
            database: { type: 'dynamodb-aws', region: DEFAULT_REGION },
            storage:  { type: 's3', bucket: 'optidesktranscripts', region: DEFAULT_REGION },
            posthogEnabled:   true,
            posthogKey:       null,
            licensingEnabled: true,
            hostedEnforcementEnabled: true,
            rateLimitEnabled: true,
            singleTenant:     false,
        };
    }

    const dev = profile === 'dev';
    return {
        mode:    profile,
        hosting: 'local',
        database: {
            type:        'dynamodb-local',
            region:      DEFAULT_REGION,
            endpoint:    'http://localhost:8000',
            // dev runs in-memory (ephemeral); self-host persists to disk so data survives restarts.
            persistPath: dev ? null : './data/dynamo',
        },
        storage:  { type: 'disabled', bucket: 'optidesktranscripts', region: DEFAULT_REGION },
        posthogEnabled:   dev,
        posthogKey:       null,
        licensingEnabled: dev,
        hostedEnforcementEnabled: dev,
        rateLimitEnabled: true,
        singleTenant:     !dev,
    };
}

function normalizeConfig(raw, profile) {
    const d = profileDefaults(profile);
    const posthogKey   = raw.posthogKey ?? d.posthogKey;
    const wantPosthog  = raw.posthogEnabled ?? d.posthogEnabled;

    return {
        ...d,
        ...raw,
        mode:     d.mode,
        hosting:  raw.hosting ?? d.hosting,
        database: { ...d.database, ...(raw.database || {}) },
        storage:  { ...d.storage,  ...(raw.storage  || {}) },
        posthogKey,
        posthogEnabled:   !!wantPosthog && !!posthogKey,
        licensingEnabled: raw.licensingEnabled ?? d.licensingEnabled,
        hostedEnforcementEnabled: raw.hostedEnforcementEnabled ?? d.hostedEnforcementEnabled,
        rateLimitEnabled: raw.rateLimitEnabled ?? d.rateLimitEnabled,
        singleTenant:     raw.singleTenant     ?? d.singleTenant,
    };
}

function validateLoadedConfig(config, source) {
    const missing = ['token', 'clientId', 'guildId'].filter(key => !config[key]);
    if (missing.length) {
        throw new Error(`Missing required config value(s): ${missing.join(', ')}`);
    }

    if (source === 'config') {
        const placeholders = {
            token: 'YOUR_DISCORD_BOT_TOKEN',
            clientId: 'YOUR_DISCORD_APPLICATION_CLIENT_ID',
            guildId: 'YOUR_DISCORD_SERVER_ID',
        };
        const unchanged = Object.entries(placeholders)
            .filter(([key, value]) => config[key] === value)
            .map(([key]) => key);
        if (unchanged.length) {
            throw new Error(`Replace placeholder config value(s) before starting: ${unchanged.join(', ')}`);
        }
    }
}

async function _loadProdSsm() {
    const AWS = require('aws-sdk');
    const ssm = new AWS.SSM({ region: DEFAULT_REGION });

    const { Parameters, InvalidParameters } = await ssm.getParameters({
        Names: [
            '/optidesk/prod/token',
            '/optidesk/prod/clientId',
            '/optidesk/prod/guildId',
            '/optidesk/prod/posthogKey',
            '/optidesk/prod/instatusHeartbeatUrl',
        ],
        WithDecryption: true,
    }).promise();

    if (InvalidParameters && InvalidParameters.length > 0) {
        throw new Error(`Missing SSM parameters: ${InvalidParameters.join(', ')}`);
    }

    const p = Object.fromEntries(Parameters.map(param => [param.Name.split('/').pop(), param.Value]));
    return {
        token:                p.token,
        clientId:             p.clientId,
        guildId:              p.guildId,
        posthogKey:           p.posthogKey,
        instatusHeartbeatUrl: p.instatusHeartbeatUrl,
    };
}

async function _loadDevSsm() {
    const AWS = require('aws-sdk');
    const ssm = new AWS.SSM({ region: DEFAULT_REGION });

    const { Parameters, InvalidParameters } = await ssm.getParameters({
        Names: [
            '/optidesk/dev/token',
            '/optidesk/dev/clientId',
            '/optidesk/dev/guildId',
            '/optidesk/dev/instatusHeartbeatUrl',
            '/optidesk/prod/posthogKey',
        ],
        WithDecryption: true,
    }).promise();

    if (InvalidParameters && InvalidParameters.length > 0) {
        throw new Error(`Missing SSM parameters: ${InvalidParameters.join(', ')}`);
    }

    const p = Object.fromEntries(Parameters.map(param => [param.Name.split('/').pop(), param.Value]));
    return {
        token:                p.token,
        clientId:             p.clientId,
        guildId:              p.guildId,
        posthogKey:           p.posthogKey,
        instatusHeartbeatUrl: p.instatusHeartbeatUrl,
    };
}

async function loadConfig({ devSource, source } = {}) {
    if (_cache) return _cache;

    const effective = source
        ?? (IS_DEV   ? (devSource === 'ssm' ? 'dev' : 'config')
          : IS_CLOUD ? 'prod'
          :            'config'); // self-host default

    let raw, normProfile;
    if (effective === 'prod') {
        raw = await _loadProdSsm();
        normProfile = 'cloud';
    } else if (effective === 'dev') {
        raw = await _loadDevSsm();
        normProfile = 'dev';
    } else {
        raw = require('../config.json');
        normProfile = IS_DEV ? 'dev' : 'selfhost';
    }

    _cache = normalizeConfig(raw, normProfile);
    validateLoadedConfig(_cache, effective);
    return _cache;
}

function getConfig() {
    if (!_cache) throw new Error('Config not loaded. Await loadConfig() before accessing getConfig().');
    return _cache;
}

module.exports = {
    loadConfig, getConfig, normalizeConfig,
    IS_PROD, IS_DEV, IS_CLOUD, IS_SELFHOST, PROFILE, DEV_SOURCE_FLAG,
};
