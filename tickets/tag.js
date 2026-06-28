const { MessageFlags, ContainerBuilder, ThumbnailBuilder, TextDisplayBuilder,
    ButtonBuilder, ComponentType, ActionRowBuilder, SeparatorBuilder,
    SeparatorSpacingSize, SectionBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, ButtonStyle, ChannelType } = require('discord.js');

const { getGuildConfig } = require(`../utils/guildConfig.js`);


// TODO: Overengineered
async function getServerConfig(serverId) {
    return await getGuildConfig(serverId) || null;
}


function findMatchingTag(intellitags, reason) {
    const reasonLower = reason.toLowerCase();

    for (const [tagId, tagConfig] of Object.entries(intellitags)) {
        if (!tagConfig.enabled) continue;

        const keywords = tagConfig.triggerKeywords || [];
        const hasMatch = keywords.some(keyword =>
            reasonLower.includes(keyword.toLowerCase())
        );

        if (hasMatch) {
            return { tagId, config: tagConfig };
        }
    }

    return null;
}


async function sendIntellitagMessage(ticket, tagConfig) {
    const container = new ContainerBuilder()
        .setAccentColor(parseInt(tagConfig.accentColor));

    if (tagConfig.headerImage) {
        const headerAttachment = new MediaGalleryBuilder()
            .addItems((mediaGalleryItem) =>
                mediaGalleryItem
                    .setDescription(tagConfig.headerImage.description)
                    .setURL(tagConfig.headerImage.url)
            );
        container.addMediaGalleryComponents(headerAttachment);
    }

    const separator = new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(false);
    container.addSeparatorComponents(separator);

    const body = new TextDisplayBuilder()
        .setContent(tagConfig.content);
    container.addTextDisplayComponents(body);

    await ticket.send({
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    });
}

function parseQueueBehavior(queueBehavior) {
    if (queueBehavior === "true") return true;
    if (queueBehavior === "false") return false;
    return null;
}


async function tagTicket(ticket, reason) {
    try {
        const serverId = ticket.guild.id;

        const config = await getServerConfig(serverId);

        if (!config || !config.layout || !config.layout.intellitags) {
            return null;
        }

        const intellitags = config.layout.intellitags;

        const match = findMatchingTag(intellitags, reason);

        if (!match) {
            return null;
        }

        await sendIntellitagMessage(ticket, match.config);

        return parseQueueBehavior(match.config.queueBehavior);

    } catch (error) {
        console.error('Error in tagTicket:', error);
        return null;
    }
}

module.exports = {
    tagTicket,
    getServerConfig,
};