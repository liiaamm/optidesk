const { dynamo, getTicketByClaimMessage } = require('../../utils/db');
const { TABLE_TICKETS } = require('../../utils/constants');
const { MessageFlags, ActionRowBuilder } = require('discord.js')
const { loadEmojis } = require('../../utils/emojiLoader');
const {getGuildConfig} = require("../../utils/guildConfig");
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess, sanitizeReason} = require('../../utils/security');
const {logEvent} = require("../../utils/logging");

module.exports = async function finalEscalateTicket(interaction) {
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);

    await interaction.deferReply({flags: MessageFlags.Ephemeral})

    let record;
    try {
        record = await getTicketByClaimMessage(interaction.message.id);
    } catch (err) {
        console.warn('[finalEscalateTicket] Failed to fetch ticket by claim message:', {
            guildId: interaction.guild.id,
            messageId: interaction.message.id,
            userId: interaction.user.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    // Access Control
    if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;

    if (interaction.user.id === record.ticketCreatorId) {
        return await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.cancel.markdown} You can't claim your own ticket!`
        });
    }

    if(!record.answered) {
        let claimChannel, message, ticket;
        try {
            claimChannel = await interaction.guild.channels.fetch(record.escalatedInboxId);
            message = await claimChannel.messages.fetch(record.claimMessageId);
            ticket = await interaction.guild.channels.fetch(record.channelId);
        } catch (err) {
            console.warn('[finalEscalateTicket] Failed to fetch escalation resources:', {
                guildId: interaction.guild.id,
                escalatedInboxId: record.escalatedInboxId,
                claimMessageId: record.claimMessageId,
                ticketChannelId: record.channelId,
                message: err?.message,
            });
            return await safeReply(interaction, `**An error occurred**\nAn error on Discord's side has occurred and we can't fetch details. Try again in a few minutes. This may be a permissions error.`);
        }

        try {
            const channelId = record.channelId
            const updateParams = {
                TableName: TABLE_TICKETS,
                Key: { channelId },
                ConditionExpression: "attribute_not_exists(answered) OR answered = :false",
                UpdateExpression: "SET claimed = :c, claimedBy = :cb, claimedByFriendly = :cd, answered = :answered",
                ExpressionAttributeValues: {
                    ":false": false,
                    ":c": true,
                    ":cb": interaction.user.id,
                    ":cd": interaction.user.tag,
                    ":answered": true
                },
                ReturnValues: "ALL_NEW"
            };
            await dynamo.update(updateParams).promise();
        } catch (err) {
            if (err.code === "ConditionalCheckFailedException") {
                return await safeReply(interaction, `${emojis.NotHappeningToday.markdown} This escalation has just been claimed by someone else.`);
            }
            console.error('[finalEscalateTicket] Failed to persist escalation claim:', {
                guildId: interaction.guild.id,
                ticketChannelId: record.channelId,
                claimMessageId: record.claimMessageId,
                userId: interaction.user.id,
                message: err?.message,
            });
            return await safeReply(interaction, `**An error occurred**\nThe claim didn't save due to an error. The old support staff member stays the owner. If this error persists, contact support.`);
        }

        try {
            await message.delete();
        } catch (err) {
            console.warn('[finalEscalateTicket] Failed to delete escalation claim message:', {
                guildId: interaction.guild.id,
                escalatedInboxId: record.escalatedInboxId,
                claimMessageId: record.claimMessageId,
                ticketChannelId: record.channelId,
                message: err?.message,
            });
        }

        // Notify ticket channel and add staff
        try {
            const isSameAgent = record.claimedBy === interaction.user.id;
            const connectedMsg = isSameAgent
                ? `You're still connected with ${interaction.user}.`
                : `You're now connected with ${interaction.user} as well.`;
            await ticket.send({
                content: `-# ${emojis.escalate_add.markdown} *You are **being assisted**.*\n${connectedMsg} Say hi!`
            })
        } catch (err) {
            console.warn('[finalEscalateTicket] Failed to notify ticket channel after escalation claim:', {
                guildId: interaction.guild.id,
                ticketChannelId: record.channelId,
                userId: interaction.user.id,
                message: err?.message,
            });
        }

        try {
            await ticket.members.add(interaction.user.id);
        } catch (err) {
            console.warn('[finalEscalateTicket] Failed to add escalation claimee to ticket thread:', {
                guildId: interaction.guild.id,
                ticketChannelId: record.channelId,
                userId: interaction.user.id,
                message: err?.message,
            });
        }

        await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.escalate_add.markdown} You've claimed the escalation request for ${record.ticketCreator}.`
        })

        await logEvent("ticketActions", "info", `**${sanitizeReason(interaction.user.tag)}** claimed the following ticket, which was escalated:\n> -# Ticket ID: ${interaction.channel.id}\n> Ticket Creator: **${sanitizeReason(record.ticketCreator)}**`, interaction)

    } else {
        await interaction.editReply({
            flags: MessageFlags.Ephemeral,
            content: `${emojis.NotHappeningToday.markdown} This request has already been claimed :(`
        })
    }
}
