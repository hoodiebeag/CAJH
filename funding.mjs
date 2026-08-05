/**
 * funding.mjs — idempotent CSV funding-rate collector for Kraken Futures BTC/ETH/SOL.
 *
 * Research-only. Reuses derivatives.mjs's already-validated fetchFundingRates(), which
 * hits Kraken's real historical-funding endpoint with the PF_XBTUSD-style symbols this
 * repo's other funding research (funding-study.mjs, funding-gate-h11.mjs) already relies
 * on — rather than a from-scratch client against a different endpoint/ticker format.
 * What's new here is the idempotent per-symbol CSV merge: safe to rerun, only ever adds
 * rows for timestamps not already stored.
 */
import fs from "fs";
import path from "path";
import { fetchFundingRates } from "./derivatives.mjs";

const dataDir = () => process.env.DATA_DIR || ".";
export const SYMBOLS = Object.freeze({ BTC: "PF_XBTUSD", ETH: "PF_ETHUSD", SOL: "PF_SOLUSD" });

function csvFile(asset) {
  return path.join(dataDir(), "funding", `${asset}.csv`);
}

/** Parse an existing "timestamp,funding_rate" CSV into a Map keyed by timestamp. */
export function parseCsv(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("timestamp")) continue;
    const [ts, rate] = trimmed.split(",");
    const timestamp = Number(ts), fundingRate = Number(rate);
    if (Number.isFinite(timestamp) && Number.isFinite(fundingRate)) rows.set(timestamp, fundingRate);
  }
  return rows;
}

/** Idempotent merge: existing rows plus new ones, deduped by timestamp, sorted ascending. */
export function mergeRows(existing, incoming) {
  const merged = new Map(existing);
  for (const { timestamp, fundingRate } of incoming) {
    if (Number.isFinite(timestamp) && Number.isFinite(fundingRate)) merged.set(timestamp, fundingRate);
  }
  return [...merged.entries()].sort(([a], [b]) => a - b);
}

export function toCsv(rows) {
  return ["timestamp,funding_rate", ...rows.map(([ts, rate]) => `${ts},${rate}`)].join("\n") + "\n";
}

/** Fetch, idempotently merge, and persist one symbol's funding-rate CSV. */
export async function collectFundingCsv(asset, { refresh = false } = {}) {
  const perpSymbol = SYMBOLS[asset];
  if (!perpSymbol) throw new Error(`Unsupported funding asset: ${asset}`);
  const file = csvFile(asset);
  const existing = fs.existsSync(file) ? parseCsv(fs.readFileSync(file, "utf8")) : new Map();
  const { rates } = await fetchFundingRates({ symbol: perpSymbol, refresh });
  const incoming = rates.map((row) => ({
    timestamp: Date.parse(row.timestamp),
    fundingRate: Number(row.relativeFundingRate),
  }));
  const merged = mergeRows(existing, incoming);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toCsv(merged));
  return { asset, file, rows: merged.length, from: merged[0]?.[0] ?? null, to: merged.at(-1)?.[0] ?? null };
}

async function main() {
  for (const asset of Object.keys(SYMBOLS)) {
    const { rows, from, to } = await collectFundingCsv(asset);
    const fromDate = from ? new Date(from).toISOString().slice(0, 10) : "—";
    const toDate = to ? new Date(to).toISOString().slice(0, 10) : "—";
    console.log(`${asset}: ${rows} rows ${fromDate} to ${toDate}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("funding.mjs")) {
  main().then(() => { process.exitCode = 0; }).catch((err) => { console.error(err); process.exitCode = 1; });
}
