// API Version: 1
const VALID_SCOPES = ["events.subscribe", "instance.info"];

// No remote network-accessible scopes
// Should probably not increase this
const NETWORK_SCOPES = [];

function isValidScope(scope) {
    return VALID_SCOPES.includes(scope);
}

function requiresToken(scopes) {
    return scopes.some(s => NETWORK_SCOPES.includes(s));
}

module.exports = { VALID_SCOPES, NETWORK_SCOPES, isValidScope, requiresToken };