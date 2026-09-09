const userRepository = require('../dal/userRepository.js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

/**
 * Business-logic layer for authentication.
 *
 * Owns the rules the route must not know about: hashing on signup, checking the
 * password on login, and rotating the refresh token. Talks to the database only
 * through `userRepository` — it never imports a model. It knows nothing about
 * `req`, `res`, cookies, or HTTP status codes; it signals failure by throwing an
 * `Error` with a `.status` the route/central handler reads.
 *
 * Every exported function returns `{ user, accessToken, refreshToken }` on
 * success, except `logout`, which returns nothing. The route puts the
 * `refreshToken` in the cookie and strips the user down to
 * `{ id, username, email }` before responding.
 *
 * See docs/specs/05-user-layers.md, section 4.
 */

/**
 * Sign an access/refresh token pair for a user and persist the refresh token.
 *
 * Private — not exported. Used by signup, login and refresh so all three issue
 * tokens the same way.
 *
 * - access token: `{ id, username }`, `JWT_SECRET`, 15 minutes. The payload is
 *   what `requireAuth` reads off `req.user` on the chat and expense routes.
 * - refresh token: `{ userId }`, `REFRESH_TOKEN_SECRET` (a different secret),
 *   7 days.
 * - the refresh token row is saved with an `expiresAt` 7 days out, which feeds
 *   the TTL index on the collection.
 *
 * `async` only because of the `saveRefreshToken` call; every caller awaits it.
 *
 * @param {import('mongoose').Document} user - a saved User document
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
const issueTokenPair = async (user) => {
    const accessToken = jwt.sign(
        { id: user._id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
    );
    const refreshToken = jwt.sign(
        { userId: user._id },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
    );
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await userRepository.saveRefreshToken({ token: refreshToken, user: user._id, expiresAt });

    return { accessToken, refreshToken };
};

/**
 * Register a new user and log them in.
 *
 * Hashes the password (bcrypt, 10 salt rounds), saves the user, then issues a
 * token pair. The "username / email already taken" check is done by the
 * express-validator async validators on the route, not here; if a duplicate
 * still races through, `createUser` throws a Mongo `E11000` and the central
 * error handler turns it into a 409.
 *
 * @param {{ username: string, email: string, password: string }} obj
 * @returns {Promise<{ user: import('mongoose').Document, accessToken: string, refreshToken: string }>}
 */
const signup = async (obj) => {
    obj.password = await bcrypt.hash(obj.password, 10);
    const user = await userRepository.createUser(obj);
    const { accessToken, refreshToken } = await issueTokenPair(user);
    return { user, accessToken, refreshToken };
};

/**
 * Verify credentials and log a user in.
 *
 * Throws one 401 error for both "no such user" and "wrong password", with the
 * same message, so the response cannot reveal which was wrong.
 *
 * @param {string} username
 * @param {string} password - the plain password from the request
 * @returns {Promise<{ user: import('mongoose').Document, accessToken: string, refreshToken: string }>}
 * @throws {Error} with `.status = 401` when the credentials do not match
 */
const login = async (username, password) => {
    const user = await userRepository.findUserByUsername(username);
    const isMatch = user && await bcrypt.compare(password, user.password);
    if (!isMatch) {
        const err = new Error("Username or password is incorrect.");
        err.status = 401;
        throw err;
    }
    const { accessToken, refreshToken } = await issueTokenPair(user);
    return { user, accessToken, refreshToken }
}

/**
 * Rotate a refresh token: trade a valid one for a fresh pair, killing the old.
 *
 * 1. the token must still be in the collection — one that was already rotated
 *    out, or issued before a restart, is gone, and this throws 401;
 * 2. `jwt.verify` must pass — a tampered or expired token throws, and the route
 *    turns that into a 401 too;
 * 3. the old row is deleted, so it can never be used again;
 * 4. a new pair is issued for the same user (the new refresh row is saved by
 *    `issueTokenPair`).
 *
 * @param {string} oldRefreshToken - the raw token from the cookie
 * @returns {Promise<{ user: import('mongoose').Document, accessToken: string, refreshToken: string }>}
 * @throws {Error} with `.status = 401` when the token is not recognized;
 *   `jwt.verify` errors propagate for the route to treat as 401
 */
const refresh = async (oldRefreshToken) => {
    const stored = await userRepository.findRefreshToken(oldRefreshToken);
    if (!stored) {
        const err = new Error("not recognized");
        err.status = 401;
        throw err;
    }
    const payload = jwt.verify(oldRefreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await userRepository.findUserById(payload.userId);
    await userRepository.deleteRefreshToken(oldRefreshToken);
    const { accessToken, refreshToken } = await issueTokenPair(user);
    return { user, accessToken, refreshToken };

};

/**
 * Log a user out by deleting their refresh token row.
 *
 * Idempotent: if the token was already gone, this is a no-op and does not throw.
 *
 * @param {string} [refreshToken] - the raw token from the cookie, if any
 * @returns {Promise<void>}
 */
const logout = async (refreshToken) => {
    await userRepository.deleteRefreshToken(refreshToken);
};

module.exports = {
    signup,
    login,
    refresh,
    logout
}