jest.mock('../../utils/guildConfig', () => ({ getGuildConfig: jest.fn() }));
jest.mock('../../utils/telemetry', () => ({ captureEvent: jest.fn(), reportCriticalFailure: jest.fn() }));
jest.mock('../../utils/config', () => ({ getConfig: jest.fn() }));
jest.mock('../../utils/enforcement', () => ({ checkUserNetBan: jest.fn(), checkServerBan: jest.fn() }));
jest.mock('../../utils/licensing', () => ({ isServerLicensed: jest.fn() }));
jest.mock('../../utils/rateLimiter', () => ({ consume: jest.fn() }));

const { getGuildConfig } = require('../../utils/guildConfig');
const { getConfig } = require('../../utils/config');
const { checkUserNetBan, checkServerBan } = require('../../utils/enforcement');
const { isServerLicensed } = require('../../utils/licensing');
const { consume } = require('../../utils/rateLimiter');
const { createExternalTicket } = require('../../utils/integrations/tickets');

const getClient = () => ({ isReady: () => true });

function input(idempotencyKey) {
    return {
        guildId: 'guild-1',
        userId: 'user-1',
        category: 'Support',
        subject: 'Phone ticket',
        idempotencyKey,
        source: 'test',
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockReturnValue({
        hostedEnforcementEnabled: true,
        licensingEnabled: true,
        rateLimitEnabled: true,
    });
    checkUserNetBan.mockResolvedValue({ success: true, netBan: false });
    checkServerBan.mockResolvedValue({ success: true, banned: false });
    isServerLicensed.mockResolvedValue(true);
    consume.mockReturnValue({ allowed: true });
    getGuildConfig.mockResolvedValue({ settings: { integrationsEnabled: false } });
});

test('external ticket creation blocks restricted users', async () => {
    checkUserNetBan.mockResolvedValue({ success: true, netBan: true });
    await expect(createExternalTicket(getClient, 'test', input('user-ban')))
        .rejects.toThrow('user user-1 is restricted');
});

test('external ticket creation blocks restricted guilds', async () => {
    checkServerBan.mockResolvedValue({ success: true, banned: true });
    await expect(createExternalTicket(getClient, 'test', input('guild-ban')))
        .rejects.toThrow('guild guild-1 is restricted');
});

test('external ticket creation blocks unlicensed guilds', async () => {
    isServerLicensed.mockResolvedValue(false);
    await expect(createExternalTicket(getClient, 'test', input('unlicensed')))
        .rejects.toThrow('guild guild-1 is not licensed');
});

test('external ticket creation uses the normal ticket rate limit', async () => {
    consume.mockReturnValue({ allowed: false, retryAfterMs: 2500 });
    await expect(createExternalTicket(getClient, 'test', input('rate-limit')))
        .rejects.toThrow('retry in 3s');
    expect(consume).toHaveBeenCalledWith('user-1', 'openTicketModal', 8);
});

test('external ticket creation reaches the guild opt-in after access checks pass', async () => {
    await expect(createExternalTicket(getClient, 'test', input('guild-opt-in')))
        .rejects.toThrow('guild guild-1 has not enabled integrations');
    expect(checkUserNetBan).toHaveBeenCalledWith('user-1');
    expect(checkServerBan).toHaveBeenCalledWith('guild-1');
    expect(isServerLicensed).toHaveBeenCalledWith('guild-1');
    expect(consume).toHaveBeenCalledWith('user-1', 'openTicketModal', 8);
});

test('disabled access controls are not called', async () => {
    getConfig.mockReturnValue({
        hostedEnforcementEnabled: false,
        licensingEnabled: false,
        rateLimitEnabled: false,
    });
    await expect(createExternalTicket(getClient, 'test', input('controls-disabled')))
        .rejects.toThrow('guild guild-1 has not enabled integrations');
    expect(checkUserNetBan).not.toHaveBeenCalled();
    expect(checkServerBan).not.toHaveBeenCalled();
    expect(isServerLicensed).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
});
