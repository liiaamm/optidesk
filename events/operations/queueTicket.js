const { MessageFlags, ContainerBuilder, ThumbnailBuilder, TextDisplayBuilder, ButtonBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ButtonStyle } = require('discord.js');
const { dynamo, getTicketByChannel } = require('../../utils/db')
const { TABLE_TICKETS, COLOR_PRIORITY, COLOR_CX } = require('../../utils/constants');
const { loadEmojis } = require('../../utils/emojiLoader');
const {getGuildConfig, clearGuildCache} = require("../../utils/guildConfig");
const { safeReply } = require('../../utils/interactionHelper');
const { sanitizeReason } = require('../../utils/security');
const { memberHasCategoryAccess } = require('../../utils/categoryAcl');
const { reportCriticalFailure } = require('../../utils/telemetry');

module.exports = async function queueTicket(interaction, reason, { skipAck = false, channelId = null, anonymous = false } = {}) {
    try {
        await interaction.deferReply({flags: MessageFlags.Ephemeral})
    } catch (err) {
        if (!skipAck) {
            console.warn('[queueTicket] Failed to defer interaction reply:', {
                guildId: interaction.guild?.id,
                channelId,
                interactionId: interaction.id,
                message: err?.message,
            });
        }
    }
    channelId = channelId ?? interaction.channel.id;
    let ticket;
    try {
        ticket = await interaction.guild.channels.fetch(channelId);
    } catch (err) {
        console.warn('[queueTicket] Failed to fetch ticket channel:', {
            guildId: interaction.guild?.id,
            channelId,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nThe ticket channel couldn't be found — it may have been deleted. If this is unexpected, contact support.`);
    }
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id)

    if (!config) {
        return await safeReply(interaction, `**An error occurred**\nThe server isn't configured. Please contact an administrator.\n-# Only the Guild Owner and authorised persons can configure OptiDesk.`);
    }
    
    let record;
    try {
        record = await getTicketByChannel(channelId);
    } catch (err) {
        console.warn('[queueTicket] Failed to fetch ticket record:', {
            guildId: interaction.guild?.id,
            channelId,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    const isCreator = interaction.user.id === record.ticketCreatorId;
    if (!isCreator) {
        let allowed = false;
        try {
            allowed = memberHasCategoryAccess(interaction.member, config, record.category);
        } catch (err) {
            console.warn('[queueTicket] Failed to verify category access:', {
                guildId: interaction.guild?.id,
                channelId,
                userId: interaction.user?.id,
                category: record.category,
                message: err?.message,
            });
            return await safeReply(interaction, `**An error occurred**\nI wasn't able to verify your identity. Please try again in a moment.`);
        }
        if (!allowed) {
            const denyPayload = {
                content: `${emojis.cancel.markdown} You lack permissions to do this.`,
                flags: MessageFlags.Ephemeral
            };
            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply(denyPayload);
            }
            return await interaction.reply(denyPayload);
        }
    }

    // Construct new ticket notification

    // FLAGGING
    let containerP;
    if (record.priority) {
        const triggeredRole = interaction.guild.roles.cache.get(record.priorityTriggeredBy);
        const roleName = triggeredRole?.name ?? 'Unknown Role';
        const pings = (config.access.pingOnPriorityRoles ?? []).map(id => `<@&${id}>`).join(' ');
        const textP = new TextDisplayBuilder().setContent(`${emojis.priority.markdown} **Flagged as Priority**\nThis user has the **${roleName}** role, which is a Priority role.\n-# ${pings}`)
        containerP = new ContainerBuilder().setAccentColor(COLOR_PRIORITY)
        containerP.addTextDisplayComponents(textP)
    }

    let containerCeQ;
    if ((record.sentBackToQueue ?? 0) > 0) {
        const textCeQ = new TextDisplayBuilder().setContent(`${emojis.customer_experience.markdown} **User queued again**\nThis ticket was released back to queue by **${record.lastQueuedByFriendly}**. The ticket has been released back **${record.sentBackToQueue}** times.`)
        containerCeQ = new ContainerBuilder().setAccentColor(COLOR_CX)
        containerCeQ.addTextDisplayComponents(textCeQ)
    }

    const categoryConfig = config.layout?.categories?.[record.category];
    if (!categoryConfig || !categoryConfig.inboxId) {
        return await safeReply(interaction, `**An error occurred**\nThere are no categories configured. Please re-run setup and ensure categories are configured with the same names prior to this error. If this is unexpected, or need assistance, please contact support.\n-# Only the Guild Owner and authorised persons can configure OptiDesk.`);
    }
    const categoryStaffRoleId = categoryConfig.staffRoleId;

    const hexColor = config.appearance.defaultHexColor.replace('#', '');
    const accentColor = parseInt(hexColor, 16);
    const containerB = new ContainerBuilder().setAccentColor(accentColor)
    const presentedUser = anonymous ? "An anonymous user" : record.ticketCreator;
    const staffMention = categoryStaffRoleId ? `<@&${categoryStaffRoleId}>` : '';
    const header = new TextDisplayBuilder().setContent(`## New Ticket Available\n-# ${staffMention}\n**${presentedUser}** created a ticket for the following:\n\`\`\`Reason: ${sanitizeReason(record.reason)}\`\`\``)
    const claimTxt = new TextDisplayBuilder().setContent(`If you are able to assist this person, please claim their request below. By claiming this request, it'll be removed from this page. Ticket supervisors can still see the ticket.`)
    const staffClaimB = new ButtonBuilder()
        .setLabel('Claim')
        .setEmoji(`${emojis.claim.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId('claimTicket')

    const section1 = new SectionBuilder()
        .addTextDisplayComponents(header)
    if (config.appearance.serverLogoURL) {
        section1.setThumbnailAccessory(new ThumbnailBuilder().setURL(config.appearance.serverLogoURL))
    }

    const section2 = new SectionBuilder()
        .addTextDisplayComponents(claimTxt)
        .setButtonAccessory(staffClaimB)

    const separator = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)

    await containerB.addSectionComponents(section1)
    await containerB.addSeparatorComponents(separator)
    await containerB.addSectionComponents(section2)

    const claimChannelId = categoryConfig.inboxId;

    // Claim notification
    let claimMsg;
    try {
        const claimChannel = await interaction.guild.channels.fetch(claimChannelId);
        const components = [];
        if (containerP) components.push(containerP);
        if (containerCeQ) components.push(containerCeQ);
        components.push(containerB);
        claimMsg = await claimChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components,
            fetchReply: true,
            allowedMentions: { roles: categoryStaffRoleId ? [categoryStaffRoleId] : [] }
        })
    } catch (err) {
        // Staff won't see this ticket, hit the big red button
        reportCriticalFailure(err, 'queueTicket', 'claim_notification_send', {
            guild_id: interaction.guild.id,
            channel_id: channelId,
        });
        return await safeReply(interaction, `**An error occurred**\nWe couldn't notify staff. You should attempt to contact them yourself, or contact OptiDesk support (https://optidesk.dev).`);
    }


    try {
        const updateParams = {
            TableName: TABLE_TICKETS,
            Key: { channelId },
            UpdateExpression: "SET claimed = :c, claimMessageId = :cb",
            ExpressionAttributeValues: {
                ":c": false,
                ":cb": claimMsg.id
            },
            ReturnValues: "ALL_NEW"
        };
        await dynamo.update(updateParams).promise();
    } catch (err) {
        console.error(`[queueTicket] Failed to persist claimMessageId for channel ${channelId}:`, err);
        // Claim button silently broken
        reportCriticalFailure(err, 'queueTicket', 'claim_msgid_persist', {
            guild_id: interaction.guild.id,
            channel_id: channelId,
        });
    }

    try {
        await ticket.send({content: `-# ${emojis.InQueuev2.markdown} *You are **In Queue**.*\n${config.layout.presets.queueMessage}`})
    } catch (err) {
        console.warn('[queueTicket] Failed to send queue status message into ticket:', {
            guildId: interaction.guild.id,
            channelId: ticket.id,
            message: err?.message,
        });
    }

    if (!skipAck) {
        await interaction.editReply({content: `${emojis.InQueuev2.markdown} Thank you. We've placed you in queue.`, flags: MessageFlags.Ephemeral})

        try {
            await interaction.message.delete();
        } catch (err) {
            console.warn('[queueTicket] Failed to delete queue trigger message:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel?.id,
                messageId: interaction.message?.id,
                message: err?.message,
            });
        }
    }
}
