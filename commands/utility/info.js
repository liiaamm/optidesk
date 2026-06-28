// Important Information
// This command exists to satisfy the requirements of
// the AGPL license. Modifying this could violate
// the license.

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('info')
		.setDescription('Retrieve information & status'),
	async execute(interaction) {
		await interaction.deferReply({flags: MessageFlags.Ephemeral})
		const self = interaction.guild.members.me
		const selfName = self.displayName


		const container = new ContainerBuilder()
		const text = new TextDisplayBuilder().setContent(`**${selfName}** *powered by OptiDesk*\n\`\`\`
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License version 3, as published by the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

If you modify this software, including running said modified software over a network, you must release your source-code under the same AGPL-3.0 license.

You should have received a copy of the AGPL-3.0 license and a link to the source code, available below.
\`\`\``)

		const licenseB = new ButtonBuilder()
			.setLabel('License (AGPL-3.0)')
			.setStyle(ButtonStyle.Link)
			.setURL('https://www.gnu.org/licenses/agpl-3.0.html#license-text')
		
		const repositoryB = new ButtonBuilder()
			.setLabel('Source Code')
			.setStyle(ButtonStyle.Link)
			.setURL('https://github.com/liiaamm/optidesk') // If you have made changes, under the AGPL you MUST make them open-source & under the AGPL. Add a link to your source code here.

		const row = new ActionRowBuilder()
			.setComponents([licenseB, repositoryB])

		await container.addTextDisplayComponents(text)
		await container.addActionRowComponents(row)

		await interaction.editReply({flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral], components: [container]})
	},
};
