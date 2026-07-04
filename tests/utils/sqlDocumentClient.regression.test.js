// Regression tests for the two CRITICAL gaps found auditing the
// PostgreSQL/SQLite DocumentClient shim:
//   1. ConditionExpression was ignored -> atomic guards (e.g. ticket claiming)
//      silently no-op'd, so two writers could both "win".
//   2. PK_MAP disagreed with the real DynamoDB KeySchema, so put() only landed
//      under the right id by accident of object key order.
//
// Against the UNPATCHED shim these fail. They pass once the fix is applied.

const SqlDocumentClient = require('../../utils/sqlDocumentClient');
const {
    TABLE_TICKETS, TABLE_CONFIGS, TABLE_LICENSING,
    TABLE_ENFORCEMENT, TABLE_ENFORCEMENT_GUILDS,
    TABLE_PERFORMANCE, TABLE_TRANSCRIPTS,
} = require('../../utils/constants');

describe('SqlDocumentClient — ConditionExpression (atomic guards)', () => {
    let client;
    beforeEach(async () => {
        client = new SqlDocumentClient({ type: 'sqlite', sqlitePath: ':memory:' });
        await client.init();
    });

    it('throws ConditionalCheckFailedException when the condition is false (double-claim race)', async () => {
        // Alice already claimed the ticket.
        await client.put({
            TableName: TABLE_TICKETS,
            Item: { channelId: 'c1', claimed: true, claimedBy: 'alice' },
        }).promise();

        // Bob tries to claim with the same guard claimTicket.js uses.
        await expect(client.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: 'c1' },
            ConditionExpression: 'claimed = :mustBeFalse',
            UpdateExpression: 'SET claimed = :c, claimedBy = :cb',
            ExpressionAttributeValues: { ':mustBeFalse': false, ':c': true, ':cb': 'bob' },
        }).promise()).rejects.toMatchObject({ code: 'ConditionalCheckFailedException' });

        // The row must be untouched — still Alice's.
        const after = await client.get({ TableName: TABLE_TICKETS, Key: { channelId: 'c1' } }).promise();
        expect(after.Item.claimedBy).toBe('alice');
    });

    it('applies the update when the condition is true (no over-blocking)', async () => {
        await client.put({
            TableName: TABLE_TICKETS,
            Item: { channelId: 'c2', claimed: false },
        }).promise();

        await client.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: 'c2' },
            ConditionExpression: 'claimed = :mustBeFalse',
            UpdateExpression: 'SET claimed = :c, claimedBy = :cb',
            ExpressionAttributeValues: { ':mustBeFalse': false, ':c': true, ':cb': 'alice' },
        }).promise();

        const after = await client.get({ TableName: TABLE_TICKETS, Key: { channelId: 'c2' } }).promise();
        expect(after.Item).toMatchObject({ claimed: true, claimedBy: 'alice' });
    });

    it('honours attribute_not_exists for idempotency (requestCloseTicket)', async () => {
        await client.put({
            TableName: TABLE_TICKETS,
            Item: { channelId: 'c3', closeReason: 'first' },
        }).promise();

        await expect(client.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: 'c3' },
            ConditionExpression: 'attribute_not_exists(closeReason)',
            UpdateExpression: 'SET closeReason = :r',
            ExpressionAttributeValues: { ':r': 'second' },
        }).promise()).rejects.toMatchObject({ code: 'ConditionalCheckFailedException' });

        const after = await client.get({ TableName: TABLE_TICKETS, Key: { channelId: 'c3' } }).promise();
        expect(after.Item.closeReason).toBe('first');
    });

    it('evaluates AND/OR/parentheses (finalCloseTicket guard)', async () => {
        const COND = 'attribute_exists(channelId) AND (attribute_not_exists(closing) OR closing = :false)';
        await client.put({ TableName: TABLE_TICKETS, Item: { channelId: 'c4' } }).promise();

        // closing not set yet -> guard passes.
        await client.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: 'c4' },
            ConditionExpression: COND,
            UpdateExpression: 'SET closing = :true',
            ExpressionAttributeValues: { ':false': false, ':true': true },
        }).promise();

        // closing already true -> guard now fails.
        await expect(client.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: 'c4' },
            ConditionExpression: COND,
            UpdateExpression: 'SET closing = :true',
            ExpressionAttributeValues: { ':false': false, ':true': true },
        }).promise()).rejects.toMatchObject({ code: 'ConditionalCheckFailedException' });
    });
});

describe('SqlDocumentClient — primary keys match the real DynamoDB KeySchema', () => {
    let client;
    beforeEach(async () => {
        client = new SqlDocumentClient({ type: 'sqlite', sqlitePath: ':memory:' });
        await client.init();
    });

    // A decoy string field BEFORE the real PK. The old "first string/number"
    // fallback would store under the decoy; reads by the real key then miss.
    const cases = [
        [TABLE_CONFIGS, { name: 'My Guild', serverId: '123' }, { serverId: '123' }],
        [TABLE_ENFORCEMENT, { type: 'normal', userId: 'u1' }, { userId: 'u1' }],
        [TABLE_ENFORCEMENT_GUILDS, { reason: 'spam', serverId: 's1' }, { serverId: 's1' }],
        [TABLE_TRANSCRIPTS, { guildId: 'g1', channelId: 'ch1' }, { channelId: 'ch1' }],
        [TABLE_PERFORMANCE, { command: 'help', id: 't1' }, { id: 't1' }],
        [TABLE_TICKETS, { claimedBy: 'a', channelId: 'tc1' }, { channelId: 'tc1' }],
        [TABLE_LICENSING, { serverId: 's9', licenseId: 'L1' }, { licenseId: 'L1' }],
    ];

    it.each(cases)('round-trips %s by its real key regardless of field order', async (table, item, key) => {
        await client.put({ TableName: table, Item: item }).promise();
        const res = await client.get({ TableName: table, Key: key }).promise();
        expect(res.Item).toEqual(item);
    });

    it('throws (does not silently guess) when the real primary key is missing', async () => {
        await expect(client.put({
            TableName: TABLE_CONFIGS,
            Item: { name: 'no key here' },
        }).promise()).rejects.toThrow(/primary key|serverId/i);
    });
});
