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
 *
 * Uses the same .env the bot uses (loaded below). Only public Kraken data is needed for the
 * analysis, so trading keys aren't required for it to run.
 */
import "dotenv/config";
import { loadConfig, symbolToKrakenId } from "./storage.js";
import { handleBacktest, handleDiscover, handleProfile, handleValidate } from "./commands.js";
import { backfill } from "./data.js";
import * as logger from './logger.js';

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
  backfill: async () => {
    const syms = rest.length ? rest : state.watchlist.map((a) => a.symbol);
    for (const sym of syms) {
      const id = symbolToKrakenId(sym);
      logger.info(`\n=== backfilling ${sym} (${id}) ===`);
      await backfill(id, 18);
    }
  },
};

if (!commands[cmd]) {
  logger.error("Usage: node research.js <backtest [SYMBOL] | discover | profile | validate | backfill SYM...>");
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
