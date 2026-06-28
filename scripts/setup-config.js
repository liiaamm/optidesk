const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function askQuestion(query, options = {}) {
    const { defaultValue, required = false, type = 'string' } = options;
    let suffix = '';
    if (defaultValue !== undefined) {
        suffix = ` [Default: ${defaultValue}]`;
    } else if (required) {
        suffix = ' (Required)';
    }
    
    let asking = true;
    while (asking) {
        let answer = (await ask(`${query}${suffix}: `)).trim();
        if (answer === '') {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            if (required) {
                console.log('❌ Error: This field is required.');
                continue;
            }
            return null;
        }
        
        if (type === 'boolean') {
            if (/^(y|yes|true|1)$/i.test(answer)) return true;
            if (/^(n|no|false|0)$/i.test(answer)) return false;
            console.log('❌ Error: Please enter y/n (yes/no).');
            continue;
        }
        
        if (type === 'number') {
            const num = Number(answer);
            if (isNaN(num)) {
                console.log('❌ Error: Please enter a valid number.');
                continue;
            }
            return num;
        }
        
        return answer;
    }
}

async function main() {
    console.log('\n=========================================');
    console.log('      OptiDesk Configuration Setup       ');
    console.log('=========================================\n');
    console.log('This script will guide you through setting up all required configuration files.\n');

    // --- CONFIG.JSON ---
    console.log('--- Phase 1: General Bot Configuration (config.json) ---\n');

    const token = await askQuestion('Discord Bot Token', { required: true });
    const clientId = await askQuestion('Discord Application Client (Application) ID', { required: true });
    const guildId = await askQuestion('Discord Server (Guild) ID', { required: true });
    const singleTenant = await askQuestion('Run in Single Tenant mode? (Only accepts commands from this guild)', { type: 'boolean', defaultValue: true });
    const licensingEnabled = await askQuestion('Enable licensing checks?', { type: 'boolean', defaultValue: false });
    const hostedEnforcementEnabled = await askQuestion('Enable hosted enforcement (global ban-lists)?', { type: 'boolean', defaultValue: false });
    const rateLimitEnabled = await askQuestion('Enable user rate limiting?', { type: 'boolean', defaultValue: true });

    console.log('\n--- Database Configuration ---');
    console.log('OptiDesk supports multiple database engines:');
    console.log('  1. sqlite   - (Recommended) Zero-config local database, extremely fast and reliable.');
    console.log('  2. postgres - Global/Production distributed PostgreSQL database.');
    console.log('  3. local    - DynamoDB local deployment.');
    console.log('  4. aws      - DynamoDB AWS deployment.');
    const dbTypeInput = await askQuestion('Database Engine (sqlite/postgres/local/aws)', { defaultValue: 'sqlite' });
    
    let dbType = 'sqlite';
    let sqlitePath = undefined;
    let postgresUrl = undefined;
    let persistPath = undefined;
    let dbRegion = undefined;
    let awsCredentials = null;

    const inputLower = dbTypeInput.toLowerCase();
    if (inputLower === 'postgres' || inputLower === 'postgresql') {
        dbType = 'postgresql';
        postgresUrl = await askQuestion('PostgreSQL Connection URL (e.g. postgresql://user:pass@localhost:5432/optidesk)', { required: true });
        
        console.log('Testing PostgreSQL connection...');
        try {
            const { Pool } = require('pg');
            const pool = new Pool({ connectionString: postgresUrl });
            await pool.query('SELECT 1');
            await pool.end();
            console.log('✅ PostgreSQL connection successful.');
        } catch (err) {
            console.log('⚠️ Warning: Failed to connect to PostgreSQL. Please verify your credentials later.', err.message);
        }
    } else if (inputLower === 'aws') {
        dbType = 'dynamodb-aws';
        dbRegion = await askQuestion('AWS Region for DynamoDB', { defaultValue: 'ap-southeast-4' });
        const configureAwsCreds = await askQuestion('Would you like to configure AWS Credentials in the script setup?', { type: 'boolean', defaultValue: false });
        if (configureAwsCreds) {
            const accessKeyId = await askQuestion('AWS Access Key ID', { required: true });
            const secretAccessKey = await askQuestion('AWS Secret Access Key', { required: true });
            awsCredentials = { accessKeyId, secretAccessKey };
        }
    } else if (inputLower === 'local' || inputLower === 'dynamodb-local') {
        dbType = 'dynamodb-local';
        persistPath = await askQuestion('DynamoDB Local persistence directory path', { defaultValue: './data/dynamo' });
    } else {
        dbType = 'sqlite';
        sqlitePath = await askQuestion('SQLite Database file path', { defaultValue: './data/optidesk.db' });
    }

    const storageTypeInput = await askQuestion('Transcript storage type (disabled/s3)', { defaultValue: 'disabled' });
    const storageType = storageTypeInput.toLowerCase() === 's3' ? 's3' : 'disabled';
    let storageBucket = undefined;
    let storageRegion = undefined;

    if (storageType === 's3') {
        storageBucket = await askQuestion('AWS S3 Bucket name', { defaultValue: 'optidesktranscripts' });
        storageRegion = await askQuestion('AWS S3 Region', { defaultValue: 'ap-southeast-4' });
    }

    const posthogEnabled = await askQuestion('Enable PostHog analytics?', { type: 'boolean', defaultValue: false });
    let posthogKey = null;
    if (posthogEnabled) {
        posthogKey = await askQuestion('PostHog API Key', { required: true });
    }

    const instatusHeartbeatUrl = await askQuestion('Instatus Heartbeat URL (leave blank to disable)', { defaultValue: '' }) || null;

    const configData = {
        token,
        clientId,
        guildId,
        singleTenant,
        licensingEnabled,
        hostedEnforcementEnabled,
        rateLimitEnabled,
        database: {
            type: dbType,
            ...(sqlitePath ? { sqlitePath } : {}),
            ...(postgresUrl ? { postgresUrl } : {}),
            ...(persistPath ? { persistPath } : {}),
            ...(dbRegion ? { region: dbRegion } : {})
        },
        storage: {
            type: storageType,
            ...(storageBucket ? { bucket: storageBucket } : {}),
            ...(storageRegion ? { region: storageRegion } : {})
        },
        posthogEnabled,
        posthogKey,
        instatusHeartbeatUrl
    };

    const configPath = path.join(__dirname, '..', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
    console.log(`\n✅ Saved general bot configuration to ${configPath}\n`);

    // --- GUILD-CONFIG.JSON ---
    console.log('--- Phase 2: Guild-Level Ticketing Setup (guild-config.json) ---\n');

    // Read the example to use as template base
    const guildConfigExamplePath = path.join(__dirname, '..', 'data', 'guild-config.example.json');
    let guildConfig;
    try {
        const rawExample = fs.readFileSync(guildConfigExamplePath, 'utf8');
        guildConfig = JSON.parse(rawExample);
    } catch (err) {
        console.error('❌ Warning: Could not read guild-config.example.json. Creating config from scratch.');
        guildConfig = {};
    }

    guildConfig.serverId = guildId;

    // We now rely on the /config Discord command for all guild-level settings.
    // We just write the template to disk so the bot can boot and accept /config commands.
    const guildConfigPath = path.join(__dirname, '..', 'data', 'guild-config.json');
    fs.writeFileSync(guildConfigPath, JSON.stringify(guildConfig, null, 2));
    console.log(`\n✅ Saved default guild configuration template to ${guildConfigPath}\n`);

    // --- PM2 ECOSYSTEM.CONFIG.JS ---
    console.log('--- Phase 3: Generating PM2 Ecosystem File ---\n');
    
    const ecosystemData = {
        apps: [{
            name: 'optidesk',
            script: 'index.js',
            env: {
                NODE_ENV: 'production'
            }
        }]
    };

    if (awsCredentials) {
        ecosystemData.apps[0].env.AWS_ACCESS_KEY_ID = awsCredentials.accessKeyId;
        ecosystemData.apps[0].env.AWS_SECRET_ACCESS_KEY = awsCredentials.secretAccessKey;
        if (dbRegion) {
            ecosystemData.apps[0].env.AWS_REGION = dbRegion;
        }
    }

    const ecosystemPath = path.join(__dirname, '..', 'ecosystem.config.js');
    fs.writeFileSync(ecosystemPath, `module.exports = ${JSON.stringify(ecosystemData, null, 4)};\n`);
    console.log(`✅ Generated PM2 ecosystem file at ${ecosystemPath}\n`);

    console.log('=========================================');
    console.log('    Configuration Setup Complete!        ');
    console.log('=========================================\n');
    rl.close();
}

main().catch(err => {
    console.error('❌ An unexpected error occurred:', err);
    rl.close();
    process.exit(1);
});
