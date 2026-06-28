const { dynamo, getTicketByChannel } = require('../utils/db');
const { TABLE_TICKETS } = require('../utils/constants');
const { getGuildConfig } = require('../utils/guildConfig');
const { memberHasCategoryAccess } = require('../utils/categoryAcl');
const { sanitizeReason } = require('../utils/security');
const { logEvent } = require('../utils/logging');
const { MessageFlags } = require('discord.js');

module.exports = async function deleteMsgTicket(interaction) {

    let record;
    try {
        record = await getTicketByChannel(interaction.channel.id);
    } catch (err) {
        console.warn('[deleteMsgTicket] Failed to fetch ticket record:', {
            channelId: interaction.channel?.id,
            message: err?.message,
        });
        return;
    }

    if (!record) {
        return;
    }

    let authorised = false;

    if (interaction.user.id === record.ticketCreatorId) {
        authorised = true;
    }

    if (!authorised && record.closeAuthorId && interaction.user.id === record.closeAuthorId) {
        authorised = true;
    }

    if (!authorised) {
        try {
            const config = await getGuildConfig(interaction.guild.id);
            if (config && memberHasCategoryAccess(interaction.member, config, record.category)) {
                authorised = true;
            }
        } catch (err) {
            console.warn('[deleteMsgTicket] Failed to verify category staff access:', {
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id,
                userId: interaction.user?.id,
                message: err?.message,
            });
        }
    }

    if (!authorised) {
        await interaction.reply({
            content: `**You can't do that.**\nOnly the ticket creator, the staff member who issued this close request, or category staff can cancel it.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferUpdate();

    try {
        await interaction.message.delete();
    } catch (err) {
        console.warn('[deleteMsgTicket] Failed to delete close request message:', {
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id,
            messageId: interaction.message?.id,
            message: err?.message,
        });
    }

    try {
        await dynamo.update({
            TableName: TABLE_TICKETS,
            Key: { channelId: interaction.channel.id },
            UpdateExpression: 'REMOVE closeReason, closeAuthor, closeAuthorId, forcedQuery',
        }).promise();
    } catch (err) {
        console.error('[deleteMsgTicket] Failed to clear close fields:', err);
    }

    await logEvent('ticketActions', 'notice', `**${sanitizeReason(interaction.user.tag)}** cancelled a pending close request.`, interaction);
};
