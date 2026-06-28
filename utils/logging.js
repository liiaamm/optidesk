const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js')
const { getGuildConfig } = require('./guildConfig.js')



const levelMessages = {
    info: "<:log_info:1504081315161702430> Info",
    notice: "<:log_notice:1504081313336922182> Notice",
    warning: "<:log_warning:1504081310396977162> Warning",
    critical: "<:log_critical:1504081306437554268> Critical",
    emergency: "<:log_emergency:1504081304814354572> Emergency"
}

const levelAccentColours = {
    info: 0x9de9f3,
    notice: 0x9db2f3,
    warning: 0xf1f39d,
    critical: 0xf49d9d,
    emergency: 0xf49d9d
}


const serviceMessages = {
    ticketOperations: "<:log_ticketOperations:1504433334808477766> Ticket Operations", // General/high-level ticket operations (opening, closure)
    ticketActions: "<:log_ticketActions:1504433332669124678> Ticket Actions", // Intermediate ticket operations (adding, removing people)
    administration: "<:log_administration:1504433331041861682> Administration & Settings",
    transcription: "<:log_transcription:1504433329087451146> Transcription",
    integrations: "<:log_integrations:1504433325027360840> Integrations",
    accessControl: "<:log_accessControl:1504433326755287042> Access Control & Restrictions"
}

async function logEvent(service, level, event, interaction) {
    if (!interaction.guild) return { success: false, reason: 'No guild' }

    const config = await getGuildConfig(interaction.guild.id)

    if (!config.settings.loggingEnabled || !config.layout.loggingChannelId) {
        return { success: false, reason: 'Unconfigured' }
    }

    if (!serviceMessages[service] || !levelMessages[level]) {
        return { success: false, reason: 'Malformed request' }
    }

    const logContainer = new ContainerBuilder().setAccentColor(levelAccentColours[level])
    const header = new TextDisplayBuilder().setContent(`-# ${levelMessages[level]}    |    ${serviceMessages[service]}`)
    const body = new TextDisplayBuilder().setContent(event)
    logContainer.addTextDisplayComponents(header, body)

    let logChannel
    try {
        logChannel = await interaction.guild.channels.fetch(config.layout.loggingChannelId)
    } catch (err) {
        console.warn('[logging] Failed to fetch logging channel:', {
            guildId: interaction.guild.id,
            loggingChannelId: config.layout.loggingChannelId,
            message: err?.message,
        })
        return { success: false, reason: 'Unconfigured' }
    }

    try {
        await logChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [logContainer],
            allowedMentions: { parse: [] },
        })
        return { success: true }
    } catch (err) {
        console.warn('[logging] Failed to send log event:', {
            guildId: interaction.guild.id,
            loggingChannelId: config.layout.loggingChannelId,
            service,
            level,
            message: err?.message,
        })
        return { success: false, reason: 'Failure' }
    }
}


module.exports = {
    logEvent
}
