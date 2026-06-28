const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, TextDisplayBuilder } = require('discord.js')
const { openTicket } = require(`../../tickets/open`)
const { getGuildConfig } = require('../../utils/guildConfig')
const { enforcePostModalSubmit } = require('../../utils/postModalEnforcement')

module.exports = async function buttonCategoryHandler(interaction) {
    const config = await getGuildConfig(interaction.guild.id);

    const modalIntro = config?.layout?.presets?.panel?.modalIntro
        ?? `When you submit this form, we'll open up a ticket for you. **Please follow [nohello.net](https://nohello.net) and put an appropriate reason in the box below.**`;

    const modal = new ModalBuilder().setCustomId('tktModal').setTitle('Open a Request');

    const text = new TextDisplayBuilder().setContent(modalIntro);

    const reasonInput = new TextInputBuilder()
        .setCustomId('reasonInput')
        .setPlaceholder("Add a descriptive reason...")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(100);

    const reasonLabel = new LabelBuilder()
        .setLabel("Why are you opening this ticket?")
        .setTextInputComponent(reasonInput);

    await modal.addTextDisplayComponents(text);
    await modal.addLabelComponents(reasonLabel);
    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'tktModal',
        time: 120000
    }).catch(() => null);
    if (!submitted) return;
    if (!await enforcePostModalSubmit(submitted, 'openTicketModal')) return;

    const reason = submitted.fields.getTextInputValue('reasonInput');

    let category;
    if (interaction.isStringSelectMenu()) {
        category = interaction.values[0];
    } else if (interaction.customId.startsWith('buttonCategory_')) {
        category = interaction.customId.slice('buttonCategory_'.length);
    } else {
        category = 'Staff Support';
    }

    await openTicket(submitted, category, reason);
}
