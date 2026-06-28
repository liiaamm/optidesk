const { MessageFlags, ContainerBuilder, ThumbnailBuilder, TextDisplayBuilder, ButtonBuilder, ComponentType, ActionRowBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ButtonStyle, ChannelType, permissionOverwrites } = require('discord.js');

module.exports = async function info_securetranscripting(interaction) {
    // You may want to change this for your guild manually.
    await interaction.deferReply({flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2})
    const container = new ContainerBuilder().setAccentColor(0x9DE8E4)
    const text = new TextDisplayBuilder().setContent(`Placehollddeerrr!`) // Add information here about how your transcripting is handled - who you need to see, what are your policies, etc.
    const thumbnail = new ThumbnailBuilder().setURL(`https://files.catbox.moe/3se1ea.png`)

    const section = new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(thumbnail)

    container.addSectionComponents(section)

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    })
}
