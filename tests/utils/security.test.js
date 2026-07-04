const { sanitizeReason, checkStaffAccess } = require('../../utils/security');
const { memberHasCategoryAccess } = require('../../utils/categoryAcl');
const { logEvent } = require('../../utils/logging');
const { getConfig } = require('../../utils/config');
const { posthog } = require('../../utils/db');
const { MessageFlags } = require('discord.js');

jest.mock('../../utils/categoryAcl');
jest.mock('../../utils/logging');
jest.mock('../../utils/config');
jest.mock('../../utils/db', () => ({
    posthog: { capture: jest.fn() }
}));

describe('sanitizeReason', () => {
    test('non-string input returns empty string', () => {
        expect(sanitizeReason(null)).toBe('');
        expect(sanitizeReason(undefined)).toBe('');
        expect(sanitizeReason(42)).toBe('');
        expect(sanitizeReason({})).toBe('');
    });

    test('strips backticks (fence break-out)', () => {
        expect(sanitizeReason('a`b')).toBe('ab');
        expect(sanitizeReason('```@everyone```')).toBe('@everyone');
    });

    test('strips ASCII C0 control chars + DEL', () => {
        expect(sanitizeReason('a\x00b')).toBe('ab');
        expect(sanitizeReason('a\x01b')).toBe('ab');
        expect(sanitizeReason('a\x1bb')).toBe('ab');
        expect(sanitizeReason('a\x1fb')).toBe('ab');
        expect(sanitizeReason('a\x7fb')).toBe('ab');
    });

    test('strips Unicode bidi overrides (U+202A-U+202E)', () => {
        expect(sanitizeReason('a‪b')).toBe('ab'); // LRE
        expect(sanitizeReason('a‫b')).toBe('ab'); // RLE
        expect(sanitizeReason('a‬b')).toBe('ab'); // PDF
        expect(sanitizeReason('a‭b')).toBe('ab'); // LRO
        expect(sanitizeReason('a‮b')).toBe('ab'); // RLO
    });

    test('strips Unicode bidi isolates (U+2066-U+2069)', () => {
        expect(sanitizeReason('a⁦b')).toBe('ab'); // LRI
        expect(sanitizeReason('a⁧b')).toBe('ab'); // RLI
        expect(sanitizeReason('a⁨b')).toBe('ab'); // FSI
        expect(sanitizeReason('a⁩b')).toBe('ab'); // PDI
    });

    test('strips zero-width chars (U+200B-U+200D), LRM (U+200E), RLM (U+200F)', () => {
        expect(sanitizeReason('a​b')).toBe('ab'); // ZWSP
        expect(sanitizeReason('a‌b')).toBe('ab'); // ZWNJ
        expect(sanitizeReason('a‍b')).toBe('ab'); // ZWJ
        expect(sanitizeReason('a‎b')).toBe('ab'); // LRM
        expect(sanitizeReason('a‏b')).toBe('ab'); // RLM
    });

    test('strips soft hyphen (U+00AD) and BOM (U+FEFF)', () => {
        expect(sanitizeReason('a­b')).toBe('ab');
        expect(sanitizeReason('a﻿b')).toBe('ab');
    });

    test('blocks zero-width @everyone reformation', () => {
        expect(sanitizeReason('@​everyone')).toBe('@everyone');
    });

    test('trims leading/trailing whitespace', () => {
        expect(sanitizeReason('  hello  ')).toBe('hello');
        expect(sanitizeReason('\n\thello\n\t')).toBe('hello');
    });

    test('enforces maxLen', () => {
        expect(sanitizeReason('x'.repeat(300))).toBe('x'.repeat(200));
        expect(sanitizeReason('x'.repeat(300), 50)).toBe('x'.repeat(50));
    });

    test('leaves normal multilingual text intact', () => {
        expect(sanitizeReason('hello world')).toBe('hello world');
        expect(sanitizeReason('café résumé')).toBe('café résumé');
        expect(sanitizeReason('日本語テスト')).toBe('日本語テスト');
        expect(sanitizeReason('emoji 🎉')).toBe('emoji 🎉');
    });
});

describe('checkStaffAccess', () => {
    let mockInteraction;
    let mockConfig;
    let mockEmojis;

    beforeEach(() => {
        mockInteraction = {
            member: { id: 'user1' },
            user: { id: 'user1', tag: 'user1#1234' },
            guildId: 'guild1',
            id: 'interaction1',
            deferred: false,
            replied: false,
            reply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue()
        };
        mockConfig = {};
        mockEmojis = { cancel: { markdown: 'X' } };
        
        getConfig.mockReturnValue({ posthogEnabled: true });
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns true if member has access', async () => {
        memberHasCategoryAccess.mockReturnValue(true);
        const result = await checkStaffAccess(mockInteraction, mockConfig, mockEmojis);
        expect(result).toBe(true);
        expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    test('denies access, replies, and logs if member lacks access', async () => {
        memberHasCategoryAccess.mockReturnValue(false);
        const result = await checkStaffAccess(mockInteraction, mockConfig, mockEmojis);
        
        expect(result).toBe(false);
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'X You lack permissions to do this.',
            flags: MessageFlags.Ephemeral
        });
        expect(logEvent).toHaveBeenCalledWith(
            'accessControl',
            'notice',
            '**user1#1234** attempted to execute a command that they do not have the permissions for.',
            mockInteraction
        );
        expect(posthog.capture).toHaveBeenCalledWith(expect.objectContaining({
            event: 'access_denied'
        }));
    });

    test('uses editReply if interaction was already deferred', async () => {
        memberHasCategoryAccess.mockReturnValue(false);
        mockInteraction.deferred = true;
        await checkStaffAccess(mockInteraction, mockConfig, mockEmojis);
        
        expect(mockInteraction.editReply).toHaveBeenCalledWith({
            content: 'X You lack permissions to do this.',
            flags: MessageFlags.Ephemeral
        });
        expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    test('catches errors, replies with generic error, and logs warning', async () => {
        memberHasCategoryAccess.mockImplementation(() => { throw new Error('acl crash'); });
        
        const result = await checkStaffAccess(mockInteraction, mockConfig, mockEmojis);
        expect(result).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[security] Staff access check failed:'), expect.any(Object));
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: "X I wasn't able to verify your identity. Please try again in a moment. If this persists, contact OptiDesk support.",
            flags: MessageFlags.Ephemeral
        });
    });
});
