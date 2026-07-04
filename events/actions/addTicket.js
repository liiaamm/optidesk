const { MessageFlags, ComponentType, ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getGuildConfig } = require("../../utils/guildConfig");
const { getTicketByChannel } = require('../../utils/db');
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess, sanitizeReason} = require('../../utils/security');
const { memberHasCategoryAccess } = require('../../utils/categoryAcl');
const { logEvent } = require('../../utils/logging');

const funnyResponses = [
    "Brace yourself.",
    "Oh great, now we have witnesses.",
    "Hope they enjoy reading logs.",
    "May the tickets be with them.",
    "Finally, some extra hands!",
    "Uh oh.",
    "Did they bring their A-game?",
    "I hope they like paperwork.",
    "The more the merrier! (and louder)",
    "I need a coffee.",
]

const placeholderResponses = [
    "Who's the fortunate one?",
    "Choose wisely.",
    "Summon a hero!",
    "Who's coming to the rescue?",
    "The fate of the ticket awaits...",
    "Call in backup!",
    "Requesting 10-32s...",
    "The ticket needs a legend...",
    "Who's joining the fun?",
]

module.exports = async function addTicket(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    const emojis = await loadEmojis(interaction.guild.id);

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.warn('[addTicket] Failed to fetch ticket record:', {
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

    await interaction.deferReply({})

    const menu = new UserSelectMenuBuilder()
        .setCustomId('ticket_add')
        .setPlaceholder('Select a user...')
        .setMaxValues(1)
    const row = new ActionRowBuilder().addComponents(menu);
    
    // Prompt user with the menu
    const reply = await interaction.editReply({ content: `-# ${emojis.add.markdown} **${interaction.user.tag}**, who am I adding to this ticket?`, components: [row] })

    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.UserSelect,
        time: 30_000, // 30 seconds
        filter: i => i.user.id === interaction.user.id // only the person who initiated it
    });

    // Collected a selection
    collector.on('collect', async (i) => {
        const user = i.users.first();

        try {
            await interaction.channel.members.fetch({ member: user.id, force: true });
            await i.reply({ content: `${emojis.cancel.markdown} **${user.tag}** is already in this ticket.`, flags: MessageFlags.Ephemeral });
            return;
        } catch (err) {
            if (err?.status !== 404) {
                console.error('[addTicket] Membership pre-check failed (non-404):', err?.message ?? err);
            }
        }

        // Restrict to staff-only if the guild has opted in
        if (config.settings.addNonStaffToTickets === false) {
            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(user.id);
            } catch (err) {
                console.warn('[addTicket] Failed to fetch selected guild member:', {
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id,
                    userId: user.id,
                    message: err?.message,
                });
            }
            if (!memberHasCategoryAccess(targetMember, config, record.category)) {
                await i.reply({ content: `This server prohibits adding non-staff members to tickets. Please contact server management.`, flags: MessageFlags.Ephemeral });
                return;
            }
        }

        try {
            await interaction.channel.members.add(user.id);
        } catch (err) {
            console.warn('[addTicket] Failed to add user to ticket thread:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                userId: user.id,
                message: err?.message,
            });
            await safeReply(i, `**An error occurred**\nI couldn't add the user. This may be due to a permissions issue. Check that the OptiDesk bot has the adequate permissions, then try again.`);
            return;
        }

        await i.reply({ content: `${emojis.add.markdown} I've added ${user} to the ticket!`, flags: MessageFlags.Ephemeral })
        const funnySuffix = config.appearance?.funnyResponses === true ? ` ${funnyResponses[Math.floor(Math.random() * funnyResponses.length)]}` : '';
        await interaction.channel.send({ content: `-# ${emojis.add.markdown} *Someone's joined!*\n${interaction.user} has added ${user} to this ticket.${funnySuffix}` })

        try {
            await reply.delete()
        } catch (err) {
            console.warn('[addTicket] Failed to delete add-user prompt:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: reply.id,
                message: err?.message,
            });
        }

        await logEvent("ticketActions", "notice", `**${sanitizeReason(interaction.user.tag)}** added **${sanitizeReason(user.tag)}** to the following ticket:\n> -# Ticket ID: ${interaction.channel.id}\n> Ticket Creator: **${sanitizeReason(record.ticketCreator)}**`, interaction)
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'done') return;

        // Disable menu on timeout
        const disabledRow = new ActionRowBuilder().addComponents(
            menu.setDisabled(true)
        );

        try {
            await reply.edit({
                content: `-# ${emojis.cancel.markdown} Request timed out, try again.`,
                components: [disabledRow],
            });
        } catch (err) {
            console.warn('[addTicket] Failed to disable timed-out add-user selector:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: reply.id,
                message: err?.message,
            });
        }
    });
}
