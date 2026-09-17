const mongoose = require("mongoose");

/**
 * Mongoose schema for a RefreshToken document.
 * Tokens are rotated on refresh and automatically expire so the collection does
 * not keep growing forever.
 *
 * @typedef {Object} RefreshToken
 * @property {string} token - Required, unique. The raw refresh token value.
 * @property {mongoose.Types.ObjectId} user - Required. The User this token
 *   belongs to.
 * @property {Date} expiresAt - Required. MongoDB deletes expired tokens
 *   automatically through the TTL index below.
 * @property {string|null} replacedByToken - The token this one was rotated
 *   into, or null while it is still current. The row is kept after rotation
 *   rather than deleted, so a second request carrying the same old token can
 *   be answered with the new one instead of being treated as a dead session.
 * @property {Date|null} replacedAt - When that rotation happened. Separate
 *   from `expiresAt`, which is the row's own 7-day lifetime and says nothing
 *   about rotation: `bl/userService.js` compares this against its grace
 *   window to tell a near-simultaneous second call apart from a replay.
 */
const refreshTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: [true, 'refreshToken is required'],
        unique: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, 'User is required']
    },
    expiresAt: {
        type: Date,
        required: [true, 'expiresAt is required']
    },
    replacedByToken: {
        type: String,
        default: null
    },
    replacedAt: {
        type: Date,
        default: null
    }

});

// Expire expired tokens automatically so the collection never grows forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ user: 1 });

refreshTokenSchema.set("toJSON", { virtuals: true });

/**
 * The RefreshToken model. Use this to create, rotate, and revoke refresh tokens.
 * @type {mongoose.Model<RefreshToken>}
 */
const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
module.exports = RefreshToken;