import { createHash } from "node:crypto";

export const STABLE_13 = Object.freeze([
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "LTC", "BCH", "ATOM", "XLM"
]);
export const PRIMARY_SYMBOL_HOLDOUT = Object.freeze(["ATOM", "DOT", "LTC"]);
export const RECENT_HOLDOUT_DAYS = 180;
export const ROUND_TRIP_COST = 0.009;

const DAY = 86400;
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const dateOf = (time) => new Date(time * 1000).toISOString().slice(0, 10);
const finitePrice = (x) => Number.isFinite(x) && x > 0;

/** Simple MA of the `n` closes ending at (and including) index `end`. Null if short. */
function maAt(rows, end, n) {
  if (end < n - 1) return null;
  const window = rows.slice(end - n + 1, end + 1);
  if (window.length !== n || window.some((row) => !finitePrice(row.close))) return null;
  return window.reduce((sum, row) => sum + row.close, 0) / n;
}

/**
 * Wilder RSI(14), one value per index, seeded by a plain average of the first `period`
 * changes then smoothed thereafter — the same formula already used elsewhere in this
 * repo (backtest.js's rsiEntry), kept identical so results are comparable.
 */
function rsiSeries(rows, period = 14) {
  const closes = rows.map((row) => row.close);
  const out = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    if (!finitePrice(closes[i]) || !finitePrice(closes[i - 1])) continue;
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0), loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain; avgLoss += loss;
      if (i === period) {
        avgGain /= period; avgLoss /= period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

export function reversionTrades(candles, {
  rsiPeriod = 14,
  rsiThreshold = 30,
  maPeriod = 20,
  maxHoldDays = 7,
  roundTripCost = ROUND_TRIP_COST
} = {}) {
  if (rsiPeriod !== 14 || rsiThreshold !== 30 || maPeriod !== 20 || maxHoldDays !== 7) {
    throw new Error("MR1 is pre-registered as RSI(14)/30/MA(20)/7-day only");
  }
  const rows = [...candles].sort((a, b) => a.time - b.time);
  const rsi = rsiSeries(rows, rsiPeriod);
  const trades = [];
  let position = null;

  for (let i = rsiPeriod; i + 1 < rows.length; i++) {
    if (position) {
      // "the first SUBSEQUENT close at or above MA(20)" excludes the entry bar itself —
      // the entry fill and its own close cannot also be its exit signal.
      const heldDays = i - position.entryIndex;
      if (heldDays >= 1) {
        const ma = maAt(rows, i, maPeriod);
        const closeCoversMA = ma !== null && finitePrice(rows[i].close) && rows[i].close >= ma;
        if (closeCoversMA || heldDays >= maxHoldDays) {
          const execution = rows[i];
          const grossReturn = execution.close / position.entry - 1;
          trades.push({
            ...position,
            exitIndex: i,
            exitTime: execution.time,
            exitDate: dateOf(execution.time),
            exit: execution.close,
            exitReason: closeCoversMA ? "ma_reclaim" : "timeout",
            grossReturn,
            netReturn: grossReturn - roundTripCost,
            roundTripCost,
            holdingDays: heldDays
          });
          position = null;
        }
      }
      continue; // one position at a time — do not also scan for a new entry this bar
    }

    if (rsi[i - 1] === null || rsi[i] === null) continue;
    const crossedUp = rsi[i - 1] < rsiThreshold && rsi[i] >= rsiThreshold;
    if (!crossedUp) continue;
    const execution = rows[i + 1]; // t+1 daily close, never the trigger-bar close.
    if (!finitePrice(execution.close)) continue;
    position = { entryIndex: i + 1, entryTime: execution.time, entryDate: dateOf(execution.time), entry: execution.close };
  }
  return trades;
}

export function buyAndHold(candles) {
  const rows = candles.filter((row) => finitePrice(row.close)).sort((a, b) => a.time - b.time);
  if (rows.length < 2) return null;
  return rows.at(-1).close / rows[0].close - 1;
}

export function scoreAsset(symbol, candles, options = {}) {
  const trades = reversionTrades(candles, options);
  const netReturns = trades.map((trade) => trade.netReturn);
  return {
    symbol,
    bars: candles.length,
    start: candles[0] ? dateOf(candles[0].time) : null,
    end: candles.at(-1) ? dateOf(candles.at(-1).time) : null,
    signals: trades.length,
    positionDays: trades.reduce((sum, trade) => sum + trade.holdingDays, 0),
    timeouts: trades.filter((trade) => trade.exitReason === "timeout").length,
    grossReturn: mean(trades.map((trade) => trade.grossReturn)),
    netReturn: mean(netReturns),
    buyHoldReturn: buyAndHold(candles),
    trades
  };
}

function summarize(scores) {
  return {
    assets: scores.length,
    bars: scores.reduce((sum, row) => sum + row.bars, 0),
    signals: scores.reduce((sum, row) => sum + row.signals, 0),
    timeouts: scores.reduce((sum, row) => sum + row.timeouts, 0),
    positionDays: scores.reduce((sum, row) => sum + row.positionDays, 0),
    grossReturn: mean(scores.map((row) => row.grossReturn).filter(Number.isFinite)),
    netReturn: mean(scores.map((row) => row.netReturn).filter(Number.isFinite)),
    buyHoldReturn: mean(scores.map((row) => row.buyHoldReturn).filter(Number.isFinite))
  };
}

function recentSplit(series, recentDays = RECENT_HOLDOUT_DAYS) {
  const latest = Math.max(...[...series.values()].flatMap((rows) => rows.map((row) => row.time)));
  const cutoff = latest - recentDays * DAY;
  const train = new Map();
  const holdout = new Map();
  for (const [symbol, rows] of series) {
    train.set(symbol, rows.filter((row) => row.time < cutoff));
    holdout.set(symbol, rows.filter((row) => row.time >= cutoff));
  }
  return { cutoff, train, holdout };
}

function hashSeries(series) {
  const hash = createHash("sha256");
  for (const [symbol, rows] of [...series].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(symbol);
    hash.update(String(rows.length));
    if (rows[0]) hash.update(`${rows[0].time}:${rows[0].close}`);
    if (rows.at(-1)) hash.update(`${rows.at(-1).time}:${rows.at(-1).close}`);
  }
  return hash.digest("hex");
}

// Fail-closed per AGENT_RUNBOOK.md: too few completed holdout signals, or a non-positive
// net holdout result, is KILLED or CONTEXT-ONLY — never PASS on a thin or losing sample.
const MIN_HOLDOUT_SIGNALS = 5;

function verdictFor(summary) {
  if (summary.signals < MIN_HOLDOUT_SIGNALS) return "CONTEXT-ONLY";
  if (!Number.isFinite(summary.netReturn) || !Number.isFinite(summary.buyHoldReturn)) return "CONTEXT-ONLY";
  if (summary.netReturn <= 0) return "KILLED";
  return summary.netReturn > summary.buyHoldReturn ? "PASS" : "KILLED";
}

export function runRsiReversionStudy(series, {
  universe = STABLE_13,
  symbolHoldout = PRIMARY_SYMBOL_HOLDOUT,
  recentHoldoutDays = RECENT_HOLDOUT_DAYS,
  roundTripCost = ROUND_TRIP_COST
} = {}) {
  const available = new Set(series.keys());
  const symbols = universe.filter((symbol) => available.has(symbol));
  const held = symbolHoldout.filter((symbol) => available.has(symbol));
  const trainSymbols = symbols.filter((symbol) => !held.includes(symbol));
  const recent = recentSplit(new Map(symbols.map((symbol) => [symbol, series.get(symbol)])), recentHoldoutDays);

  const scoreSymbols = (names, source) => names.map((symbol) => scoreAsset(symbol, source.get(symbol) || [], { roundTripCost }));
  const train = scoreSymbols(trainSymbols, recent.train);
  const recentHoldout = scoreSymbols(trainSymbols, recent.holdout);
  const primarySymbolHoldout = scoreSymbols(held, new Map(held.map((symbol) => [symbol, series.get(symbol)])));
  const holdoutSummary = summarize([...recentHoldout, ...primarySymbolHoldout]);
  const verdict = verdictFor(holdoutSummary);

  return {
    input: {
      specification: "MR1-RSI14x30-MA20-7day-long-cash/v1",
      universe: [...universe],
      symbols,
      trainSymbols,
      symbolHoldout: held,
      recentHoldoutFrom: dateOf(recent.cutoff),
      roundTripCost,
      fingerprint: hashSeries(series)
    },
    result: {
      train: summarize(train),
      recentHoldout: summarize(recentHoldout),
      symbolHoldout: summarize(primarySymbolHoldout),
      holdout: holdoutSummary,
      verdict,
      perAsset: { train, recentHoldout, symbolHoldout: primarySymbolHoldout },
      limitation: verdict === "PASS"
        ? "Research-only PASS candidate; requires separate human-gated promotion."
        : verdict === "CONTEXT-ONLY"
        ? `Fewer than ${MIN_HOLDOUT_SIGNALS} completed holdout signals (or non-finite holdout) — not enough to support any inference either way.`
        : "No promoted edge: non-positive or net-underperforming holdout is KILLED."
    }
  };
}
