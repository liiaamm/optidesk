const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { s3, dynamo, storageEnabled, transcriptBucket } = require('../../utils/db');
const { TABLE_TRANSCRIPTS } = require('../../utils/constants');
const { loadEmojis } = require('../../utils/emojiLoader');
const { getGuildConfig } = require('../../utils/guildConfig');
const { checkStaffAccess, sanitizeReason } = require('../../utils/security');
const { safeReply } = require('../../utils/interactionHelper');
const { logEvent } = require('../../utils/logging');

const TRANSCRIPT_LINK_EXPIRES_SEC = 15 * 60;
const TRANSCRIPT_COOLDOWN_MS      = 15 * 60 * 1000;
const TRANSCRIPT_RETENTION_DAYS   = 90; // CHANGE. THIS. if you keep them forever

module.exports = async function viewTranscript(interaction) {
    // customId is `viewTranscript:<channelId>`
    const parts = interaction.customId.split(':');
    const channelId = parts[1];
    const guildIdFromCustomId = parts[2];

    const guildId = interaction.guild?.id || guildIdFromCustomId;
    if (!guildId) {
        // Malformed / legacy DM button with no guild
        return await safeReply(interaction, `This transcript is no longer available.`);
    }

    const emojis = await loadEmojis(guildId);
    const config = await getGuildConfig(guildId);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!storageEnabled()) {
        await interaction.editReply({ content: `${emojis.cancel.markdown} This transcript is no longer available.` });
        return;
    }

    let record;
    try {
        const result = await dynamo.get({
            TableName: TABLE_TRANSCRIPTS,
            Key: { channelId },
        }).promise();
        record = result.Item;
    } catch (err) {
        console.error(`[ERROR] viewTranscript: DynamoDB get failed for channelId ${channelId}:`, err);
        return await safeReply(interaction, `**An error occurred**\nCouldn't retrieve the transcript record. Try again in a moment.`);
    }

    if (!record || record.guildId !== guildId) {
        await interaction.editReply({
            content: `${emojis.cancel.markdown} This transcript is no longer available.\n-# Transcripts are kept for **${TRANSCRIPT_RETENTION_DAYS} days** after a ticket is closed, then permanently deleted. This one has likely expired.`,
        });
        return;
    }

    const isCreator = record.ticketCreatorId && interaction.user.id === record.ticketCreatorId;
    if (!isCreator) {
        // The staff path needs guild member context (roles). A non-creator pressing
        // the button from a DM can't be authorised — fail closed.
        if (!interaction.inGuild()) {
            await interaction.editReply({
                content: `${emojis.cancel.markdown} This transcript is no longer available.`,
            });
            return;
        }
        if (!await checkStaffAccess(interaction, config, emojis, { category: record.category, supervisorPreferred: true })) return;
    }

    // 15-minute cooldown on link generation
    if (record.lastseen && (Date.now() - record.lastseen) < TRANSCRIPT_COOLDOWN_MS) {
        const waitMin = Math.ceil((TRANSCRIPT_COOLDOWN_MS - (Date.now() - record.lastseen)) / 60_000);
        await interaction.editReply({
            content: `${emojis.cancel.markdown} A transcript link was recently issued for this ticket. Please wait **${waitMin} minute${waitMin !== 1 ? 's' : ''}** before requesting another.`,
        });
        return;
    }

    const Bucket = transcriptBucket();
    const Key = `transcripts/${guildId}/${channelId}.html`;

    try {
        await s3.headObject({ Bucket, Key }).promise();
    } catch (err) {
        const objectExpired = err.statusCode === 404 || err.code === 'NotFound' || err.code === 'NoSuchKey';
        if (objectExpired) {
            const ageDays = record.createdAt
                ? Math.floor((Date.now() - record.createdAt) / 86_400_000)
                : null;
            const ageNote = ageDays != null
                ? ` This ticket was closed **${ageDays} day${ageDays !== 1 ? 's' : ''} ago**.`
                : '';
            await interaction.editReply({
                content: `${emojis.cancel.markdown} This transcript has expired and is no longer available.\n-# Transcripts are retained for **${TRANSCRIPT_RETENTION_DAYS} days** after a ticket is closed, then permanently deleted.${ageNote}`,
            });
            return;
        }
        console.error(`[ERROR] viewTranscript: S3 headObject failed for ${Key}:`, err);
        return await safeReply(interaction, `${emojis.cancel.markdown} The transcript file is currently unavailable. Please contact an administrator.`);
    }

    // Generate a 15-minute signed S3 URL
    const url = s3.getSignedUrl('getObject', {
        Bucket,
        Key,
        Expires: TRANSCRIPT_LINK_EXPIRES_SEC,
    });

    const hexColor = config.appearance.defaultHexColor.replace('#', '');
    const accentColor = parseInt(hexColor, 16);

    const container = new ContainerBuilder().setAccentColor(accentColor);
    const text = new TextDisplayBuilder().setContent(
        `Your link is valid for **15** minutes.\n-# Transcript access is monitored.` // Adjust as needed
    );
    container.addTextDisplayComponents(text);

    const linkButton = new ButtonBuilder()
        .setLabel('Transcript')
        .setStyle(ButtonStyle.Link)
        .setURL(url);

    const linkRow = new ActionRowBuilder().addComponents(linkButton);

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container, linkRow],
    });

    const logGuild = interaction.guild
        || await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (logGuild) {
        const actor = isCreator ? 'the ticket creator' : 'a staff member';
        await logEvent('transcription', 'notice', `**${sanitizeReason(interaction.user.tag)}** (${actor}) generated a transcript link for the following ticket:\n> -# Ticket ID: ${channelId}\n> Category: \`${sanitizeReason(record.category || 'Unknown')}\``, { guild: logGuild });
    }

    try {
        await dynamo.update({
            TableName: TABLE_TRANSCRIPTS,
            Key: { channelId },
            UpdateExpression: 'SET lastseen = :now, lastseenBy = :uid',
            ExpressionAttributeValues: {
                ':now': Date.now(),
                ':uid': interaction.user.id,
            },
        }).promise();
    } catch {
        console.log(`[WARNING] Failed to update lastseen for transcript ${channelId}`);
    }
};
