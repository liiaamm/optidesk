const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, TextDisplayBuilder, LabelBuilder } = require('discord.js');
const { getTicketByChannel } = require('../../utils/db');
const { getGuildConfig } = require('../../utils/guildConfig');
const { loadEmojis } = require('../../utils/emojiLoader');
const { checkStaffAccess, sanitizeReason } = require('../../utils/security');
const { safeReply } = require('../../utils/interactionHelper');
const { enforcePostModalSubmit } = require('../../utils/postModalEnforcement');
const finalCloseTicket = require('../operations/finalCloseTicket');
const {logEvent} = require("../../utils/logging");

module.exports = async function blacklistTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id)
    const emojis = await loadEmojis(interaction.guild.id);

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.warn('[blacklistTicket] Failed to fetch ticket record:', {
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

    const modal = new ModalBuilder().setCustomId('blacklistConfirmModal').setTitle('Blacklist User');

    const warning = new TextDisplayBuilder().setContent(
        `# ⚠️ WAIT!\nYou're about to blacklist this user — they will be force-closed from this ticket and prevented from opening further ones.`
    );

    const reasonInput = new TextInputBuilder()
        .setCustomId('reasonInput')
        .setPlaceholder("Add a reason...")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(200);

    const reasonLabel = new LabelBuilder()
        .setLabel("Why are you blacklisting this user?")
        .setTextInputComponent(reasonInput);

    modal.addTextDisplayComponents(warning);
    await modal.addLabelComponents(reasonLabel);

    try {
        await interaction.showModal(modal);
    } catch (err) {
        console.warn('[blacklistTicket] Failed to show blacklist confirmation modal:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            userId: interaction.user.id,
            message: err?.message,
        });
        return;
    }

    const submitted = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'blacklistConfirmModal',
        time: 120000
    }).catch((err) => {
        console.warn('[blacklistTicket] Blacklist confirmation modal was not submitted:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            userId: interaction.user.id,
            message: err?.message,
        });
        return null;
    });
    if (!submitted) return
    if (!await enforcePostModalSubmit(submitted, 'blacklistTicket_modal')) return;

    await submitted.deferReply({ flags: MessageFlags.Ephemeral });

    if (!config.access.blacklistRoleID) {
        return await submitted.editReply({
            content: `${emojis.cancel.markdown} Blacklisting isn't enabled on this server.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const role = submitted.guild.roles.cache.get(config.access.blacklistRoleID);
    if (!role) {
        return await safeReply(submitted, `**An error occurred**\nThe blacklist role isn't configured. Please contact an administrator.\n-# Only the Guild Owner and authorised persons can configure OptiDesk.`);
    }

    if (record.ticketCreatorId === submitted.user.id) {
        return await submitted.editReply({
            content: `${emojis.cancel.markdown} You can't blacklist yourself!`,
            flags: MessageFlags.Ephemeral
        });
    }

    let member;
    try {
        member = await submitted.guild.members.fetch(record.ticketCreatorId);
    } catch (err) {
        console.warn('[blacklistTicket] Failed to fetch ticket creator for blacklist:', {
            guildId: submitted.guild.id,
            channelId: submitted.channel?.id,
            targetUserId: record.ticketCreatorId,
            message: err?.message,
        });
        return await safeReply(submitted, `**An error occurred**\nAn error on Discord's side has occurred and we can't fetch the user. They may have left the server. Try again in a few minutes.`);
    }

    try {
        await member.roles.add(role);
    } catch (err) {
        console.warn('[blacklistTicket] Failed to add blacklist role:', {
            guildId: submitted.guild.id,
            channelId: submitted.channel?.id,
            targetUserId: record.ticketCreatorId,
            roleId: role.id,
            message: err?.message,
        });
        return await safeReply(submitted, `**An error occurred**\nThe bot is lacking permissions. Please check that the bot has the adequate permissions, and try again later. If this error persists, contact support.`);
    }

    const reason = sanitizeReason(submitted.fields.getTextInputValue('reasonInput'), 200);
    await finalCloseTicket(submitted, `Blacklisted - ${reason}`, submitted.user.tag, true);

    await logEvent("ticketActions", "warning", `**${sanitizeReason(submitted.user.tag)}** has blacklisted **${sanitizeReason(record.ticketCreator)}** for reason \`${reason}\`. The user will not be able to create any further tickets until the assigned role is removed.`, submitted)
}
