const { Events } = require('discord.js');
const { dynamo, getTicketByChannel } = require('../utils/db');
const { captureEvent } = require('../utils/telemetry');
const { TABLE_TICKETS } = require('../utils/constants');
const { logEvent } = require('../utils/logging');

module.exports = {
    name: Events.ThreadDelete,
    async execute(channel) {
        if (!channel.guild) return;

        const channelId = channel.id;
        const guildId = channel.guild.id;

        let record;
        try {
            record = await getTicketByChannel(channelId);
        } catch (err) {
            console.log(`[WARNING] channelDelete: Failed to query ticket record for channel ${channelId}: ${err}`);
            return;
        }

        // Not an OptiDesk ticket
        if (!record) return;

        // Delete the orphaned live ticket record
        try {
            await dynamo.delete({
                TableName: TABLE_TICKETS,
                Key: { channelId }
            }).promise();
            console.log(`[CLEANUP] channelDelete: Removed orphaned ticket record for channel ${channelId} in guild ${guildId} (creator: ${record.ticketCreator})`);
        } catch (err) {
            console.log(`[WARNING] channelDelete: Failed to delete orphaned ticket record for channel ${channelId}: ${err}`);
            return;
        }

        // Telemetry
        captureEvent(`guild:${guildId}`, 'ticket_channel_deleted_externally', {
            channelId,
            guildId,
        });

        await logEvent('ticketOperations', 'warning',
            `A ticket thread was deleted externally, bypassing the OptiDesk close process.\n> -# Ticket ID: ${channelId}\n> Ticket Creator: **${record.ticketCreator}**`,
            { guild: channel.guild }
        );
    }
};
