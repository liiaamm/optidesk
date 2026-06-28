const { s3, dynamo, storageEnabled, transcriptBucket } = require('../../utils/db');
const { TABLE_TICKETS, TABLE_TRANSCRIPTS } = require('../../utils/constants');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Collection } = require('discord.js')
const { generateTranscript } = require('../../utils/transcriptGenerator');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getGuildConfig } = require('../../utils/guildConfig');
const {getUserIdsFromChannel} = require("../../utils/gdpr");
const { safeReply, safeFollowUp, buildErrorContainer } = require('../../utils/interactionHelper');
const { sanitizeReason } = require('../../utils/security');
const {logEvent} = require("../../utils/logging");
const { memberHasCategoryAccess } = require('../../utils/categoryAcl');
const { reportCriticalFailure } = require('../../utils/telemetry');

module.exports = async function finalCloseTicket(interaction, closeReason, closeAuthor, force) {
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);

    const Lparams = {
        TableName: TABLE_TICKETS,
        Key: { channelId: interaction.channel.id }
    };

    let record;
    try {
        const result = await dynamo.get(Lparams).promise();
        record = result.Item;
    } catch (err) {
        console.error('[finalCloseTicket] Failed to fetch ticket record before close:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            userId: interaction.user.id,
            message: err?.message,
        });
    }

    if (!record) {
        const actionRow = new ActionRowBuilder();
        return await safeReply(interaction, `**An error occurred**\nNo record exists for this ticket, so closing the ticket will fail. You can safely delete the channel, instead. If this error persists in other tickets, contact support.`, { actionRow });
    }

    const isCreator = interaction.user.id === record.ticketCreatorId;
    if (!isCreator) {
        try {
            if (!memberHasCategoryAccess(interaction.member, config, record.category)) {
                const denyPayload = {
                    content: `${emojis.cancel.markdown} You lack permissions to close this ticket.`,
                    flags: MessageFlags.Ephemeral
                };
                if (interaction.deferred || interaction.replied) {
                    return await interaction.editReply(denyPayload);
                }
                return await interaction.reply(denyPayload);
            }
        } catch (err) {
            console.warn('[finalCloseTicket] Failed to verify close permissions:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                userId: interaction.user.id,
                category: record.category,
                message: err?.message,
            });
            return await safeReply(interaction, `**An error occurred**\nI wasn't able to verify your identity. Please try again in a moment.`);
        }
    }

    // Atomic lock
    try {
        await dynamo.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: interaction.channel.id },
            ConditionExpression: "attribute_exists(channelId) AND (attribute_not_exists(closing) OR closing = :false)",
            UpdateExpression: "SET closing = :true",
            ExpressionAttributeValues: { ":true": true, ":false": false },
        }).promise();
    } catch (err) {
        if (err.code === 'ConditionalCheckFailedException') {
            const inlinePayload = {
                content: `${emojis.NotHappeningToday.markdown} This ticket is already being closed.`,
                flags: MessageFlags.Ephemeral
            };
            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply(inlinePayload);
            }
            return await interaction.reply(inlinePayload);
        }
        return await safeReply(interaction, `**An error occurred**\nCouldn't initiate ticket closure. Please try again in a moment.`);
    }

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`${emojis.logs.markdown} Closing this request now, this can take a few moments.`);
    } else {
        await interaction.reply(`${emojis.logs.markdown} Closing this request now, this can take a few moments.`);
    }

    let transcriptFailed = false;

    if (config.settings.transcriptsEnabled && storageEnabled()) {
        try {
            const channel = interaction.channel;

            if (channel.isThread()) {
                await channel.fetch();
            }

            // Fetch all messages via pagination (Discord limit = 100 per request)
            const fetchedMessages = new Collection();
            let lastId = null;
            for (let i = 0; i < 50; i++) {
                const options = { limit: 100 };
                if (lastId) options.before = lastId;
                const batch = await channel.messages.fetch(options);
                if (batch.size === 0) break;
                batch.forEach((msg, id) => fetchedMessages.set(id, msg));
                lastId = batch.last().id;
                if (batch.size < 100) break;
            }

            const transcript = await generateTranscript(fetchedMessages, channel, config.settings.transcriptsTrusted ?? false);

            const params = {
                Bucket: transcriptBucket(),
                Key: `transcripts/${interaction.guild.id}/${channel.id}.html`,
                Body: transcript,
                ContentType: 'text/html',
                ACL: 'private',
            };

            await s3.putObject(params).promise();

        } catch(err) {
            console.error('[finalCloseTicket] Transcript generation/upload failed:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                message: err?.message,
                stack: err?.stack,
            });
            transcriptFailed = true;
            // Transcript data loss — page.
            reportCriticalFailure(err, 'finalCloseTicket', 's3_transcript_put', {
                guild_id: interaction.guild.id,
                channel_id: interaction.channel.id,
            });
        }
    }

    // Pull reason and metadata FROM ATTRIBUTES/RECORD
    if (!closeReason) {
        closeReason = record.closeReason || 'Ticket closed by user';
    }

    // Close Author: explicit param > DB record > current user
    if (!closeAuthor) {
        closeAuthor = record.closeAuthor || interaction.user.tag;
    }

    // Force: explicit param > DB record > false (voluntary)
    if (force === undefined || force === null) {
        force = record.forcedQuery !== undefined ? record.forcedQuery : false;
    }

    const transcriptAvailable = config.settings.transcriptsEnabled && storageEnabled() && !transcriptFailed;

    // Save transcript
    if (transcriptAvailable) {
        let partArray = [];
        try {
            partArray = await getUserIdsFromChannel(interaction.channel);
        } catch (err) {
            console.warn('[finalCloseTicket] Failed to collect transcript participants:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                message: err?.message,
            });
        }
        try {
            await dynamo.put({
                TableName: TABLE_TRANSCRIPTS,
                Item: {
                    channelId: record.channelId,
                    guildId: interaction.guild.id,
                    messageId: `N/A`,
                    participants: partArray,
                    claimedBy: record.claimedBy || null,
                    category: record.category || null,
                    ticketCreatorId: record.ticketCreatorId || null,
                    createdAt: Date.now(),
                },
            }).promise();
        } catch (err) {
            console.error('[finalCloseTicket] Transcript record save failed:', {
                guildId: interaction.guild.id,
                channelId: record.channelId,
                message: err?.message,
            });
            // Orphan S3 object
            reportCriticalFailure(err, 'finalCloseTicket', 'transcript_record_put', {
                guild_id: interaction.guild.id,
                channel_id: record.channelId,
            });
        }
    }

    const hexColor = config.appearance.defaultHexColor.replace('#', '');
    const accentColor = parseInt(hexColor, 16);

    let transcriptDisclaimer = '';
    if (transcriptAvailable) {
        transcriptDisclaimer = ` A copy of your transcript is available below for **90 days** after closure, after which it's permanently deleted.`;
    } else if (config.settings.transcriptsEnabled && transcriptFailed) {
        transcriptDisclaimer = ` A transcript couldn't be generated for this ticket.`;
    }

    const userContainer = new ContainerBuilder().setAccentColor(accentColor);
    const text = new TextDisplayBuilder().setContent(`### ${emojis.ticketresolved.markdown} Thank you for contacting us!

We've enclosed your ticket information for ticket ID number \` ${interaction.channel.id} \` in the server \` ${sanitizeReason(interaction.guild.name, 100)} \` here. If you have any questions, make another ticket to contact us again.

> -# Ticket Lifetime Information:
> ${emojis.materialsymbolsserverpersonround.markdown} Creator: \` ${sanitizeReason(record.ticketCreator, 100)} \`
> ${emojis.help.markdown} Reason: ||\` ${sanitizeReason(record.reason)} \`||
> ${emojis.materialsymbolspersoncheckrounde.markdown} Staff Assisting: \` ${sanitizeReason(record.claimedByFriendly, 100)} \`
> ${emojis.materialsymbolsfolderinforounded.markdown} Category: \` ${sanitizeReason(record.category, 100)} \`

> -# Lifetime Information:
> ${emojis.ticketresolved.markdown} Closed by: \` ${sanitizeReason(closeAuthor, 100)} \` for reason: \` ${sanitizeReason(closeReason)} \`
${force ? `> -# ${emojis.shield.markdown} This ticket was closed without your input via a force-close.` : `> -# ${emojis.shield.markdown} You allowed the closure of this ticket, or you closed it.`}

> -# Didn't go as expected?
> If you need further help, you can reopen this ticket.
-# You are receiving this message as you have made a ticket in an OptiDesk server.${transcriptDisclaimer}`)

    await userContainer.addTextDisplayComponents(text);

    // Offer the creator their own copy
    if (transcriptAvailable) {
        const dmTranscriptButton = new ButtonBuilder()
            .setCustomId(`viewTranscript:${record.channelId}:${interaction.guild.id}`)
            .setLabel('View Transcript')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(emojis.InQueuev2.id);
        userContainer.addActionRowComponents(
            new ActionRowBuilder().addComponents(dmTranscriptButton)
        );
    }

    // DM the ticket creator
    let dmFailed = false;
    try {
        const usertoDM = await interaction.guild.members.fetch(record.ticketCreatorId);
        await usertoDM.send({
            flags: MessageFlags.IsComponentsV2,
            components: [userContainer],
            allowedMentions: { parse: [] }
        })
    } catch (err) {
        console.warn('[finalCloseTicket] Failed to DM ticket creator closure notice:', {
            guildId: interaction.guild.id,
            channelId: record.channelId,
            ticketCreatorId: record.ticketCreatorId,
            message: err?.message,
        });
        dmFailed = true;
    }


    // Closure log
    if (config.layout?.transcriptChannelId) {
        try {
            const transcriptChannel = await interaction.guild.channels.fetch(config.layout.transcriptChannelId);

            const logContainer = new ContainerBuilder().setAccentColor(accentColor);
            const logText = new TextDisplayBuilder().setContent(
                `**Ticket Closed**\n> ${emojis.materialsymbolsserverpersonround.markdown} Creator: \` ${sanitizeReason(record.ticketCreator, 100)} \`\n> ${emojis.help.markdown} Reason: \` ${sanitizeReason(closeReason)} \`\n> ${emojis.materialsymbolspersoncheckrounde.markdown} Claimee: \` ${sanitizeReason(record.claimedByFriendly || 'Unclaimed', 100)} \`\n-# Ticket ID: \` ${record.channelId} \``
            );
            logContainer.addTextDisplayComponents(logText);

            if (transcriptAvailable) {
                const transcriptButton = new ButtonBuilder()
                    .setCustomId(`viewTranscript:${record.channelId}`)
                    .setLabel('View Transcript')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(emojis.InQueuev2.id);

                logContainer.addActionRowComponents(
                    new ActionRowBuilder().addComponents(transcriptButton)
                );
            }

            await transcriptChannel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [logContainer],
                allowedMentions: { parse: [] },
            });
        } catch (err) {
            console.warn('[finalCloseTicket] Failed to post closure log to transcript channel:', {
                guildId: interaction.guild.id,
                channelId: record.channelId,
                transcriptChannelId: config.layout.transcriptChannelId,
                message: err?.message,
            });
        }
    }

    if (record.claimMessageId) {
        const inboxChannelId = record.escalatedInboxId
            || config.layout?.categories?.[record.category]?.inboxId;
        if (inboxChannelId) {
            try {
                const inbox = await interaction.guild.channels.fetch(inboxChannelId);
                const msg = await inbox.messages.fetch(record.claimMessageId);
                await msg.delete();
            } catch (err) {
                console.warn('[finalCloseTicket] Failed to delete claim message during close:', {
                    guildId: interaction.guild.id,
                    channelId: record.channelId,
                    inboxChannelId,
                    claimMessageId: record.claimMessageId,
                    message: err?.message,
                });
            }
        }
    }

    // Delete live record
    const params3 = {
        TableName: TABLE_TICKETS,
        Key: {
          channelId: record.channelId
        }
    };

    try {
        await dynamo.delete(params3).promise()
    } catch(err) {
        console.error('[finalCloseTicket] Deleting ticket record failed:', {
            guildId: interaction.guild.id,
            channelId: record.channelId,
            message: err?.message,
        });
    }

    // Delete channel
    try {
        const thread = await interaction.channel.fetch();
        await thread.delete({
            reason: `Ticket closed - view more information within OptiDesk.`
        })
    } catch (err) {
        console.warn('[finalCloseTicket] Channel delete failed:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });

        await safeFollowUp(interaction, `**An error occurred**\nThe ticket was closed but the channel can't be removed. It could be a permissions problem. Please **do not** retry and delete the channel, and if this continues, contact support.`);

        try {
            await interaction.channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    buildErrorContainer(`**An error occurred**\n${closeAuthor} attempted to close the ticket, but it failed to delete the channel. Please **do not** retry and delete the channel when you're ready.`),
                ]
            });
        } catch (sendErr) {
            console.error('[finalCloseTicket] Failed to send channel-delete failure notice:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                message: sendErr?.message,
            });
        }
    }

    if (!force) { await logEvent("ticketOperations", "info", `**${sanitizeReason(closeAuthor)}** closed the following ticket, with permission:\n> -# Ticket ID: ${record.channelId}\n> Ticket Creator: **${sanitizeReason(record.ticketCreator)}**\n> Reason: \`${sanitizeReason(closeReason)}\``, interaction) }
    else { await logEvent("ticketOperations", "warning", `**${sanitizeReason(closeAuthor)}** closed the following ticket, without permission, using the force-close feature:\n> -# Ticket ID: ${record.channelId}\n> Ticket Creator: **${sanitizeReason(record.ticketCreator)}**\n> Reason: \`${sanitizeReason(closeReason)}\``, interaction) }
}
