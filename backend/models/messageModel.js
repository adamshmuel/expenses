const mongoose = require("mongoose");
/**
 * Mongoose schema for a chat Message document. Read-only once created — no
 * update or delete (docs/specs/01-ai-chat.md).
 *
 * @typedef {Object} Message
 * @property {string} text - Required. What was typed or replied.
 * @property {"user"|"assistant"} role - Required. Who sent this message.
 * @property {mongoose.Types.ObjectId} author - Required. The User this
 *   message belongs to.
 * @property {Date} createdAt - Set automatically to the creation time (from { timestamps: true }).
 * @property {Date} updatedAt - Set automatically, and updated on every edit (from { timestamps: true }).
 */
const messageSchema = new mongoose.Schema({
    text: {
        type: String,
        required: [true, 'Text is required']
    },
    role: {
        type: String,
        required: [true, 'User or assistant is required'],
        enum: ["user", "assistant"]
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, 'User is required']
    }
}, { timestamps: true });


messageSchema.index({ author: 1});
messageSchema.set("toJSON", { virtuals: true });


/**
 * The Message model. Use this to create and read chat messages.
 * @type {mongoose.Model<Message>}
 */
const Message = mongoose.model("Message", messageSchema);
module.exports = Message;