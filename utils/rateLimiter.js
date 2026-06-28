// Weighted token-bucket rate limiter, per-user

const CAPACITY        = 60;                // tokens
const REFILL_PER_SEC  = 1.0;               // tokens/sec (full refill in 60s)
const ABUSE_WINDOW    = 10 * 60 * 1000;    // 10 minutes
const STREAK_WINDOW   = 5 * 60 * 1000;     // 5 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000;
const IDLE_EVICT_MS   = 10 * 60 * 1000;

// Map<userId, { tokens: number, lastRefillMs: number }>
const userBuckets = new Map();

// Map<userId, number[]>  // denial timestamps within ABUSE_WINDOW
const userAbuseTracker = new Map();

// Map<userId, Map<key, number[]>>  // successful-use timestamps within STREAK_WINDOW
const userStreaks = new Map();

const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [userId, state] of userBuckets.entries()) {
        const elapsed = (now - state.lastRefillMs) / 1000;
        const refilled = Math.min(CAPACITY, state.tokens + elapsed * REFILL_PER_SEC);
        if (refilled >= CAPACITY && now - state.lastRefillMs > IDLE_EVICT_MS) {
            userBuckets.delete(userId);
        }
    }

    for (const [userId, timestamps] of userAbuseTracker.entries()) {
        const valid = timestamps.filter(ts => now - ts < ABUSE_WINDOW);
        if (valid.length === 0) userAbuseTracker.delete(userId);
        else userAbuseTracker.set(userId, valid);
    }

    for (const [userId, perKey] of userStreaks.entries()) {
        for (const [key, timestamps] of perKey.entries()) {
            const valid = timestamps.filter(ts => now - ts < STREAK_WINDOW);
            if (valid.length === 0) perKey.delete(key);
            else perKey.set(key, valid);
        }
        if (perKey.size === 0) userStreaks.delete(userId);
    }
}, CLEANUP_INTERVAL);

// Don't hold the event loop open just for the cleanup timer
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function refill(state, now) {
    const elapsed = (now - state.lastRefillMs) / 1000;
    state.tokens = Math.min(CAPACITY, state.tokens + elapsed * REFILL_PER_SEC);
    state.lastRefillMs = now;
}

function streakCount(userId, key, now) {
    const perKey = userStreaks.get(userId);
    if (!perKey) return 0;
    const timestamps = perKey.get(key);
    if (!timestamps) return 0;
    return timestamps.filter(ts => now - ts < STREAK_WINDOW).length;
}

function pushStreak(userId, key, now) {
    let perKey = userStreaks.get(userId);
    if (!perKey) {
        perKey = new Map();
        userStreaks.set(userId, perKey);
    }
    const fresh = (perKey.get(key) ?? []).filter(ts => now - ts < STREAK_WINDOW);
    fresh.push(now);
    perKey.set(key, fresh);
}

function timeUntilStreakAffordable(userId, key, baseCost, now) {
    const timestamps = userStreaks.get(userId)?.get(key) ?? [];
    const valid = timestamps.filter(ts => now - ts < STREAK_WINDOW).sort((a, b) => a - b);

    // Largest k where baseCost × (1 + k) still fits the bucket
    let kMax = 0;
    while (baseCost * (1 + (kMax + 1)) <= CAPACITY) kMax++;

    const needToExpire = valid.length - kMax;
    if (needToExpire <= 0) return 0;

    const oldestThatMustExpire = valid[needToExpire - 1];
    return Math.max(0, STREAK_WINDOW - (now - oldestThatMustExpire) + 1);
}

/**
 * Attempt to spend tokens from the user's bucket for the given key.
 */
function consume(userId, key, baseCost) {
    const now = Date.now();

    if (baseCost === 0) {
        return { allowed: true, tokensRemaining: CAPACITY, abuseCount: 0, effectiveCost: 0 };
    }

    const prior = streakCount(userId, key, now);
    const effectiveCost = baseCost * (1 + prior);

    let state = userBuckets.get(userId);
    if (!state) {
        state = { tokens: CAPACITY, lastRefillMs: now };
        userBuckets.set(userId, state);
    } else {
        refill(state, now);
    }

    if (state.tokens >= effectiveCost) {
        state.tokens -= effectiveCost;
        pushStreak(userId, key, now);
        return { allowed: true, tokensRemaining: state.tokens, abuseCount: 0, effectiveCost };
    }

    let retryAfterMs;
    if (effectiveCost > CAPACITY) {
        // Locked-out by the streak multiplier — refill alone can't help.
        retryAfterMs = timeUntilStreakAffordable(userId, key, baseCost, now);
    } else {
        const deficit = effectiveCost - state.tokens;
        retryAfterMs = Math.ceil((deficit / REFILL_PER_SEC) * 1000);
    }

    const abuseTimestamps = (userAbuseTracker.get(userId) ?? []).filter(ts => now - ts < ABUSE_WINDOW);
    abuseTimestamps.push(now);
    userAbuseTracker.set(userId, abuseTimestamps);

    return {
        allowed: false,
        tokensRemaining: state.tokens,
        abuseCount: abuseTimestamps.length,
        effectiveCost,
        retryAfterMs,
    };
}

function _resetForTests() {
    userBuckets.clear();
    userAbuseTracker.clear();
    userStreaks.clear();
}

function _stopCleanup() {
    clearInterval(cleanupTimer);
}

module.exports = {
    consume,
    _resetForTests,
    _stopCleanup,
    CAPACITY,
    REFILL_PER_SEC,
    ABUSE_WINDOW,
    STREAK_WINDOW,
};
