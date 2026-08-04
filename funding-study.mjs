/** Research-only, spot-safe test of derivatives funding as a cash signal. */
import { loadResearchCandles } from "./researchlab.mjs";
import { fetchFundingRates } from "./derivatives.mjs";

const DAY = 86400;
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stdev = (xs) => xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) : 0;

function dailyFunding(rates) {
  const buckets = new Map();
  for (const row of rates) {
    const time = Date.parse(row.timestamp) / 1000, value = Number(row.relativeFundingRate);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    const day = Math.floor(time / DAY) * DAY;
    const values = buckets.get(day) || []; values.push(value); buckets.set(day, values);
  }
  return new Map([...buckets].map(([day, values]) => [day, mean(values)]));
}
function sim(rows, threshold, { start, end, costRate = .009 }) {
  let equity = 1, peak = 1, dd = 0, state = false, turnover = 0; const daily = [];
  for (let i = start; i < end; i++) {
    const row = rows[i], next = rows[i + 1];
    const want = row.funding < threshold; // excess positive funding is a crowding/risk-off signal
    if (want !== state) { equity *= 1 - costRate; turnover += 1; state = want; }
    const ret = state ? next.close / row.close - 1 : 0;
    equity *= 1 + ret; daily.push(ret); peak = Math.max(peak, equity); dd = Math.min(dd, equity / peak - 1);
  }
  const annual = daily.length ? equity ** (365 / daily.length) - 1 : 0, vol = stdev(daily) * Math.sqrt(365);
  return { days: daily.length, totalReturn: equity - 1, annualReturn: annual, volatility: vol, sharpe: vol ? annual / vol : 0, maxDrawdown: dd, turnover };
}

/**
 * Select a funding threshold solely on training data and score that fixed rule once
 * on the final chronological holdout.  Cash is the only risk-off action.
 */
export async function runFundingCashStudy({ symbol = "PF_XBTUSD", splitFraction = .70 } = {}) {
  const rates = await fetchFundingRates({ symbol });
  const funding = dailyFunding(rates.rates);
  const btc = loadResearchCandles("XBTUSD", 1440);
  const rows = btc.map((bar) => ({ ...bar, funding: funding.get(bar.time) })).filter((row) => Number.isFinite(row.funding));
  if (rows.length < 150) throw new Error(`Only ${rows.length} aligned BTC/funding days; need at least 150`);
  const split = Math.floor(rows.length * splitFraction);
  const trainValues = rows.slice(0, split).map((r) => r.funding).sort((a, b) => a - b);
  const quantiles = [.50, .60, .70, .80, .90];
  const ranked = quantiles.map((quantile) => {
    const threshold = trainValues[Math.floor((trainValues.length - 1) * quantile)];
    return { quantile, threshold, train: sim(rows, threshold, { start: 0, end: split }) };
  }).sort((a, b) => b.train.sharpe - a.train.sharpe);
  const finalists = ranked.map((row) => ({ ...row, holdout: sim(rows, row.threshold, { start: split, end: rows.length - 1 }) }))
    .map((row) => ({ ...row, promoted: row.train.sharpe > .5 && row.holdout.sharpe > .5 && row.holdout.totalReturn > 0 && row.holdout.maxDrawdown > -.35 }));
  return {
    input: { specification: "funding-cash-study/v1", symbol, alignedDays: rows.length, splitFraction, quantiles, costRate: .009, action: "cash when funding is at or above train-derived threshold" },
    result: { finalists, verdict: finalists.some((r) => r.promoted) ? "paper-trading funding cash-gate candidate exists; no live promotion" : "no funding cash gate passes both chronological samples" },
  };
}
