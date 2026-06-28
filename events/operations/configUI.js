const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildConfig, clearGuildCache } = require('../../utils/guildConfig');
const { dynamo } = require('../../utils/db');
const { TABLE_CONFIGS, COLOR_CX, COLOR_ERROR } = require('../../utils/constants');

// Check permissions again to prevent unauthorized use
async function verifyAccess(interaction, guildConfig) {
    const isOwner = interaction.user.id === interaction.guild.ownerId;
    const adminRoleId = guildConfig.access?.adminRoleID;
    const hasAdminRole = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
    return isOwner || hasAdminRole;
}

// Re-usable navigation row
function getNavRow(currentCategory) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('configMenuSelect')
            .setPlaceholder('Switch category...')
            .addOptions(
                { label: 'Access Control', value: 'access', emoji: '🔒', default: currentCategory === 'access' },
                { label: 'General Settings', value: 'settings', emoji: '⚙️', default: currentCategory === 'settings' },
                { label: 'Layout & Channels', value: 'layout', emoji: '📁', default: currentCategory === 'layout' }
            )
    );
}

// Generate the UI based on the selected category
async function generateUI(interaction, category, guildConfig) {
    const container = new ContainerBuilder().setAccentColor(COLOR_CX);
    const navRow = getNavRow(category);
    
    if (category === 'access') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent("### Access Control\nConfigure which roles have access to manage tickets, edit configs, or are blacklisted."));
        
        const supervisorRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('configEditRole_supervisorRoleID').setPlaceholder(`Supervisor Role (Current: ${guildConfig.access.supervisorRoleID ? 'Set' : 'None'})`)
        );
        const adminRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('configEditRole_adminRoleID').setPlaceholder(`Admin Role (Current: ${guildConfig.access.adminRoleID ? 'Set' : 'None'})`)
        );
        const blacklistRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('configEditRole_blacklistRoleID').setPlaceholder(`Blacklist Role (Current: ${guildConfig.access.blacklistRoleID ? 'Set' : 'None'})`)
        );
        
        container.addActionRowComponents(navRow, supervisorRow, adminRow, blacklistRow);
        
    } else if (category === 'settings') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent("### General Settings\nToggle bot features on and off."));
        
        const togglesRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('configToggleParam_transcriptsEnabled').setLabel(`Transcripts: ${guildConfig.settings.transcriptsEnabled ? 'ON' : 'OFF'}`).setStyle(guildConfig.settings.transcriptsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('configToggleParam_loggingEnabled').setLabel(`Logging: ${guildConfig.settings.loggingEnabled ? 'ON' : 'OFF'}`).setStyle(guildConfig.settings.loggingEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('configToggleParam_interactiveSupportEnabled').setLabel(`Interactive UI: ${guildConfig.settings.interactiveSupportEnabled ? 'ON' : 'OFF'}`).setStyle(guildConfig.settings.interactiveSupportEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
        
        container.addActionRowComponents(navRow, togglesRow);

    } else if (category === 'layout') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent("### Layout & Channels\nConfigure where the bot logs actions and saves transcripts."));
        
        const transcriptRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('configEditChannel_transcriptChannelId').setPlaceholder(`Transcript Channel (Current: ${guildConfig.layout.transcriptChannelId ? 'Set' : 'None'})`)
        );
        const loggingRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('configEditChannel_loggingChannelId').setPlaceholder(`Logging Channel (Current: ${guildConfig.layout.loggingChannelId ? 'Set' : 'None'})`)
        );
        
        container.addActionRowComponents(navRow, transcriptRow, loggingRow);
    }
    
    await interaction.update({ components: [container] });
}

// Exported handlers
module.exports = {
    configMenuSelect: async (interaction) => {
        const guildConfig = await getGuildConfig(interaction.guildId);
        if (!await verifyAccess(interaction, guildConfig)) return;
        const category = interaction.values[0];
        await generateUI(interaction, category, guildConfig);
    },

    configEditRole: async (interaction) => {
        const guildConfig = await getGuildConfig(interaction.guildId);
        if (!await verifyAccess(interaction, guildConfig)) return;
        
        const paramName = interaction.customId.split('_')[1];
        const selectedRoleId = interaction.values[0];
        
        await dynamo.update({
            TableName: TABLE_CONFIGS,
            Key: { serverId: String(interaction.guildId) },
            UpdateExpression: `SET access.${paramName} = :r`,
            ExpressionAttributeValues: { ':r': selectedRoleId }
        }).promise();
        
        clearGuildCache(interaction.guildId);
        guildConfig.access[paramName] = selectedRoleId;
        await generateUI(interaction, 'access', guildConfig);
    },

    configEditChannel: async (interaction) => {
        const guildConfig = await getGuildConfig(interaction.guildId);
        if (!await verifyAccess(interaction, guildConfig)) return;
        
        const paramName = interaction.customId.split('_')[1];
        const selectedChannelId = interaction.values[0];
        
        await dynamo.update({
            TableName: TABLE_CONFIGS,
            Key: { serverId: String(interaction.guildId) },
            UpdateExpression: `SET layout.${paramName} = :c`,
            ExpressionAttributeValues: { ':c': selectedChannelId }
        }).promise();
        
        clearGuildCache(interaction.guildId);
        guildConfig.layout[paramName] = selectedChannelId;
        await generateUI(interaction, 'layout', guildConfig);
    },

    configToggleParam: async (interaction) => {
        const guildConfig = await getGuildConfig(interaction.guildId);
        if (!await verifyAccess(interaction, guildConfig)) return;
        
        const paramName = interaction.customId.split('_')[1];
        const newValue = !guildConfig.settings[paramName];
        
        await dynamo.update({
            TableName: TABLE_CONFIGS,
            Key: { serverId: String(interaction.guildId) },
            UpdateExpression: `SET settings.${paramName} = :v`,
            ExpressionAttributeValues: { ':v': newValue }
        }).promise();
        
        clearGuildCache(interaction.guildId);
        guildConfig.settings[paramName] = newValue;
        await generateUI(interaction, 'settings', guildConfig);
    }
};
