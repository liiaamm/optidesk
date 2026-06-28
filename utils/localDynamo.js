'use strict';

// Starts a pure-JS local DynamoDB (dynalite) for the local profiles:
//   - self-host (default `node .`): persisted to disk (config.database.persistPath)
//   - contributor dev (`--dev`):    in-memory (ephemeral)

const fs = require('node:fs');
const AWS = require('aws-sdk');
const dynalite = require('dynalite');
const {
    TABLE_TICKETS, TABLE_CONFIGS, TABLE_LICENSING,
    TABLE_ENFORCEMENT, TABLE_ENFORCEMENT_GUILDS,
    TABLE_PERFORMANCE, TABLE_TRANSCRIPTS,
} = require('./constants');
const { syncSingleTenantGuildConfig } = require('./localGuildConfigSeed');

const DEFAULT_PORT   = 8000;
const DEFAULT_REGION = 'ap-southeast-4';

const TABLE_SCHEMAS = [
    {
        TableName: TABLE_TICKETS,
        KeySchema: [{ AttributeName: 'channelId', KeyType: 'HASH' }],
        AttributeDefinitions: [
            { AttributeName: 'channelId',      AttributeType: 'S' },
            { AttributeName: 'claimMessageId', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [{
            IndexName: 'claimMessageId-index',
            KeySchema: [{ AttributeName: 'claimMessageId', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
        TableName: TABLE_CONFIGS,
        KeySchema: [{ AttributeName: 'serverId', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'serverId', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
        TableName: TABLE_LICENSING,
        KeySchema: [{ AttributeName: 'licenseId', KeyType: 'HASH' }],
        AttributeDefinitions: [
            { AttributeName: 'licenseId', AttributeType: 'S' },
            { AttributeName: 'serverId',  AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [{
            IndexName: 'serverId-index',
            KeySchema: [{ AttributeName: 'serverId', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
        TableName: TABLE_ENFORCEMENT,
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        AttributeDefinitions: [
            { AttributeName: 'userId', AttributeType: 'S' },
            { AttributeName: 'type',   AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [{
            IndexName: 'type-index',
            KeySchema: [
                { AttributeName: 'type',   KeyType: 'HASH' },
                { AttributeName: 'userId', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
        TableName: TABLE_ENFORCEMENT_GUILDS,
        KeySchema: [{ AttributeName: 'serverId', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'serverId', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
        TableName: TABLE_PERFORMANCE,
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
        TableName: TABLE_TRANSCRIPTS,
        KeySchema: [{ AttributeName: 'channelId', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'channelId', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
];

// Dev fixtures. Adjust for your guild, if you have staging or otherwise.
const DEV_HOME_GUILD_ID = '000000000000000000';

const DEV_LICENSE_RECORD = {
    licenseId:                 '',
    additionalServersLicensed: null,
    disabled:                  false,
    expires:                   null,
    ownerId:                   '',
    serverId:                  DEV_HOME_GUILD_ID,
    serverLock:                null,
    transaction:               null,
    type:                      3,
};

const DEV_CONFIG_RECORD = { // An example, but put your own here
    serverId: DEV_HOME_GUILD_ID,
    access: {
        blacklistRoleID:     '000000000000000000',
        pingOnPriorityRoles: ['000000000000000000'],
        priorityRoles:       ['000000000000000000'],
        supervisorRoleID:    '000000000000000000',
    },
    appearance: {
        defaultHexColor: '9DE8E4',
        emojiSet:        'OptiDeskEmojis',
        footer:          'OptiDesk',
        funnyResponses:  false,
        serverIconEmoji: null,
        serverLogoURL:   null,
    },
    layout: {
        transcriptChannelId: '000000000000000000',
        loggingChannelId: '000000000000000000',
        categories: {
            'General Support': {
                channelId:        '000000000000000000',
                inboxId:          '000000000000000000',
                anonymous:        false,
                description:      'General support category',
                emoji:            '💬',
                staffRoleId:      '000000000000000000',
                supervisorRoleId: null,
            },
        },
        presets: {
            closeRequestMessage: 'If your issue has been resolved, please press \'Close\'. Otherwise, press \'Ignore\' and we\'ll help you.',
            openTicket: {
                openTicketMessage: '## Welcome!\nThank you for making a support ticket. A support team member will help you shortly.',
            },
            queueMessage: 'Thank you for contacting us. Your support request has been put in the queue. Please wait for a representative to assist you further.',
        },
    },
    settings: {
        interactiveSupportEnabled: true,
        transcriptsEnabled:        false,
        loggingEnabled:            true,
        transcriptsTrusted:        false,
    },
};

function portFromEndpoint(endpoint) {
    if (!endpoint) return DEFAULT_PORT;
    try {
        const p = new URL(endpoint).port;
        return p ? Number(p) : DEFAULT_PORT;
    } catch {
        return DEFAULT_PORT;
    }
}

async function waitReady(ddl, attempts = 20, delayMs = 150) {
    for (let i = 0; i < attempts; i++) {
        try {
            await ddl.listTables({}).promise();
            return;
        } catch {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw new Error('Local DynamoDB did not become ready within the expected time');
}

async function createTables(ddl) {
    for (const schema of TABLE_SCHEMAS) {
        try {
            await ddl.createTable(schema).promise();
        } catch (err) {
            // Idempotent: a persisted DB already has its tables on subsequent boots.
            if (err.code !== 'ResourceInUseException') throw err;
        }
    }
}

async function recordExists(docClient, tableName, key) {
    const res = await docClient.get({ TableName: tableName, Key: key }).promise();
    return !!res.Item;
}

// Keep the single-tenant starter guild config in sync with data/guild-config.json.
async function seedSelfHostData(docClient, config) {
    const result = await syncSingleTenantGuildConfig(docClient, config);
    if (result.status === 'synced') {
        console.log(`[localDynamo] synced starter guild config for ${result.guildId} from ${result.sourceName}.`);
    } else if (result.reason === 'missing-config') {
        console.warn('[localDynamo] no starter guild config found in data/; skipping seed.');
    }
}

async function seedDevData(docClient) {
    if (!await recordExists(docClient, TABLE_LICENSING, { licenseId: DEV_LICENSE_RECORD.licenseId })) {
        await docClient.put({ TableName: TABLE_LICENSING, Item: DEV_LICENSE_RECORD }).promise();
    }
    if (!await recordExists(docClient, TABLE_CONFIGS, { serverId: DEV_CONFIG_RECORD.serverId })) {
        await docClient.put({ TableName: TABLE_CONFIGS, Item: DEV_CONFIG_RECORD }).promise();
    }
}

async function startLocalDynamo(config) {
    const database = config.database || {};
    const port = portFromEndpoint(database.endpoint);
    const persistPath = database.persistPath || null;

    const opts = { createTableMs: 0 };
    if (persistPath) {
        fs.mkdirSync(persistPath, { recursive: true });
        opts.path = persistPath;
    }

    const server = dynalite(opts);
    await new Promise((resolve, reject) => {
        server.listen(port, (err) => (err ? reject(err) : resolve()));
    });

    const close = () => { try { server.close(); } catch { /* noop */ } };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);

    const clientOpts = {
        region: database.region || DEFAULT_REGION,
        endpoint: database.endpoint || `http://localhost:${port}`,
        accessKeyId:     'local',
        secretAccessKey: 'local',
        httpOptions:     { connectTimeout: 250, timeout: 2000 },
        maxRetries:      0,
    };

    const ddl = new AWS.DynamoDB(clientOpts);
    await waitReady(ddl);
    await createTables(ddl);

    const docClient = new AWS.DynamoDB.DocumentClient(clientOpts);
    if (config.mode === 'dev') {
        await seedDevData(docClient);
    } else {
        await seedSelfHostData(docClient, config);
    }

    return server;
}

module.exports = { startLocalDynamo };
