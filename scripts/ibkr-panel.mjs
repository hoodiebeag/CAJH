#!/usr/bin/env node
/**
 * ibkr-panel.mjs — pull a CURRENT daily panel from IB Gateway so the analyst can run paper mode.
 *
 * READ-ONLY: `reqHistoricalData` only. No order path in this file or anything it imports.
 *
 * THE PROBLEM THIS SOLVES. analyst-run.mjs refuses paper mode on a stale panel, because a model
 * asked what it would do on a past date already knows what happened -- that refusal is the whole
 * measurement instrument, not a nuisance. sp500-bundle's last bar is 2026-09-03, so paper mode has
 * never run. This pulls current bars from the one vendor that is actually reachable.
 *
 * IT WRITES A SEPARATE ROOT AND NEVER TOUCHES sp500-bundle. THAT IS THE IMPORTANT PART.
 * The obvious design -- append fresh bars onto the existing CSVs -- is wrong twice over:
 *
 *   1. ADJUSTMENT BASIS. sp500-bundle is an owner-supplied tarball of unrecorded provenance.
 *      IBKR TRADES bars are split-adjusted but NOT dividend-adjusted. Dividend adjustment is
 *      applied BACKWARDS from the present, so a dividend-adjusted series' most recent bars are
 *      nearly raw and an overlap check on the last two weeks would MATCH while three years of
 *      older history sat on a different basis. The check that would catch it is a cross-sectional
 *      one -- ratios scaling with dividend yield -- and it cannot be run without a Gateway. So the
 *      join is not verifiable from here, and an unverifiable join is not made.
 *   2. REPRODUCIBILITY. Sixteen closed verdicts were computed on sp500-bundle exactly as it
 *      stands. Silently mutating it invalidates every one of them. That cost is larger than the
 *      cost of a separate pull.
 *
 * ONE YEAR IS ENOUGH, AND THE RESEARCH WINDOW IS NOT THE ANALYST'S WINDOW. The closed studies
 * needed 920 dates because they were measuring a 3.65-year book. The analyst needs enough history
 * to warm its indicators up -- the longest is a 120-day window with a 60-day z on top, so ~180
 * bars. A year of daily bars covers that with room, and the 1 Y / 1 day rung is the one already
 * measured working (251 bars, clean). Conflating the two artifacts is what created the splice
 * problem in the first place.
 *
 * RE-RUNNING IS SAFE. A second run merges by timestamp INSIDE this root, which is the same vendor
 * on the same basis, so no join question arises. A bar already present is replaced by the fresh
 * one rather than duplicated, because a late correction from the vendor should win.
 *
 * Usage:
 *   npm install @stoqey/ib
 *   node scripts/ibkr-panel.mjs
 *   git add ibkr-bundle/ && git commit -m "panel refresh" && git push
 *
 * Options:
 *   --host H --port P    default 127.0.0.1:4002
 *   --duration "1 Y"     how much history to request
 *   --out ibkr-bundle    destination root (refuses to be pointed at a research bundle)
 *   --delay MS           between requests, default 1200 (TWS paces historical data strictly)
 *   --symbols FILE       one ticker per line; # comments allowed; otherwise taken from a bundle
 *   --skip-fresh         skip symbols already current (resumes an interrupted pull)
 *   --fresh-days N       what "current" means for --skip-fresh, default 2
 *   --write-resolved F   where to write the IBKR-verified universe (default <out>/universe-resolved.txt)
 *   --symbols-from ROOT  bundle to take the symbol list from, default sp500-bundle
 *
 * THE UNIVERSE IS AN ARGUMENT BECAUSE IT IS THE BINDING CONSTRAINT. sp500-bundle is 128 large-cap
 * names. An agent asked to find an asymmetric setup cannot find one in a name it cannot see, and
 * most of the moves worth catching happen outside the S&P 500 -- small-cap biotech around a
 * readout, a memory name turning on the supply cycle. IBKR will return daily bars for any symbol
 * it can resolve, so the universe here is a text file, not a property of a tarball somebody sent.
 * A name that fails to resolve is REPORTED, never silently dropped: a universe that quietly
 * shrinks is how a study ends up describing a different population than it claims.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, fetchBars } from "../ibkr-bars.mjs";
import { availablePairs } from "../bundle-loader.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

if (flag("host", null)) process.env.IBKR_HOST = flag("host");
if (flag("port", null)) process.env.IBKR_PORT = flag("port");

const DURATION = flag("duration", "1 Y");
const OUT = flag("out", "ibkr-bundle");
const DELAY = Number(flag("delay", 1200));
const SRC = flag("symbols-from", "sp500-bundle");

// A research bundle is an input to closed verdicts, not a destination. Guarding by name is crude
// but it is the mistake actually worth preventing, and a wrong --out is silent until a study
// disagrees with its own record months later.
const PROTECTED = ["sp500-bundle", "candle-bundle", "candle-bundle-long", "equity-bundle"];
if (PROTECTED.includes(path.basename(OUT.replace(/\/+$/, "")))) {
  console.error(`refusing to write into "${OUT}": that is a research bundle behind closed verdicts.`);
  console.error("This script writes a NEW root on a single vendor's basis. Pick another --out.");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SYMFILE = flag("symbols", null);
let symbols, symSource;
if (SYMFILE) {
  // COMMENTS ARE STRIPPED PER LINE, BEFORE TOKENISING, and that is not a nicety. The ticker
  // pattern accepts any 1-10 letter word, so "# Semis and memory" contributed SEMIS, AND and
  // MEMORY as tickers -- three symbols nobody asked for, arriving as unresolvable names in a
  // report that also lists genuine delistings. A universe file is the natural place for a human
  // to write headings, so the file format has to survive one.
  symbols = [...new Set(
    fs.readFileSync(SYMFILE, "utf8")
      .split("\n")
      .map((line) => line.split("#")[0])
      .join(" ")
      .split(/[\s,]+/)
      .map((x) => x.trim().toUpperCase())
      .filter((x) => /^[A-Z][A-Z.\-]{0,9}$/.test(x)),
  )].sort();
  symSource = `${SYMFILE} (${symbols.length} tickers)`;
} else {
  symbols = availablePairs(1440, SRC);
  symSource = `${SRC} bundle`;
}
if (!symbols.length) { console.error(`no symbols from ${symSource}`); process.exit(2); }

console.log(`connecting to ${process.env.IBKR_HOST ?? "127.0.0.1"}:${process.env.IBKR_PORT ?? 4002} ...`);
const conn = await connect();
if (!conn.status.connected) {
  console.error(`\nno Gateway: ${conn.status.error}`);
  console.error("IB Gateway must be running and logged in, and this host trusted. Nothing was written.");
  process.exit(1);
}
console.log(`connected. read-only. pulling ${DURATION} of daily bars for ${symbols.length} symbols`);
console.log(`universe from ${symSource}`);
console.log(`(about ${Math.ceil(symbols.length * DELAY / 1000 / 60)} min at ${DELAY}ms spacing)\n`);

const dir = path.join(OUT, "1440");
fs.mkdirSync(dir, { recursive: true });

// RESUMABILITY, because a large universe cannot be pulled in one sitting. IBKR paces historical
// data requests hard, so a thousand-name pull runs for hours and WILL be interrupted -- by a
// throttle, a disconnect, or somebody closing the laptop. --skip-fresh skips any symbol whose CSV
// already reaches within `--fresh-days` of the newest bar seen so far, so re-running continues
// rather than starting over. It also makes the daily refresh cheap.
const SKIP_FRESH = args.includes("--skip-fresh");
const FRESH_DAYS = Number(flag("fresh-days", 2));
const freshCutoff = Math.floor(Date.now() / 1000) - FRESH_DAYS * 86400;

const ok = [], failed = [], skipped = [];
let reqId = 7000;
for (const sym of symbols) {
  if (SKIP_FRESH) {
    const f = path.join(dir, `${sym}.csv`);
    if (fs.existsSync(f)) {
      const lines = fs.readFileSync(f, "utf8").trim().split("\n");
      const last = Number(lines.at(-1)?.split(",")[0]);
      if (Number.isFinite(last) && last >= freshCutoff) {
        skipped.push({ sym, bars: lines.length - 1, last });
        process.stdout.write("=");
        continue;
      }
    }
  }
  const r = await fetchBars(conn, { symbol: sym, secType: "STK", exchange: "SMART", currency: "USD" },
                            DURATION, conn.ib.WhatToShow.TRADES, reqId++, "1 day");
  await sleep(DELAY);
  if (!r.ok || !r.bars.length) { failed.push([sym, r.reason || "no bars"]); process.stdout.write("x"); continue; }
  const file = path.join(dir, `${sym}.csv`);
  const merged = new Map();
  // Existing rows first so a fresh bar overwrites its own timestamp: a vendor correction should win.
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").trim().split("\n").slice(1)) {
      const t = Number(line.split(",")[0]);
      if (Number.isFinite(t)) merged.set(t, line);
    }
  }
  for (const b of r.bars) {
    if (![b.open, b.high, b.low, b.close].every(Number.isFinite)) continue;
    merged.set(b.time, `${b.time},${b.open},${b.high},${b.low},${b.close},${Number.isFinite(b.volume) ? b.volume : 0}`);
  }
  const rows = [...merged.entries()].sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(file, "time,open,high,low,close,volume\n" + rows.map((x) => x[1]).join("\n") + "\n");
  ok.push({ sym, bars: rows.length, last: rows.at(-1)[0] });
  process.stdout.write(".");
}
process.stdout.write("\n");

try { conn.api.disconnect(); } catch { /* socket may already be closed */ }

// ---- what actually landed, reported rather than assumed --------------------------------------
const lasts = ok.map((x) => x.last).sort((a, b) => a - b);
const newest = lasts.at(-1) ?? 0;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const behind = ok.filter((x) => x.last < newest);

console.log(`\n${ok.length}/${symbols.length} symbols written to ${dir}` +
            `${skipped.length ? `, ${skipped.length} already current and skipped` : ""}`);
if (ok.length) {
  console.log(`newest bar across the panel: ${iso(newest)}`);
  console.log(`bars per symbol: min ${Math.min(...ok.map((x) => x.bars))}, max ${Math.max(...ok.map((x) => x.bars))}`);
  if (behind.length) {
    console.log(`${behind.length} symbol(s) do not reach the newest date -- a panel is only as ` +
                `current as its laggards:`);
    for (const x of behind.slice(0, 10)) console.log(`  ${x.sym.padEnd(6)} last ${iso(x.last)}`);
  }
}
if (failed.length) {
  console.log(`\n${failed.length} failed (left out, not filled in):`);
  for (const [s, why] of failed.slice(0, 15)) console.log(`  ${s.padEnd(6)} ${why}`);
}

fs.writeFileSync(path.join(OUT, "PROVENANCE.json"), JSON.stringify({
  source: "IBKR reqHistoricalData, SMART/USD STK, whatToShow TRADES",
  adjustment: "IBKR TRADES bars: split-adjusted, NOT dividend-adjusted. Single vendor, single basis.",
  doNotJoin: "Do not merge with sp500-bundle or any other root. Different vendor, unverified basis.",
  duration: DURATION, symbolsFrom: symSource,
  collectedAt: new Date().toISOString(),
  symbols: ok.length, failed: failed.map(([s, why]) => ({ symbol: s, reason: why })),
  newestBar: newest ? iso(newest) : null,
}, null, 2) + "\n");
console.log(`\nwrote ${path.join(OUT, "PROVENANCE.json")}`);

// THE FIRST RUN IS THE CLEANING PASS. A hand-written universe carries names that were acquired,
// renamed or delisted, and no list assembled away from the broker can know which. IBKR is the
// authority, so the symbols it actually resolved are written back out as a verified universe --
// use that file from then on and the failures stop repeating every run.
if (SYMFILE) {
  const resolvedFile = flag("write-resolved", path.join(OUT, "universe-resolved.txt"));
  const live = [...ok.map((x) => x.sym), ...skipped.map((x) => x.sym)].sort();
  fs.writeFileSync(resolvedFile,
    `# Resolved against IBKR ${new Date().toISOString().slice(0, 10)} from ${SYMFILE}\n` +
    `# ${live.length} of ${symbols.length} resolved; ${failed.length} did not and are left out.\n` +
    live.join("\n") + "\n");
  console.log(`wrote ${resolvedFile} — ${live.length} verified tickers. Use this file from now on.`);
}
console.log("\nCommit and push so the agent can decide on it:");
console.log(`  git add ${OUT}/ && git commit -m "panel refresh ${newest ? iso(newest) : ""}" && git push`);
