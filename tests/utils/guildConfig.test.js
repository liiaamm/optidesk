jest.mock('../../utils/db', () => ({
    dynamo: { get: jest.fn() }
}));

const { getGuildConfig, clearGuildCache } = require('../../utils/guildConfig');
const { dynamo } = require('../../utils/db');

const GUILD = 'guild_test_123';
const MOCK_CONFIG = {
    serverId: GUILD,
    access: { supervisorRoleID: 'role_supervisor' },
    layout: {
        categories: {
            'General Support': {
                channelId: 'chan_gen',
                inboxId: 'inbox_gen',
                anonymous: false,
                staffRoleId: 'role_gen_staff',
                supervisorRoleId: null,
                description: null,
                emoji: null,
            },
        },
    },
};

beforeEach(() => {
    clearGuildCache(GUILD);
});

test('returns null when config not found in DynamoDB', async () => {
    dynamo.get.mockReturnValue({ promise: () => Promise.resolve({ Item: undefined }) });
    expect(await getGuildConfig(GUILD)).toBeNull();
});

test('returns config when found in DynamoDB', async () => {
    dynamo.get.mockReturnValue({ promise: () => Promise.resolve({ Item: MOCK_CONFIG }) });
    expect(await getGuildConfig(GUILD)).toEqual(MOCK_CONFIG);
});

test('serves cache on second call — DynamoDB queried only once', async () => {
    dynamo.get.mockReturnValue({ promise: () => Promise.resolve({ Item: MOCK_CONFIG }) });
    await getGuildConfig(GUILD);
    await getGuildConfig(GUILD);
    expect(dynamo.get).toHaveBeenCalledTimes(1);
});
