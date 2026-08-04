/** Public Binance USD-M funding collector. Research only; it cannot trade. */
import fs from "fs";
import path from "path";
import axios from "axios";

const BASE = "https://fapi.binance.com";
const DAY = 86400_000;
const dataDir = () => process.env.DATA_DIR || ".";
const safe = (s) => {
  if (!/^[A-Z0-9]{2,20}$/.test(s)) throw new Error(`Invalid futures symbol: ${s}`);
  return s;
};
export const toBinancePerp = (asset) => `${({ BTC: "BTC", XBT: "BTC" }[String(asset).toUpperCase()] || String(asset).toUpperCase())}USDT`;
const fileFor = (symbol) => path.join(dataDir(), "funding", `binance-${safe(symbol)}.json`);

function normalize(rows) {
  const byTime = new Map();
  for (const row of rows) {
    const time = Number(row?.fundingTime), rate = Number(row?.fundingRate);
    if (Number.isFinite(time) && Number.isFinite(rate)) byTime.set(time, { time, rate });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Fetch every available 8h funding point from `startTime`, with bounded pagination. */
export async function fetchBinanceFunding(symbol, { startTime = Date.now() - 730 * DAY, endTime = Date.now(), refresh = false } = {}) {
  symbol = safe(symbol);
  const file = fileFor(symbol);
  if (!refresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cached?.schema === "cajh-binance-funding/v1" && Array.isArray(cached.points)) return cached;
  }
  let cursor = Number(startTime), pages = 0; const rows = [];
  while (cursor <= endTime && pages++ < 50) {
    const { data } = await axios.get(`${BASE}/fapi/v1/fundingRate`, { params: { symbol, startTime: cursor, endTime, limit: 1000 }, timeout: 30_000 });
    if (!Array.isArray(data)) throw new Error(`Unexpected Binance funding response for ${symbol}`);
    rows.push(...data); if (data.length < 1000) break;
    const last = Number(data.at(-1)?.fundingTime);
    if (!Number.isFinite(last) || last < cursor) throw new Error(`Funding pagination did not advance for ${symbol}`);
    cursor = last + 1;
  }
  const payload = { schema: "cajh-binance-funding/v1", fetchedAt: new Date().toISOString(), source: "Binance USD-M public fundingRate", symbol, startTime, endTime, points: normalize(rows) };
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(payload) + "\n");
  return payload;
}

export function fundingAsOf(points) {
  let i = 0, latest = null;
  return (timeSec) => {
    const time = Number(timeSec) * 1000;
    while (i < points.length && points[i].time <= time) latest = points[i++];
    return latest?.rate ?? null;
  };
}
