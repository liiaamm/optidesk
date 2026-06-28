const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getGuildConfig } = require('../../utils/guildConfig');
const { COLOR_CX, COLOR_ERROR } = require('../../utils/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Edit OptiDesk configuration (Admins only)'),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const guildConfig = await getGuildConfig(interaction.guildId);
        if (!guildConfig) {
            const container = new ContainerBuilder().setAccentColor(COLOR_ERROR);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Error:** Server configuration not found."));
            return interaction.editReply({ flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral], components: [container] });
        }

        // Permission check
        const isOwner = interaction.user.id === interaction.guild.ownerId;
        const adminRoleId = guildConfig.access?.adminRoleID;
        const hasAdminRole = adminRoleId && interaction.member.roles.cache.has(adminRoleId);

        if (!isOwner && !hasAdminRole) {
            const container = new ContainerBuilder().setAccentColor(COLOR_ERROR);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Access Denied:** You must be the server owner or have the designated Admin role to use this command."));
            return interaction.editReply({ flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral], components: [container] });
        }

        const container = new ContainerBuilder().setAccentColor(COLOR_CX);
        const text = new TextDisplayBuilder().setContent("## OptiDesk Configuration Panel\nSelect a configuration category from the dropdown below to begin editing your server's settings.");
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('configMenuSelect')
            .setPlaceholder('Select a category to edit...')
            .addOptions(
                { label: 'Access Control', description: 'Configure Staff, Admin, and Blacklist roles', value: 'access', emoji: '🔒' },
                { label: 'General Settings', description: 'Configure bot features and toggles', value: 'settings', emoji: '⚙️' },
                { label: 'Layout & Channels', description: 'Configure logging and transcript channels', value: 'layout', emoji: '📁' }
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        container.addTextDisplayComponents(text);
        container.addActionRowComponents(row);

        await interaction.editReply({ flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral], components: [container] });
    },
};
