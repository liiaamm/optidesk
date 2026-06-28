const { logEvent } = require('../../utils/logging');
const { getGuildConfig } = require('../../utils/guildConfig');
const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');

jest.mock('../../utils/guildConfig');

// discord.js structures are partially mocked in tests via setupFiles or we can mock them here
jest.mock('discord.js', () => {
    return {
        ContainerBuilder: jest.fn().mockImplementation(() => ({
            setAccentColor: jest.fn().mockReturnThis(),
            addTextDisplayComponents: jest.fn().mockReturnThis()
        })),
        TextDisplayBuilder: jest.fn().mockImplementation(() => ({
            setContent: jest.fn().mockReturnThis()
        })),
        MessageFlags: {
            IsComponentsV2: 1 << 6 // Arbitrary flag
        }
    };
});

describe('logging utility', () => {
    let mockInteraction;
    let mockChannel;

    beforeEach(() => {
        mockChannel = {
            send: jest.fn().mockResolvedValue({})
        };
        mockInteraction = {
            guild: {
                id: 'guild123',
                channels: {
                    fetch: jest.fn().mockResolvedValue(mockChannel)
                }
            }
        };
        getGuildConfig.mockResolvedValue({
            settings: { loggingEnabled: true },
            layout: { loggingChannelId: 'channel123' }
        });
        
        // Suppress console warnings for expected failures
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns false if no guild is in interaction', async () => {
        const result = await logEvent('ticketOperations', 'info', 'test event', { guild: null });
        expect(result).toEqual({ success: false, reason: 'No guild' });
    });

    it('returns false if logging is disabled', async () => {
        getGuildConfig.mockResolvedValueOnce({
            settings: { loggingEnabled: false },
            layout: { loggingChannelId: 'channel123' }
        });
        const result = await logEvent('ticketOperations', 'info', 'test event', mockInteraction);
        expect(result).toEqual({ success: false, reason: 'Unconfigured' });
    });

    it('returns false if logging channel is not set', async () => {
        getGuildConfig.mockResolvedValueOnce({
            settings: { loggingEnabled: true },
            layout: { loggingChannelId: null }
        });
        const result = await logEvent('ticketOperations', 'info', 'test event', mockInteraction);
        expect(result).toEqual({ success: false, reason: 'Unconfigured' });
    });

    it('returns false if service or level is malformed', async () => {
        const result = await logEvent('badService', 'info', 'test event', mockInteraction);
        expect(result).toEqual({ success: false, reason: 'Malformed request' });
    });

    it('sends log successfully', async () => {
        const result = await logEvent('ticketOperations', 'info', 'test event', mockInteraction);
        expect(result).toEqual({ success: true });
        expect(mockInteraction.guild.channels.fetch).toHaveBeenCalledWith('channel123');
        expect(mockChannel.send).toHaveBeenCalled();
    });

    it('returns false if channel fetch fails', async () => {
        mockInteraction.guild.channels.fetch.mockRejectedValue(new Error('Discord API Error'));
        const result = await logEvent('ticketOperations', 'info', 'test event', mockInteraction);
        expect(result).toEqual({ success: false, reason: 'Unconfigured' });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[logging] Failed to fetch logging channel:'), expect.any(Object));
    });

    it('returns false if channel send fails', async () => {
        mockChannel.send.mockRejectedValue(new Error('Discord API Error'));
        const result = await logEvent('ticketOperations', 'info', 'test event', mockInteraction);
        expect(result).toEqual({ success: false, reason: 'Failure' });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[logging] Failed to send log event:'), expect.any(Object));
    });
});
