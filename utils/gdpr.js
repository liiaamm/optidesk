
async function getUserIdsFromChannel(channel) {
    const userIds = new Set();
    let lastMessageId = null;

    // Cap at 50 batches (5,000 messages) as a runaway guard against spam-filled tickets.
    // The primary throttle is the per-user token bucket charged on the button click
    // (see utils/rateLimitWeights.js — finalCloseTicket cost covers this collection).
    for (let i = 0; i < 50; i++) {
        const messages = await channel.messages.fetch({
            limit: 100,
            before: lastMessageId ?? undefined
        });

        if (messages.size === 0) break;

        for (const msg of messages.values()) {
            userIds.add(msg.author.id);
        }

        lastMessageId = messages.last().id;

        if (messages.size < 100) break;
    }

    return Array.from(userIds);
}

module.exports = {getUserIdsFromChannel};