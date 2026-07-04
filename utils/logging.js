const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js')
const { getGuildConfig } = require('./guildConfig.js')



const levelMessages = {
    info: "Info",
    notice: "Notice",
    warning: "Warning",
    critical: "Critical",
    emergency: "Emergency"
}

const levelAccentColours = {
    info: 0x9de9f3,
    notice: 0x9db2f3,
    warning: 0xf1f39d,
    critical: 0xf49d9d,
    emergency: 0xf49d9d
}


const serviceMessages = {
    ticketOperations: "Ticket Operations", // General/high-level ticket operations (opening, closure)
    ticketActions: "Ticket Actions", // Intermediate ticket operations (adding, removing people)
    administration: "Administration & Settings",
    transcription: "Transcription",
    integrations: "Integrations",
    accessControl: "Access Control & Restrictions"
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
