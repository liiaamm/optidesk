const { Events, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { checkUserNetBan, netBanUser, checkServerBan } = require('../utils/enforcement');
const { isServerLicensed } = require('../utils/licensing');
const { captureEvent, captureException, identifyGuild, hasIdentifiedGuild } = require('../utils/telemetry');
const { consume } = require('../utils/rateLimiter');
const { resolveCost } = require('../utils/rateLimitWeights');
const { DEV_HOME_GUILD_ID, COLOR_ERROR } = require('../utils/constants');
const { IS_DEV, getConfig } = require('../utils/config');

const claimTicket             = require('./operations/claimTicket');
const queueTicket             = require('./operations/queueTicket');
const closeTicket             = require('./operations/closeTicket');
const finalCloseTicket        = require('./operations/finalCloseTicket');
const info_securetranscripting = require('./info/info_securetranscripting');
const viewTranscript           = require('./info/viewTranscript');
const forceCloseQueryTicket   = require('./operations/forceCloseQueryTicket');
const addTicket               = require('./actions/addTicket');
const removeTicket            = require('./actions/removeTicket');
const integrationsTicket      = require('./operations/integrationsTicket');
const requestCloseQueryTicket = require('./operations/requestCloseQueryTicket');
const requestCloseTicket      = require('./operations/requestCloseTicket');
const escalateTicket          = require('./actions/escalateTicket');
const finalEscalateTicket     = require('./operations/finalEscalateTicket');
const deleteMsgTicket         = require('./deleteMsgTicket');
const buttonCategoryHandler   = require('./operations/buttonCategoryHandler');
const staffPanelTicket        = require('./actions/staffPanelTicket');
const blacklistTicket         = require('./actions/blacklistTicket');
const {logEvent} = require("../utils/logging");
const {sanitizeReason} = require("../utils/security");

const buttonHandlers = {
    claimTicket,
    queueTicket,
    closeTicket,
    finalCloseTicket,
    info_securetranscripting,
    viewTranscript,
    forceCloseQueryTicket,
    addTicket,
    removeTicket,
    integrationsTicket,
    intergrationsTicket: integrationsTicket,
    requestCloseQueryTicket,
    requestCloseTicket,
    escalateTicket,
    deleteMsgTicket,
    finalEscalateTicket,
    buttonCategoryHandler,
    selectCategory: buttonCategoryHandler,
    staffPanelTicket,
    blacklistTicket,
};

// --- Middleware ---

function passesDevGate(interaction) { // Staging!
    // if (interaction.user.id !== DEV_OWNER_ID) return false;
    if (interaction.guild && interaction.guild.id !== DEV_HOME_GUILD_ID) return false;
    return true;
}

// Single-tenant hard-scope
function passesGuildScope(interaction) {
    const cfg = getConfig();
    if (!cfg.singleTenant) return true;
    if (interaction.guild && interaction.guild.id !== cfg.guildId) return false;
    return true;
}

function buildBlockContainer(text, color) {
    const container = new ContainerBuilder().setAccentColor(color);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    return container;
}

async function checkBansLookup(interaction) {
    const cfg = getConfig();
    if (!cfg.hostedEnforcementEnabled) {
        return {
            RnetBan:    { success: true, netBan: false },
            RserverBan: { success: true, banned: false },
        };
    }

    const [RnetBan, RserverBan] = await Promise.all([
        checkUserNetBan(`${interaction.user.id}`),
        interaction.guildId ? checkServerBan(`${interaction.guildId}`) : Promise.resolve({ success: true, banned: false })
    ]);
    return { RnetBan, RserverBan };
}

async function applyBansResult(interaction, { RnetBan, RserverBan }) {
    if (RnetBan.netBan) {
        await interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [buildBlockContainer(
                `**You can't perform this action.**\nYou have an active enforcement action and are indefinitely restricted from using OptiDesk. For more information, visit: https://optidesk.dev/enf/enforcement-action-landing`,
                COLOR_ERROR
            )]
        });
        captureEvent(`user:${interaction.user.id}`, 'enforcement_netban_blocked', {
            userId: interaction.user.id, guildId: interaction.guildId, interactionType: interaction.type
        });
        return false;
    }

    if (RserverBan.banned) {
        await interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [buildBlockContainer(
                `**You can't perform this action.**\nThis server has been banned from using OptiDesk. For more information, visit: https://optidesk.dev/enf/nonstandard-enforcement-action-landing`,
                COLOR_ERROR
            )]
        });
        captureEvent(`guild:${interaction.guildId}`, 'enforcement_serverban_blocked', {
            guildId: interaction.guildId, interactionType: interaction.type
        });
        return false;
    }

    return true;
}

async function applyLicenseResult(interaction, licensed) {
    if (!licensed) {
        await interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [buildBlockContainer(
                `**You can't perform this action.**\nThis server is unlicensed! You'll need to purchase a license to OptiDesk, or allocate an existing one onto this server.`,
                COLOR_ERROR
            )]
        });
        return false;
    }

    return true;
}

const AUTO_NETBAN_THRESHOLD = 60;

async function checkRateLimit(interaction) {
    const cfg = getConfig();
    if (!cfg.rateLimitEnabled) return true;

    const userId = interaction.user.id;
    const key = interaction.commandName || interaction.customId || 'unknown';
    const cost = resolveCost(interaction);
    if (cost === 0) return true;

    const result = consume(userId, key, cost);
    if (result.allowed) return true;

    const retrySeconds = Math.ceil(result.retryAfterMs / 1000);
    await interaction.reply({
        content: `⚠️ You're doing that too fast! Try again in ${retrySeconds}s.`,
        flags: MessageFlags.Ephemeral,
    });
    captureEvent(`user:${userId}`, 'enforcement_cooldown_hit', {
        userId,
        guildId: interaction.guildId,
        commandName: key,
        baseCost: cost,
        effectiveCost: result.effectiveCost,
    });
    captureEvent(`user:${userId}`, 'enforcement_abuse_increment', {
        userId,
        guildId: interaction.guildId,
        abuseCount: result.abuseCount,
    });

    if (result.abuseCount >= AUTO_NETBAN_THRESHOLD && cfg.hostedEnforcementEnabled) {
        const { netBan: alreadyBanned } = await checkUserNetBan(userId);
        if (alreadyBanned) return false;

        await netBanUser(userId, `[Automatic] Consistent abuse of OptiDesk limits`, `Automatic enforcement action`);
        captureEvent(`user:${userId}`, 'enforcement_auto_netban', {
            userId,
            guildId: interaction.guildId,
            reason: '[Automatic] Consistent abuse of OptiDesk limits',
        });
        await interaction.followUp({
            content: `You've been automatically banned from OptiDesk. Contact support.`,
            flags: MessageFlags.Ephemeral,
        });
        await logEvent("accessControl", "critical", `**${sanitizeReason(interaction.user.tag)}** has been flagged by an automated system for consistent abuse of OptiDesk, and has been banned. The affected member will need to contact OptiDesk Enforcement via email to resolve the issue.\n*This log has been forwarded to our monitoring centre.*`, interaction)
    }

    return false;
}

async function routeInteraction(interaction) {
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }
        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(`Error executing ${interaction.commandName}:`, err);
        }
    } else if (interaction.isButton()) {
        let handler = buttonHandlers[interaction.customId];
        if (!handler && interaction.customId.startsWith('buttonCategory_')) {
            handler = buttonHandlers.buttonCategoryHandler;
        }
        if (!handler && interaction.customId.startsWith('viewTranscript:')) {
            handler = buttonHandlers.viewTranscript;
        }
        if (handler) {
            try {
                await handler(interaction);
            } catch (err) {
                console.error(`Error handling button "${interaction.customId}":`, err);
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        const handler = buttonHandlers[interaction.customId];
        if (handler) {
            try {
                await handler(interaction);
            } catch (err) {
                console.error(`Error handling select "${interaction.customId}":`, err);
            }
        }
    }
}

// --- Event handler ---

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        const traceId = `interaction-${interaction.id}`;
        const guildId = interaction.guildId ? `guild:${interaction.guildId}` : 'dm';

        const startTime = Date.now();

        try {
            if (interaction.isModalSubmit()) return;
            if (IS_DEV && !passesDevGate(interaction)) return;
            if (!passesGuildScope(interaction)) return;

            // Run the checks in parallel so we save time

            const cfg = getConfig();
            const isSetup = interaction.commandName === 'setup' || interaction.customId?.startsWith('setup_');
            const licensingOn = cfg.licensingEnabled;
            const [bansOk, licenseLookup] = await Promise.all([
                checkBansLookup(interaction),
                (!interaction.guildId || isSetup || !licensingOn) ? Promise.resolve({ skip: true }) : isServerLicensed(interaction.guildId).then(licensed => ({ licensed })),
            ]);

            // Telemetry
            if (interaction.guild && !hasIdentifiedGuild(interaction.guildId)) {
                identifyGuild(interaction.guildId, {
                    name: interaction.guild.name,
                    member_count: interaction.guild.memberCount,
                    owner_id: interaction.guild.ownerId,
                    preferred_locale: interaction.guild.preferredLocale,
                });
            }

            captureEvent(guildId, 'interaction_started', {
                trace_id: traceId,
                interaction_type: interaction.type,
                command_name: interaction.commandName,
                ...(interaction.customId != null && { custom_id: interaction.customId }),
                is_dm: !interaction.guildId,
            });

            if (!await applyBansResult(interaction, bansOk)) return;
            if (!licenseLookup.skip && !await applyLicenseResult(interaction, licenseLookup.licensed)) return;
            if (!await checkRateLimit(interaction)) return;

            await routeInteraction(interaction);

            captureEvent(guildId, 'interaction_completed', {
                trace_id: traceId,
                command_name: interaction.commandName,
                ...(interaction.customId != null && { custom_id: interaction.customId }),
                duration_ms: Date.now() - startTime,
                success: true,
            });

        } catch (error) {
            console.error(`[Interaction Error]`, error);
            captureException(error, guildId, {
                trace_id: traceId,
                command_name: interaction.commandName || interaction.customId,
                ...(interaction.customId != null && { custom_id: interaction.customId }),
                interaction_type: interaction.type,
                duration_ms: Date.now() - startTime,
            });

            try {
                const payload = {
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                    components: [buildBlockContainer(
                        `**Oh no!**\nSomething clicked out of place, and an error slammed OptiDesk in the head, multiple times. Our team has been notified. Try again in a few minutes - and if that doesn't work, contact support.\n-# We understand this can be frustrating. This is probably the cue for a coffee break.`,
                        COLOR_ERROR
                    )]
                };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(payload);
                } else {
                    await interaction.reply(payload);
                }
            } catch (innerError) {
                console.error(`Error sending error reply for ${interaction.commandName}:`, innerError);
            }
        }
    }
};
