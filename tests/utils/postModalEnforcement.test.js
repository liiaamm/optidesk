jest.mock('../../utils/config', () => ({
    getConfig: jest.fn(),
}));

jest.mock('../../utils/enforcement', () => ({
    checkUserNetBan: jest.fn(),
    checkServerBan: jest.fn(),
}));

jest.mock('../../utils/licensing', () => ({
    isServerLicensed: jest.fn(),
}));

jest.mock('../../utils/rateLimiter', () => ({
    consume: jest.fn(),
}));

jest.mock('../../utils/rateLimitWeights', () => ({
    COSTS: { testModal: 1 },
    DEFAULT_COST: 1,
}));

jest.mock('../../utils/interactionHelper', () => ({
    safeReply: jest.fn(),
}));

jest.mock('../../utils/telemetry', () => ({
    captureEvent: jest.fn(),
    captureException: jest.fn(),
}));

const { getConfig } = require('../../utils/config');
const { checkUserNetBan, checkServerBan } = require('../../utils/enforcement');
const { isServerLicensed } = require('../../utils/licensing');
const { consume } = require('../../utils/rateLimiter');
const { safeReply } = require('../../utils/interactionHelper');
const { enforcePostModalSubmit } = require('../../utils/postModalEnforcement');

const submitted = {
    user: { id: 'user-1' },
    guildId: 'guild-1',
    customId: 'ticketModal',
    type: 5,
};

beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockReturnValue({
        hostedEnforcementEnabled: false,
        licensingEnabled: false,
        rateLimitEnabled: true,
    });
    consume.mockReturnValue({ allowed: true });
});

test('self-host modal path skips hosted bans and licensing when disabled', async () => {
    await expect(enforcePostModalSubmit(submitted, 'testModal')).resolves.toBe(true);

    expect(checkUserNetBan).not.toHaveBeenCalled();
    expect(checkServerBan).not.toHaveBeenCalled();
    expect(isServerLicensed).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith('user-1', 'testModal', 1);
});

test('modal path still enforces licensing when licensingEnabled is true', async () => {
    getConfig.mockReturnValue({
        hostedEnforcementEnabled: false,
        licensingEnabled: true,
        rateLimitEnabled: true,
    });
    isServerLicensed.mockResolvedValue(false);

    await expect(enforcePostModalSubmit(submitted, 'testModal')).resolves.toBe(false);

    expect(checkUserNetBan).not.toHaveBeenCalled();
    expect(checkServerBan).not.toHaveBeenCalled();
    expect(isServerLicensed).toHaveBeenCalledWith('guild-1');
    expect(safeReply).toHaveBeenCalledWith(
        submitted,
        expect.stringContaining('unlicensed'),
    );
});

test('modal path skips rate limiting when rateLimitEnabled is false', async () => {
    getConfig.mockReturnValue({
        hostedEnforcementEnabled: false,
        licensingEnabled: false,
        rateLimitEnabled: false,
    });

    await expect(enforcePostModalSubmit(submitted, 'testModal')).resolves.toBe(true);

    expect(consume).not.toHaveBeenCalled();
});
