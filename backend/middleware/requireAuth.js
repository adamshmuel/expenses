/**
 * Access-token guard for routes that work with a specific user's data
 * (`/chat/*`, `/expenses/*`). The `/users/*` endpoints do not use it — logging
 * in is how a token is obtained in the first place.
 *
 * See docs/specs/06-server-modules.md, section 4.
 */

const jwt = require('jsonwebtoken');

/**
 * Verify the access token and attach the user to the request.
 *
 * - Expects `Authorization: Bearer <token>`. Missing or malformed → 401, and
 *   `next()` is not called (the route never runs).
 * - `jwt.verify(token, JWT_SECRET)` — a failure (expired, tampered, wrong
 *   secret) → 401.
 * - On success: `req.user = { id, username }` from the token payload (the shape
 *   `userService` signs, per 05-user-layers.md §4), then `next()`.
 *
 * Does not touch the database — the token is self-contained. Does not attempt a
 * refresh; that is the client's job after it sees the 401.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Not authenticated." });
    }
    const token = authHeader.split(" ")[1];
    try {

        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = { id: decoded.id, username: decoded.username };
        next();
    } catch (error) {
        res.status(401).json({ error: "Invalid or expired token!" })
    }
}

module.exports = requireAuth;