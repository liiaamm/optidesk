const { TextDisplayBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require('discord.js')
const finalCloseTicket = require('./finalCloseTicket');
const {loadEmojis} = require("../../utils/emojiLoader");
const {getGuildConfig} = require("../../utils/guildConfig");
const { checkStaffAccess, sanitizeReason } = require('../../utils/security');
const { getTicketByChannel } = require('../../utils/db');
const { safeReply } = require('../../utils/interactionHelper');
const { enforcePostModalSubmit } = require('../../utils/postModalEnforcement');

module.exports = async function forceCloseQueryTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    const emojis = await loadEmojis(interaction.guild.id);
    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.error('[forceCloseQueryTicket] Failed to fetch ticket record:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please try again in a moment.`);
    }
    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket.`);
    }
    if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;

    const modal = new ModalBuilder().setCustomId('forceCloseModal').setTitle('Force-Close this Request');
    // Create the text input components
    
	const text = new TextDisplayBuilder().setContent(
		`# ⚠️ WAIT!\nYou're about to force-close this ticket - closing immediately without the creators approval. In some servers, you might need permission from a supervisor to do this.`,
	);

    const reasonInput = new TextInputBuilder()
        .setCustomId('reasonInput')
        .setPlaceholder("Add a reason...")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(200);
    
    const reasonLabel = new LabelBuilder()
        .setLabel("Why are you closing this request?")
        .setTextInputComponent(reasonInput);

    modal.addTextDisplayComponents(text)
    await modal.addLabelComponents(reasonLabel);
    try {
        await interaction.showModal(modal);
    } catch {
        // Kill it globally
        return;
    }

    const submitted = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'forceCloseModal',
        time: 120000
    }).catch(() => null);
    if (!submitted) return;
    if (!await enforcePostModalSubmit(submitted, 'forceCloseQueryTicket_modal')) return;

    const reason = sanitizeReason(submitted.fields.getTextInputValue('reasonInput'), 200);
    await finalCloseTicket(submitted, reason, submitted.user.tag, true)
}