const { getTicketByChannel } = require('../../utils/db');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, ActionRowBuilder } = require('discord.js')
const { loadEmojis } = require('../../utils/emojiLoader');
const {getGuildConfig} = require("../../utils/guildConfig");
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess } = require('../../utils/security');

module.exports = async function closeTicket(interaction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral})
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch {
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    if( record.ticketCreatorId === interaction.user.id ) {
        // Check if ticket is unable to be closed, object here
        // Close ask
        const closeTxt = new TextDisplayBuilder().setContent(`${emojis.logs.markdown} Are you sure you want to close this request?\n-# You can dismiss this message to cancel.`)
        const confirmB = new ButtonBuilder()
            .setCustomId('finalCloseTicket')
            .setLabel(`Yes, Close`)
            .setEmoji(`${emojis.secondarywarning.id}`)
            .setStyle(ButtonStyle.Secondary)

        const row = new ActionRowBuilder()
            .addComponents(confirmB)

        const initMsg = await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [closeTxt,row],
            fetchReply: true
        })
    } else {
        // Close request to the staff/user
        // Access Control
        if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;
        const closeTxt = new TextDisplayBuilder().setContent(`${emojis.logs.markdown} What would you like to do?`)
        const confirmB = new ButtonBuilder()
            .setCustomId('requestCloseQueryTicket')
            .setLabel(`Request to Close`)
            .setEmoji(`${emojis.check.id}`)
            .setStyle(ButtonStyle.Secondary)

        const abortB = new ButtonBuilder()
            .setCustomId('forceCloseQueryTicket')
            .setLabel(`Force Close`)
            .setEmoji(`${emojis.secondarywarning.id}`)
            .setStyle(ButtonStyle.Secondary)

        const row = new ActionRowBuilder()
            .addComponents(confirmB, abortB)

        const initMsg = await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [closeTxt,row],
            fetchReply: true
        })
        return
    }
}