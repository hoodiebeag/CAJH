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

function ma(candles, endExclusive, n) {
  if (endExclusive < n) return null;
  const rows = candles.slice(endExclusive - n, endExclusive);
  if (rows.length !== n || rows.some((row) => !finitePrice(row.close))) return null;
  return rows.reduce((sum, row) => sum + row.close, 0) / n;
}

export function crossoverTrades(candles, {
  fast = 50,
  slow = 200,
  roundTripCost = ROUND_TRIP_COST
} = {}) {
  if (fast !== 50 || slow !== 200) throw new Error("TF1 is pre-registered as MA(50)/MA(200) only");
  const rows = [...candles].sort((a, b) => a.time - b.time);
  const trades = [];
  let position = null;

  for (let i = slow; i + 1 < rows.length; i++) {
    const prevFast = ma(rows, i, fast);
    const prevSlow = ma(rows, i, slow);
    const currFast = ma(rows, i + 1, fast);
    const currSlow = ma(rows, i + 1, slow);
    if ([prevFast, prevSlow, currFast, currSlow].some((x) => x === null)) continue;
    const crossedUp = prevFast <= prevSlow && currFast > currSlow;
    const crossedDown = prevFast >= prevSlow && currFast < currSlow;
    const execution = rows[i + 1]; // t+1 daily close, never trigger-bar close.
    if (crossedUp && !position) {
      position = { entryIndex: i + 1, entryTime: execution.time, entryDate: dateOf(execution.time), entry: execution.close };
    } else if (crossedDown && position) {
      const grossReturn = execution.close / position.entry - 1;
      trades.push({
        ...position,
        exitIndex: i + 1,
        exitTime: execution.time,
        exitDate: dateOf(execution.time),
        exit: execution.close,
        grossReturn,
        netReturn: grossReturn - roundTripCost,
        roundTripCost,
        holdingDays: i + 1 - position.entryIndex
      });
      position = null;
    }
  }
  return trades;
}

export function buyAndHold(candles) {
  const rows = candles.filter((row) => finitePrice(row.close)).sort((a, b) => a.time - b.time);
  if (rows.length < 2) return null;
  return rows.at(-1).close / rows[0].close - 1;
}

export function scoreAsset(symbol, candles, options = {}) {
  const trades = crossoverTrades(candles, options);
  const netReturns = trades.map((trade) => trade.netReturn);
  return {
    symbol,
    bars: candles.length,
    start: candles[0] ? dateOf(candles[0].time) : null,
    end: candles.at(-1) ? dateOf(candles.at(-1).time) : null,
    crossovers: trades.length,
    positionDays: trades.reduce((sum, trade) => sum + trade.holdingDays, 0),
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
    crossovers: scores.reduce((sum, row) => sum + row.crossovers, 0),
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

function verdictFor(summary) {
  if (summary.crossovers < 1) return "CONTEXT-ONLY";
  if (!Number.isFinite(summary.netReturn) || !Number.isFinite(summary.buyHoldReturn)) return "CONTEXT-ONLY";
  return summary.netReturn > summary.buyHoldReturn ? "PASS" : "KILLED";
}

export function runMaCrossoverStudy(series, {
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
      specification: "TF1-MA50-MA200-long-cash/v1",
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
        : "No promoted edge: sparse or net-underperforming holdout is KILLED/CONTEXT-ONLY."
    }
  };
}
