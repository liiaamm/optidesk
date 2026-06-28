const { MessageFlags, ComponentType, ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const { getTicketByChannel } = require('../../utils/db');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getGuildConfig } = require("../../utils/guildConfig");
const { safeReply } = require('../../utils/interactionHelper');
const { checkStaffAccess, sanitizeReason} = require('../../utils/security');
const {logEvent} = require("../../utils/logging");

module.exports = async function removeTicket(interaction) {
    const emojis = await loadEmojis(interaction.guild.id);
    const config = await getGuildConfig(interaction.guild.id);

    let outerRecord;
    try {
        outerRecord = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.warn('[removeTicket] Failed to fetch ticket record:', {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: err?.message,
        });
        return await safeReply(interaction, `**An error occurred**\nI couldn't fetch this ticket. Please try again in a few minutes.`);
    }
    if (!outerRecord) {
        return await safeReply(interaction, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
    }

    // Access Control
    if (!await checkStaffAccess(interaction, config, emojis, { category: outerRecord.category })) return;

    await interaction.deferReply({})

    const menu = new UserSelectMenuBuilder()
        .setCustomId('ticket_remove')
        .setPlaceholder(`Select a user...`)
        .setMaxValues(1)
    const row = new ActionRowBuilder().addComponents(menu);
    const reply = await interaction.editReply({ content: `-# ${emojis.remove.markdown} **${interaction.user.tag}**, who am I removing from this ticket?`, components: [row] })

    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.UserSelect,
        time: 30_000, // 30 seconds
        filter: i => i.user.id === interaction.user.id // only allow the button presseeee
    });

    // Collected a selection
    collector.on('collect', async (i) => {
        let record;
        try {
            record = await getTicketByChannel(interaction.channel.id);
        } catch (err) {
            console.warn('[removeTicket] Failed to refresh ticket record:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                message: err?.message,
            });
            await safeReply(i, `**An error occurred**\nI couldn't fetch this ticket. Please check the OptiDesk outage page and our official Discord. Try again in a few minutes, and if the error still persists, contact support.`);
            return;
        }

        if (!record) {
            await safeReply(i, `**An error occurred**\nThere's no record for this ticket. Try again in a few minutes, and if the error still persists, contact support.`);
            return;
        }


        // Ensue protections:
        const user = i.users.first();
        let ownerId;
        try {
            ownerId = (await i.guild.fetchOwner()).id;
        } catch (err) {
            console.warn('[removeTicket] Failed to fetch guild owner:', {
                guildId: i.guild.id,
                channelId: interaction.channel.id,
                message: err?.message,
            });
            await safeReply(i, `**An error occurred**\nAn error on Discord's side has occurred and we can't find the owner of this server. Try again in a few minutes.`);
            return;
        }
        if (i.user.id === user.id) {
            await i.reply({ content: `${emojis.cancel.markdown} You can't remove yourself. Try again.`, flags: MessageFlags.Ephemeral })
            return
        }
        if (user.id === ownerId) {
            await i.reply({ content: `${emojis.cancel.markdown} You can't remove the guild owner. I hope that makes sense.`, flags: MessageFlags.Ephemeral })
            return
        }

        if (user.id === record.ticketCreatorId) {
            await i.reply({ content: `${emojis.cancel.markdown} For extremely obvious reasons, you can't remove the ticket creator.`, flags: MessageFlags.Ephemeral })
            return
        }

        if (user.id === record.claimedBy) {
            await i.reply({ content: `${emojis.cancel.markdown} This user has claimed the ticket. To remove them, you must release the ticket first.`, flags: MessageFlags.Ephemeral })
            return
        }
        if (user.id === interaction.client.user?.id) {
            await i.reply({ content: `${emojis.cancel.markdown} You're not going to believe this, but it turns out, you can't remove OptiDesk from an OptiDesk ticket.`, flags: MessageFlags.Ephemeral })
            return
        }

        try {
            await interaction.channel.members.fetch({ member: user.id, force: true });
        } catch (err) {
            if (err?.status === 404) {
                await i.reply({ content: `${emojis.cancel.markdown} **${user.tag}** isn't in this ticket.`, flags: MessageFlags.Ephemeral });
                return;
            }
            console.error('[removeTicket] Membership pre-check failed (non-404):', err?.message ?? err);
        }

        const targetMember = await i.guild.members.fetch(user.id).catch((err) => {
            console.warn('[removeTicket] Failed to fetch selected guild member:', {
                guildId: i.guild.id,
                channelId: interaction.channel.id,
                userId: user.id,
                message: err?.message,
            });
            return null;
        });
        const canRejoin = targetMember && (
            targetMember.permissions.has('Administrator') ||
            targetMember.permissions.has('ManageThreads')
        );

        // Remove the user FIRST, then confirm
        try {
            await interaction.channel.members.remove(user.id);
        } catch (err) {
            console.warn('[removeTicket] Failed to remove user from ticket thread:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                userId: user.id,
                message: err?.message,
            });
            await safeReply(i, `**An error occurred**\nI couldn't remove the user from the ticket. This may be due to a permissions issue. Check that the OptiDesk bot has the adequate permissions, then try again.`);
            return;
        }

        await i.reply({ content: `${emojis.remove.markdown} I've removed ${user} from the ticket!`, flags: MessageFlags.Ephemeral })
        await interaction.channel.send({ content: `-# ${emojis.remove.markdown} *Someone's left!*\n${interaction.user} has removed **${user.tag}** from this ticket.${canRejoin ? `\n-# ${emojis.secondarywarning.markdown} *This user has elevated server permissions and may be able to rejoin the ticket.*` : ''}` })

        try {
            await reply.delete()
        } catch (err) {
            console.warn('[removeTicket] Failed to delete remove-user prompt:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: reply.id,
                message: err?.message,
            });
        }

        await logEvent("ticketActions", "notice", `**${sanitizeReason(interaction.user.tag)}** removed **${sanitizeReason(user.tag)}** from the following ticket:\n> -# Ticket ID: ${interaction.channel.id}\n> Ticket Creator: **${sanitizeReason(record.ticketCreator)}**`, interaction)
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
            console.warn('[removeTicket] Failed to disable timed-out remove-user selector:', {
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: reply.id,
                message: err?.message,
            });
        }
    });
}
