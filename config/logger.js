const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function shouldLog(level) {
  return LEVELS[level] <= LEVELS[currentLevel];
}

function write(level, ...args) {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](prefix, ...args);
}

module.exports = {
  error: (...args) => write('error', ...args),
  warn: (...args) => write('warn', ...args),
  info: (...args) => write('info', ...args),
  debug: (...args) => write('debug', ...args)
};
