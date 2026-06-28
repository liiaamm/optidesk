const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require('discord.js');
const { getGuildConfig } = require('../../utils/guildConfig');
const { loadEmojis } = require('../../utils/emojiLoader');
const { orderCategoryNames } = require('../../utils/categoryAcl');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Post a ticket creation panel in a channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to post the panel in (defaults to current channel)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const config = await getGuildConfig(interaction.guild.id);
        if (!config) {
            return await interaction.editReply({ content: '**An error occurred**\nServer configuration not found. Please contact an administrator.' });
        }

        const emojis = await loadEmojis(interaction.guild.id);

        const categories = config.layout?.categories;
        if (!categories || Object.keys(categories).length === 0) {
            return await interaction.editReply({ content: `${emojis.cancel.markdown} No categories are configured. Complete server setup first.` });
        }

        const hexColor = config.appearance.defaultHexColor.replace('#', '');
        const accentColor = parseInt(hexColor, 16);

        const container = new ContainerBuilder().setAccentColor(accentColor);

        // Banner
        const bannerUrl = config.layout?.presets?.openTicket?.banner?.url;
        if (bannerUrl) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(item =>
                    item
                        .setURL(bannerUrl)
                        .setDescription(config.layout.presets.openTicket.banner.altText || 'Support')
                )
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
            );
        }

        // Panel greeting
        const panelMessage =
            config.layout?.presets?.panel?.message ??
            config.layout?.presets?.openTicket?.openTicketMessage;
        if (panelMessage) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(panelMessage)
            );
        }

        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
        );

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${emojis.help.markdown} Select a category to get started`)
        );

        // Category select menu
        const categoryNames = orderCategoryNames(Object.keys(categories), config.layout?.categoryOrder);
        const options = categoryNames.map(name => {
            const cat = categories[name] ?? {};
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(name)
                .setValue(name);
            if (cat.description) option.setDescription(String(cat.description).slice(0, 100));
            if (cat.emoji) option.setEmoji(cat.emoji);
            return option;
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('selectCategory')
            .setPlaceholder('Choose a category...')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
        );

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${config.appearance.footer}`)
        );

        const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;

        await targetChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container],
        });

        await interaction.editReply({
            content: `${emojis.check.markdown} Panel posted in <#${targetChannel.id}>.`,
        });
    },
};
