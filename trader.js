/**
 * trader.js — Kraken Spot Trading API
 * Handles authenticated requests, balance queries, and order placement.
 * Uses the kraken-api library for battle-tested authentication.
 */

import Kraken from "kraken-api";
import axios  from "axios";

// ─── Client ────────────────────────────────────────────────────────────────────

const kraken = new Kraken(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);

if (!process.env.KRAKEN_API_KEY || !process.env.KRAKEN_API_SECRET) {
  console.warn("[TRADER] Warning: KRAKEN_API_KEY or KRAKEN_API_SECRET not set.");
}

// ─── Pair mapping ──────────────────────────────────────────────────────────────

const PAIR_MAP = {
  BTC:   "XBTUSD",  ETH:   "ETHUSD",  SOL:   "SOLUSD",
  XRP:   "XRPUSD",  ADA:   "ADAUSD",  DOGE:  "DOGEUSD",
  AVAX:  "AVAXUSD", LINK:  "LINKUSD", LTC:   "LTCUSD",
  DOT:   "DOTUSD",  UNI:   "UNIUSD",  ATOM:  "ATOMUSD",
  POL:   "POLUSD",  MATIC: "POLUSD",  NEAR:  "NEARUSD",
  FIL:   "FILUSD",  APT:   "APTUSD",  INJ:   "INJUSD",
  TAO:   "TAOUSD",  TIA:   "TIAUSD",  SUI:   "SUIUSD"
};

export function symbolToPair(symbol) {
  return PAIR_MAP[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USD`;
}

// ─── Pair metadata (lot decimals + minimum order size) ─────────────────────────
// Kraken rejects orders with too many volume decimals or below the per-pair
// minimum. We fetch AssetPairs once and cache it for the process lifetime.

let pairInfoCache = null;

async function loadPairInfo() {
  if (pairInfoCache) return pairInfoCache;
  try {
    const res = await kraken.api("AssetPairs");
    pairInfoCache = res.result ?? {};
  } catch (err) {
    console.error("[TRADER] Failed to load AssetPairs:", err.message);
    pairInfoCache = {};
  }
  return pairInfoCache;
}

async function getPairInfo(pair) {
  const all = await loadPairInfo();
  for (const [key, info] of Object.entries(all)) {
    if (key === pair || info.altname === pair || info.wsname === pair) return info;
  }
  return null;
}

/** Round a volume to the pair's allowed lot decimals and validate the minimum. */
async function normalizeVolume(pair, volume) {
  const info     = await getPairInfo(pair);
  const decimals = info?.lot_decimals ?? 8;
  const rounded  = Number(parseFloat(volume).toFixed(decimals));

  if (info?.ordermin && rounded < parseFloat(info.ordermin)) {
    throw new Error(
      `Volume ${rounded} ${pair} is below Kraken's minimum of ${info.ordermin}.`
    );
  }
  if (rounded <= 0) throw new Error(`Computed volume for ${pair} is zero.`);

  return rounded.toFixed(decimals);
}

// ─── Account ───────────────────────────────────────────────────────────────────

/** Returns available USD balance. */
export async function getAccountBalance() {
  const res     = await kraken.api("Balance");
  const balance = parseFloat(res.result?.ZUSD ?? res.result?.USD ?? 0);
  console.log(`[TRADER] Available balance: $${balance.toFixed(2)}`);
  return balance;
}

/** Map a Kraken asset code to a friendly ticker (XXBT → BTC, ZUSD → USD, etc.). */
function displayAsset(a) {
  if (a === "ZUSD") return "USD";
  if (a === "XXBT" || a === "XBT") return "BTC";
  if (a.length === 4 && (a.startsWith("X") || a.startsWith("Z"))) return a.slice(1);
  return a;
}

const STABLES = ["USD", "USDT", "USDC", "DAI", "PYUSD"];

/**
 * Returns every non-dust asset held on the Kraken account, priced in USD:
 *   { holdings: [{ asset, qty, price, value }], totalUsd }
 * Stablecoins are valued at $1. Cost basis isn't available from the API, so this is
 * market value only — true entry-based P&L is tracked separately for cajh's own trades.
 */
export async function getHoldings() {
  const res = await kraken.api("Balance");
  const bal = res.result || {};
  const holdings = [];
  let totalUsd = 0;

  for (const [code, qtyStr] of Object.entries(bal)) {
    const qty = parseFloat(qtyStr);
    if (!qty || qty < 1e-8) continue;
    const asset = displayAsset(code);

    if (STABLES.includes(asset)) {
      holdings.push({ asset, qty, price: 1, value: qty });
      totalUsd += qty;
      continue;
    }

    let price = 0;
    try {
      const pairCode = asset === "BTC" ? "XBT" : asset;
      const t = await kraken.api("Ticker", { pair: `${pairCode}USD` });
      const k = Object.keys(t.result)[0];
      price = parseFloat(t.result[k].c[0]);
    } catch { price = 0; }

    const value = qty * price;
    holdings.push({ asset, qty, price, value });
    totalUsd += value;
    await new Promise(r => setTimeout(r, 400)); // gentle with Kraken rate limits
  }

  holdings.sort((a, b) => b.value - a.value);
  return { holdings, totalUsd };
}

/** Returns the current mid price for a symbol. */
export async function getCurrentPrice(symbol) {
  const pair = symbolToPair(symbol);
  const res  = await kraken.api("Ticker", { pair });
  const data = Object.values(res.result)[0];
  return parseFloat(data?.c?.[0] ?? 0);
}

// ─── Orders ────────────────────────────────────────────────────────────────────

/**
 * Places a spot market buy order.
 * Volume is calculated as (balance × sizePct) / price.
 */
/**
 * Places a spot market buy order.
 * Volume is (balance × sizePct) / price, rounded to the pair's lot decimals.
 */
export async function placeBuy({ symbol, sizePct, price }) {
  const pair    = symbolToPair(symbol);
  const balance = await getAccountBalance();
  const capital = balance * sizePct;
  const volume  = await normalizeVolume(pair, capital / price);

  console.log(`[TRADER] BUY ${volume} ${symbol} @ ~$${price} (${(sizePct * 100).toFixed(0)}% of balance)`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "buy",
    ordertype: "market",
    volume
  });

  return {
    txid:    res.result?.txid?.[0],
    symbol,
    pair,
    side:    "buy",
    volume:  parseFloat(volume),
    price,
    capital,
    balance,
    sizePct
  };
}

/**
 * Places a spot market sell order to close a position.
 * Volume is the amount of the asset held.
 */
export async function placeSell({ symbol, volume }) {
  const pair    = symbolToPair(symbol);
  const volStr  = await normalizeVolume(pair, volume);

  console.log(`[TRADER] SELL ${volStr} ${symbol}`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "market",
    volume:    volStr
  });

  return {
    txid:   res.result?.txid?.[0],
    symbol,
    pair,
    side:   "sell",
    volume: parseFloat(volStr)
  };
}

// ─── Public market data ─────────────────────────────────────────────────────────

/**
 * Fetches OHLC candles for a Kraken pair id (e.g. "XBTUSD") at the given interval
 * (minutes). Returns [{ time, open, high, low, close, volume }] or null. Public
 * endpoint — no auth needed. Centralized here so scanner and monitor share one path.
 */
export async function fetchOHLC(pair, minutes) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get("https://api.kraken.com/0/public/OHLC", {
        params: { pair, interval: minutes },
        timeout: 15000
      });

      if (response.data.error && response.data.error.length > 0) {
        console.error(`Kraken error for ${pair}:`, response.data.error);
        return null;
      }

      const key     = Object.keys(response.data.result).find(k => k !== "last");
      const candles = response.data.result[key];

      return candles.map(k => ({
        time:   k[0],
        open:   k[1].toString(),
        high:   k[2].toString(),
        low:    k[3].toString(),
        close:  k[4].toString(),
        volume: k[6].toString()
      }));
    } catch (error) {
      console.error(`Fetch attempt ${attempt} failed for ${pair}:`, error.message);
      if (attempt === 3) return null;
      await new Promise(res => setTimeout(res, 5000 * attempt));
    }
  }
  return null;
}
