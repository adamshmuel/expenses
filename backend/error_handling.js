/**
 * `catchAsync` and the one central error handler (course demo 16).
 *
 * Routes stay clean: a handler just `throw`s (or rejects), `catchAsync` forwards
 * it, and `errorHandler` — registered last in `index.js` — is the single place
 * that turns an error into an HTTP response and the single place that logs it.
 *
 * See docs/specs/06-server-modules.md, section 3.
 */

const logger = require("./.config/logger");

/**
 * Wrap an async route handler so a rejected promise is forwarded to the error
 * handler instead of crashing the process.
 *
 * Does not log and does not touch the response — that is `errorHandler`'s job.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<any>} handler
 * @returns {import('express').RequestHandler}
 */
function catchAsync(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      next(err);
    });
  };
}


/**
 * The one central error handler. Its 4-argument signature is how Express knows
 * it is error middleware; `index.js` registers it after every route.
 *
 * Maps the error to a status and one of the two response shapes from the API
 * contract (`{ error }` here; `{ errors: [] }` is produced earlier by the route
 * validators and never reaches this handler):
 *
 *   - `err.code === 11000` (Mongo duplicate key) → 409, friendly message.
 *     Handled here once, for every model with a `unique` index — not in a
 *     service (05-user-layers.md decision 3).
 *   - `err.status` set (e.g. 401 from `userService.login`) → that status, with
 *     `err.message` (a message the code chose on purpose).
 *   - anything else → 500 with a generic message; the real one is logged, not
 *     sent to the client.
 *
 * Logging: the 500 case at `error` level (this is what fills `logs/error.log`);
 * the deliberate 4xx and the 409 at `warn`, so `error.log` stays a list of real
 * problems.
 *
 * @param {Error & { status?: number, code?: number }} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {

  if (err.code === 11000) {
    logger.warn(err.message, { method: req.method, stack: err.stack, path: req.originalUrl });
    return res.status(409).json({ error: "That username or email is already taken." });
  }
  if (err.status) {
    logger.warn(err.message, { method: req.method, stack: err.stack, path: req.originalUrl });
    res.status(err.status).json({ error: err.message })
  } else {
    logger.error(err.message, { method: req.method, stack: err.stack, path: req.originalUrl });
    res.status(500).json({ error: "Something went wrong." })
  }
}

module.exports = {
  catchAsync,
  errorHandler
}