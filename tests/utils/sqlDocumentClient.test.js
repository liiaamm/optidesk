const SqlDocumentClient = require('../../utils/sqlDocumentClient');
const { TABLE_CONFIGS } = require('../../utils/constants');

describe('SqlDocumentClient (SQLite in-memory)', () => {
    let client;

    beforeEach(async () => {
        client = new SqlDocumentClient({ type: 'sqlite', sqlitePath: ':memory:' });
        await client.init();
    });

    it('translates put and get parameters correctly', async () => {
        // TABLE_CONFIGS is keyed by serverId in the real DynamoDB KeySchema.
        await client.put({
            TableName: TABLE_CONFIGS,
            Item: { serverId: '123', name: 'test' }
        }).promise();

        const result = await client.get({
            TableName: TABLE_CONFIGS,
            Key: { serverId: '123' }
        }).promise();

        expect(result.Item).toEqual({ serverId: '123', name: 'test' });
    });

    it('translates update parameters with SET expression correctly', async () => {
        await client.put({
            TableName: TABLE_CONFIGS,
            Item: { serverId: '123', name: 'test', access: { } }
        }).promise();

        const result = await client.update({
            TableName: TABLE_CONFIGS,
            Key: { serverId: '123' },
            UpdateExpression: 'SET access.adminRoleID = :r',
            ExpressionAttributeValues: { ':r': '456' }
        }).promise();

        expect(result.Attributes).toEqual({ serverId: '123', name: 'test', access: { adminRoleID: '456' } });
    });

    it('translates update parameters with if_not_exists increment correctly', async () => {
        await client.put({
            TableName: TABLE_CONFIGS,
            Item: { serverId: '123', metrics: { } }
        }).promise();

        const result = await client.update({
            TableName: TABLE_CONFIGS,
            Key: { serverId: '123' },
            UpdateExpression: 'SET metrics.counter = if_not_exists(metrics.counter, :zero) + :inc',
            ExpressionAttributeValues: { ':zero': 0, ':inc': 1 }
        }).promise();

        expect(result.Attributes).toEqual({ serverId: '123', metrics: { counter: 1 } });
    });

    it('translates update parameters with REMOVE expression correctly', async () => {
        await client.put({
            TableName: TABLE_CONFIGS,
            Item: { serverId: '123', name: 'test', deleteMe: true }
        }).promise();

        const result = await client.update({
            TableName: TABLE_CONFIGS,
            Key: { serverId: '123' },
            UpdateExpression: 'REMOVE deleteMe'
        }).promise();

        expect(result.Attributes).toEqual({ serverId: '123', name: 'test' });
    });
});
