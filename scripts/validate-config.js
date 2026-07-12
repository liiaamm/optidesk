const fs = require('fs');
const path = require('path');

// Support helper: validate a self-host config file without booting the bot.
//
//   npm run validate                 -> bot config.json (repo root)
//   npm run validate -- their.json   -> bot config at a given path
//   npm run validate:guild           -> data/guild-config.json against the schema
//   npm run validate:guild -- g.json -> a given guild config against the schema
//
// Exits 0 when valid, 1 when not, so it also works in CI / one-off checks.

function fail(message) {
    console.log(`❌ ${message}`);
    process.exit(1);
}

function readJson(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        fail(`Cannot read ${file}: ${err.message}`);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        fail(`${file} is not valid JSON: ${err.message}`);
    }
}

// Guild config: compile the shipped schema and validate. Same check as
// tests/guildConfigSchema.test.js, so results match CI.
function validateGuild(file) {
    const target = file || path.join('data', 'guild-config.json');
    const Ajv = require('ajv');
    const schema = readJson(path.join(__dirname, '..', 'data', 'guild-config.schema.json'));
    const config = readJson(target);
    const validate = new Ajv({ allErrors: true, jsonPointers: true }).compile(schema);
    if (validate(config)) {
        console.log(`✅ ${target} is a valid guild config`);
        return;
    }
    console.log(`❌ ${target} is not a valid guild config:`);
    console.log(JSON.stringify(validate.errors, null, 2));
    process.exit(1);
}

// Bot config: normalize with the real loader (fills profile defaults), then
// mirror the required + placeholder checks from utils/config.js
// validateLoadedConfig (self-host / source === 'config' path).
function validateBot(file) {
    const target = file || 'config.json';
    const { normalizeConfig } = require('../utils/config');
    const raw = readJson(path.resolve(target));
    const config = normalizeConfig(raw, 'selfhost');

    const placeholders = {
        token: 'YOUR_DISCORD_BOT_TOKEN',
        clientId: 'YOUR_DISCORD_APPLICATION_CLIENT_ID',
        guildId: 'YOUR_DISCORD_SERVER_ID',
    };

    const missing = ['token', 'clientId', 'guildId'].filter(key => !config[key]);
    const unchanged = Object.keys(placeholders).filter(key => config[key] === placeholders[key]);

    if (missing.length) {
        console.log(`❌ ${target} missing required value(s): ${missing.join(', ')}`);
    }
    if (unchanged.length) {
        console.log(`❌ ${target} still has placeholder value(s): ${unchanged.join(', ')}`);
    }
    if (missing.length || unchanged.length) {
        process.exit(1);
    }
    console.log(`✅ ${target} is a valid self-host config`);
}

const args = process.argv.slice(2);
const guild = args.includes('--guild');
const file = args.find(arg => !arg.startsWith('--'));

if (guild) {
    validateGuild(file);
} else {
    validateBot(file);
}
