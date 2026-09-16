const messageRepository = require('../dal/messageRepository.js');

/**
 * Business-logic layer for chat messages.
 *
 * Thin by design — chat messages have no rules to enforce beyond who owns
 * them. It exists so routes never touch the `Message` model directly, keeping
 * the `route → bl → dal → model` layering the rest of the server follows.
 *
 * See docs/specs/01-ai-chat.md.
 */

/**
 * Save one message against a user.
 * @param {string} userId
 * @param {string} text - what was typed, or what the assistant replied
 * @param {"user"|"assistant"} role - who sent it
 * @returns {Promise<import('mongoose').Document>}
 */
const saveMessage = (userId, text, role) => {
    return messageRepository.createMessage({ text, role, author: userId });
}

/**
 * A user's recent messages in reading order.
 *
 * The repository returns newest-first so `limit` keeps the *latest* messages;
 * they are reversed here so callers — the chat history screen and the AI
 * parser alike — get them oldest-first, the order a conversation is read in.
 *
 * @param {string} userId
 * @param {number} limit - how many of the most recent messages to return
 * @returns {Promise<import('mongoose').Document[]>} oldest first
 */
const getHistory = async (userId, limit) => {
    const messages = await messageRepository.getMessagesByUser(userId, limit)
    return messages.reverse();
}

module.exports = {
    saveMessage,
    getHistory
}