const { dynamo } = require('../../utils/db');
const { TABLE_TICKETS, COLOR_ERROR } = require('../../utils/constants');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js')
const { loadEmojis } = require('../../utils/emojiLoader');
const {getGuildConfig} = require("../../utils/guildConfig");
const { safeReply } = require('../../utils/interactionHelper');
const { sanitizeReason } = require('../../utils/security');
const {logEvent} = require("../../utils/logging");
const { captureEvent } = require('../../utils/telemetry');

module.exports = async function requestCloseTicket(interaction, reason) {
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);
    const closeTxt = new TextDisplayBuilder().setContent(`-# ${emojis.ticketresolved.markdown} ***${interaction.user}** wants to close this ticket.*\n${config.layout.presets.closeRequestMessage}\n\`\`\`Reason: ${sanitizeReason(reason)}\`\`\``)
    const confirmB = new ButtonBuilder()
        .setCustomId('finalCloseTicket')
        .setLabel(`Close`)
        .setEmoji(`${emojis.check.id}`)
        .setStyle(ButtonStyle.Secondary)

    const abortB = new ButtonBuilder()
        .setCustomId('deleteMsgTicket')
        .setLabel(`Continue`)
        .setEmoji(`${emojis.cancel.id}`)
        .setStyle(ButtonStyle.Secondary)

    const row = new ActionRowBuilder()
        .addComponents(confirmB, abortB)

    // DB
    const channelId = interaction.channel.id
    try {
        const updateParams = {
            TableName: TABLE_TICKETS,
            Key: { channelId },
            ConditionExpression: "attribute_not_exists(closeReason)",
            UpdateExpression: "SET closeReason = :c, closeAuthor = :cb, closeAuthorId = :cid, forcedQuery = :cc",
            ExpressionAttributeValues: {
                ":c": `${reason}`,
                ":cb": `${interaction.user.tag}`,
                ":cid": `${interaction.user.id}`,
                ":cc": false,
            },
            ReturnValues: "ALL_NEW"
        };
        await dynamo.update(updateParams).promise();
    } catch (err) {
        if (err.code === 'ConditionalCheckFailedException') {
            let pendingAuthor = null;
            try {
                const existing = await dynamo.get({ TableName: TABLE_TICKETS, Key: { channelId } }).promise();
                pendingAuthor = existing.Item?.closeAuthor ?? null;
            } catch (readErr) {
                console.warn('[requestCloseTicket] Failed to read pending close author after conflict:', {
                    guildId: interaction.guild.id,
                    channelId,
                    message: readErr?.message,
                });
            }
            captureEvent(`user:${interaction.user.id}`, 'close_request_conflict', {
                guild_id: interaction.guild.id,
                channel_id: channelId,
                conflicting_user: interaction.user.tag,
                pending_author: pendingAuthor,
            });
            if (pendingAuthor && pendingAuthor === interaction.user.tag) {
                return await safeReply(interaction, `**You already have a pending close request**\nThis ticket already has an open close request from you. Wait for the ticket creator to respond, or cancel your existing request first.`);
            }
            const authorNote = pendingAuthor
                ? `It was submitted by \`${sanitizeReason(pendingAuthor, 100)}\`.`
                : `Check the ticket channel for the pending request.`;
            return await safeReply(interaction, `**A close request is already pending**\nThis ticket already has an open close request. ${authorNote} Wait for the ticket creator to respond, or cancel the existing request first.`);
        }
        return await safeReply(interaction, `**An error occurred**\nThe request could not be saved. Please try again in a moment. If this persists, contact support.`);
    }

    try {
        const ticket = await interaction.guild.channels.fetch(interaction.channel.id);
        await ticket.send({
            flags: MessageFlags.IsComponentsV2,
            components: [closeTxt,row],
            fetchReply: true,
            allowedMentions: { users: [interaction.user.id] }
        })
    } catch (err) {
        console.warn('[requestCloseTicket] Failed to send close request message:', {
            guildId: interaction.guild.id,
            channelId,
            userId: interaction.user.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nThe request could not be sent. Check permissions.`);
    }

    await interaction.editReply({content: `${emojis.check.markdown} You've sent a request to close the ticket.`, flags: MessageFlags.Ephemeral})
    await logEvent("ticketActions", "info", `**${sanitizeReason(interaction.user.tag)}** requested to close the following ticket, which is pending acceptance:\n> -# Ticket ID: ${interaction.channel.id}\n> Reason: \`${sanitizeReason(reason)}\``, interaction)
}
