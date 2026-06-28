const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

const schema = readJson('data/guild-config.schema.json');
const exampleConfig = readJson('data/guild-config.example.json');
const ajv = new Ajv({ allErrors: true, jsonPointers: true });
const validate = ajv.compile(schema);

function expectValid(config) {
    const valid = validate(config);
    expect({
        valid,
        errors: validate.errors,
    }).toEqual({
        valid: true,
        errors: null,
    });
}

test('self-host guild config example matches the guild config schema', () => {
    expectValid(exampleConfig);
});

test('schema accepts a prod-shaped guild config with categories, intellitags, and panel presets', () => {
    expectValid({
        serverId: '1424977254693343282',
        access: {
            blacklistRoleID: '1489772964437037077',
            pingOnPriorityRoles: ['1425012111053951038'],
            priorityRoles: ['1489841304765468783'],
            supervisorRoleID: null,
        },
        appearance: {
            defaultHexColor: '9DE8E4',
            emojiSet: 'OptiDeskEmojis',
            footer: '<:OptiDesk:1424689695207587870> - **OptiDesk**, 2026',
            funnyResponses: false,
            serverIconEmoji: '<:optidesk:1425005362871930911>',
            serverLogoURL: 'https://files.catbox.moe/5libeb.png',
        },
        layout: {
            categories: {
                'Billing Support': {
                    anonymous: false,
                    channelId: '1461611813723570398',
                    description: 'Billing support',
                    emoji: '💸',
                    inboxId: '1461611904819658894',
                    requiredRoleId: '1489841304765468783',
                    staffRoleId: '1425012011967975548',
                    supervisorRoleId: null,
                },
                'General Support': {
                    anonymous: false,
                    channelId: '1426356711299485786',
                    description: 'General support',
                    emoji: '1074045599873257492',
                    inboxId: '1434754389465104496',
                    staffRoleId: '1425012011967975548',
                    supervisorRoleId: null,
                },
            },
            intellitags: {
                appeal: {
                    accentColor: '5477521',
                    content: '## We need some more information\nPlease answer the appeal questions.',
                    enabled: true,
                    headerImage: {
                        description: 'OptiDesk development header',
                        url: 'https://files.catbox.moe/f6aq3k.png',
                    },
                    queueBehavior: 'true',
                    triggerKeywords: ['appeal', 'contest', 'dispute'],
                },
                close: {
                    accentColor: '5477521',
                    content: '## We need some more information',
                    enabled: true,
                    headerImage: {
                        description: 'OptiDesk development header',
                        url: 'https://files.catbox.moe/f6aq3k.png',
                    },
                    queueBehavior: 'false',
                    triggerKeywords: ['close', 'cancel'],
                },
            },
            loggingChannelId: '1504452020172619917',
            presets: {
                closeRequestMessage: 'If your issue has been resolved, please press Close.',
                openTicket: {
                    banner: {
                        altText: 'OptiDesk development header',
                        url: 'https://files.catbox.moe/f6aq3k.png',
                    },
                    openTicketMessage: '## Welcome!\nThank you for making a support ticket.',
                },
                panel: {
                    message: 'layout.presets.panel.message',
                    modalIntro: 'layout.presets.panel.modalIntro',
                },
                queueMessage: 'Your support request has been put in the queue.',
            },
            transcriptChannelId: '1425011612485550150',
        },
        settings: {
            addNonStaffToTickets: false,
            interactiveSupportEnabled: false,
            loggingEnabled: true,
            transcriptsEnabled: false,
            transcriptsTrusted: false,
        },
    });
});

test('schema rejects a category missing the required inbox channel', () => {
    const config = clone(exampleConfig);
    delete config.layout.categories['General Support'].inboxId;

    expect(validate(config)).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({
            keyword: 'required',
            params: { missingProperty: 'inboxId' },
        }),
    ]));
});
