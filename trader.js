/**
 * trader.js — Kraken Spot Trading API
 * Handles authenticated requests, balance queries, and order placement.
 * Uses the kraken-api library for battle-tested authentication.
 */

import Kraken from "kraken-api";

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

/**
 * Places a stop-loss sell order at a specific price.
 */
export async function placeStopLoss({ symbol, volume, stopPrice }) {
  const pair   = symbolToPair(symbol);
  const volStr = await normalizeVolume(pair, volume);

  console.log(`[TRADER] STOP-LOSS ${symbol} @ $${stopPrice}`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "stop-loss",
    price:     stopPrice.toString(),
    volume:    volStr
  });

  return res.result?.txid?.[0];
}

/**
 * Places a take-profit sell order at a specific price.
 */
export async function placeTakeProfit({ symbol, volume, takeProfitPrice }) {
  const pair   = symbolToPair(symbol);
  const volStr = await normalizeVolume(pair, volume);

  console.log(`[TRADER] TAKE-PROFIT ${symbol} @ $${takeProfitPrice}`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "take-profit",
    price:     takeProfitPrice.toString(),
    volume:    volStr
  });

  return res.result?.txid?.[0];
}

/** Returns all open orders. */
export async function getOpenOrders() {
  try {
    const res = await kraken.api("OpenOrders");
    return Object.values(res.result?.open ?? {});
  } catch (err) {
    console.error("[TRADER] Failed to fetch open orders:", err.message);
    return [];
  }
}

/** Returns the status of a single order by txid (open/closed/canceled/expired/pending), or null. */
export async function getOrderStatus(txid) {
  if (!txid) return null;
  try {
    const res = await kraken.api("QueryOrders", { txid });
    return res.result?.[txid]?.status ?? null;
  } catch (err) {
    console.error(`[TRADER] QueryOrders failed for ${txid}:`, err.message);
    return null;
  }
}

/** Cancels an order by txid. */
export async function cancelOrder(txid) {
  try {
    await kraken.api("CancelOrder", { txid });
    console.log(`[TRADER] Cancelled order ${txid}`);
  } catch (err) {
    console.error(`[TRADER] Failed to cancel order ${txid}:`, err.message);
  }
}