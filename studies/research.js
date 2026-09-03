/**
 * research.js — Local research runner.
 *
 * Runs cajh's analysis (backtest / discover / profile / validate) against the LOCAL candle
 * store and prints to the console — no Discord, no live bot. The deep backfilled data lives
 * on this machine, so research runs on this machine; the Railway bot is untouched.
 *
 *   node research.js backtest BTC
 *   node research.js discover
 *   node research.js profile
 *   node research.js validate
 *   node research.js momentum
 *   node research.js tournament
 *   node research.js search
 *   node research.js portfolio
 *   node research.js riskoff
 *   node research.js derivatives [PF_XBTUSD] [days]
 *   node research.js funding
 *
 * Uses the same .env the bot uses (loaded below). Only public Kraken data is needed for the
 * analysis, so trading keys aren't required for it to run.
 */
import "dotenv/config";
import { loadConfig, symbolToKrakenId } from "../storage.js";
import { handleBacktest, handleDiscover, handleProfile, handleValidate, handleExits, handleExcursion } from "../commands.js";
import { backfill, backfillRange, ingestKrakenOHLCVT } from "../data.js";
import * as logger from '../logger.js';
import path from "path";

// Stand-in for a Discord message: whatever a handler "replies" or "sends" just prints.
const print = (t) => console.log("\n" + t + "\n");
const message = { reply: async (t) => print(t), channel: { send: async (t) => print(t) } };

// Watchlist-scanning handlers need a watchlist; build it from the WATCHLIST env, else config.
const config = loadConfig();
const envWatchlist = (process.env.WATCHLIST || "")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  .map((sym) => ({ id: symbolToKrakenId(sym), symbol: sym }));
const state = { watchlist: envWatchlist.length ? envWatchlist : (config.watchlist || []) };

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest[0];
const commands = {
  backtest: () => handleBacktest(message, state, arg || ""),
  discover: () => handleDiscover(message, state),
  profile:  () => handleProfile(message, state),
  validate: () => handleValidate(message, state),
  exits:    () => handleExits(message, state),
  excursion:() => handleExcursion(message, state),
  backfill: async () => {
    const syms = rest.length ? rest : state.watchlist.map((a) => a.symbol);
    for (const sym of syms) {
      const id = symbolToKrakenId(sym);
      logger.info(`\n=== backfilling ${sym} (${id}) ===`);
      await backfill(id, 18);
    }
  },
  // Rebuild a window from raw trades so buyVol/sellVol/maxTrade exist (the OHLCVT
  // archive has no order flow). FLOW_FROM / FLOW_TO are YYYY-MM-DD; default last 90 days.
  flow: async () => {
    const day = 24 * 60 * 60;
    const from = process.env.FLOW_FROM ? Date.parse(`${process.env.FLOW_FROM}T00:00:00Z`) / 1000
                                       : Math.floor(Date.now() / 1000) - 90 * day;
    const to   = process.env.FLOW_TO   ? Date.parse(`${process.env.FLOW_TO}T00:00:00Z`) / 1000
                                       : Math.floor(Date.now() / 1000);
    const syms = rest.length ? rest : state.watchlist.map((a) => a.symbol);
    for (const sym of syms) {
      const id = symbolToKrakenId(sym);
      logger.info(`
=== order-flow backfill ${sym} (${id}) ===`);
      await backfillRange(id, from, to);
    }
  },
  ingest: async () => {
    const dir = process.env.ARCHIVE_DIR || "archive";
    // Default to the last ~18 months; INGEST_SINCE=YYYY-MM-DD reaches further back (the
    // archive holds years, and testing across a bull AND a bear regime needs them).
    const sinceSec = process.env.INGEST_SINCE
      ? Math.floor(Date.parse(`${process.env.INGEST_SINCE}T00:00:00Z`) / 1000)
      : Math.floor(Date.now() / 1000) - 18 * 30 * 24 * 60 * 60;
    if (!Number.isFinite(sinceSec)) throw new Error(`INGEST_SINCE must be YYYY-MM-DD, got "${process.env.INGEST_SINCE}"`);
    logger.info(`[INGEST] including bars from ${new Date(sinceSec * 1000).toISOString().slice(0, 10)} onward`);
    const syms = rest.length ? rest : state.watchlist.map((a) => a.symbol);
    for (const sym of syms) {
      const id = symbolToKrakenId(sym);
      const src = path.join(dir, `${id}_1.csv`);
      try {
        const n = ingestKrakenOHLCVT(id, src, sinceSec);
        logger.info(`[INGEST] ${sym} (${id}): ${n} bars ← ${src}`);
      } catch (e) {
        logger.error(`[INGEST] ${sym} (${id}): ${e.message}`);
      }
    }
  },
  momentum: async () => {
    const { runMomentumStudy } = await import("./momentum.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const study = runMomentumStudy({ permutations: Number(process.env.PERMUTATIONS) || 1000 });
    const file = saveExperiment("momentum", study.input, study.result);
    print(JSON.stringify({ ...study.result.primary, saved: file }, null, 2));
  },
  tournament: async () => {
    const { runTournament } = await import("../tournament.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const report = runTournament();
    const file = saveExperiment("tournament", report.input, report.result);
    print(JSON.stringify({ ...report.result, saved: file }, null, 2));
  },
  search: async () => {
    const { runStrategySearch } = await import("./strategy-search.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const report = runStrategySearch();
    const file = saveExperiment("strategy-search", report.input, report.result);
    print(JSON.stringify({ ...report.result, saved: file }, null, 2));
  },
  portfolio: async () => {
    const { runPortfolioStudy } = await import("./portfolio.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const report = runPortfolioStudy();
    const file = saveExperiment("portfolio-study", report.input, report.result);
    print(JSON.stringify({ ...report.result, saved: file }, null, 2));
  },
  riskoff: async () => {
    const { runRiskOffSearch } = await import("./portfolio.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const report = runRiskOffSearch();
    const file = saveExperiment("risk-off-search", report.input, report.result);
    print(JSON.stringify({ ...report.result, saved: file }, null, 2));
  },
  derivatives: async () => {
    const { fetchAnalytics, fetchFundingRates } = await import("./derivatives.mjs");
    const symbol = arg || "PF_XBTUSD";
    const days = Math.max(7, Math.min(365, Number(rest[1]) || 90));
    const to = Math.floor(Date.now() / 1000), since = to - days * 86400;
    const [funding, openInterest, liquidations, rates] = await Promise.all([
      fetchAnalytics({ symbol, type: "funding", since, to, interval: 86400 }),
      fetchAnalytics({ symbol, type: "open-interest", since, to, interval: 86400 }),
      fetchAnalytics({ symbol, type: "liquidation-volume", since, to, interval: 86400 }),
      fetchFundingRates({ symbol }),
    ]);
    print(JSON.stringify({ symbol, days, analytics: {
      fundingPoints: funding.normalized.points.length, openInterestPoints: openInterest.normalized.points.length,
      liquidationPoints: liquidations.normalized.points.length, historicalFundingRates: rates.rates.length,
    }, cache: "research-cache/derivatives" }, null, 2));
  },
  funding: async () => {
    const { runFundingCashStudy } = await import("./funding-study.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const report = await runFundingCashStudy();
    const file = saveExperiment("funding-cash-study", report.input, report.result);
    print(JSON.stringify({ ...report.result, saved: file }, null, 2));
  },
  h11: async () => {
    const { runFundingGateH11 } = await import("./funding-gate-h11.mjs");
    const { saveExperiment } = await import("../researchlab.mjs");
    const report = await runFundingGateH11();
    const file = saveExperiment("funding-gate-h11", report.input, report.result);
    print(JSON.stringify({ ...report.result, saved: file }, null, 2));
  },
};

if (!commands[cmd]) {
  logger.error("Usage: node research.js <backtest [SYMBOL] | discover | profile | validate | exits | excursion | momentum | tournament | search | portfolio | riskoff | derivatives [PF_XBTUSD] [days] | funding | flow | backfill SYM... | ingest SYM...>");
  process.exitCode = 1;
} else {
  logger.info(`[research] running "${cmd}${arg ? " " + arg : ""}" against local candles/ …`);
  (async () => {
    try {
      await commands[cmd]();
      process.exitCode = 0;
    } catch (err) {
      logger.error(err);
      process.exitCode = 1;
    }
  })();
}
