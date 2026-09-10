/**
 * HTTP layer for authentication. Mounted at `/users` (no `/api` prefix), so the
 * four endpoints are `/users/signup`, `/users/login`, `/users/refresh`,
 * `/users/logout`.
 *
 * This layer only speaks HTTP: it reads the request, runs express-validator,
 * calls `userService`, sets or clears the refresh cookie, and shapes the JSON
 * response. It never hashes a password or signs a token — that is the service's
 * job — and it never touches a model directly, except through `userRepository`
 * inside the "is it taken" validators.
 *
 * Every handler is wrapped in `catchAsync`, so a thrown error is logged and
 * forwarded to the central error handler. The one exception is `/refresh`,
 * which handles its own 401s locally so they are not logged as errors.
 *
 * See docs/specs/05-user-layers.md, section 6, and docs/specs/03-api-contract.md.
 */

const express = require('express');
const router = express.Router()
const { catchAsync } = require('../error_handling');
const userService = require('../bl/userService.js');
const userRepository = require('../dal/userRepository.js');
const { body, validationResult } = require("express-validator");
const rateLimit = require('express-rate-limit');

/**
 * Map a User document to the safe public shape sent to the client.
 *
 * Keeps the "never leak `password`" rule (and "no `createdAt` in the body",
 * per spec decision 4) in one place.
 *
 * @param {import('mongoose').Document} user
 * @returns {{ id: string, username: string, email: string }}
 */
function publicUser(user) {
    return {
        id: user._id,
        username: user.username,
        email: user.email
    };
}

/**
 * Write the refresh token into the HttpOnly `refreshToken` cookie.
 *
 * Same options every time (spec §6.1). `secure` is `false` for local http and
 * becomes `true` once the app is on https. `maxAge` matches the refresh token's
 * 7-day lifetime. `res.clearCookie("refreshToken")` on logout / failed refresh
 * uses the matching name.
 *
 * @param {import('express').Response} res
 * @param {string} token - the raw refresh token from the service
 */
function setRefreshCookie(res, token) {
    res.cookie("refreshToken", token, {
        httpOnly: true, secure: false, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

/**
 * Middleware: turn any express-validator failures into the agreed 400 response.
 *
 * Runs after the validators in a route's chain. On failure it sends the
 * `{ errors: [{ field, message }] }` shape from the API contract and does not
 * call `next()`, so the route handler never runs. On success it calls `next()`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function checkValidationResult(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
        });
    }
    next();
}

/**
 * Validators for `POST /signup` (spec §7).
 *
 * - `username`: 3–20 characters, and not already taken. The "taken" check is an
 *   async custom validator that queries the database through `userRepository`.
 * - `email`: a valid email, and not already taken (same async pattern).
 * - `password`: at least 8 characters.
 *
 * The model's `unique` index on `username` / `email` is the safety net behind
 * these; a duplicate that races past them makes `createUser` throw `E11000`,
 * which the central error handler turns into a 409.
 */
const signupValidators = [
    body("username")
        .isLength({ min: 3, max: 20 })
        .withMessage('User name must between 3 and 20 characters')
        .custom(async (value) => {
            const existing = await userRepository.findUserByUsername(value);
            if (existing) {
                throw new Error('That username is already taken.');
            }
        }),
    body("email")
        .isEmail()
        .withMessage('Please provide a valid email.')
        .custom(async (value) => {
            const existing = await userRepository.findUserByEmail(value);
            if (existing) {
                throw new Error('That email is already taken.');
            }
        }),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
];

/**
 * POST /users/signup — create an account and log in straight away.
 *
 * Validators run first; on failure `checkValidationResult` answers 400. On
 * success the service hashes the password, saves the user, and issues a token
 * pair. Responds 201 with `{ user, accessToken }` and sets the refresh cookie.
 */
router.post('/signup', signupValidators, checkValidationResult, catchAsync(async (req, res) => {

    const { user, accessToken, refreshToken } = await userService.signup(req.body);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user: publicUser(user), accessToken });

}));


/**
 * Validators for `POST /login` (spec §7): `username` and `password` must be
 * present. Whether the credentials are actually correct is the service's
 * decision, not a validator's.
 */
const loginValidators = [
    body("username").notEmpty(),
    body("password").notEmpty()
];

/**
 * Strict rate limit for `/login` only (spec §6, course demo 24): at most 5
 * attempts per IP per 15 minutes, to slow down password guessing. A blocked
 * request gets a 429 with the `{ error }` shape the client understands. The
 * rest of the API uses a looser limiter set up in the server, not here.
 */
const limiter = rateLimit({
    windowMs: 900 * 1000,  // 15 minutes, in milliseconds
    max: 5,
    message: { error: "Too many login attempts, try again later." }
})


/**
 * POST /users/login — verify credentials and log in.
 *
 * Rate limiter, then validators, then the service. A wrong username or password
 * makes the service throw a 401 with a generic message (the response never says
 * which was wrong); the central error handler sends it. On success, responds
 * 200 with `{ user, accessToken }` and sets the refresh cookie.
 */
router.post('/login', limiter, loginValidators, checkValidationResult, catchAsync(async (req, res) => {

    const { user, accessToken, refreshToken } = await userService.login(req.body.username, req.body.password);
    setRefreshCookie(res, refreshToken);
    res.status(200).json({ user: publicUser(user), accessToken });
}));

/**
 * POST /users/logout — invalidate the refresh token and clear the cookie.
 *
 * Reads the cookie (may be undefined — the service handles that), deletes the
 * token row, clears the cookie, and answers 204 with no body. Safe to call when
 * nobody is logged in.
 */
router.post('/logout', catchAsync(async (req, res) => {

    const token = req.cookies.refreshToken;
    await userService.logout(token);
    res.clearCookie("refreshToken");
    res.status(204).end();

}));

/**
 * POST /users/refresh — trade the refresh cookie for a new access token.
 *
 * Returns the user as well as the token, because after a page reload the client
 * has no user in memory. Both failure paths answer 401 locally (not via the
 * central handler) so they are not logged as errors:
 *
 * - no cookie: the normal "nobody is logged in" case on start-up — 401, nothing
 *   cleared, nothing logged;
 * - the service throws (token unknown, expired, tampered, or its user is gone):
 *   401 and the cookie is cleared.
 *
 * On success: 200 with `{ user, accessToken }`, and the rotated refresh token
 * replaces the cookie.
 */
router.post('/refresh', catchAsync(async (req, res) => {

    const token = req.cookies.refreshToken;
    if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
    }
    try {
        const { user, accessToken, refreshToken } = await userService.refresh(token);
        setRefreshCookie(res, refreshToken);
        res.status(200).json({ user: publicUser(user), accessToken });
    } catch (error) {
        res.clearCookie("refreshToken");
        res.status(401).json({ error: "Session expired" });
    }
}));

module.exports = router 





