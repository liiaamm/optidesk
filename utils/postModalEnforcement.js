const { checkUserNetBan, checkServerBan } = require('./enforcement');
const { isServerLicensed } = require('./licensing');
const { consume } = require('./rateLimiter');
const { COSTS, DEFAULT_COST } = require('./rateLimitWeights');
const { safeReply } = require('./interactionHelper');
const { captureEvent, captureException } = require('./telemetry');
const { getConfig } = require('./config');

/**
 * Re-runs configured hosted enforcement, licensing, and local rate limiting
 * against modal submissions. This closes the button-to-modal bypass without
 * forcing hosted OptiDesk checks onto self-hosted installations.
 *
 * @param {import('discord.js').ModalSubmitInteraction} submitted
 * @param {string} key  Rate-limit key
 * @returns {Promise<boolean>} true = all checks passed; false = blocked (reply already sent)
 */
async function enforcePostModalSubmit(submitted, key) {
    const userId = submitted.user.id;
    const guildId = submitted.guildId;
    const cfg = getConfig();

    const isSetup = submitted.customId?.startsWith('setup_');
    const hostedEnforcementOn = cfg.hostedEnforcementEnabled;
    const licensingOn = cfg.licensingEnabled;

    let netBanResult, serverBanResult, licensed;
    try {
        [netBanResult, serverBanResult, licensed] = await Promise.all([
            hostedEnforcementOn ? checkUserNetBan(userId) : Promise.resolve({ success: true, netBan: false }),
            (hostedEnforcementOn && guildId) ? checkServerBan(guildId) : Promise.resolve({ success: true, banned: false }),
            (licensingOn && guildId && !isSetup) ? isServerLicensed(guildId) : Promise.resolve(true),
        ]);
    } catch (err) {
        captureException(err, `user:${userId}`, {
            guildId, context: 'postModalEnforcement', customId: submitted.customId,
        });
        await safeReply(submitted,
            `**Oh no!**\nSomething clicked out of place, and an error slammed OptiDesk in the head, multiple times. Our team has been notified. Try again in a few minutes - and if that doesn't work, contact support.\n-# We understand this can be frustrating. This is probably the cue for a coffee break.`
        );
        return false;
    }

    if (!netBanResult.success || !serverBanResult.success) {
        await safeReply(submitted,
            `**Oh no!**\nSomething clicked out of place, and an error slammed OptiDesk in the head, multiple times. Our team has been notified. Try again in a few minutes - and if that doesn't work, contact support.\n-# We understand this can be frustrating. This is probably the cue for a coffee break.`
        );
        return false;
    }

    if (netBanResult.netBan) {
        await safeReply(submitted,
            `**You can't perform this action.**\nYou have an active enforcement action and are indefinitely restricted from using OptiDesk. For more information, visit: https://optidesk.dev/enf/enforcement-action-landing`
        );
        captureEvent(`user:${userId}`, 'enforcement_netban_blocked', {
            userId, guildId, interactionType: submitted.type, context: 'postModal',
        });
        return false;
    }

    if (serverBanResult.banned) {
        await safeReply(submitted,
            `**You can't perform this action.**\nThis server has been banned from using OptiDesk. For more information, visit: https://optidesk.dev/enf/nonstandard-enforcement-action-landing`
        );
        captureEvent(`guild:${guildId}`, 'enforcement_serverban_blocked', {
            guildId, interactionType: submitted.type, context: 'postModal',
        });
        return false;
    }

    if (!licensed) {
        await safeReply(submitted,
            `**You can't perform this action.**\nThis server is unlicensed! You'll need to purchase a license to OptiDesk, or allocate an existing one onto this server.`
        );
        return false;
    }

    const cost = COSTS[key] ?? DEFAULT_COST;
    if (cfg.rateLimitEnabled && cost > 0) {
        const result = consume(userId, key, cost);
        if (!result.allowed) {
            const retrySeconds = Math.ceil(result.retryAfterMs / 1000);
            await safeReply(submitted,
                `**You're doing that too fast!**\nTry again in ${retrySeconds}s.`
            );
            captureEvent(`user:${userId}`, 'enforcement_cooldown_hit', {
                userId, guildId, commandName: key,
                baseCost: cost, effectiveCost: result.effectiveCost, context: 'postModal',
            });
            return false;
        }
    }

    return true;
}

module.exports = { enforcePostModalSubmit };
