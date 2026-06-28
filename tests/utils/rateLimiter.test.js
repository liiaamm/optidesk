const {
    consume,
    _resetForTests,
    _stopCleanup,
    CAPACITY,
    REFILL_PER_SEC,
    STREAK_WINDOW,
} = require('../../utils/rateLimiter');
const { resolveCost, DEFAULT_COST, COSTS } = require('../../utils/rateLimitWeights');

// Most token-bucket tests use distinct keys per call to isolate from the
// per-key streak multiplier. Tests that exercise the multiplier reuse a key
// on purpose.
let __k = 0;
const fresh = () => `k${++__k}`;

describe('rateLimiter.consume — token bucket', () => {
    let nowSpy;
    let currentTime;

    beforeEach(() => {
        _resetForTests();
        currentTime = 1_700_000_000_000;
        nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    });

    afterEach(() => {
        nowSpy.mockRestore();
    });

    afterAll(() => {
        _stopCleanup();
    });

    test('cheap actions succeed up to CAPACITY, then deny', () => {
        for (let i = 0; i < CAPACITY; i++) {
            expect(consume('u1', fresh(), 1).allowed).toBe(true);
        }
        const denied = consume('u1', fresh(), 1);
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterMs).toBeGreaterThan(0);
    });

    test('heavy action spends proportional tokens', () => {
        // CAPACITY=60, cost=15 → 4 succeed, 5th denied
        for (let i = 0; i < 4; i++) {
            expect(consume('u2', fresh(), 15).allowed).toBe(true);
        }
        const denied = consume('u2', fresh(), 15);
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterMs).toBeGreaterThanOrEqual(14_000);
        expect(denied.retryAfterMs).toBeLessThanOrEqual(16_000);
    });

    test('mixed costs drain the bucket correctly', () => {
        expect(consume('u3', fresh(), 3).allowed).toBe(true);   // 57 left
        expect(consume('u3', fresh(), 3).allowed).toBe(true);   // 54 left
        expect(consume('u3', fresh(), 3).allowed).toBe(true);   // 51 left
        expect(consume('u3', fresh(), 1).allowed).toBe(true);   // 50 left
        expect(consume('u3', fresh(), 15).allowed).toBe(true);  // 35 left
    });

    test('bucket refills over time', () => {
        // drain
        expect(consume('u4', fresh(), CAPACITY).allowed).toBe(true);
        expect(consume('u4', fresh(), 1).allowed).toBe(false);

        // advance 30s → 30 tokens available
        currentTime += 30_000;
        expect(consume('u4', fresh(), 20).allowed).toBe(true);
        // 10 left
        expect(consume('u4', fresh(), 15).allowed).toBe(false);
    });

    test('refill does not exceed CAPACITY', () => {
        // spend a bit, then wait a long time
        consume('u5', fresh(), 5);
        currentTime += 60 * 60 * 1000; // 1 hour
        // should allow one full capacity spend
        expect(consume('u5', fresh(), CAPACITY).allowed).toBe(true);
        expect(consume('u5', fresh(), 1).allowed).toBe(false);
    });

    test('retryAfterMs matches REFILL_PER_SEC', () => {
        // drain completely
        consume('u6', fresh(), CAPACITY);
        const denied = consume('u6', fresh(), 10);
        // need 10 tokens at REFILL_PER_SEC=1.0/s → ~10_000 ms
        const expected = Math.ceil((10 / REFILL_PER_SEC) * 1000);
        expect(denied.retryAfterMs).toBe(expected);
    });
});

describe('rateLimiter.consume — abuse tracker', () => {
    let nowSpy;
    let currentTime;

    beforeEach(() => {
        _resetForTests();
        currentTime = 1_700_000_000_000;
        nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    });

    afterEach(() => {
        nowSpy.mockRestore();
    });

    afterAll(() => {
        _stopCleanup();
    });

    test('each denial increments abuseCount by exactly 1 (regression: previous impl never accumulated)', () => {
        // drain
        consume('a1', fresh(), CAPACITY);
        expect(consume('a1', fresh(), 1).abuseCount).toBe(1);
        expect(consume('a1', fresh(), 1).abuseCount).toBe(2);
        expect(consume('a1', fresh(), 1).abuseCount).toBe(3);
    });

    test('allowed actions do not add to abuseCount', () => {
        for (let i = 0; i < 10; i++) {
            expect(consume('a2', fresh(), 1).abuseCount).toBe(0);
        }
    });

    test('60 denials within the window reach the auto-ban threshold', () => {
        consume('a3', fresh(), CAPACITY);
        let last;
        for (let i = 0; i < 60; i++) {
            last = consume('a3', fresh(), 1);
        }
        expect(last.abuseCount).toBeGreaterThanOrEqual(60);
    });

    test('abuse timestamps older than 10 min are dropped', () => {
        consume('a4', fresh(), CAPACITY);
        expect(consume('a4', fresh(), 1).abuseCount).toBe(1);

        // Advance past the abuse window; bucket is fully refilled.
        currentTime += 11 * 60 * 1000;

        // Drain and deny again — old abuse timestamp should have expired,
        // so the new denial starts the counter at 1, not 2.
        consume('a4', fresh(), CAPACITY);
        expect(consume('a4', fresh(), 1).abuseCount).toBe(1);
    });
});

describe('rateLimiter.consume — per-key streak multiplier', () => {
    let nowSpy;
    let currentTime;

    beforeEach(() => {
        _resetForTests();
        currentTime = 1_700_000_000_000;
        nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    });

    afterEach(() => {
        nowSpy.mockRestore();
    });

    afterAll(() => {
        _stopCleanup();
    });

    test('repeating the same key linearly grows effectiveCost', () => {
        // base 12 → 12, 24, 36 (cumulative 12, 36, 72). 3rd denied: 24 left, needs 36.
        const r1 = consume('s1', 'open', 12);
        const r2 = consume('s1', 'open', 12);
        const r3 = consume('s1', 'open', 12);
        expect(r1.effectiveCost).toBe(12);
        expect(r2.effectiveCost).toBe(24);
        expect(r3.allowed).toBe(false);
        expect(r3.effectiveCost).toBe(36);
    });

    test('different keys do not compound', () => {
        const r1 = consume('s2', 'open', 12);
        const r2 = consume('s2', 'claimTicket', 3);
        const r3 = consume('s2', 'closeTicket', 3);
        expect(r1.effectiveCost).toBe(12);
        expect(r2.effectiveCost).toBe(3);
        expect(r3.effectiveCost).toBe(3);
    });

    test('denied attempts do not grow the streak', () => {
        // Drain bucket so the key gets denied without ever spending tokens.
        consume('s3', 'filler', CAPACITY);
        const d1 = consume('s3', 'open', 12);
        const d2 = consume('s3', 'open', 12);
        expect(d1.allowed).toBe(false);
        expect(d2.allowed).toBe(false);
        // Both denials see streak=0 → effectiveCost stays at base.
        expect(d1.effectiveCost).toBe(12);
        expect(d2.effectiveCost).toBe(12);
    });

    test('streak resets after STREAK_WINDOW elapses', () => {
        const r1 = consume('s4', 'open', 12);
        expect(r1.effectiveCost).toBe(12);

        // Advance past the streak window AND let bucket refill.
        currentTime += STREAK_WINDOW + 1;
        const r2 = consume('s4', 'open', 12);
        expect(r2.effectiveCost).toBe(12);
    });

    test('cost-0 keys ignore the multiplier', () => {
        const r1 = consume('s5', 'setup', 0);
        const r2 = consume('s5', 'setup', 0);
        const r3 = consume('s5', 'setup', 0);
        expect(r1.allowed).toBe(true);
        expect(r2.allowed).toBe(true);
        expect(r3.allowed).toBe(true);
        expect(r1.effectiveCost).toBe(0);
        expect(r3.effectiveCost).toBe(0);
    });

    test('claim spam table (base 3, linear): 5 in a row succeed, 6th denied', () => {
        // costs 3, 6, 9, 12, 15 → cumulative 3, 9, 18, 30, 45. 6th = 18, only 15 left.
        for (let i = 1; i <= 5; i++) {
            const r = consume('s6', 'claimTicket', 3);
            expect(r.allowed).toBe(true);
            expect(r.effectiveCost).toBe(3 * i);
        }
        const denied = consume('s6', 'claimTicket', 3);
        expect(denied.allowed).toBe(false);
        expect(denied.effectiveCost).toBe(18);
    });

    test('/open spam table (base 8, linear): 3 in a row succeed, 4th denied', () => {
        // costs 8, 16, 24, 32 → cumulative 8, 24, 48. 4th = 32, only 12 left.
        const r1 = consume('s7', 'open', 8);
        expect(r1.allowed).toBe(true);
        expect(r1.effectiveCost).toBe(8);
        expect(r1.tokensRemaining).toBe(52);

        const r2 = consume('s7', 'open', 8);
        expect(r2.allowed).toBe(true);
        expect(r2.effectiveCost).toBe(16);
        expect(r2.tokensRemaining).toBe(36);

        const r3 = consume('s7', 'open', 8);
        expect(r3.allowed).toBe(true);
        expect(r3.effectiveCost).toBe(24);
        expect(r3.tokensRemaining).toBe(12);

        const r4 = consume('s7', 'open', 8);
        expect(r4.allowed).toBe(false);
        expect(r4.effectiveCost).toBe(32);
    });

    test('locked-out retryAfterMs reflects time until streak ages out, not refill deficit', () => {
        // Use a tiny capacity scenario via base 30: 30, 60, 90 (last > CAPACITY=60).
        const t0 = currentTime;
        const r1 = consume('s8', 'heavy', 30);
        expect(r1.allowed).toBe(true);
        expect(r1.effectiveCost).toBe(30);

        // Wait for full refill, then second use at cost 60 — fits exactly.
        currentTime += 60_000;
        const r2 = consume('s8', 'heavy', 30);
        expect(r2.allowed).toBe(true);
        expect(r2.effectiveCost).toBe(60);
        const t2 = currentTime;

        // Third attempt would cost 90 > CAPACITY. No amount of refill helps;
        // need oldest streak entry (at t0) to age out so cost drops to 60.
        currentTime += 60_000;
        const denied = consume('s8', 'heavy', 30);
        expect(denied.allowed).toBe(false);
        expect(denied.effectiveCost).toBe(90);

        const expectedWait = STREAK_WINDOW - (currentTime - t0) + 1;
        expect(denied.retryAfterMs).toBe(expectedWait);
        // NOT the naive (90-60)/1 = 30s refill answer.
        expect(denied.retryAfterMs).not.toBe(30_000);
        // Sanity: t2 is the second entry, not what we wait on.
        void t2;
    });
});

describe('resolveCost', () => {
    test('known customId returns its mapped cost', () => {
        expect(resolveCost({ customId: 'finalCloseTicket' })).toBe(COSTS.finalCloseTicket);
        expect(resolveCost({ customId: 'buttonCategoryHandler' })).toBe(COSTS.buttonCategoryHandler);
    });

    test('unknown customId falls back to DEFAULT_COST', () => {
        expect(resolveCost({ customId: 'totallyUnknownButton' })).toBe(DEFAULT_COST);
    });

    test('known slash command returns its mapped cost', () => {
        expect(resolveCost({ commandName: 'open' })).toBe(COSTS.open);
    });

    test('/setup command resolves to 0 (exempt)', () => {
        expect(resolveCost({ commandName: 'setup' })).toBe(0);
    });

    test('setup_* customIds resolve to 0 (exempt)', () => {
        expect(resolveCost({ customId: 'setup_welcome' })).toBe(0);
        expect(resolveCost({ customId: 'setup_staff_role' })).toBe(0);
        expect(resolveCost({ customId: 'setup_agreement' })).toBe(0);
    });

    test('commandName takes precedence over customId', () => {
        expect(resolveCost({ commandName: 'open', customId: 'finalCloseTicket' })).toBe(COSTS.open);
    });

    test('missing customId and commandName falls back to DEFAULT_COST', () => {
        expect(resolveCost({})).toBe(DEFAULT_COST);
    });
});
