jest.mock('aws-sdk');

const mockCapture = jest.fn();
const mockCaptureException = jest.fn();
const mockGroupIdentify = jest.fn();

jest.mock('../../utils/db', () => ({
    dynamo: {},
    posthog: {
        capture: (...args) => mockCapture(...args),
        captureException: (...args) => mockCaptureException(...args),
        groupIdentify: (...args) => mockGroupIdentify(...args),
    },
}));

let mockPosthogEnabled = true;
jest.mock('../../utils/config', () => ({
    getConfig: () => ({ posthogEnabled: mockPosthogEnabled, hosting: 'test' }),
    IS_DEV: false,
}));

const { reportCriticalFailure, captureEvent, captureException, identifyGuild, hasIdentifiedGuild } = require('../../utils/telemetry');

beforeEach(() => {
    mockCapture.mockReset();
    mockCaptureException.mockReset();
    mockGroupIdentify.mockReset();
    mockPosthogEnabled = true;
});

test('emits critical_failure event and grouped exception', () => {
    const err = Object.assign(new Error('boom'), { code: 'ProvisionedThroughputExceededException' });
    reportCriticalFailure(err, 'licensing', 'license_lookup', { guild_id: 'g1' });

    expect(mockCapture).toHaveBeenCalledTimes(1);
    const evt = mockCapture.mock.calls[0][0];
    expect(evt.distinctId).toBe('guild:g1');
    expect(evt.event).toBe('critical_failure');
    expect(evt.properties).toMatchObject({
        component: 'licensing',
        failure_type: 'license_lookup',
        severity: 'critical',
        error_code: 'ProvisionedThroughputExceededException',
        error_message: 'boom',
        guild_id: 'g1',
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][0]).toBe(err);
    expect(mockCaptureException.mock.calls[0][1]).toBe('guild:g1');
});

test('no-ops when posthog is disabled', () => {
    mockPosthogEnabled = false;
    reportCriticalFailure(new Error('x'), 'c', 'f', { guild_id: 'g1' });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
});

test('never throws when posthog.capture throws', () => {
    mockCapture.mockImplementationOnce(() => { throw new Error('posthog down'); });
    expect(() => reportCriticalFailure(new Error('x'), 'c', 'f', { guild_id: 'g1' })).not.toThrow();
});

test('falls back to system distinctId when no guild_id', () => {
    reportCriticalFailure(new Error('x'), 'index/uncaughtException', 'uncaught_exception');
    expect(mockCapture.mock.calls[0][0].distinctId).toBe('system');
});

test('honours explicit distinctId override', () => {
    reportCriticalFailure(new Error('x'), 'c', 'f', { distinctId: 'user:42', guild_id: 'g1' });
    expect(mockCapture.mock.calls[0][0].distinctId).toBe('user:42');
});

describe('group analytics', () => {
    test('captureEvent auto-attaches guild group from guild:<id> distinctId', () => {
        captureEvent('guild:g123', 'interaction_started', { foo: 'bar' });
        expect(mockCapture).toHaveBeenCalledTimes(1);
        expect(mockCapture.mock.calls[0][0].groups).toEqual({ guild: 'g123' });
    });

    test('captureEvent auto-attaches guild group from properties.guildId', () => {
        captureEvent('user:u1', 'enforcement_cooldown_hit', { guildId: 'g456' });
        expect(mockCapture.mock.calls[0][0].groups).toEqual({ guild: 'g456' });
    });

    test('captureEvent auto-attaches guild group from properties.guild_id', () => {
        captureEvent('user:u1', 'some_event', { guild_id: 'g789' });
        expect(mockCapture.mock.calls[0][0].groups).toEqual({ guild: 'g789' });
    });

    test('captureEvent omits groups when no guild context', () => {
        captureEvent('user:u1', 'user_only_event', {});
        expect(mockCapture.mock.calls[0][0].groups).toBeUndefined();
    });

    test('captureEvent honours explicit groups override', () => {
        captureEvent('guild:g1', 'event', { guild_id: 'g2' }, { groups: { guild: 'g3' } });
        expect(mockCapture.mock.calls[0][0].groups).toEqual({ guild: 'g3' });
    });

    test('captureException attaches $groups in properties bag', () => {
        captureException(new Error('x'), 'guild:g1', { foo: 'bar' });
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException.mock.calls[0][2].$groups).toEqual({ guild: 'g1' });
    });

    test('identifyGuild calls posthog.groupIdentify with guild type', () => {
        identifyGuild('g1', { name: 'Test Guild', member_count: 42 });
        expect(mockGroupIdentify).toHaveBeenCalledTimes(1);
        expect(mockGroupIdentify.mock.calls[0][0]).toEqual({
            groupType: 'guild',
            groupKey: 'g1',
            distinctId: 'guild:g1',
            properties: { name: 'Test Guild', member_count: 42 },
        });
        expect(hasIdentifiedGuild('g1')).toBe(true);
    });

    test('captureEvent lazy-identifies guild on first guild:<id> distinctId', () => {
        captureEvent('guild:lazy1', 'evt', {});
        expect(mockGroupIdentify).toHaveBeenCalledTimes(1);
        expect(mockGroupIdentify.mock.calls[0][0]).toEqual({
            groupType: 'guild',
            groupKey: 'lazy1',
            distinctId: 'guild:lazy1',
            properties: {},
        });
        // Second call for same guild: cached, no re-identify.
        captureEvent('guild:lazy1', 'evt2', {});
        expect(mockGroupIdentify).toHaveBeenCalledTimes(1);
    });

    test('captureEvent does NOT lazy-identify when guildId is only in properties', () => {
        captureEvent('user:u1', 'evt', { guildId: 'no_identify' });
        expect(mockGroupIdentify).not.toHaveBeenCalled();
    });

    test('captureException lazy-identifies guild on first guild:<id> distinctId', () => {
        captureException(new Error('x'), 'guild:lazyExc', {});
        expect(mockGroupIdentify).toHaveBeenCalledTimes(1);
        expect(mockGroupIdentify.mock.calls[0][0]).toMatchObject({
            groupKey: 'lazyExc',
            distinctId: 'guild:lazyExc',
        });
    });

    test('identifyGuild no-ops when posthog disabled', () => {
        mockPosthogEnabled = false;
        identifyGuild('g2', { name: 'x' });
        expect(mockGroupIdentify).not.toHaveBeenCalled();
    });

    test('identifyGuild no-ops when guildId is null', () => {
        identifyGuild(null, {});
        expect(mockGroupIdentify).not.toHaveBeenCalled();
    });

    test('identifyGuild never throws if groupIdentify throws', () => {
        mockGroupIdentify.mockImplementationOnce(() => { throw new Error('posthog down'); });
        expect(() => identifyGuild('g3', {})).not.toThrow();
    });
});
