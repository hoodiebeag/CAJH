/** Research-only data inventory and immutable experiment records. */
import fs from "fs";
import path from "path";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadBars, resampleBars } from "./data.js";

const dataDir = () => process.env.DATA_DIR || ".";
const finite = (x) => Number.isFinite(Number(x));

export function qualityReport(bars, intervalSeconds = 60) {
  const valid = bars.filter((b) => finite(b.time) && finite(b.open) && finite(b.high) && finite(b.low) && finite(b.close));
  let gaps = 0, largestGapSeconds = 0;
  for (let i = 1; i < valid.length; i++) {
    const gap = Number(valid[i].time) - Number(valid[i - 1].time);
    if (gap > intervalSeconds) { gaps++; largestGapSeconds = Math.max(largestGapSeconds, gap); }
  }
  return {
    bars: bars.length, validBars: valid.length, invalidBars: bars.length - valid.length,
    start: valid[0] ? new Date(valid[0].time * 1000).toISOString() : null,
    end: valid.at(-1) ? new Date(valid.at(-1).time * 1000).toISOString() : null,
    gaps, largestGapSeconds,
  };
}

const normalizeUniverse = (watchlist) => watchlist.map((asset) => typeof asset === "string"
  ? { symbol: asset, id: symbolToKrakenId(asset) } : asset);

export function dataManifest(watchlist = loadWatchlist()) {
  watchlist = normalizeUniverse(watchlist);
  const assets = watchlist.map(({ symbol, id }) => {
    const daily = loadDailyCandles(id);
    return {
      symbol, pair: id,
      daily: qualityReport(daily, 86400),
    };
  });
  return { schema: "cajh-data-manifest/v1", createdAt: new Date().toISOString(), assets };
}

/**
 * Resampled research cache. Reading multi-year minute CSVs for every experiment is
 * needlessly expensive; each timeframe cache is invalidated when its source changes.
 */
export function loadResearchCandles(pair, minutes = 1440) {
  return loadResearchCandlesWithQuality(pair, minutes).candles;
}

export function loadResearchCandlesWithQuality(pair, minutes = 1440, { gapPolicy = "allow", nowSec = Infinity } = {}) {
  if (!/^[A-Za-z0-9]+$/.test(pair)) throw new Error(`Invalid pair: ${pair}`);
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error("minutes must be a positive integer");
  const source = path.join(dataDir(), "candles", `${pair}.csv`);
  if (!fs.existsSync(source)) return { schema: "cajh-research-cache/v1", minutes, gapPolicy, nowSec: null, candles: [], gaps: [] };
  if (gapPolicy !== "allow" && gapPolicy !== "error") throw new Error("gapPolicy must be allow or error");
  const cacheNowSec = Number.isFinite(nowSec) ? nowSec : null;
  const cacheDir = path.join(dataDir(), "research-cache", `tf-${minutes}`);
  const cache = path.join(cacheDir, `${pair}.json`); const sourceStat = fs.statSync(source);
  if (fs.existsSync(cache)) {
    try {
      const saved = JSON.parse(fs.readFileSync(cache, "utf8"));
      if (
        saved.schema === "cajh-research-cache/v1" &&
        saved.sourceMtimeMs === sourceStat.mtimeMs &&
        saved.sourceSize === sourceStat.size &&
        saved.minutes === minutes &&
        saved.gapPolicy === gapPolicy &&
        saved.nowSec === cacheNowSec &&
        Array.isArray(saved.candles) &&
        Array.isArray(saved.gaps)
      ) return saved;
    } catch {
      // Corrupt caches are disposable derivations; rebuild from validated candle CSV.
    }
  }
  const { candles, gaps } = resampleBars(loadBars(pair), minutes, { gapPolicy, nowSec });
  const payload = { schema: "cajh-research-cache/v1", sourceMtimeMs: sourceStat.mtimeMs, sourceSize: sourceStat.size, minutes, gapPolicy, nowSec: cacheNowSec, candles, gaps };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(payload) + "\n");
  return payload;
}

export const loadDailyCandles = (pair) => loadResearchCandles(pair, 1440);

/** Persist the full inputs and result together so a research finding can be reproduced. */
export function saveExperiment(kind, input, result) {
  if (!/^[a-z0-9-]+$/i.test(kind)) throw new Error("Experiment kind must be alphanumeric or hyphenated");
  const dir = path.join(dataDir(), "research-runs");
  fs.mkdirSync(dir, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}`;
  const file = path.join(dir, `${id}.json`);
  const payload = { schema: "cajh-research-run/v1", id, kind, createdAt: new Date().toISOString(), input, result };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
  return file;
}
