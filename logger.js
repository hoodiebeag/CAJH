const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function format(level, args) {
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  console.log(prefix, ...args);
}

export function error(...args) { if (LEVELS.error <= currentLevel) format('error', args); }
export function warn(...args)  { if (LEVELS.warn  <= currentLevel) format('warn',  args); }
export function info(...args)  { if (LEVELS.info  <= currentLevel) format('info',  args); }
export function debug(...args) { if (LEVELS.debug <= currentLevel) format('debug', args); }

export default { error, warn, info, debug };
