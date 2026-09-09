const User = require('../models/userModel');
const RefreshToken = require('../models/refreshTokenModel');

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
 * Delete one refresh token row by its raw token value. Used by both logout and
 * the rotation step of refresh. Safe to call when nothing matches.
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
    deleteRefreshToken
}
