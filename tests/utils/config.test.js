const { normalizeConfig } = require('../../utils/config');

const base = { token: 't', clientId: 'c', guildId: 'g' };

describe('normalizeConfig', () => {
    test('self-host profile fills safe local defaults', () => {
        const c = normalizeConfig({ ...base }, 'selfhost');
        expect(c.mode).toBe('selfhost');
        expect(c.hosting).toBe('local');
        expect(c.database.type).toBe('dynamodb-local');
        expect(c.database.persistPath).toBe('./data/dynamo');
        expect(c.database.endpoint).toBe('http://localhost:8000');
        expect(c.storage.type).toBe('disabled');
        expect(c.posthogEnabled).toBe(false);
        expect(c.licensingEnabled).toBe(false);
        expect(c.hostedEnforcementEnabled).toBe(false);
        expect(c.rateLimitEnabled).toBe(true);
        expect(c.singleTenant).toBe(true);
        // required keys are carried through
        expect(c.token).toBe('t');
        expect(c.guildId).toBe('g');
    });

    test('cloud profile enables AWS + S3 + PostHog + licensing, multi-tenant', () => {
        const c = normalizeConfig({ ...base, posthogKey: 'phc_x' }, 'cloud');
        expect(c.mode).toBe('cloud');
        expect(c.hosting).toBe('aws');
        expect(c.database.type).toBe('dynamodb-aws');
        expect(c.storage.type).toBe('s3');
        expect(c.storage.bucket).toBe('optidesktranscripts');
        expect(c.posthogEnabled).toBe(true);
        expect(c.licensingEnabled).toBe(true);
        expect(c.hostedEnforcementEnabled).toBe(true);
        expect(c.rateLimitEnabled).toBe(true);
        expect(c.singleTenant).toBe(false);
    });

    test('PostHog stays off unless a key is present', () => {
        expect(normalizeConfig({ ...base, posthogEnabled: true }, 'selfhost').posthogEnabled).toBe(false);
        expect(normalizeConfig({ ...base, posthogEnabled: true, posthogKey: 'k' }, 'selfhost').posthogEnabled).toBe(true);
        // cloud defaults want posthog on, but a missing key still disables it
        expect(normalizeConfig({ ...base }, 'cloud').posthogEnabled).toBe(false);
    });

    test('raw values override defaults and sub-objects deep-merge', () => {
        const c = normalizeConfig(
            {
                ...base,
                singleTenant: false,
                licensingEnabled: true,
                hostedEnforcementEnabled: true,
                rateLimitEnabled: false,
                storage: { type: 's3', bucket: 'mybucket' },
            },
            'selfhost',
        );
        expect(c.singleTenant).toBe(false);
        expect(c.licensingEnabled).toBe(true);
        expect(c.hostedEnforcementEnabled).toBe(true);
        expect(c.rateLimitEnabled).toBe(false);
        expect(c.storage.type).toBe('s3');
        expect(c.storage.bucket).toBe('mybucket');
        // region default survives the merge
        expect(c.storage.region).toBe('ap-southeast-4');
    });

    test('dev profile keeps telemetry + licensing on and runs in-memory', () => {
        const c = normalizeConfig({ ...base, posthogKey: 'k' }, 'dev');
        expect(c.mode).toBe('dev');
        expect(c.database.type).toBe('dynamodb-local');
        expect(c.database.persistPath).toBeNull();
        expect(c.posthogEnabled).toBe(true);
        expect(c.licensingEnabled).toBe(true);
        expect(c.hostedEnforcementEnabled).toBe(true);
        expect(c.rateLimitEnabled).toBe(true);
        expect(c.singleTenant).toBe(false);
    });
});
