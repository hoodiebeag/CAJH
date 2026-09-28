/**
 * Generate a deterministic synthetic OHLCV panel with NO predictable structure.
 *
 * WHAT THIS IS FOR. `score` is the instrument every conclusion in this project will rest on, and it
 * has never been checked against known ground truth. A panel drawn from a random walk has, by
 * construction, no edge to find: any strategy's expected excess over a matched random control is
 * exactly zero. So if the decision -> journal -> settle -> score chain reports an edge on this data
 * beyond what chance explains, the chain is broken. See docs/FORWARD-EVAL-SPEC.md §6.
 *
 * WHAT IT IS NOT. A pass says nothing whatever about real markets, because there was nothing to
 * find. This is a negative control on the measuring device, not a test of any strategy. Planting
 * known structure to test detection would measure the analyst against our own assumptions about
 * markets, which is a different and much weaker claim.
 *
 * IT MUST NEVER BE MISTAKEN FOR DATA. Three independent guards:
 *   1. PROVENANCE.json carries `"synthetic": true` and the generating seed.
 *   2. It refuses to write into any root this project treats as real.
 *   3. analyst-run.mjs refuses paper mode on a root whose provenance says synthetic, so a
 *      current-dated synthetic panel cannot become a forward track record.
 * The output is deliberately NOT committed. The generator is committed and the panel's PRICES are a
 * pure function of its seed, so reproducibility comes from regenerating rather than from storing.
 * The BAR TIMESTAMPS are not: `--end` defaults to 90 days before now, which moves daily. Pass an
 * explicit `--end` for a byte-identical panel, and any run whose numbers are reported must do so.
 *
 * Usage:
 *   node scripts/make-synthetic-panel.mjs --out <dir> [--seed N] [--symbols N] [--bars N]
 *                                         [--end YYYY-MM-DD]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seededRng } from "../inference.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

const OUT = flag("out", null);
const SEED = Number(flag("seed", 20260928));
const NSYM = Number(flag("symbols", 40));
const NBARS = Number(flag("bars", 500));
const END = flag("end", null);

if (!OUT) { console.error("--out <dir> is required"); process.exit(2); }

// GUARD 2: never write into a root this project treats as real data. A synthetic panel landing in
// sp500-bundle would be indistinguishable from measured prices the moment this run is forgotten.
//
// COMPARE RESOLVED PATHS, NOT THE STRING AS TYPED. An earlier version matched
// `path.basename(OUT.replace(/\/+$/, ""))`, and `path.basename("sp500-bundle/.")` is `"."` — so
// `--out sp500-bundle/.` passed the check and would have written CSVs into the real
// `sp500-bundle/1440` and overwritten its PROVENANCE.json. Resolving first collapses `.`, `..` and
// any other spelling of the same directory, and the containment test catches a subdirectory of a real
// root, which a basename test cannot see at all.
const REAL_ROOTS = ["sp500-bundle", "ibkr-bundle", "candle-bundle", "candle-bundle-long",
                    "equity-bundle", "funding-binance", "funding-kraken", "funding-okx", "positioning", "data"];
const resolved = path.resolve(OUT);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const refuse = (why) => {
  console.error(`refusing to write synthetic data into "${OUT}" — ${why}.`);
  console.error(`resolved to ${resolved}`);
  process.exit(2);
};
for (const r of REAL_ROOTS) {
  const real = path.resolve(repoRoot, r);
  if (resolved === real) refuse(`that is the real data root "${r}"`);
  if (resolved.startsWith(real + path.sep)) refuse(`that is inside the real data root "${r}"`);
}
// Then refuse ANY path component named like a real root, wherever it sits. The repo-relative test
// above misses a bundle reached through a copy of the repo, a sibling checkout or a mount, and a
// basename-only test misses `sp500-bundle/sub` — which is still a subdirectory of somewhere a reader
// would expect measured prices. Scanning components covers both.
const hit = resolved.split(path.sep).find((seg) => REAL_ROOTS.includes(seg));
if (hit) refuse(`"${hit}" in that path names a real data root`);

const DAY = 86400;
const endSec = END ? Math.floor(Date.parse(`${END}T00:00:00Z`) / 1000)
                   : Math.floor(Date.now() / 1000) - 90 * DAY;
// Bars land on UTC midnight so the session calendar is unambiguous.
const lastTime = Math.floor(endSec / DAY) * DAY;

const rng = seededRng(SEED);
/** Box-Muller from the seeded uniform stream, so the whole panel is a function of the seed alone. */
function gauss() {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const dates = [];
for (let i = NBARS - 1; i >= 0; i--) dates.push(lastTime - i * DAY);

const dir = path.join(OUT, "1440");
fs.mkdirSync(dir, { recursive: true });

// A DRIFTLESS RANDOM WALK. Zero drift is the point: with drift, a long-only book beats a
// long-only control by nothing, but the NULL's own level moves and a reader could mistake the
// common trend for a result. Per-symbol volatility varies so the cross-section is not uniform.
const symbols = [];
for (let s = 0; s < NSYM; s++) {
  const sym = `SYN${String(s).padStart(3, "0")}`;
  const vol = 0.010 + 0.020 * rng();          // 1.0%-3.0% daily, spanning real equity vol
  let px = 20 + 180 * rng();
  const rows = ["time,open,high,low,close,volume"];
  for (let i = 0; i < NBARS; i++) {
    const open = px;
    px = Math.max(0.5, px * (1 + vol * gauss()));
    const close = px;
    const wick = Math.abs(vol * gauss()) * close;
    const high = Math.max(open, close) + wick;
    const low = Math.max(0.25, Math.min(open, close) - wick);
    const volume = Math.round(5e5 + 4e6 * rng());
    rows.push(`${dates[i]},${open},${high},${low},${close},${volume}`);
  }
  fs.writeFileSync(path.join(dir, `${sym}.csv`), rows.join("\n") + "\n");
  symbols.push(sym);
}

// GUARD 1: provenance that says what this is, in the same file real bundles use for the same job.
fs.writeFileSync(path.join(OUT, "PROVENANCE.json"), JSON.stringify({
  synthetic: true,
  doNotTrade: "Generated noise. No predictable structure exists in it by construction.",
  doNotJoin: "Never merge with a real bundle, and never cite a number from it as evidence of edge.",
  generator: "scripts/make-synthetic-panel.mjs",
  process: "driftless geometric random walk, Box-Muller from a seeded uniform stream",
  seed: SEED, symbols: symbols.length, bars: NBARS,
  firstBar: new Date(dates[0] * 1000).toISOString().slice(0, 10),
  lastBar: new Date(dates.at(-1) * 1000).toISOString().slice(0, 10),
  generatedAt: new Date().toISOString(),
}, null, 2) + "\n");

console.log(`wrote ${symbols.length} symbols x ${NBARS} bars to ${dir}`);
console.log(`seed ${SEED}, bars ${new Date(dates[0] * 1000).toISOString().slice(0, 10)} .. ${new Date(dates.at(-1) * 1000).toISOString().slice(0, 10)}`);
console.log(`PROVENANCE.json marks this SYNTHETIC; paper mode refuses such a root.`);
