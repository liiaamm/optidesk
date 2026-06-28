const { Events } = require('discord.js');
const { captureEvent } = require('../utils/telemetry');

module.exports = {
    name: Events.GuildDelete,
    async execute(guild) {
        // guild.available is false during a Discord outage
        if (guild.available === false) return;
        captureEvent(`guild:${guild.id}`, 'bot_removed_from_guild', {
            guild_id: guild.id,
            guild_name: guild.name,
        });
    },
};
