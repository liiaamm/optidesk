// Silence aws-sdk v2 maintenance-mode warning. Must run before any require()
// that pulls in aws-sdk; the message is emitted at module load time.
process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';

const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./utils/config');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

async function pickSource() {
	const argv = process.argv;
	if (argv.includes('--prod') || argv.includes('--cloud')) return 'prod';
	if (argv.includes('--dev'))    return 'dev';
	if (argv.includes('--config')) return 'config';

	// No flag: default to local config.json (self-host) in non-interactive contexts so a
	// self-hoster can just run `node deploy-commands.js`. Production passes --cloud.
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return 'config';
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (q) => new Promise(res => rl.question(q, res));

	console.log('Deploy target:');
	console.log('  1) Prod SSM  (/optidesk/prod/)');
	console.log('  2) Dev SSM   (/optidesk/dev/)');
	console.log('  3) Local config.json (CHOOSE THIS FOR SELFHOSTED)');

	let choice = '';
	while (!['1', '2', '3'].includes(choice)) {
		choice = (await ask('Choose [1/2/3]: ')).trim();
	}
	rl.close();

	return { '1': 'prod', '2': 'dev', '3': 'config' }[choice];
}

const commands = [];
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
			commands.push(command.data.toJSON());
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

(async () => {
	try {
		const source = await pickSource();
		const { clientId, token } = await loadConfig({ source });
		const rest = new REST().setToken(token);

		console.log(`Started refreshing ${commands.length} application (/) commands (source: ${source}).`);

		const data = await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error(error?.message || error);
		process.exitCode = 1;
	}
})();
