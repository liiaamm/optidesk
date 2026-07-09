jest.mock('../../utils/guildConfig', () => ({ getGuildConfig: jest.fn() }));

const { getGuildConfig } = require('../../utils/guildConfig');
const { buildIntegrationCommand } = require('../../utils/integrations/commands');

beforeEach(() => {
    jest.clearAllMocks();
});

test('integration commands reject guilds that have not opted in', async () => {
    getGuildConfig.mockResolvedValue({ settings: { integrationsEnabled: false } });
    const execute = jest.fn();
    const reply = jest.fn().mockResolvedValue('disabled');
    const command = buildIntegrationCommand({ data: {}, execute, ctx: {} });

    await expect(command.execute({ guildId: 'guild-1', reply })).resolves.toBe('disabled');

    expect(execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Integrations are disabled in this server.',
    }));
});

test('integration commands run for guilds that have opted in', async () => {
    getGuildConfig.mockResolvedValue({ settings: { integrationsEnabled: true } });
    const ctx = {};
    const interaction = { guildId: 'guild-1' };
    const execute = jest.fn().mockResolvedValue('ok');
    const command = buildIntegrationCommand({ data: {}, execute, ctx });

    await expect(command.execute(interaction)).resolves.toBe('ok');
    expect(execute).toHaveBeenCalledWith(interaction, ctx);
});
