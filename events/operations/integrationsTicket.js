const { MessageFlags } = require('discord.js');
const { loadEmojis } = require('../../utils/emojiLoader');
const {getGuildConfig} = require("../../utils/guildConfig");
const { getTicketByChannel } = require('../../utils/db');
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess, sanitizeReason} = require('../../utils/security');
const {logEvent} = require("../../utils/logging");

module.exports = async function integrationsTicket(interaction) {
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.error('[integrationsTicket] Failed to fetch ticket record:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please try again in a few minutes.`);
    }
    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    // Access Control
    if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;
    await interaction.reply({content: `${emojis.cancel.markdown} Unfortunately, API Integrations aren't available 'on request' at the moment. You can still use them for other purposes, but in-ticket functionality is coming soon.`, flags: MessageFlags.Ephemeral})
    await logEvent("integrations", "notice", `**${sanitizeReason(interaction.user.tag)}** tried to use an integration, but it wasn't available.`, interaction)
}