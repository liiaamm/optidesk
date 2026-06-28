jest.mock('aws-sdk');

const { _mockGet, _mockQuery } = require('aws-sdk');
const { isServerLicensed } = require('../../utils/licensing');

test('returns false when no license found', async () => {
    _mockQuery.mockResolvedValueOnce({ Items: [] });
    expect(await isServerLicensed('s_none')).toBe(false);
});

test('returns true when license exists and is active', async () => {
    _mockQuery.mockResolvedValueOnce({ Items: [{ licenseId: 'LIC-AAAA' }] });
    _mockGet.mockResolvedValueOnce({ Item: { licenseId: 'LIC-AAAA', disabled: false } });
    expect(await isServerLicensed('s_active')).toBe(true);
});

test('returns false when license exists but is disabled', async () => {
    _mockQuery.mockResolvedValueOnce({ Items: [{ licenseId: 'LIC-BBBB' }] });
    _mockGet.mockResolvedValueOnce({ Item: { licenseId: 'LIC-BBBB', disabled: true } });
    expect(await isServerLicensed('s_disabled')).toBe(false);
});
