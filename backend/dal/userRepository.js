const User = require('../models/userModel');
const RefreshToken = require('../models/refreshTokenModel');
// How long after a token is rotated it may still be presented by a second,
// near-simultaneous call — long enough to cover a double-fired request, far
// too short for a captured token to be replayed later.

/**
 * Data-access layer for authentication.
 *
 * Talks only to the `User` and `RefreshToken` models. It does no hashing and
 * signs no tokens — that is the service's job (`bl/userService.js`). It also
 * knows nothing about `req`, `res`, or HTTP status codes.
 *
 * Every function returns the Mongoose query directly; the caller awaits it.
 * A finder resolves to `null` when nothing matches.
 *
 * See docs/specs/05-user-layers.md, section 3.
 */

/**
 * Create and save a new user.
 *
 * The `password` field is expected to be **already hashed** by the service —
 * this function does not hash.
 *
 * @param {{ username: string, email: string, password: string }} obj
 * @returns {Promise<import('mongoose').Document>} the saved User document
 */
const createUser = (obj) => {
    const newUser = new User(obj)
    return newUser.save();
};

/**
 * Find one user by username.
 *
 * The returned document includes the `password` field, so the service can
 * compare it on login. The password is stripped later, in the route.
 *
 * @param {string} username
 * @returns {Promise<import('mongoose').Document|null>} the User document, or null
 */
const findUserByUsername = (username) => {
    return User.findOne({ username: username });
};

/**
 * Find one user by email. Used by the signup async validator to check that an
 * email is not already registered, before the request reaches the service.
 *
 * @param {string} email
 * @returns {Promise<import('mongoose').Document|null>} the User document, or null
 */
const findUserByEmail = (email) => {
    return User.findOne({ email: email });
};

/**
 * Find one user by id. Used by the refresh flow, which needs the user for the
 * response body.
 *
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>} the User document, or null
 */
const findUserById = (id) => {
    return User.findOne({ _id: id })
};

/**
 * Create and save a new refresh token row.
 *
 * `expiresAt` feeds the TTL index on the collection, so expired tokens are
 * removed by MongoDB on their own.
 *
 * @param {{ token: string, user: import('mongoose').Types.ObjectId, expiresAt: Date }} obj
 * @returns {Promise<import('mongoose').Document>} the saved RefreshToken document
 */
const saveRefreshToken = (obj) => {
    const newRefreshToken = new RefreshToken(obj);
    return newRefreshToken.save();
};

/**
 * Find one refresh token row by its raw token value. A token that is not in the
 * collection has been rotated out or was never issued.
 *
 * @param {string} token
 * @returns {Promise<import('mongoose').Document|null>} the RefreshToken document, or null
 */
const findRefreshToken = (token) => {
    return RefreshToken.findOne({ token })
};

/**
 * Atomically stamp a refresh token row with the token it is being rotated
 * into, and return the row as it was *before* that stamp.
 *
 * This is the single read-and-write that makes rotation safe: MongoDB
 * serializes concurrent `findOneAndUpdate` calls on the same document, so of
 * two near-simultaneous calls with the same old token, exactly one sees
 * `replacedByToken` still null (it won the race) and the other sees it
 * already set to the winner's new token. The caller decides what that means —
 * see `refresh` in `bl/userService.js`.
 *
 * The row is kept, not deleted, so the losing call can still be answered with
 * the winner's token instead of a 401. The collection's TTL index on
 * `expiresAt` clears it out later.
 *
 * @param {string} oldToken - the token being rotated away from
 * @param {string} newToken - the token it is being rotated into
 * @returns {Promise<import('mongoose').Document|null>} the row as it was just
 *   before this update, so `replacedByToken` on it is the *previous* value;
 *   null when no row with this token exists at all
 */
const consumeRefreshToken = (oldToken, newToken) => {
    return RefreshToken.findOneAndUpdate(
        { token: oldToken },
        { replacedByToken: newToken, replacedAt: new Date() }
    );
};

/**
 * Delete one refresh token row by its raw token value. Used by logout only —
 * refresh rotates through `consumeRefreshToken` instead, which keeps the old
 * row so a second, near-simultaneous call with the same token can still be
 * answered. Safe to call when nothing matches.
 *
 * @param {string} token
 * @returns {Promise<import('mongoose').mongo.DeleteResult>}
 */
const deleteRefreshToken = (token) => {
    return RefreshToken.deleteOne({ token })
};


module.exports = {
    createUser,
    findUserByUsername,
    findUserById,
    saveRefreshToken,
    findRefreshToken,
    deleteRefreshToken,
    findUserByEmail,
    consumeRefreshToken
}
