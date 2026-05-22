const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

const PREFIXES = { error: '❌', warn: '⚠️', info: 'ℹ️', debug: '🔍' };

function log(level, message, meta) {
  if (LOG_LEVELS[level] > currentLevel) return;
  const ts = new Date().toISOString();
  const prefix = PREFIXES[level] || '';
  const extra = meta ? ' ' + JSON.stringify(meta) : '';
  console.error(`${prefix} [${ts}] ${message}${extra}`);
}

module.exports = {
  log,
  error: (m, meta) => log('error', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  info: (m, meta) => log('info', m, meta),
  debug: (m, meta) => log('debug', m, meta)
};