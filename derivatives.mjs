/**
 * Research-only Kraken derivatives collector.
 *
 * It never places orders.  It persists the raw public response alongside a
 * small, validated series so feature research can be reproduced offline.
 */
import fs from "fs";
import path from "path";
import axios from "axios";

const BASE = "https://futures.kraken.com";
export const ANALYTICS_TYPES = new Set([
  "open-interest", "aggressor-differential", "trade-volume", "trade-count",
  "liquidation-volume", "rolling-volatility", "long-short-ratio", "long-short-info",
  "cvd", "top-traders", "orderbook", "spreads", "liquidity", "slippage",
  "future-basis", "funding",
]);

const dataDir = () => process.env.DATA_DIR || ".";
const safe = (value, name) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Invalid ${name}: ${value}`);
  return value;
};
const finite = (x) => Number.isFinite(Number(x));

/** Normalize Kraken's parallel timestamp/data response without guessing its shape. */
export function normalizeAnalytics(response) {
  const result = response?.result;
  if (!result || !Array.isArray(result.timestamp) || !(Array.isArray(result.data) || (result.data && typeof result.data === "object"))) {
    throw new Error("Unexpected Kraken analytics response: expected result.timestamp and result.data");
  }
  // A few analytics types (e.g. `top-traders`) wrap their parallel-array object one level
  // deeper under a single cohort key (`{top20Percent: {openInterest:[...], ratio:[...], ...}}`)
  // instead of exposing the arrays directly like every other type. Unwrap that single wrapper
  // key so the rest of this function sees the same flat parallel-array shape it already handles
  // — confirmed against Kraken's real top-traders response, which is otherwise silently
  // normalized to an empty `{}` value on every point (no series entries survive the
  // Array.isArray filter below, but the loop still runs to timestamp.length, so this fails
  // silently rather than throwing).
  let data = result.data;
  if (!Array.isArray(data) && data && typeof data === "object") {
    const entries = Object.entries(data);
    if (entries.length === 1 && entries[0][1] && typeof entries[0][1] === "object" && !Array.isArray(entries[0][1])) {
      data = entries[0][1];
    }
  }
  const series = Array.isArray(data)
    ? null
    : Object.entries(data).filter(([, values]) => Array.isArray(values));
  const length = Math.min(result.timestamp.length, series
    ? Math.min(...series.map(([, values]) => values.length))
    : data.length);
  const points = [];
  for (let i = 0; i < length; i++) {
    const timestamp = Number(result.timestamp[i]);
    if (!Number.isFinite(timestamp)) continue;
    const value = series ? Object.fromEntries(series.map(([key, values]) => [key, values[i]])) : data[i];
    points.push({ timestamp, value });
  }
  return { points, more: Boolean(result.more), sourcePoints: length };
}

function cacheFile(symbol, type, since, to, interval) {
  return path.join(dataDir(), "research-cache", "derivatives", `${symbol}-${type}-${since}-${to}-${interval}.json`);
}

/** Fetch one bounded public analytics window and cache its unmodified response. */
export async function fetchAnalytics({ symbol = "PF_XBTUSD", type = "funding", since, to = Math.floor(Date.now() / 1000), interval = 86400, refresh = false } = {}) {
  safe(symbol, "symbol");
  if (!ANALYTICS_TYPES.has(type)) throw new Error(`Unsupported analytics type: ${type}`);
  if (!Number.isInteger(since) || since <= 0) throw new Error("since must be a positive epoch timestamp in seconds");
  if (!Number.isInteger(to) || to < since) throw new Error("to must be an epoch timestamp at or after since");
  if (![60, 300, 900, 1800, 3600, 14400, 43200, 86400, 604800].includes(interval)) throw new Error("Unsupported Kraken analytics interval");
  const file = cacheFile(symbol, type, since, to, interval);
  if (!refresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cached.schema === "cajh-derivatives-cache/v2") return cached;
  }
  const url = `${BASE}/api/charts/v1/analytics/${encodeURIComponent(symbol)}/${encodeURIComponent(type)}`;
  const pages = [], merged = new Map(); let pageTo = to;
  // Kraken caps large windows; move the upper bound before the earliest page point.
  for (let page = 0; page < 100 && pageTo >= since; page++) {
    const { data } = await axios.get(url, { params: { since, to: pageTo, interval }, timeout: 30_000 });
    const normalized = normalizeAnalytics(data); pages.push(data);
    for (const point of normalized.points) merged.set(point.timestamp, point.value);
    if (!normalized.more || !normalized.points.length) break;
    const earliestSeconds = Math.floor(Math.min(...normalized.points.map((p) => p.timestamp)) / 1000);
    if (earliestSeconds >= pageTo) throw new Error("Kraken analytics pagination did not advance");
    pageTo = earliestSeconds - 1;
  }
  const points = [...merged].sort(([a], [b]) => a - b).map(([timestamp, value]) => ({ timestamp, value }));
  const normalized = { points, more: false, sourcePoints: points.length, pages: pages.length };
  const payload = { schema: "cajh-derivatives-cache/v2", fetchedAt: new Date().toISOString(), request: { symbol, type, since, to, interval }, normalized, rawPages: pages };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload) + "\n");
  return payload;
}

/** Public historical funding is a separate endpoint with a simpler rate series. */
export async function fetchFundingRates({ symbol = "PF_XBTUSD", refresh = false } = {}) {
  safe(symbol, "symbol");
  const file = path.join(dataDir(), "research-cache", "derivatives", `${symbol}-historical-funding.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const { data } = await axios.get(`${BASE}/derivatives/api/v3/historical-funding-rates`, { params: { symbol }, timeout: 30_000 });
  if (data?.result !== "success" || !Array.isArray(data.rates)) throw new Error("Unexpected Kraken historical funding response");
  const rates = data.rates.filter((row) => row && Number.isFinite(Date.parse(row.timestamp)) && finite(row.relativeFundingRate));
  const payload = { schema: "cajh-funding-cache/v1", fetchedAt: new Date().toISOString(), request: { symbol }, rates, raw: data };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload) + "\n");
  return payload;
}
