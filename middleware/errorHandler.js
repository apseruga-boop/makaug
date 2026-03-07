const logger = require('../config/logger');

function notFound(req, res) {
  return res.status(404).json({
    ok: false,
    error: 'Not Found',
    path: req.originalUrl
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  const message = status >= 500 ? 'Internal Server Error' : err.message;

  logger.error('API error', {
    status,
    path: req.originalUrl,
    method: req.method,
    message: err.message,
    stack: err.stack
  });

  return res.status(status).json({
    ok: false,
    error: message
  });
}

module.exports = {
  notFound,
  errorHandler
};
