const Message = require('../models/messageModel');

/**
 * Data-access layer for chat messages.
 *
 * Talks only to the `Message` model. Every function returns the Mongoose
 * query/promise directly; the caller awaits it. Messages are append-only —
 * there is no update or delete here, by design (docs/specs/01-ai-chat.md).
 */

/**
 * Save one chat message.
 * @param {{ text: string, role: "user"|"assistant", author: string }} fields
 * @returns {Promise<import('mongoose').Document>}
 */
const createMessage = ({ text, role, author }) => {
    return Message.create({ text, role, author })
}

/**
 * Find a user's most recent messages, newest first.
 * @param {string} userId
 * @param {number} limit - how many to return
 * @returns {Promise<import('mongoose').Document[]>} newest first — the caller
 *   reverses when it wants chronological order
 */
const getMessagesByUser = (userId, limit) => {
    return Message.find({ author: userId }).sort({ createdAt: -1 }).limit(limit)
}


module.exports = {
    createMessage,
    getMessagesByUser
}