const { dynamo, getTicketByClaimMessage } = require('../../utils/db');
const { TABLE_TICKETS } = require('../../utils/constants');
const { getGuildConfig } = require('../../utils/guildConfig');
const { MessageFlags } = require('discord.js')
const { loadEmojis } = require('../../utils/emojiLoader');
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess, sanitizeReason} = require('../../utils/security');
const {logEvent} = require("../../utils/logging");

module.exports = async function claimTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    const emojis = await loadEmojis(interaction.guild.id);

    await interaction.deferReply({flags: MessageFlags.Ephemeral})

    let record;
    try {
        record = await getTicketByClaimMessage(interaction.message.id);
    } catch (err) {
        console.warn('[claimTicket] Failed to fetch ticket by claim message:', {
            guildId: interaction.guild.id,
            messageId: interaction.message.id,
            userId: interaction.user.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    if (!record) {
        return await interaction.editReply({
            content: `${emojis.NotHappeningToday.markdown} This request has already been claimed :(`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Access Control — must be authorised for this ticket's category
    const category = record.category;
    if (!await checkStaffAccess(interaction, config, emojis, { category })) return;

    const categoryConfig = config.layout?.categories?.[category];

    if (!categoryConfig || !categoryConfig.inboxId) {
        return await safeReply(interaction, `**An error occurred**\nThis ticket's category isn't configured properly. Please contact an administrator to check the server configuration.\n-# You may want to contact the user directly - they're in a ticket with no-one right now!`);
    }

    if (interaction.user.id === record.ticketCreatorId) {
        return await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.cancel.markdown} You can't claim your own ticket!`
        })
    }

    if(!record.claimed) {
        let claimChannel, message, ticket;
        try {
            const claimChannelId = categoryConfig.inboxId;
            claimChannel = await interaction.guild.channels.fetch(claimChannelId);
            message = await claimChannel.messages.fetch(record.claimMessageId);
            ticket = await interaction.guild.channels.fetch(record.channelId);
        } catch (err) {
            console.warn('[claimTicket] Failed to fetch claim resources:', {
                guildId: interaction.guild.id,
                claimChannelId: categoryConfig.inboxId,
                claimMessageId: record.claimMessageId,
                ticketChannelId: record.channelId,
                message: err?.message,
            });
            return await safeReply(interaction, `**An error occurred**\nAn error on Discord's side has occurred and we can't fetch details. Try again in a few minutes.`);
        }

        try {
            await message.delete();
        } catch (err) {
            console.warn('[claimTicket] Failed to delete claim message:', {
                guildId: interaction.guild.id,
                claimChannelId: claimChannel?.id,
                claimMessageId: record.claimMessageId,
                ticketChannelId: record.channelId,
                message: err?.message,
            });
        }

        // Notify the ticket channel and add the staff member
        try {
            await ticket.send({
                content: `-# ${emojis.claimed.markdown} *You are **being assisted**.*\nYou're now connected with ${interaction.user}. Say hi!`
            })
        } catch (err) {
            console.warn('[claimTicket] Failed to notify ticket channel after claim:', {
                guildId: interaction.guild.id,
                ticketChannelId: record.channelId,
                userId: interaction.user.id,
                message: err?.message,
            });
        }

        try {
            await ticket.members.add(interaction.user.id);
        } catch (err) {
            console.warn('[claimTicket] Failed to add claiming staff member to ticket thread:', {
                guildId: interaction.guild.id,
                ticketChannelId: record.channelId,
                userId: interaction.user.id,
                message: err?.message,
            });
        }

        // Update DB
        try {
            const channelId = record.channelId
            const updateParams = {
                TableName: TABLE_TICKETS,
                Key: { channelId },
                ConditionExpression: "claimed = :mustBeFalse",
                UpdateExpression: "SET claimed = :c, claimedBy = :cb, claimedByFriendly = :cd",
                ExpressionAttributeValues: {
                    ":mustBeFalse": false,
                    ":c": true,
                    ":cb": interaction.user.id,
                    ":cd": interaction.user.tag
                },
                ReturnValues: "ALL_NEW"
            };
            await dynamo.update(updateParams).promise();
        } catch (err) {
            if (err.code === 'ConditionalCheckFailedException') {
                // PLACEHOLDER: Inline reply (issue #70) — race condition limitation, another staff member claimed the ticket first. Brief, X-emoji prefix.
                return await interaction.editReply({
                    content: `${emojis.NotHappeningToday.markdown} This request has already been claimed :(`,
                    flags: MessageFlags.Ephemeral
                });
            }
            console.error('[claimTicket] Failed to persist claim:', {
                guildId: interaction.guild.id,
                ticketChannelId: record.channelId,
                claimMessageId: record.claimMessageId,
                userId: interaction.user.id,
                message: err?.message,
            });
            return await safeReply(interaction, `**An error occurred**\nWe couldn't update the ticket's record, so the claim hasn't gone through. Please contact support as the bot may not function properly within this ticket until it is corrected.`);
        }

        await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.check.markdown} You've claimed the support request for ${record.ticketCreator}.`
        })

        await logEvent("ticketActions", "info", `**${sanitizeReason(interaction.user.tag)}** claimed the following ticket:\n> -# Ticket ID: ${record.channelId}\n> Ticket Creator: **${sanitizeReason(record.ticketCreator)}**`, interaction)
    } else {
        await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.NotHappeningToday.markdown} This request has already been claimed :(`
        })
    }
}
