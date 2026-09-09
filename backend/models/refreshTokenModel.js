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