const logger = require("./.config/logger");

// Same async-wrapper idea as ex5, but this version also LOGS the error (with request context)
// before forwarding it. Keeps the routes clean — they just `throw`, this handles logging + next.
function catchAsync(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      logger.error(err.message, {  method: req.method, stack: err.stack, path: req.originalUrl });
      next(err);
    });
  };
}

// The one place errors turn into HTTP responses. 4-arg signature = Express error middleware.
// err.status || 400: use a status the code set on the error (e.g. 401 from userLogin), else default 400.
function errorHandler(err, req, res, next) {
  logger.error(err.message, { method: req.method, stack: err.stack, path: req.originalUrl });
  res.status(err.status || 400).json({ error: err.message });
}

module.exports = {  
  catchAsync,
  errorHandler
}