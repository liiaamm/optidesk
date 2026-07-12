const { dynamo } = require('./db');
const { TABLE_LICENSING } = require('./constants');
const { reportCriticalFailure } = require('./telemetry');
const { randomBytes } = require("crypto");

function generateLicenseKey({
  groups = 4,
  groupSize = 4,
  alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
} = {}) {
  const total = groups * groupSize;
  const A = alphabet;
  const A_LEN = A.length;
  if (A_LEN < 2 || total < 1) throw new Error("invalid alphabet or sizes");

  const maxAccept = 256 - (256 % A_LEN);
  let out = "";
  while (out.length < total) {
    const buf = randomBytes(total - out.length);
    for (let i = 0; i < buf.length && out.length < total; i++) {
      const v = buf[i];
      if (v < maxAccept) out += A[v % A_LEN];
    }
  }

  const parts = [];
  for (let i = 0; i < groups; i++) parts.push(out.slice(i * groupSize, (i + 1) * groupSize));
  return parts.join("-");
}

async function createLicense(ownerId, type, serverLock, expires) {
    try {
    const params = {
        TableName: TABLE_LICENSING,
        Item: {
            licenseId: generateLicenseKey(),
            ownerId: ownerId,
            serverId: "null",
            type: type, // Generally ignored, but 1-4 in increasing usage limits - we never used this
            serverLock: serverLock,
            additionalServersLicensed: null,
            expires: expires,
            transaction: null,
            disabled: false,
        },
    };
    await dynamo.put(params).promise();
    return {success: true, licenseId: params.Item.licenseId}
    } catch (err) {
        console.error('[licensing] createLicense failed:', {
            ownerId,
            message: err?.message,
        });
        return {
            success: false,
            reason: "Database failure"
        }
    }
}

async function assignLicenseToServer(userAttemptingTransferId, licenseId, serverId) {
    try {
        const queryParams = {
            TableName: TABLE_LICENSING,
            KeyConditionExpression: "licenseId = :lid",
            ExpressionAttributeValues: {
                ":lid": licenseId
            }
        };
        
        const queryResult = await dynamo.query(queryParams).promise();
        
        if (!queryResult.Items || queryResult.Items.length === 0) {
            return {success: false, reason: "No license exists"};
        }
        
        const license = queryResult.Items[0];
        
        if (license.ownerId !== userAttemptingTransferId) {
            return {success: false, reason: "Unauthorised"};
        }

        if (license.disabled === true) {
            return {success: false, reason: "License is disabled"};
        }

        if (license.expires != null && license.expires <= Date.now()) {
            return {success: false, reason: "License has expired"};
        }

        if (license.serverLock != null && license.serverLock !== serverId) {
            return {success: false, reason: "License is locked to a different server"};
        }

        if (license.serverId !== 'null' && license.serverId !== serverId) {
            return {success: false, reason: "License is already assigned to a different server"};
        }

        const updateParams = {
            TableName: TABLE_LICENSING,
            Key: { 
                licenseId: licenseId, 
            },
            UpdateExpression: "SET serverId = :sid",
            ExpressionAttributeValues: {
                ":sid": serverId
            },
            ReturnValues: "ALL_NEW"
        };
        
        await dynamo.update(updateParams).promise();
        return {success: true};
        
    } catch (err) {
        console.error("Error:", err);
        return {
            success: false,
            reason: "Database failure",
            error: err.message
        }
    }
}


const licenseCache = new Map();
const LICENSE_CACHE_TTL = 15 * 60 * 1000;

// Manual licensing override
const LICENSE_OVERRIDES = new Set([]);


async function isServerLicensed(serverId) {
    const sid = String(serverId);

    if (LICENSE_OVERRIDES.has(sid)) {
        return true;
    }

    // Check cache first
    const cached = licenseCache.get(sid);
    if (cached && Date.now() - cached.timestamp < LICENSE_CACHE_TTL) {
        return cached.licensed;
    }

    try {
        const params = {
            TableName: TABLE_LICENSING,
            IndexName: 'serverId-index',
            KeyConditionExpression: 'serverId = :sid',
            ExpressionAttributeValues: {
                ':sid': sid
            }
        };

        const result = await dynamo.query(params).promise();

        if (!result.Items || result.Items.length === 0) {
            licenseCache.set(sid, { licensed: false, timestamp: Date.now() });
            return false;
        }

        const item = result.Items[0];
        const fullItem = await dynamo.get({
            TableName: TABLE_LICENSING,
            Key: {
                licenseId: item.licenseId
            }
        }).promise();

        const licensed = fullItem.Item &&
            fullItem.Item.disabled === false &&
            (fullItem.Item.expires == null || fullItem.Item.expires > Date.now());

        licenseCache.set(sid, { licensed, timestamp: Date.now() });
        return licensed;

    } catch (error) {
        console.error(`isServerLicensed(${sid}) failed:`, error);
        reportCriticalFailure(error, 'licensing', 'license_lookup', { guild_id: sid });
        throw error;
    }
}

function clearLicenseCache(serverId) {
    licenseCache.delete(String(serverId));
}

module.exports = { isServerLicensed, assignLicenseToServer, clearLicenseCache };