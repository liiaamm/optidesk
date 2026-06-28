const _mockGet = jest.fn();
const _mockQuery = jest.fn();
const _mockPut = jest.fn();

const _mockInstance = {
    get: jest.fn(() => ({ promise: _mockGet })),
    query: jest.fn(() => ({ promise: _mockQuery })),
    put: jest.fn(() => ({ promise: _mockPut })),
};

module.exports = {
    config: { update: jest.fn() },
    DynamoDB: {
        DocumentClient: jest.fn(() => _mockInstance),
    },
    S3: jest.fn(() => ({})),
    _mockInstance,
    _mockGet,
    _mockQuery,
    _mockPut,
};
