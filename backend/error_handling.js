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
 * A copy of a request body that is safe to write to a log file.
 *
 * Shallow-copies so the real request is never modified, and replaces a
 * `password` field with a placeholder — `/users/login` and `/users/signup`
 * both carry one, and a logged failure on either would otherwise put the
 * plaintext password on disk.
 *
 * @param {any} body - `req.body`; a GET has none, which is returned unchanged
 * @returns {any} the body with `password` redacted, if it had one
 */
const safeBody = (body) => {
  if (!body || typeof body !== "object") return body;
  const copy = { ...body };
  if ("password" in copy) copy.password = "[redacted]";
  return copy;
};


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
 *   - `err.name === "ValidationError"` (Mongoose schema validation, including
 *     on updates, which pass `runValidators: true`) → 400, with the failing
 *     field's own message out of `err.errors`. The user reads the rule they
 *     broke ("Amount cannot have more than two decimal places") instead of a
 *     generic failure.
 *   - `err.status` set (e.g. 401 from `userService.login`) → that status, with
 *     `err.message` (a message the code chose on purpose).
 *   - anything else → 500 with a generic message; the real one is logged, not
 *     sent to the client.
 *
 * Logging: the 500 case at `error` level (this is what fills `logs/error.log`);
 * the deliberate 4xx and the 409 at `warn`, so `error.log` stays a list of real
 * problems. Every line carries the request body as well as the method, path
 * and stack — without it a logged failure cannot be reconstructed later, only
 * counted. The body goes through `safeBody` first, so a failed login never
 * writes a plaintext password to disk.
 *
 * @param {Error & { status?: number, code?: number }} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {

  if (err.code === 11000) {
    logger.warn(err.message, { method: req.method, stack: err.stack, path: req.originalUrl, body: safeBody(req.body) });
    const field = Object.keys(err.keyValue ?? {})[0] ?? "That value";
    return res.status(409).json({ error: `${field} already exists.` });
  }
  if (err.name === 'ValidationError') {
    logger.warn(err.message, { method: req.method, stack: err.stack, path: req.originalUrl, body: safeBody(req.body) });
    return res.status(400).json({ error: Object.values(err.errors)[0].message });
  }
  if (err.status) {
    logger.warn(err.message, { method: req.method, stack: err.stack, path: req.originalUrl, body: safeBody(req.body) });
    res.status(err.status).json({ error: err.message })
  } else {
    logger.error(err.message, { method: req.method, stack: err.stack, path: req.originalUrl, body: safeBody(req.body) });
    res.status(500).json({ error: "Something went wrong." })
  }
}

module.exports = {
  catchAsync,
  errorHandler
}