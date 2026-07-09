// API Version: 1
const VALID_SCOPES = ["events.subscribe", "instance.info", "tickets.write", "commands.register"];

// No remote network-accessible scopes
// Should probably not increase this
const NETWORK_SCOPES = [];

const SCOPE_DESCRIPTIONS = {
    "events.subscribe": "Listen to every event OptiDesk fires (includes ticket/user context)",
    "instance.info": "Read instance metadata (OptiDesk version)",
    "tickets.write": "[WRITE] Create tickets in your servers on behalf of external systems",
    "commands.register": "[WRITE] Add its own slash commands to your Discord servers",
};

function isValidScope(scope) {
    return VALID_SCOPES.includes(scope);
}

function requiresToken(scopes) {
    return scopes.some(s => NETWORK_SCOPES.includes(s));
}

module.exports = { VALID_SCOPES, NETWORK_SCOPES, SCOPE_DESCRIPTIONS, isValidScope, requiresToken };
