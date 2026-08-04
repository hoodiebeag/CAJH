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

const DECISION_LOG_LIMIT = Number.parseInt(process.env.DECISION_LOG_LIMIT || "500", 10);
const recentDecisions = [];

function cleanDecision(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) return null;
    if (typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") return undefined;
    return item;
  }));
}

export function recordDecision(decision, { sink = null, now = () => new Date().toISOString() } = {}) {
  const record = cleanDecision({
    type: "asset_decision",
    ts: now(),
    symbol: decision?.symbol ?? null,
    timeframe: decision?.timeframe ?? decision?.tf ?? null,
    taken: decision?.taken === true,
    reason: decision?.reason ?? null,
    entry: decision?.entry ?? null,
    stop: decision?.stop ?? null,
    takeProfit: decision?.takeProfit ?? decision?.tp ?? null,
    risk: decision?.risk ?? null,
    regime: decision?.regime ?? null,
    mode: decision?.mode ?? null
  });
  recentDecisions.push(record);
  const limit = Number.isInteger(DECISION_LOG_LIMIT) && DECISION_LOG_LIMIT > 0 ? DECISION_LOG_LIMIT : 500;
  if (recentDecisions.length > limit) recentDecisions.splice(0, recentDecisions.length - limit);
  try {
    if (sink) sink(record);
  } catch (err) {
    warn("[DECISION] non-blocking decision log sink failed:", err.message);
  }
  return record;
}

export function getRecentDecisions({ limit = DECISION_LOG_LIMIT } = {}) {
  const n = Number.isInteger(limit) && limit > 0 ? limit : DECISION_LOG_LIMIT;
  return recentDecisions.slice(-n);
}

export function resetDecisionLogForTests() {
  recentDecisions.length = 0;
}

export default { error, warn, info, debug, recordDecision, getRecentDecisions };
