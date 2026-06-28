const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
const { COLOR_ERROR } = require('./constants');

/**
 * Builds the standard error container used across OptiDesk.
 * Matches the pattern in interactionCreate.js (enforcement/licensing errors).
 *
 * @param {string} textContent - The text to display
 * @param {number} accentColor - Container accent colour
 * @returns {{ container: ContainerBuilder, components: Array }} 
 */
function buildErrorContainer(textContent, accentColor = COLOR_ERROR) {
    const container = new ContainerBuilder().setAccentColor(accentColor);
    const text = new TextDisplayBuilder().setContent(textContent);
    container.addTextDisplayComponents(text);
    return container;
}

/**
 * Safely replies to an interaction regardless of its current state
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} textContent - Error message text
 * @param {object} options
 * @param {number} options.accentColor - Container accent colour
 * @param {ActionRowBuilder|null} options.actionRow - Optional action row for recovery buttons
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function safeReply(interaction, textContent, { accentColor = COLOR_ERROR, actionRow = null } = {}) {
    try {
        const container = buildErrorContainer(textContent, accentColor);
        const components = [container];
        if (actionRow) components.push(actionRow);

        const payload = {
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components
        };

        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(payload);
        } else {
            return await interaction.reply(payload);
        }
    } catch {
        // Interaction expired or otherwise invalid — nothing we can do
        return null;
    }
}

/**
 * Safely sends a follow-up to an interaction. Use when the main reply slot is already taken
 * and you need to send an additional error/warning message.
 * Never throws - at least we think.
 */
async function safeFollowUp(interaction, textContent, { accentColor = COLOR_ERROR, actionRow = null } = {}) {
    try {
        const container = buildErrorContainer(textContent, accentColor);
        const components = [container];
        if (actionRow) components.push(actionRow);

        return await interaction.followUp({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components
        });
    } catch {
        return null;
    }
}

module.exports = { safeReply, safeFollowUp, buildErrorContainer };
