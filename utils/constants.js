// DynamoDB table names
const TABLE_TICKETS            = 'OptiDeskLiveTickets';
const TABLE_CONFIGS            = 'OptiDeskGuildConfigs';
const TABLE_LICENSING          = 'OptiDeskLicensing';
const TABLE_ENFORCEMENT        = 'OptiDeskEnforcement';
const TABLE_ENFORCEMENT_GUILDS = 'OptiDeskEnforcementGuilds';
const TABLE_PERFORMANCE        = 'OptiDeskPerformance';
const TABLE_TRANSCRIPTS        = 'OptiDeskTranscripts';

// UI accent colors
const COLOR_ERROR    = 0x792828;
const COLOR_WARNING  = 0xd49217;
const COLOR_PRIORITY = 0xfbff50;
const COLOR_CX       = 0xffbc50;
const COLOR_ESCALATE = 0x795394;

// Development / ops IDs
const DEV_OWNER_ID      = ''; // Only user allowed through the dev wedge
const DEV_HOME_GUILD_ID = ''; // Only guild allowed through the dev wedge

module.exports = {
    TABLE_TICKETS, TABLE_CONFIGS, TABLE_LICENSING,
    TABLE_ENFORCEMENT, TABLE_ENFORCEMENT_GUILDS,
    TABLE_PERFORMANCE, TABLE_TRANSCRIPTS,
    COLOR_ERROR, COLOR_WARNING, COLOR_PRIORITY, COLOR_CX, COLOR_ESCALATE,
    DEV_OWNER_ID, DEV_HOME_GUILD_ID,
};
