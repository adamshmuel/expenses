const { validationResult } = require("express-validator");

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

module.exports = checkValidationResult;
