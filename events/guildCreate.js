const { Events } = require('discord.js');
const { identifyGuild, captureEvent } = require('../utils/telemetry');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        identifyGuild(guild.id, {
            name: guild.name,
            member_count: guild.memberCount,
            owner_id: guild.ownerId,
            preferred_locale: guild.preferredLocale,
            joined_at: new Date().toISOString(),
        });
        captureEvent(`guild:${guild.id}`, 'bot_added_to_guild', {
            guild_id: guild.id,
            guild_name: guild.name,
            member_count: guild.memberCount,
        });
    },
};
