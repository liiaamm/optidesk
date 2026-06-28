const { MessageFlags, TextDisplayBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require('discord.js')
const requestCloseTicket = require('./requestCloseTicket');
const { checkStaffAccess, sanitizeReason } = require('../../utils/security');
const { getGuildConfig } = require('../../utils/guildConfig');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getTicketByChannel } = require('../../utils/db');
const { safeReply } = require('../../utils/interactionHelper');
const { enforcePostModalSubmit } = require('../../utils/postModalEnforcement');

module.exports = async function requestCloseQueryTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    const emojis = await loadEmojis(interaction.guild.id);
    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch {
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please try again in a moment.`);
    }
    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket.`);
    }
    if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;

    const modal = new ModalBuilder().setCustomId('requestCloseModal').setTitle('Close this Request');
    
	const text = new TextDisplayBuilder().setContent(
		`When you submit this form, we'll prompt to close the request with the reason you have provided.`,
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
        // Rely on handler to throw an error
        return;
    }

    const submitted = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'requestCloseModal',
        time: 120000
    }).catch(() => null);
    if (!submitted) return;
    if (!await enforcePostModalSubmit(submitted, 'requestCloseQueryTicket_modal')) return;

    await submitted.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = sanitizeReason(submitted.fields.getTextInputValue('reasonInput'), 200);
    await requestCloseTicket(submitted, reason)
}