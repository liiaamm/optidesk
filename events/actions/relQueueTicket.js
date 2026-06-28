const { MessageFlags } = require('discord.js');
const { getTicketByChannel, dynamo } = require('../../utils/db');
const { TABLE_TICKETS } = require('../../utils/constants');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getGuildConfig } = require('../../utils/guildConfig');
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess, sanitizeReason } = require('../../utils/security');
const queueTicket = require('../operations/queueTicket');
const { logEvent } = require("../../utils/logging");


module.exports = async function relQueueTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    const emojis = await loadEmojis(interaction.guild.id);

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch {
        await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
        return;
    }

    if (!record) {
        await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
        return;
    }

    // Access Control
    if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    await interaction.editReply({ content: `${emojis.InQueuev2.markdown} Processing release, please wait.`, flags: MessageFlags.Ephemeral });

    if (!record.claimed) {
        await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.cancel.markdown} This ticket needs to be answered before it can be released.`
        });
        return;
    }

    // Remove claimee from thread
    try {
        await interaction.channel.members.remove(record.claimedBy);
    } catch (err) {
        console.warn('[relQueueTicket] Failed to remove previous claimee from thread:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            claimedBy: record.claimedBy,
            message: err?.message,
        });
    }

    // Delete orphaned escalation notification
    if (record.escalatedInboxId && record.claimMessageId && record.claimMessageId !== 'N/A') {
        try {
            const escalatedInbox = await interaction.guild.channels.fetch(record.escalatedInboxId);
            const escalationMsg = await escalatedInbox.messages.fetch(record.claimMessageId);
            await escalationMsg.delete();
        } catch (err) {
            console.warn('[relQueueTicket] Failed to delete orphaned escalation notification:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                escalatedInboxId: record.escalatedInboxId,
                claimMessageId: record.claimMessageId,
                message: err?.message,
            });
        }
    }

    try {
        await dynamo.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: interaction.channel.id },
            ConditionExpression: "claimed = :mustBeTrue",
            UpdateExpression: "SET claimed = :c, claimedBy = :cb, claimedByFriendly = :cd, sentBackToQueue = if_not_exists(sentBackToQueue, :zero) + :inc, lastQueuedBy = :lb, lastQueuedByFriendly = :lbf REMOVE escalatedInboxId",
            ExpressionAttributeValues: {
                ":mustBeTrue": true,
                ":c": false,
                ":cb": "N/A",
                ":cd": "N/A",
                ":zero": 0,
                ":inc": 1,
                ":lb": interaction.user.id,
                ":lbf": interaction.user.tag
            }
        }).promise();
    } catch (err) {
        if (err.code === 'ConditionalCheckFailedException') {
            return await interaction.editReply({
                content: `${emojis.NotHappeningToday.markdown} Ticket is already being released by another staff member.`,
                flags: MessageFlags.Ephemeral
            });
        }
        return await safeReply(interaction, `**An error occurred**\nI couldn't update this ticket. Please try again in a few minutes, and if the error still persists, contact support.`);
    }

    // Re-queue
    try {
        await queueTicket(interaction, record.reason, { skipAck: true });
    } catch {
        return await safeReply(interaction, `**An error occurred**\nThe ticket was released but couldn't be re-queued. Please try again in a few minutes, and if the error still persists, contact support.`);
    }

    try {
        await interaction.editReply({ content: `${emojis.InQueuev2.markdown} Ticket released back to queue.`, flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.warn('[relQueueTicket] Failed to update release confirmation:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });
    }

    await logEvent("ticketActions", "notice", `**${sanitizeReason(interaction.user.tag)}** released a ticket back to the queue.\n> -# Ticket ID: ${interaction.channel.id}\n> Ticket Creator: \`${sanitizeReason(record.ticketCreator)}\``, interaction)
}
