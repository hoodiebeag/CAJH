/**
 * scripts/ibkr-universe-probe.mjs — can this IBKR account actually trade, and SHORT, the equities
 * universe the research uses?
 *
 * WHY THIS EXISTS. The crypto path died on exactly this question and nobody asked it until the
 * research was finished: the edge concentrated in names no venue would lend, and the borrowable
 * subset ranked 13th of 13 against random subsets of the same size. Asking it FIRST for equities
 * costs a few minutes and could save the same wasted campaign. A long-short strategy that passes
 * every statistical gate is untradeable if half its short leg cannot be borrowed.
 *
 * WHERE IT MUST RUN. On the machine with IB Gateway. 127.0.0.1:4002 is ECONNREFUSED from the cloud
 * session (checked 2026-09-02), so this is a script the owner runs, not a result computed in chat.
 *
 * WHAT IT WILL NOT DO. It places no orders, cancels nothing, and touches no file under brokers/.
 * Every call is read-only: reqContractDetails and a snapshot reqMktData.
 *
 * Usage:
 *   node scripts/ibkr-universe-probe.mjs [bundleRoot]      # default ./sp500-bundle
 *   IBKR_HOST=... IBKR_PORT=... node scripts/ibkr-universe-probe.mjs
 *
 * Writes ibkr-universe.json next to the repo root and prints a summary table.
 */
import fs from "node:fs";
import path from "node:path";
import { IBApi, EventName, IBApiTickType, isNonFatalError } from "@stoqey/ib";

const ROOT = process.argv[2] ?? "./sp500-bundle";
const HOST = process.env.IBKR_HOST ?? "127.0.0.1";
const PORT = Number(process.env.IBKR_PORT ?? 4002);
const CLIENT_ID = Number(process.env.IBKR_CLIENT_ID ?? 77);
const PER_SYMBOL_TIMEOUT_MS = 12_000;

// IBKR tick 46 (SHORTABLE) is a coded float, not a share count:
//   > 2.5  shares are available
//   1.5-2.5 available but hard to borrow, expect a fee
//   <= 1.5 not shortable
// Tick 89 (SHORTABLE_SHARES) carries the actual quantity when the account is entitled to it.
const readShortable = (v) => (v > 2.5 ? "available" : v > 1.5 ? "hard-to-borrow" : "not shortable");

const symbols = fs.readdirSync(path.join(ROOT, "1440"))
  .filter(f => f.endsWith(".csv")).map(f => f.replace(/\.csv$/, "")).sort();
if (!symbols.length) { console.error(`no symbols under ${ROOT}/1440`); process.exit(1); }
console.log(`Probing ${symbols.length} symbols from ${ROOT} against ${HOST}:${PORT}\n`);

const api = new IBApi({ host: HOST, port: PORT, clientId: CLIENT_ID });
const fatal = (code, err) => !isNonFatalError(code, err);
let nextId = 1;

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no connection to ${HOST}:${PORT} after 15s`)), 15_000);
  api.once(EventName.connected, () => { clearTimeout(t); resolve(); });
  api.once(EventName.error, (err, code) => { if (code === -1 || fatal(code, err)) { clearTimeout(t); reject(err); } });
  api.connect();
});
console.log("connected\n");

const stock = (symbol) => ({ symbol, secType: "STK", exchange: "SMART", currency: "USD" });

/** Does the contract resolve, and on what primary exchange? A symbol the bundle carries that IBKR
 *  cannot resolve is untradeable regardless of what any backtest says about it. */
function resolveContract(symbol) {
  const id = nextId++;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return; done = true; clearTimeout(timer);
      api.off(EventName.contractDetails, onDetails); api.off(EventName.contractDetailsEnd, onEnd);
      api.off(EventName.error, onError); resolve(v);
    };
    let found = null;
    const onDetails = (rid, d) => { if (rid === id && !found) found = d?.contract?.primaryExch ?? d?.contract?.exchange ?? "?"; };
    const onEnd = (rid) => { if (rid === id) finish(found); };
    const onError = (err, code, rid) => { if (rid === id && fatal(code, err)) finish(null); };
    const timer = setTimeout(() => finish(null), PER_SYMBOL_TIMEOUT_MS);
    api.on(EventName.contractDetails, onDetails);
    api.on(EventName.contractDetailsEnd, onEnd);
    api.on(EventName.error, onError);
    api.reqContractDetails(id, stock(symbol));
  });
}

/** Shortability and price entitlement in one snapshot request. Generic tick 236 asks for the
 *  shortable feed; without it ticks 46/89 never arrive and every name would read "unknown". */
function probeShortable(symbol) {
  const id = nextId++;
  return new Promise((resolve) => {
    let done = false, code = null, shares = null, price = null, delayed = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      api.off(EventName.tickGeneric, onGeneric); api.off(EventName.tickPrice, onPrice);
      api.off(EventName.tickSize, onSize); api.off(EventName.tickSnapshotEnd, onEnd);
      api.off(EventName.error, onError);
      try { api.cancelMktData(id); } catch { /* snapshot may already be closed */ }
      resolve({ shortable: code === null ? "unknown" : readShortable(code), shortableRaw: code, shares, price, delayed });
    };
    const onGeneric = (rid, tick, v) => {
      if (rid !== id) return;
      if (tick === IBApiTickType.SHORTABLE) code = v;
      if (tick === IBApiTickType.SHORTABLE_SHARES) shares = v;
    };
    const onSize = (rid, tick, v) => { if (rid === id && tick === IBApiTickType.SHORTABLE_SHARES) shares = v; };
    const onPrice = (rid, tick, v) => {
      if (rid !== id || !(v > 0)) return;
      if (tick === IBApiTickType.LAST || tick === IBApiTickType.CLOSE) price ??= v;
      if (tick === IBApiTickType.DELAYED_LAST || tick === IBApiTickType.DELAYED_CLOSE) { price ??= v; delayed = true; }
    };
    const onEnd = (rid) => { if (rid === id) finish(); };
    const onError = (err, c, rid) => {
      if (rid !== id) return;
      if (c === 10167 || c === 10090) { delayed = true; return; }   // delayed data IS coming
      if (fatal(c, err)) finish();
    };
    const timer = setTimeout(finish, PER_SYMBOL_TIMEOUT_MS);
    api.on(EventName.tickGeneric, onGeneric); api.on(EventName.tickPrice, onPrice);
    api.on(EventName.tickSize, onSize); api.on(EventName.tickSnapshotEnd, onEnd);
    api.on(EventName.error, onError);
    api.reqMktData(id, stock(symbol), "236", true /* snapshot */, false);
  });
}

const rows = [];
for (const [i, sym] of symbols.entries()) {
  const exch = await resolveContract(sym);
  const short = exch ? await probeShortable(sym) : { shortable: "n/a", shares: null, price: null, delayed: false };
  rows.push({ symbol: sym, resolves: !!exch, exchange: exch, ...short });
  process.stdout.write(`\r  ${i + 1}/${symbols.length}  ${sym.padEnd(6)}`);
  await new Promise(r => setTimeout(r, 120));      // IBKR pacing: stay well under the request cap
}
console.log("\n");

const count = (fn) => rows.filter(fn).length;
console.log("symbol".padEnd(8) + "exch".padEnd(10) + "shortable".padEnd(17) + "shares".padStart(12) + "  price");
for (const r of rows) {
  console.log(r.symbol.padEnd(8) + String(r.exchange ?? "-").padEnd(10) + r.shortable.padEnd(17) +
    String(r.shares ?? "-").padStart(12) + "  " + (r.price ?? "-") + (r.delayed ? " (delayed)" : ""));
}
console.log(`\nresolves: ${count(r => r.resolves)}/${rows.length}`);
console.log(`shortable available: ${count(r => r.shortable === "available")}`);
console.log(`hard to borrow:      ${count(r => r.shortable === "hard-to-borrow")}`);
console.log(`NOT shortable:       ${count(r => r.shortable === "not shortable")}`);
console.log(`unknown (no 236 entitlement or no data): ${count(r => r.shortable === "unknown")}`);
console.log(`delayed price data:  ${count(r => r.delayed)}`);
fs.writeFileSync("ibkr-universe.json", JSON.stringify({ probedAt: new Date().toISOString(), host: `${HOST}:${PORT}`, root: ROOT, rows }, null, 2));
console.log("\nwrote ibkr-universe.json");
console.log("A universe where a large share is 'unknown' means the account lacks the shortable feed,");
console.log("not that the names are unborrowable. Those are different answers -- check before reading.");
api.disconnect();
