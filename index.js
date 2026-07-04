// OptiDesk, 2026 (AGPL-3.0)
// Ticketing that works, and a whole lot more
// Developed with love from Australia

process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, ActivityType, Events } = require('discord.js');
const { loadConfig, getConfig, IS_DEV, IS_CLOUD, DEV_SOURCE_FLAG } = require('./utils/config');
const { clearGuildCache } = require('./utils/guildConfig');
const { showBanner } = require('./utils/banner');

async function main() {
	let configPromise = null;

	const steps = [];

	if (IS_DEV) {
		steps.push({
			kind:    'pick',
			label:   'Config source',
			prompt:  'Choose where dev credentials come from',
			choices: [
				{ label: 'Local config.json',  value: 'config' },
				{ label: 'SSM /optidesk/dev/', value: 'ssm'    },
			],
			preset:  DEV_SOURCE_FLAG,
			onPick:  (value) => { configPromise = loadConfig({ devSource: value }); },
		});
		steps.push(['Fetching configuration', () => configPromise]);
	} else {
		steps.push(['Fetching configuration', () => (configPromise = loadConfig())]);
	}

	if (!IS_CLOUD) {
		steps.push(['Starting local database', async () => {
			const cfg = await configPromise;
			if (cfg.database.type === 'dynamodb-local') {
				const { startLocalDynamo } = require('./utils/localDynamo');
				await startLocalDynamo(cfg);
			} else if (cfg.database.type === 'sqlite' || cfg.database.type === 'postgresql') {
				const { dynamo } = require('./utils/db');
				const { syncSingleTenantGuildConfig } = require('./utils/localGuildConfigSeed');
				const result = await syncSingleTenantGuildConfig(dynamo, cfg);
				if (result.status === 'synced') {
					console.log(`\n[database] synced starter guild config for ${result.guildId} from ${result.sourceName}.`);
				}
			}
		}]);
	}

	steps.push(['Initializing client',          0]);
	steps.push(['Loading commands',             0]);
	steps.push(['Registering event listeners',  0]);
	steps.push(['Authenticating with Discord',  0]);

	const profileTag = IS_DEV ? ' [DEV]' : IS_CLOUD ? '' : ' [LOCAL]';
	await showBanner(`v0.5${profileTag}`, steps);

	const { token, instatusHeartbeatUrl } = getConfig();

	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages],
		allowedMentions: { parse: ['users', 'roles'] },
	});

	client.commands = new Collection();
	const foldersPath = path.join(__dirname, 'commands');
	const commandFolders = fs.readdirSync(foldersPath).filter(folder => {
		const fullPath = path.join(foldersPath, folder);
		return fs.statSync(fullPath).isDirectory();
	});

	for (const folder of commandFolders) {
		const commandsPath = path.join(foldersPath, folder);
		const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				client.commands.set(command.data.name, command);
			} else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}
	}

	const eventsPath = path.join(__dirname, 'events');
	const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

	for (const file of eventFiles) {
		const filePath = path.join(eventsPath, file);
		const event = require(filePath);
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		} else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}

	client.once(Events.ClientReady, (readyClient) => {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		client.user.setPresence({
		activities: [{
			name: '✨ | optidesk.dev',
			// name: `🦖 | it's national dinosaur day!`,
			// name: '🐈 | meow!!!',
			type: ActivityType.Competing,
			}]
		},
		);
	});

	if (instatusHeartbeatUrl) {
		const HEARTBEAT_INTERVAL_MS = 60_000;
		setInterval(async () => {
			if (!client.isReady()) return;
			try {
				await fetch(instatusHeartbeatUrl);
			} catch (err) {
				console.warn('heartbeat failed:', err.message);
			}
		}, HEARTBEAT_INTERVAL_MS).unref();
	}

	client.login(token);
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exitCode = 1;
});
