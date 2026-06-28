const { dynamo } = require('./db');
const { TABLE_ENFORCEMENT, TABLE_ENFORCEMENT_GUILDS } = require('./constants');
const { reportCriticalFailure } = require('./telemetry');


const netBanCache = new Map();
const serverBanCache = new Map();
const userBanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Network-ban a user (type 3)
async function netBanUser(userid, reason, notes) {
    try {
    const params = {
        TableName: TABLE_ENFORCEMENT,
        Item: {
            userId: userid,
            type: "netBan",
            expires: null,
            reason: reason,
            notes: notes ?? null,
        },
    };
    await dynamo.put(params).promise();
    // Invalidate caches
    netBanCache.delete(userid);
    userBanCache.delete(userid);
    return {success: true}
    } catch (err) {
        reportCriticalFailure(err, 'enforcement', 'enforcement_write', { write: 'netBanUser', userid });
        return {
            success: false,
            reason: "Database failure"
        }
    }
}

// Ban a user (type 1)
async function banUser(userid, permaban, time, reason, notes) {
    try {
    const params = {
        TableName: TABLE_ENFORCEMENT,
        Item: {
            userId: userid,
            type: "normal",
            permanent: permaban,
            expires: time ?? null,
            reason: reason,
            notes: notes ?? null,
        },
    };
    await dynamo.put(params).promise();
    userBanCache.delete(userid);
    netBanCache.delete(userid);
    return {success: true}
    } catch (err) {
        reportCriticalFailure(err, 'enforcement', 'enforcement_write', { write: 'banUser', userid });
        return {
            success: false,
            reason: "Database failure"
        }
    }
}

// Ban a server (type 2)
async function banGuild(serverid, permaban, time, reason, notes) {
    try {
    const params = {
        TableName: TABLE_ENFORCEMENT_GUILDS,
        Item: {
            serverId: serverid,
            permanent: permaban,
            expires: time ?? null,
            reason: reason,
            notes: notes ?? null,
        },
    };
    await dynamo.put(params).promise();
    serverBanCache.delete(serverid);
    return {success: true}
    } catch (err) {
        reportCriticalFailure(err, 'enforcement', 'enforcement_write', { write: 'banGuild', guild_id: serverid });
        return {
            success: false,
            reason: "Database failure"
        }
    }
}

function clearEnforcementCache(idOrType) {
    if (!idOrType) {
        netBanCache.clear();
        userBanCache.clear();
        serverBanCache.clear();
        return;
    }
    netBanCache.delete(idOrType);
    userBanCache.delete(idOrType);
    serverBanCache.delete(idOrType);
}



async function checkUserNetBan(userid) {
    const now = Date.now();

    // Check cache first
    if (netBanCache.has(userid)) {
        const cached = netBanCache.get(userid);
        if (cached.expiresAt > now) {
            return cached.result; // Return cached result
        } else {
            netBanCache.delete(userid); // Expired, remove
        }
    }

    try {
        const params = {
            TableName: TABLE_ENFORCEMENT,
            Key: { userId: userid },
        };

        const result = await dynamo.get(params).promise();
        const response = result.Item?.type === "netBan"
            ? { success: true, netBan: true }
            : { success: true, netBan: false };

        netBanCache.set(userid, {
            result: response,
            expiresAt: now + CACHE_TTL
        });

        return response;
    } catch (err) {
        reportCriticalFailure(err, 'enforcement', 'ban_check', { check: 'checkUserNetBan', userid });
        return {
            success: false,
            reason: "Database failure"
        }
    }
}

// Check if a user is banned on an OptiDesk view-only level
async function checkUserBan(userid) {
    const now = Date.now();

    if (userBanCache.has(userid)) {
        const cached = userBanCache.get(userid);
        if (cached.expiresAt > now) {
            return cached.result;
        }
        userBanCache.delete(userid);
    }

    try {
        const params = {
            TableName: TABLE_ENFORCEMENT,
            Key: { userId: userid }
        };

        const result = await dynamo.get(params).promise();

        const response = {
            success: true,
            banned: !!result.Item
        };

        userBanCache.set(userid, {
            result: response,
            expiresAt: now + CACHE_TTL
        });

        return response;

    } catch (err) {
        console.error("checkUserBan failed:", err);
        reportCriticalFailure(err, 'enforcement', 'ban_check', { check: 'checkUserBan', userid });
        return {
            success: false,
            reason: "Database failure"
        };
    }
}

// Check if a server is banned from OptiDesk (type 2)
async function checkServerBan(serverid) {
    if (!serverid) {
        console.warn("checkServerBan called without serverid");
        return { success: false, banned: false, reason: "No serverId" };
    }

    const now = Date.now();

    if (serverBanCache.has(serverid)) {
        const cached = serverBanCache.get(serverid);
        if (cached?.expiresAt > now) return cached.result;
        serverBanCache.delete(serverid);
    }

    try {
        const result = await dynamo.get({
            TableName: TABLE_ENFORCEMENT_GUILDS,
            Key: { serverId: serverid }
        }).promise();

        const response = { success: true, banned: !!result.Item };

        serverBanCache.set(serverid, {
            result: response,
            expiresAt: now + CACHE_TTL
        });

        return response;
    } catch (err) {
        console.error("checkServerBan failed:", err);
        reportCriticalFailure(err, 'enforcement', 'ban_check', { check: 'checkServerBan', guild_id: serverid });
        return { success: false, reason: "Database failure" };
    }
}

module.exports = {
    checkUserNetBan,
    checkUserBan,
    checkServerBan,
    netBanUser,
    banUser,
    banGuild,
    clearEnforcementCache
};