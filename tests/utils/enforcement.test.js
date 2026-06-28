jest.mock('aws-sdk');

const { _mockInstance, _mockGet, _mockQuery, _mockPut } = require('aws-sdk');
const {
    checkUserNetBan,
    checkUserBan,
    checkServerBan,
    netBanUser,
    banUser,
    banGuild,
    clearEnforcementCache,
} = require('../../utils/enforcement');

beforeEach(() => {
    clearEnforcementCache();
});

describe('checkUserNetBan', () => {
    test('returns netBan: true when user has an active netBan record', async () => {
        _mockGet.mockResolvedValueOnce({ Item: { userId: 'u1', type: 'netBan' } });
        expect(await checkUserNetBan('u1')).toMatchObject({ netBan: true });
    });

    test('returns netBan: false when user is clean', async () => {
        _mockGet.mockResolvedValueOnce({ Item: undefined });
        expect(await checkUserNetBan('u2')).toMatchObject({ netBan: false });
    });

    test('returns netBan: false when the user has a non-netBan record (type "normal")', async () => {
        _mockGet.mockResolvedValueOnce({ Item: { userId: 'u2b', type: 'normal' } });
        expect(await checkUserNetBan('u2b')).toMatchObject({ netBan: false });
    });
});

describe('checkUserBan', () => {
    test('queries DynamoDB with correct userId key', async () => {
        _mockGet.mockResolvedValueOnce({ Item: null });
        await checkUserBan('u3');
        expect(_mockInstance.get).toHaveBeenCalledWith(expect.objectContaining({
            Key: { userId: 'u3' }
        }));
    });

    test('returns banned: true when record exists', async () => {
        _mockGet.mockResolvedValueOnce({ Item: { userId: 'u4', type: 'normal' } });
        expect(await checkUserBan('u4')).toMatchObject({ banned: true });
    });

    test('returns banned: false when no record', async () => {
        _mockGet.mockResolvedValueOnce({ Item: undefined });
        expect(await checkUserBan('u5')).toMatchObject({ banned: false });
    });
});

describe('checkServerBan', () => {
    test('returns banned: true when server is banned', async () => {
        _mockGet.mockResolvedValueOnce({ Item: { serverId: 's1' } });
        expect(await checkServerBan('s1')).toMatchObject({ banned: true });
    });

    test('returns banned: false when server is not banned', async () => {
        _mockGet.mockResolvedValueOnce({ Item: undefined });
        expect(await checkServerBan('s2')).toMatchObject({ banned: false });
    });
});

describe('cache invalidation on enforcement writes', () => {
    test('netBanUser invalidates the netBan cache so a freshly-banned user is blocked immediately', async () => {
        // First read populates the "not banned" cache entry.
        _mockGet.mockResolvedValueOnce({ Item: undefined });
        expect(await checkUserNetBan('u6')).toMatchObject({ netBan: false });

        // netBanUser succeeds and should invalidate the cached "not banned".
        _mockPut.mockResolvedValueOnce({});
        await netBanUser('u6', 'abuse', null);

        // Next check must hit DynamoDB again and reflect the new ban — not the
        // 5-minute-stale "false" cached entry.
        _mockGet.mockResolvedValueOnce({ Item: { userId: 'u6', type: 'netBan' } });
        expect(await checkUserNetBan('u6')).toMatchObject({ netBan: true });
    });

    test('banUser invalidates the user ban cache', async () => {
        _mockGet.mockResolvedValueOnce({ Item: undefined });
        expect(await checkUserBan('u7')).toMatchObject({ banned: false });

        _mockPut.mockResolvedValueOnce({});
        await banUser('u7', false, null, 'abuse', null);

        _mockGet.mockResolvedValueOnce({ Item: { userId: 'u7', type: 'normal' } });
        expect(await checkUserBan('u7')).toMatchObject({ banned: true });
    });

    test('banGuild invalidates the server ban cache', async () => {
        _mockGet.mockResolvedValueOnce({ Item: undefined });
        expect(await checkServerBan('s3')).toMatchObject({ banned: false });

        _mockPut.mockResolvedValueOnce({});
        await banGuild('s3', true, null, 'abuse', null);

        _mockGet.mockResolvedValueOnce({ Item: { serverId: 's3' } });
        expect(await checkServerBan('s3')).toMatchObject({ banned: true });
    });
});
