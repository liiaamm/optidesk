// Per-interaction token costs for the rate limiter.
// Cost roughly tracks resource usage (DynamoDB ops, S3 uploads, channel ops, bulk fetches).
// Unmapped interactions fall back to DEFAULT_COST.

const COSTS = {
    // Cheap: UI refresh, Map lookup, minimal Discord ops
    buttonCategoryHandler:    1,
    deleteMsgTicket:          1,
    info_securetranscripting: 1,
    integrationsTicket:       1,
    intergrationsTicket:      1,

    // Medium: 1-2 DynamoDB ops + one embed or message
    claimTicket:              3,
    closeTicket:              3,
    requestCloseTicket:       3,
    requestCloseQueryTicket:  3,
    addTicket:                3,
    removeTicket:             3,
    queueTicket:              3,
    escalateTicket:           3,
    staffPanelTicket:         3,
    blacklistTicket:          3,

    // Heavy: S3 upload, bulk Discord fetch, channel delete, multi-DDB writes
    // finalCloseTicket cost covers transcript generation (S3 upload), channel delete,
    // multi-DDB writes, and GDPR participant collection (bounded at 50 batches in gdpr.js).
    finalCloseTicket:         20,
    finalEscalateTicket:      12,
    forceCloseQueryTicket:    15,
    openTicketModal:          8,

    // Slash commands
    open:                     8,
    setup:                    0,

    // Modal-submit re-enforcement keys for flows where the BUTTON click already
    // charged the full cost through the central router
    blacklistTicket_modal:          1,
    forceCloseQueryTicket_modal:    1,
    requestCloseQueryTicket_modal:  1,
};

const DEFAULT_COST = 3;

function resolveCost(interaction) {
    if (interaction.commandName) {
        return COSTS[interaction.commandName] ?? DEFAULT_COST;
    }
    const id = interaction.customId || '';
    if (id.startsWith('setup_')) return 0;
    return COSTS[id] ?? DEFAULT_COST;
}

module.exports = { resolveCost, COSTS, DEFAULT_COST };
