// Verifies db.js builds its DynamoDB/S3 clients from the resolved config profile.

const localCfg = {
    database: { type: 'dynamodb-local', endpoint: 'http://localhost:8000', region: 'ap-southeast-4' },
    storage:  { type: 'disabled', bucket: 'optidesktranscripts', region: 'ap-southeast-4' },
    posthogKey: null,
};
const cloudCfg = {
    database: { type: 'dynamodb-aws', region: 'ap-southeast-4' },
    storage:  { type: 's3', bucket: 'optidesktranscripts', region: 'ap-southeast-4' },
    posthogKey: null,
};

function loadDbWith(cfg) {
    let mod, AWS;
    jest.isolateModules(() => {
        jest.doMock('aws-sdk');
        jest.doMock('../../utils/config', () => ({ getConfig: () => cfg }));
        AWS = require('aws-sdk');
        mod = require('../../utils/db');
    });
    return { mod, AWS };
}

describe('db client construction', () => {
    test('local profile → localhost endpoint + stub credentials', () => {
        const { mod, AWS } = loadDbWith(localCfg);
        void mod.dynamo.query; // accessing a prop triggers lazy construction
        const opts = AWS.DynamoDB.DocumentClient.mock.calls.pop()[0];
        expect(opts.endpoint).toBe('http://localhost:8000');
        expect(opts.accessKeyId).toBe('local');
        expect(opts.secretAccessKey).toBe('local');
    });

    test('cloud profile → no endpoint, no stub credentials, real region', () => {
        const { mod, AWS } = loadDbWith(cloudCfg);
        void mod.dynamo.query;
        const opts = AWS.DynamoDB.DocumentClient.mock.calls.pop()[0];
        expect(opts.endpoint).toBeUndefined();
        expect(opts.accessKeyId).toBeUndefined();
        expect(opts.region).toBe('ap-southeast-4');
    });

    test('storageEnabled / transcriptBucket reflect config', () => {
        const cloud = loadDbWith(cloudCfg);
        expect(cloud.mod.storageEnabled()).toBe(true);
        expect(cloud.mod.transcriptBucket()).toBe('optidesktranscripts');

        const local = loadDbWith(localCfg);
        expect(local.mod.storageEnabled()).toBe(false);
    });
});
