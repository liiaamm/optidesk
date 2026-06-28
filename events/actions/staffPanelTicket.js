const { MessageFlags, ComponentType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getTicketByChannel } = require('../../utils/db');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getGuildConfig } = require("../../utils/guildConfig");
const  escalateTicket  = require("./escalateTicket")
const  blacklistTicket  = require("./blacklistTicket")
const  relQueueTicket  = require("./relQueueTicket")
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess } = require('../../utils/security');

module.exports = async function staffPanelTicket(interaction) {
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.warn('[staffPanelTicket] Failed to fetch ticket record:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please try again in a few minutes.`);
    }
    if (!record) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    // Access Control
    if (!await checkStaffAccess(interaction, config, emojis, { category: record.category })) return;
    await interaction.deferReply({flags: MessageFlags.Ephemeral})

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('escalate_ticket')
        .setPlaceholder('Select a utility...')
        .addOptions(
            {
            label: `Escalate`,
            description: 'Escalate this ticket to another group.',
            value: 'escalateTicket',
            emoji: `${emojis.escalate.id}`
            },
            {
            label: `Release (Un-Claim)`,
            description: `Remove the claimee and release this ticket into queue.`,
            value: 'relQueueTicket',
            emoji: `${emojis.InQueuev2.id}`
            },
            {
            label: `Blacklist`,
            description: `Force-close the ticket and prevent the user from making further ones.`,
            value: 'blacklistTicket',
            emoji: `${emojis.cancel.id}`
            },
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const reply = await interaction.editReply({ content: `-# ${emojis.staff.markdown} **${interaction.user.tag}**, what's next?`, components: [row], flags: MessageFlags.Ephemeral })


        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 30_000, // 30 seconds
            filter: i => i.customId === 'escalate_ticket'
        });

        // Collected a selection
        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await safeReply(i, `**An error occurred**\nThis staff panel isn't yours. Open your own using the staff panel button.`);
                return;
            }

            const selected = i.values[0];
            try {
                switch (selected) {
                    case 'escalateTicket':
                        await escalateTicket(i);
                        collector.stop('done');
                        break;
                    case 'blacklistTicket':
                        await blacklistTicket(i);
                        collector.stop('done');
                        break;
                    case 'relQueueTicket':
                        await relQueueTicket(i);
                        collector.stop('done');
                        break;
                    default:
                        await i.reply({
                            content: `${emojis.cancel.markdown} That option isn't available right now. If this is unexpected, contact support.`,
                            flags: MessageFlags.Ephemeral
                        });
                }
            } catch (err) {
                console.error('[staffPanelTicket] Selected staff operation failed:', {
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id,
                    selected,
                    userId: i.user.id,
                    message: err?.message,
                });
                await safeReply(i, `**An error occurred**\nThe selected operation failed. Try again in a few minutes, and if the error persists, contact support.`);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'done') return;

            // Disable menu on timeout
            const disabledRow = new ActionRowBuilder().addComponents(
                selectMenu.setDisabled(true)
            );

            try {
                await interaction.editReply({
                    content: `-# ${emojis.cancel.markdown} Request timed out, try again.`,
                    components: [disabledRow],
                });
            } catch (err) {
                console.warn('[staffPanelTicket] Failed to disable timed-out staff panel:', {
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id,
                    messageId: reply.id,
                    message: err?.message,
                });
            }
        });
}
