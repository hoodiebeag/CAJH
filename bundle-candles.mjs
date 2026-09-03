/**
 * bundle-candles.mjs — produce a compact, transferable candle bundle from the raw local store.
 *
 * WHY. The raw minute store is ~1.2GB. It must not go into git: history is permanent, GitHub
 * caps single files at 100MB, and every future clone would pay for it forever. But nearly every
 * study in this repository consumes RESAMPLED bars — `loadResearchCandles` defaults to 1440
 * minutes — so the raw resolution is not what the research needs. Daily bars for the whole
 * universe over four years are on the order of 10MB, which transfers trivially.
 *
 *   node bundle-candles.mjs               # daily, all symbols found
 *   node bundle-candles.mjs 1440 240      # daily and 4h
 *   node bundle-candles.mjs --selftest    # no data needed
 *
 * Writes candle-bundle/<minutes>/<PAIR>.csv and prints the total size.
 *
 * READ-ONLY over the candle store. It creates a new directory and touches nothing existing.
 */

import fs from "fs";
import path from "path";

const dataDir = () => process.env.DATA_DIR || ".";
export const OUT = "candle-bundle";

/** The columns a resampled bar needs. Dropping the rest is most of the size saving. */
export const COLUMNS = ["time", "open", "high", "low", "close", "volume"];

export function toCsv(bars) {
  const lines = [COLUMNS.join(",")];
  for (const b of bars) {
    lines.push(COLUMNS.map((c) => {
      const v = b[c];
      if (v === undefined || v === null || v === "") return "";
      // Trim float noise: raw stores carry full double precision, which is most of the bytes
      // and none of the information at daily resolution.
      const n = Number(v);
      return Number.isFinite(n) && c !== "time" ? String(Math.round(n * 1e6) / 1e6) : String(v);
    }).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Symbols present in the raw store. */
export function listPairs(dir = path.join(dataDir(), "candles")) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).map((f) => f.replace(/\.csv$/, "")).sort();
}

async function main(minutesList) {
  const { loadBars, resampleBars } = await import("./data.js");
  const pairs = listPairs();
  if (!pairs.length) {
    console.error(`No candles found under ${path.join(dataDir(), "candles")}. Run this on the machine that has the store.`);
    process.exitCode = 1; return;
  }
  let total = 0, files = 0;
  for (const minutes of minutesList) {
    const outDir = path.join(OUT, String(minutes));
    fs.mkdirSync(outDir, { recursive: true });
    for (const pair of pairs) {
      let bars;
      try { bars = loadBars(pair); } catch (err) { console.error(`skip ${pair}: ${err.message}`); continue; }
      if (!bars?.length) { console.error(`skip ${pair}: empty`); continue; }
      const { candles } = resampleBars(bars, minutes, { gapPolicy: "allow" });
      if (!candles.length) { console.error(`skip ${pair} @${minutes}: no bars after resample`); continue; }
      const file = path.join(outDir, `${pair}.csv`);
      fs.writeFileSync(file, toCsv(candles));
      total += fs.statSync(file).size; files++;
    }
    console.log(`${minutes}min: ${pairs.length} pairs -> ${outDir}`);
  }
  console.log(`\n${files} files, ${(total / 1e6).toFixed(1)} MB uncompressed`);
  console.log(`Compress and send:\n  tar -czf candle-bundle.tar.gz ${OUT}\nThen upload candle-bundle.tar.gz in chat.`);
  console.log(`\nDo NOT commit ${OUT}/ or the tarball — .gitignore already excludes the raw store for the same reason.`);
}

function selftest() {
  const bars = Array.from({ length: 5 }, (_, i) => ({
    time: 1700000000 + i * 86400, open: 100.123456789, high: 101.987654321,
    low: 99.5, close: 100.5, volume: 1234.56789, trades: 42, buyVol: 1, sellVol: 2,
  }));
  const csv = toCsv(bars);
  const lines = csv.trim().split("\n");
  console.log(JSON.stringify({
    mode: "selftest",
    header: lines[0],
    firstRow: lines[1],
    rows: lines.length - 1,
    droppedColumns: ["trades", "buyVol", "sellVol"].filter((c) => !lines[0].includes(c)),
    precisionTrimmed: lines[1].includes("100.123457"),
  }, null, 2));
  return csv;
}

// Guarded so importing this module (for its pure helpers, or from a test) does not run the
// bundler. Without the guard the else-branch fired on import, tried to read a candle store that
// was not there, and set a non-zero exit code -- which is how the test suite found it.
const directRun = process.argv[1] &&
  import.meta.url === (await import("url")).pathToFileURL(process.argv[1]).href;
if (directRun) {
  if (process.argv[2] === "--selftest") selftest();
  else {
    const mins = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    await main(mins.length ? mins : [1440]);
  }
}
