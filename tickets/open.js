const { MessageFlags, PermissionsBitField, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ActionRowBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { dynamo } = require('../utils/db')
const { captureEvent, reportCriticalFailure } = require('../utils/telemetry');
const { TABLE_TICKETS } = require('../utils/constants');
const { tagTicket } = require(`./tag`)
const {getGuildConfig} = require("../utils/guildConfig");
const {loadEmojis} = require("../utils/emojiLoader");
const { safeReply } = require('../utils/interactionHelper');
const { sanitizeReason } = require('../utils/security');
const queueTicket = require('../events/operations/queueTicket');
const {logEvent} = require("../utils/logging");
const bus = require('../utils/integrations/bus');

async function openTicket(interaction, category, reason) {
    // Init guild
    const traceId = `interaction-${interaction.id}`;
    const guildId = interaction.guildId || 'dm'; // Handle DMs
    captureEvent(`guild:${guildId}`, 'ticket_created', { trace_id: traceId });

    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    const config = await getGuildConfig(interaction.guild.id)
    const emojis = await loadEmojis(interaction.guild.id);

    if (!config) {
        return await safeReply(interaction, `**An error occurred**\nServer configuration not found. Please contact an administrator.`);
    }

    const blacklistRoleId = config.access?.blacklistRoleID;
    if (blacklistRoleId && interaction.member.roles.cache.has(blacklistRoleId)) {
        return await interaction.editReply({
            content: `${emojis.cancel.markdown} You're blacklisted from making tickets in this server. Contact server management for more information.`
        });
    }

    const categoryConfig = config.layout?.categories?.[category];

    if (!categoryConfig || !categoryConfig.channelId || !categoryConfig.inboxId) {
        return await safeReply(interaction, `**An error occurred**\nCategory "${category}" is not configured properly. Please contact an administrator.`);
    }

    const requiredRoleId = categoryConfig.requiredRoleId;
    if (requiredRoleId && !interaction.member.roles.cache.has(requiredRoleId)) {
        return await interaction.editReply({
            content: `${emojis.cancel.markdown} You don't have permission to open tickets in this category.`
        });
    }

    const supportChannelId = categoryConfig.channelId; // Ticket creation channel
    const unclaimedChannelId = categoryConfig.inboxId; // Claim queue channel
    const categoryIsAnon = categoryConfig.anonymous

    let support, unclaimedChannel;
    try {
        support = await interaction.guild.channels.fetch(supportChannelId);
        unclaimedChannel = await interaction.guild.channels.fetch(unclaimedChannelId);
    } catch (err) {
        console.warn('[openTicket] Failed to fetch support or inbox channel:', {
            guildId: interaction.guild.id,
            supportChannelId,
            unclaimedChannelId,
            category,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nAn error on Discord's side has occurred and we can't fetch details. Try again in a few minutes. This may be a permissions error.`);
    }

    if (!support) {
        return await safeReply(interaction, `**An error occurred**\nThe support channel for this category can't be found. Please contact an administrator.`);
    }

    if (!unclaimedChannel) {
        return await safeReply(interaction, `**An error occurred**\nThe inbox for this category can't be found. Please contact an administrator.`);
    }

    // Pre-flight check, make sure nothing can go wrong before we commit
    const botMember = interaction.guild.members.me;
    if (botMember) {
        const botPerms = support.permissionsFor(botMember);
        const missing = [
            ['Create Private Threads', PermissionsBitField.Flags.CreatePrivateThreads],
            ['Send Messages in Threads', PermissionsBitField.Flags.SendMessagesInThreads],
            ['Manage Threads', PermissionsBitField.Flags.ManageThreads],
        ].filter(([, flag]) => !botPerms.has(flag)).map(([name]) => `\`${name}\``);

        if (missing.length > 0) {
            return await safeReply(interaction, `**An error occurred**\nI'm missing permissions in <#${supportChannelId}>: ${missing.join(', ')}. Please ask an administrator to correct the bot's channel permissions.`);
        }
    }

    // Pre-flight check, ensure they can see the channel, or Discord will silently fail
    const userPerms = support.permissionsFor(interaction.member);
    if (!userPerms?.has(PermissionsBitField.Flags.ViewChannel)) {
        return await safeReply(interaction, `**An error occurred**\nI can't add you to a ticket thread because your account doesn't have permission to view <#${supportChannelId}>. Discord requires \`View Channel\` access on the parent channel to join any thread inside it.\n-# An administrator needs to grant ticket users \`View Channel\` on <#${supportChannelId}>. \`Send Messages\` and \`Read Message History\` can stay denied to keep the channel staff-only.`);
    }

    // Construct initial message
    const hexColor = config.appearance.defaultHexColor.replace('#', '');
    const accentColor = parseInt(hexColor, 16);
    const container = new ContainerBuilder().setAccentColor(accentColor)
    const banner = config.layout?.presets?.openTicket?.banner;
    const headerAttachment = banner?.url
        ? new MediaGalleryBuilder()
            .addItems(
                (mediaGalleryItem) => mediaGalleryItem
                    .setDescription(banner.altText || 'Support ticket banner')
                    .setURL(banner.url),
            )
        : null;

    const sSeparator = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)

    const mainText = new TextDisplayBuilder()
        .setContent(`${config.layout.presets.openTicket.openTicketMessage}`)

    const subText = new TextDisplayBuilder()
        .setContent(`-# Your form details can be found below:\n\`\`\`Reason: ${sanitizeReason(reason)}\`\`\``)

    const separator = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)

    const tktcntrl = new TextDisplayBuilder().setContent(`-# Ticket Controls`)
    const closeB = new ButtonBuilder()
        .setCustomId('closeTicket')
        .setLabel(`Close`)
        .setEmoji(`${emojis.cancel.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)

    const addB = new ButtonBuilder()
        .setCustomId('addTicket')
        .setEmoji(`${emojis.add.id}`)
        .setLabel('Add')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    const removeB = new ButtonBuilder()
        .setCustomId('removeTicket')
        .setEmoji(`${emojis.remove.id}`)
        .setLabel('Remove')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)

    const intB = new ButtonBuilder()
        .setCustomId('integrationsTicket')
        .setEmoji(`${emojis.integrations.id}`)
        .setLabel('Commands')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)

    const staffB = new ButtonBuilder()
        .setCustomId('staffPanelTicket')
        .setLabel(`Staff`)
        .setEmoji(`${emojis.staff.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)

    const row = new ActionRowBuilder()
        .addComponents(closeB, addB, removeB, staffB)

    const footer = new TextDisplayBuilder().setContent(`-# ${config.appearance.footer}`)

    // container.addTextDisplayComponents(tHeader)
    if (headerAttachment) {
        container.addMediaGalleryComponents(headerAttachment)
        container.addSeparatorComponents(sSeparator)
    }
    container.addTextDisplayComponents(mainText)
    container.addTextDisplayComponents(subText)
    container.addSeparatorComponents(separator)
    container.addTextDisplayComponents(tktcntrl)
    container.addActionRowComponents(row)
    // container.addTextDisplayComponents(tktint)
    // container.addActionRowComponents(actionRow)
    container.addTextDisplayComponents(footer)

    const fullName = `${reason} | @${interaction.user.tag}`;
    const name = fullName.length > 100 ? fullName.slice(0, 97) + '...' : fullName;

    // Create the ticket thread
    let ticket;
    try {
        ticket = await support.threads.create({
            name: sanitizeReason(name),
            type: ChannelType.PrivateThread,
            reason: `Ticket created by @${interaction.user.tag}`,
            invitable: false
        })
    } catch (err) {
        console.warn('[openTicket] Failed to create ticket thread:', {
            guildId: interaction.guild.id,
            supportChannelId,
            userId: interaction.user.id,
            category,
            message: err?.message,
        });
        // RETRYABLE: Thread creation failed — Discord API error or permissions issue
        return await safeReply(interaction, `**An error occurred**\nAn error on Discord's side has occurred and the ticket couldn't be created. Try again in a few minutes. This may be a permissions error.`);
    }

    // Send the panel inside
    try {
        await ticket.send({
            fetchReply: true,
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            allowedMentions: { parse: [] }
        })
    } catch (err) {
        console.warn('[openTicket] Failed to send ticket panel; cleaning up thread:', {
            guildId: interaction.guild.id,
            threadId: ticket.id,
            userId: interaction.user.id,
            message: err?.message,
        });
        try {
            await ticket.delete();
        } catch (deleteErr) {
            console.warn('[openTicket] Failed to delete ticket thread after panel send failure:', {
                guildId: interaction.guild.id,
                threadId: ticket.id,
                message: deleteErr?.message,
            });
        }
        return await safeReply(interaction, `**An error occurred**\nAn error on Discord's side has occurred and the ticket couldn't be set up. Try again in a few minutes.`);
    }

    // Add user to the thread
    try {
        await ticket.members.add(interaction.user.id);
    } catch (error) {
        console.log('[TICKET] members.add failed', {
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            threadId: ticket.id,
            supportChannelId,
            code: error?.code,
            status: error?.status,
            message: error?.message,
        });
        // Clean up the broken ticket
        try {
            await ticket.delete();
        } catch (deleteErr) {
            console.warn('[openTicket] Failed to delete ticket thread after member add failure:', {
                guildId: interaction.guild.id,
                threadId: ticket.id,
                message: deleteErr?.message,
            });
        }
        return await safeReply(interaction, `**An error occurred**\nI couldn't add you to the ticket thread. This usually means your account is missing \`View Channel\` permission on <#${supportChannelId}>, or the bot's permissions on that channel were changed mid-flight.\n-# An administrator may need to check channel permissions for both the bot and ticket users.`);
    }

    const member = interaction.member
    const priorityRoles = config.access.priorityRoles ?? [];
    const priorityTriggeredBy = priorityRoles.find(roleId => member.roles.cache.has(roleId)) ?? null;
    const priority = !!priorityTriggeredBy;

    // DB
    try {
        const params = {
            TableName: TABLE_TICKETS,
            Item: {
                channelId: ticket.id,
                guildId: interaction.guild.id,
                ticketCreator: interaction.user.tag,
                ticketCreatorId: interaction.user.id,
                category,
                claimMessageId: "N/A",
                claimed: false,
                claimedBy: "N/A",
                claimedByFriendly: "N/A",
                reason,
                priority,
                priorityTriggeredBy,
            }
        };

        await dynamo.put(params).promise();

        bus.emit('ticket.created', {
            ticketId: ticket.id,
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            category,
        });

    } catch (error) {
        console.log('[EMERGENCY] TICKET RECORD CREATION FAILED!');
        console.log('[EMERGENCY] Error code:', error.code);
        console.log('[EMERGENCY] Error message:', error.message);
        console.log('[EMERGENCY] Full error:', error);
        reportCriticalFailure(error, 'tickets/open', 'ticket_record_create', {
            guild_id: interaction.guild.id,
            channel_id: ticket.id,
        });

        // DELETE THE TICKET since we couldn't create the record
        try {
            await ticket.delete();
            console.log('[EMERGENCY] Ticket thread deleted due to database failure');
        } catch (deleteError) {
            console.log('[EMERGENCY] Failed to delete ticket thread:', deleteError);
        }

        // Inform the user
        await safeReply(interaction, `**An error occurred**\nAn error occurred while creating your ticket and we attempted to recover. Please try again, and if the error persists, contact support.`);

        return; // STOP EXECUTION
    }

    await interaction.editReply({content: `${emojis.check.markdown} Your ticket is available here: <#${ticket.id}>`})

    // Intellitag
    let tagTik = null;
    try {
        tagTik = await tagTicket(ticket, reason);
    } catch (err) {
        console.warn('[openTicket] Intellitag failed:', {
            guildId: interaction.guild.id,
            threadId: ticket.id,
            userId: interaction.user.id,
            message: err?.message,
        });
    }

    if (tagTik === true) {
        const tagTxt1 = new TextDisplayBuilder().setContent(`To help our support staff, please complete the questions above.\n-# Once done, press Continue.`)
        const completeB = new ButtonBuilder()
            .setCustomId(`queueTicket`)
            .setEmoji(`${emojis.check.id}`)
            .setLabel(`Continue`)
            .setStyle(ButtonStyle.Secondary)
        const row = new ActionRowBuilder().addComponents(completeB)
        ticket.send({
            flags: MessageFlags.IsComponentsV2,
            components: [tagTxt1, row]
        })
        return
    } else if (tagTik === false) {
        const tagTxt1 = new TextDisplayBuilder().setContent(`Did we resolve your concern?\n-# If your open reason was stated and resolved above, and you still choose to ignore it, we will immediately close your ticket.`)
        const completeB = new ButtonBuilder()
            .setCustomId(`queueTicket`)
            .setEmoji(`${emojis.secondarywarning.id}`)
            .setLabel(`Ignore and Contact Support`)
            .setStyle(ButtonStyle.Secondary)
        const row = new ActionRowBuilder().addComponents(completeB)
        ticket.send({
            flags: MessageFlags.IsComponentsV2,
            components: [tagTxt1, row]
        })
        return
    } else {
        // Null
    }

    // Queue ticket
    await queueTicket(interaction, reason, { skipAck: true, channelId: ticket.id, anonymous: categoryIsAnon });
    await logEvent("ticketOperations", "info", `**${sanitizeReason(interaction.user.tag)}** has created a ticket:\n> -# Ticket ID: ${ticket.id}\n> Reason: \`${sanitizeReason(reason)}\``, interaction)
}


module.exports = { openTicket };
