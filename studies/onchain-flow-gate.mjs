/**
 * TEST4-ONCHAIN-FLOW-GATE: breakout entries gated on net exchange outflow.
 *
 * Hypothesis: 7-day rolling net exchange outflow (coins leaving exchanges = reduced sell
 * pressure) as an entry gate, layered on `breakout`'s own trigger (1d timeframe only,
 * BTC/ETH), produces holdout avgR/trade > -0.30 — a leading demand indicator unavailable
 * to every price-structure-only family already tested (see VERDICTS.md).
 *
 * Data-availability gate, run first (per this item's own pre-registered done_when): this
 * repo has never done on-chain data ingestion before this item — no Glassnode/CryptoQuant
 * client, no cached flow series, nothing. Checked directly against Glassnode's public
 * `transactions/transfers_volume_exchanges_net` endpoint (the closest free-tier metric to
 * "net exchange flow"): it returns HTTP 401 with no API key, which this environment does
 * not have (no GLASSNODE_API_KEY/CRYPTOQUANT_API_KEY in .env, confirmed directly) and
 * cannot obtain unattended (registering an account is outside this project's automation).
 * That is the data-availability gate failing immediately, exactly as this item's own task
 * text anticipated ("very likely trigger immediately... a fine, complete, honest outcome").
 * The backtest/entry-gate logic described in the hypothesis above is therefore not
 * implemented — it would be untestable dead code with no real data path to exercise it,
 * which this project's simplicity convention avoids.
 */
import axios from "axios";
import { saveExperiment } from "../researchlab.mjs";

const DAY = 86400_000;
const GLASSNODE_URL = "https://api.glassnode.com/v1/metrics/transactions/transfers_volume_exchanges_net";

/** Real attempt against Glassnode's free-tier net-exchange-flow metric. Injectable for tests. */
export async function fetchGlassnodeNetFlow({ asset, apiKey = process.env.GLASSNODE_API_KEY } = {}) {
  try {
    const { data } = await axios.get(GLASSNODE_URL, { params: { a: asset, i: "24h", api_key: apiKey || "" }, timeout: 15_000 });
    if (!Array.isArray(data) || data.length < 2) return { available: false, reason: "empty response" };
    const points = data
      .map((row) => ({ time: Number(row?.t) * 1000, value: Number(row?.v) }))
      .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
      .sort((a, b) => a.time - b.time);
    return { available: true, points };
  } catch (err) {
    const status = err.response?.status;
    const keyNote = apiKey ? "" : " (no GLASSNODE_API_KEY configured)";
    return { available: false, reason: status ? `glassnode-fetch-error: HTTP ${status}${keyNote}` : `glassnode-fetch-error: ${err.message}` };
  }
}

export async function runOnchainFlowGateStudy({
  assets = ["BTC", "ETH"], minHistoryDays = 730, fetchFlow = fetchGlassnodeNetFlow,
} = {}) {
  const coverage = [];
  for (const asset of assets) {
    const res = await fetchFlow({ asset });
    if (!res.available) { coverage.push({ asset, included: false, reason: res.reason }); continue; }
    const days = res.points.length ? (res.points.at(-1).time - res.points[0].time) / DAY : 0;
    if (days < minHistoryDays) { coverage.push({ asset, included: false, reason: `flow-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }
    coverage.push({ asset, included: true, days: +days.toFixed(1) });
  }

  const eligible = coverage.filter((c) => c.included);
  const input = { specification: "onchain-flow-gate/v1", assets, minHistoryDays, coverage };

  if (eligible.length < assets.length) {
    return {
      input,
      result: { verdict: "ONCHAIN-DATA-INSUFFICIENT", eligibleAssets: eligible.length, requiredAssets: assets.length, coverage },
    };
  }

  // Unreachable in this environment (no on-chain data source is available) — see the
  // module doc comment for why the entry-gate/backtest logic stops here rather than being
  // built out speculatively against data this project has never been able to fetch.
  return { input, result: { verdict: "ONCHAIN-FLOW-GATE-NOT-IMPLEMENTED: data available but backtest logic was never built (see module doc comment)", coverage } };
}

if (process.argv[1]?.endsWith("onchain-flow-gate.mjs")) {
  const report = await runOnchainFlowGateStudy();
  const saved = saveExperiment("onchain-flow-gate", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
