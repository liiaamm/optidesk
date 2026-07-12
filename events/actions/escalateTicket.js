const { ActionRowBuilder, MessageFlags,
    ComponentType,
    ButtonBuilder,
    ButtonStyle, ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
} = require('discord.js');
const { dynamo, getTicketByChannel } = require('../../utils/db')
const { TABLE_TICKETS, COLOR_ESCALATE } = require('../../utils/constants');
const { getGuildConfig } = require("../../utils/guildConfig");
const { loadEmojis } = require('../../utils/emojiLoader');
const { checkStaffAccess, sanitizeReason } = require('../../utils/security');
const { safeReply } = require('../../utils/interactionHelper');
const {logEvent} = require("../../utils/logging");

module.exports = async function escalateTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id)
    const emojis = await loadEmojis(interaction.guild.id);

    let sourceRecord;
    try {
        sourceRecord = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.error('[escalateTicket] Failed to fetch ticket record:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please try again in a few minutes.`);
    }
    if (!sourceRecord) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    // Access Control
    if (!await checkStaffAccess(interaction, config, emojis, { category: sourceRecord.category })) return;

    try { await interaction.deferUpdate() } catch {
        // Handled down-line
    }

    const categories = config.layout?.categories;
    if (!categories) {
        await safeReply(interaction, `**An error occurred**\nThere are no categories configured. Please re-run setup and ensure categories are configured with the same names prior to this error. If this is unexpected, or need assistance, please contact support.\n-# Only the Guild Owner and authorised persons can configure OptiDesk.`);
        return;
    }
    const escalationOptions = [];

    if (Object.entries(categories).length <= 1) {
        await interaction.editReply(`${emojis.cancel.markdown} You can't escalate this ticket, because only one or less categories are configured. If you need assistance from a higher rank, consider adding them.`)
        return
    }

    for (const [categoryName, categoryData] of Object.entries(categories)) {
        escalationOptions.push({
            category: categoryName,
            channelId: categoryData?.channelId ?? null,
            inboxId: categoryData?.inboxId ?? null,
            staffRoleId: categoryData?.staffRoleId ?? null,
        });
    }

    const options = escalationOptions.map((opt, index) => ({
        label: opt.category,
        value: index.toString()
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('escalate_ticket_destination')
        .setPlaceholder('Select a destination...')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const reply = await interaction.editReply({ content: `-# ${emojis.escalate.markdown} **${interaction.user.tag}**, who am I escalating this ticket to?`, components: [row] })

    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 30_000, // 30 seconds
        filter: i => i.user.id === interaction.user.id // only allow the button presser, press press
    });

    // Collected a selection
    collector.on('collect', async (i) => {
        try {
            const config = await getGuildConfig(interaction.guild.id)

            const selectedIndex = parseInt(i.values[0]);
            const { category, inboxId, staffRoleId: destStaffRoleId } = escalationOptions[selectedIndex];

            // Access Control
            if (!await checkStaffAccess(i, config, emojis, { category: sourceRecord.category })) return;
            const ticket = await interaction.guild.channels.fetch(interaction.channel.id);

            const record = await getTicketByChannel(interaction.channel.id);

            if (!record) {
                await safeReply(i, `**An error occurred**\nThere's no record for this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
                return;
            }

            if (!record.claimed) {
                await i.reply({
                    flags: MessageFlags.Ephemeral,
                    content: `${emojis.cancel.markdown} This ticket needs to be answered before it can be escalated.`
                })
                return;
            }

            if (record.category === category) {
                await i.reply({
                    flags: MessageFlags.Ephemeral,
                    content: `${emojis.cancel.markdown} You can't escalate this ticket to the same category it's already in.`
                })
                return;
            }

            if (record.escalatedInboxId && record.escalatedInboxId === inboxId) {
                await i.reply({
                    flags: MessageFlags.Ephemeral,
                    content: `${emojis.cancel.markdown} This ticket is already on that panel.`
                })
                return;
            }

            // Clean up previous escalation notification if this ticket was already escalated
            if (record.escalatedInboxId && record.claimMessageId && record.claimMessageId !== 'N/A') {
                try {
                    const prevInbox = await interaction.guild.channels.fetch(record.escalatedInboxId);
                    const prevMsg = await prevInbox.messages.fetch(record.claimMessageId);
                    await prevMsg.delete();
                } catch (err) {
                    console.warn('[escalateTicket] Failed to delete previous escalation notification:', {
                        guildId: interaction.guild.id,
                        channelId: interaction.channel.id,
                        escalatedInboxId: record.escalatedInboxId,
                        claimMessageId: record.claimMessageId,
                        message: err?.message,
                    });
                }
            }

            await i.reply({
                flags: MessageFlags.Ephemeral,
                content: `${emojis.check.markdown} You've escalated the ticket!`
            })

            // Construct new ticket notification
            const containerB = new ContainerBuilder().setAccentColor(COLOR_ESCALATE)
            const destMention = destStaffRoleId ? `<@&${destStaffRoleId}>` : '';
            const header = new TextDisplayBuilder().setContent(`## New Ticket Escalated\n-# ${destMention}\n**${record.ticketCreator}** created a ticket for the following, and it was escalated to this panel by ${i.user}:\n\`\`\`Reason: ${sanitizeReason(record.reason)}\`\`\``)
            const claimTxt = new TextDisplayBuilder().setContent(`If you are able to assist this person, please claim their request below. By claiming this request, you'll be added to the ticket alongside the initial ticket creator **and the previous support representative**, and will assume ownership/have claimed the ticket.`)
            const staffClaimB = new ButtonBuilder()
                .setLabel('Claim')
                .setEmoji(`${emojis.claim.id}`)
                .setStyle(ButtonStyle.Secondary)
                .setCustomId('finalEscalateTicket')

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

            const unclaimedChannel = await interaction.guild.channels.fetch(inboxId);
            const claimMsg = await unclaimedChannel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [containerB],
                fetchReply: true,
                allowedMentions: { roles: destStaffRoleId ? [destStaffRoleId] : [] }
            })
            const channelId = ticket.id
            const updateParams = {
                TableName: TABLE_TICKETS,
                Key: { channelId },
                UpdateExpression: "SET claimMessageId = :cb, escalatedInboxId = :inbox", // Add escalatedInboxId
                ExpressionAttributeValues: {
                    ":cb": claimMsg.id,
                    ":inbox": inboxId // Store the inbox channel ID
                },
                ReturnValues: "ALL_NEW"
            };
            await dynamo.update(updateParams).promise();
            await ticket.send({ content: `-# ${emojis[`escalate-queue`].markdown} *This ticket **has been escalated**.*\nThis request has been escalated to a member of **${category}**. When a member is available, they'll help you further. If you have further questions, you can ask your current support representative.` })
            await collector.stop('done')

            await logEvent("ticketActions", "notice", `**${sanitizeReason(interaction.user.tag)}** escalated a ticket.\n> -# Ticket ID: ${interaction.channel.id}\n> Escalating to: \`${category}\``, interaction)
        } catch (error) {
            console.log(`[WARNING] Escalation failed:`, error);
            await safeReply(i, `**An error occurred**\nSomething went wrong whilst trying to escalate. Try again in a few minutes, and if the error persists, contact support.`);
            return
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'done') return;

        // Disable menu on timeout
        const disabledRow = new ActionRowBuilder().addComponents(
            selectMenu.setDisabled(true)
        );

        try {
            await reply.edit({
                content: `-# ${emojis.cancel.markdown} Request timed out, try again.`,
                components: [disabledRow],
            });
        } catch (err) {
            console.warn('[escalateTicket] Failed to disable timed-out escalation selector:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel?.id,
                message: err?.message,
            });
        }
    });
}
