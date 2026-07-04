const AWS = require('aws-sdk');
const https = require('https');
const http = require('http');
const { PostHog } = require('posthog-node');
const { getConfig } = require('./config');
const { TABLE_TICKETS } = require('./constants');

const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const keepAliveHttpAgent  = new http.Agent({ keepAlive: true, maxSockets: 50 });

const DEFAULT_REGION = 'ap-southeast-4';

function safeConfig() {
    try { return getConfig(); } catch { return null; }
}

// ---- PostHog (lazy) ----
let _posthog = null;
function ensurePosthog() {
    if (!_posthog) {
        const key = safeConfig()?.posthogKey;
        if (!key) {
            // No key (PostHog disabled / self-host)
            _posthog = new Proxy({}, { get: () => () => {} });
        } else {
            _posthog = new PostHog(key, {
                host: 'https://us.i.posthog.com',
                enableExceptionAutocapture: true,
            });
        }
    }
    return _posthog;
}

const posthog = new Proxy({}, {
    get(_, prop) {
        const instance = ensurePosthog();
        const val = instance[prop];
        return typeof val === 'function' ? val.bind(instance) : val;
    },
});

let _dynamo = null;
function ensureDynamo() {
    if (!_dynamo) {
        const database = safeConfig()?.database ?? { type: 'dynamodb-aws', region: DEFAULT_REGION };
        if (database.type === 'postgresql' || database.type === 'sqlite') {
            const SqlDocumentClient = require('./sqlDocumentClient');
            _dynamo = new SqlDocumentClient(database);
        } else {
            const opts = {
                region: database.region || DEFAULT_REGION,
                httpOptions: { agent: keepAliveHttpsAgent },
            };
            if (database.type === 'dynamodb-local') {
                opts.endpoint        = database.endpoint || 'http://localhost:8000';
                opts.accessKeyId     = 'local';
                opts.secretAccessKey = 'local';
                opts.httpOptions     = { agent: keepAliveHttpAgent };
            }
            _dynamo = new AWS.DynamoDB.DocumentClient(opts);
        }
    }
    return _dynamo;
}

const dynamo = new Proxy({}, {
    get(_, prop) {
        const instance = ensureDynamo();
        const val = instance[prop];
        return typeof val === 'function' ? val.bind(instance) : val;
    },
});


let _s3 = null;
function ensureS3() {
    if (!_s3) {
        const storage = safeConfig()?.storage ?? { region: DEFAULT_REGION };
        _s3 = new AWS.S3({
            region: storage.region || DEFAULT_REGION,
            httpOptions: { agent: keepAliveHttpsAgent },
        });
    }
    return _s3;
}

const s3 = new Proxy({}, {
    get(_, prop) {
        const instance = ensureS3();
        const val = instance[prop];
        return typeof val === 'function' ? val.bind(instance) : val;
    },
});

function storageEnabled() {
    return safeConfig()?.storage?.type !== 'disabled';
}

function transcriptBucket() {
    return safeConfig()?.storage?.bucket;
}

async function getTicketByChannel(channelId) {
    const result = await dynamo.query({
        TableName: TABLE_TICKETS,
        KeyConditionExpression: "channelId = :id",
        ExpressionAttributeValues: { ":id": channelId }
    }).promise();
    return result.Items[0] || null;
}

async function getTicketByClaimMessage(claimMessageId) {
    const result = await dynamo.query({
        TableName: TABLE_TICKETS,
        IndexName: "claimMessageId-index",
        KeyConditionExpression: "claimMessageId = :id",
        ExpressionAttributeValues: { ":id": claimMessageId }
    }).promise();
    return result.Items[0] || null;
}

module.exports = {
    dynamo, s3, posthog,
    storageEnabled, transcriptBucket,
    getTicketByChannel, getTicketByClaimMessage,
};
