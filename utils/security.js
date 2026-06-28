const { MessageFlags } = require('discord.js');
const { posthog } = require('./db');
const { getConfig } = require('./config');
const { memberHasCategoryAccess } = require('./categoryAcl');
const {logEvent} = require("./logging");

const STRIP_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Checks whether the member is authorised to act on a ticket in the given
 * category. Replies with a denial message and returns false on failure
 *
 * Access is granted if any of the following hold:
 *   - The member is the guild owner
 *   - The member has access.supervisorRoleID (cross-cutting super-admin)
 *   - The member has the category's supervisorRoleId
 *   - (when requireSupervisor is false) the member has the category's staffRoleId
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} config - Guild config
 * @param {object} emojis - Loaded emoji set (needs cancel.markdown)
 * @param {{ category: string, requireSupervisor?: boolean }} opts
 * @returns {Promise<boolean>} true if authorised, false if denied (reply already sent)
 */
async function checkStaffAccess(interaction, config, emojis, opts = {}) {
    const { category, requireSupervisor = false, supervisorPreferred = false } = opts;
    try {
        if (!memberHasCategoryAccess(interaction.member, config, category, { requireSupervisor, supervisorPreferred })) {
            const payload = {
                content: `${emojis.cancel.markdown} You lack permissions to do this.`,
                flags: MessageFlags.Ephemeral
            };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload);
            } else {
                await interaction.reply(payload);
            }
            await logEvent("accessControl", "notice", `**${sanitizeReason(interaction.user.tag)}** attempted to execute a command that they do not have the permissions for.`, interaction)
            try {
                if (getConfig().posthogEnabled) {
                    posthog.capture({
                        distinctId: `user:${interaction.user.id}`,
                        event: 'access_denied',
                        properties: {
                            userId: interaction.user.id,
                            guildId: interaction.guildId,
                            interactionId: interaction.id,
                            category: category ?? null,
                            requireSupervisor,
                        },
                    });
                }
            } catch (err) {
                console.warn('[security] Failed to capture access_denied event:', {
                    guildId: interaction.guildId,
                    userId: interaction.user.id,
                    message: err?.message,
                });
            }
            return false;
        }
    } catch (err) {
        console.warn('[security] Staff access check failed:', {
            guildId: interaction.guildId,
            userId: interaction.user?.id,
            category,
            requireSupervisor,
            message: err?.message,
        });
        const payload = {
            content: `${emojis.cancel.markdown} I wasn't able to verify your identity. Please try again in a moment. If this persists, contact OptiDesk support.`,
            flags: MessageFlags.Ephemeral
        };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
        return false;
    }
    return true;
}

/**
 * 
 * AI generated, but reviewed by man.
 * Sanitises free-text user input that will be wrapped in a Discord code block.
 *
 * Strips, in order:
 *   1. Backticks — prevent ``` fence break-out.
 *   2. ASCII C0 control chars (U+0000–U+001F) and DEL (U+007F).
 *   3. Unicode bidi overrides, zero-width chars, soft hyphen, and BOM —
 *      prevents visual spoofing via direction-override or invisible characters
 *      (U+00AD, U+200B–U+200D, U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF).
 *
 * Pair with the global Client `allowedMentions: { parse: ['users','roles'] }`
 * setting — together they prevent mention break-out and visual spoofing via
 * crafted usernames or reasons.
 *
 * @param {string} input - Raw user text (e.g. ticket reason, close reason).
 * @param {number} maxLen - Hard length cap to enforce.
 * @returns {string}
 */
function sanitizeReason(input, maxLen = 200) {
    if (typeof input !== 'string') return '';
    const cleaned = input
        .replace(/`/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(STRIP_RE, '')
        .trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

module.exports = { checkStaffAccess, sanitizeReason };
