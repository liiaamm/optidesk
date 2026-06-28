const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TABLE_CONFIGS } = require('../../utils/constants');
const {
    readStarterGuildConfig,
    syncSingleTenantGuildConfig,
} = require('../../utils/localGuildConfigSeed');

let tempDirs = [];

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optidesk-guild-config-'));
    tempDirs.push(dir);
    return dir;
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

function mockDocClient() {
    return {
        put: jest.fn(() => ({ promise: () => Promise.resolve({}) })),
    };
}

afterEach(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
});

test('readStarterGuildConfig prefers operator config over example config', () => {
    const dir = makeTempDir();
    const operatorPath = path.join(dir, 'guild-config.json');
    const examplePath = path.join(dir, 'guild-config.example.json');
    writeJson(operatorPath, { serverId: 'operator', layout: { categories: {} } });
    writeJson(examplePath, { serverId: 'example', layout: { categories: {} } });

    const result = readStarterGuildConfig([operatorPath, examplePath]);

    expect(result.starter.serverId).toBe('operator');
    expect(result.source).toBe(operatorPath);
    expect(result.sourceName).toBe('guild-config.json');
});

test('syncSingleTenantGuildConfig upserts config from file on every startup', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'guild-config.json');
    writeJson(configPath, {
        serverId: 'placeholder',
        access: { supervisorRoleID: 'role_supervisor' },
        layout: { categories: {} },
    });
    const docClient = mockDocClient();

    const result = await syncSingleTenantGuildConfig(
        docClient,
        { guildId: 'guild_123', singleTenant: true },
        { configPaths: [configPath] },
    );

    expect(docClient.put).toHaveBeenCalledWith({
        TableName: TABLE_CONFIGS,
        Item: {
            serverId: 'guild_123',
            access: { supervisorRoleID: 'role_supervisor' },
            layout: { categories: {} },
        },
    });
    expect(result).toEqual(expect.objectContaining({
        status: 'synced',
        guildId: 'guild_123',
        sourceName: 'guild-config.json',
    }));
});

test('syncSingleTenantGuildConfig skips multi-tenant config', async () => {
    const docClient = mockDocClient();

    const result = await syncSingleTenantGuildConfig(
        docClient,
        { guildId: 'guild_123', singleTenant: false },
        { configPaths: ['/does/not/matter.json'] },
    );

    expect(docClient.put).not.toHaveBeenCalled();
    expect(result).toEqual({
        status: 'skipped',
        reason: 'not-single-tenant',
        guildId: 'guild_123',
    });
});
