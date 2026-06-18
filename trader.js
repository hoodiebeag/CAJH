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

// ─── Conviction scaling ────────────────────────────────────────────────────────

const POSITION_PCT = { 10: 0.15, 9: 0.12, 8: 0.09, 7: 0.07, 6: 0.05 };

export function getPositionPct(conviction) {
  return POSITION_PCT[Math.min(conviction, 10)] ?? 0.05;
}

// ─── Pair mapping ──────────────────────────────────────────────────────────────

const PAIR_MAP = {
  BTC:   "XBTUSD",  ETH:   "ETHUSD",  SOL:   "SOLUSD",
  XRP:   "XRPUSD",  ADA:   "ADAUSD",  DOGE:  "DOGEUSD",
  AVAX:  "AVAXUSD", LINK:  "LINKUSD", LTC:   "LTCUSD",
  DOT:   "DOTUSD",  UNI:   "UNIUSD",  ATOM:  "ATOMUSD",
  MATIC: "MATICUSD",NEAR:  "NEARUSD", FIL:   "FILUSD",
  APT:   "APTUSD",  INJ:   "INJUSD",  TAO:   "TAOUSD",
  TIA:   "TIAUSD",  SUI:   "SUIUSD"
};

export function symbolToPair(symbol) {
  return PAIR_MAP[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USD`;
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
export async function placeBuy({ symbol, conviction, price }) {
  const pair     = symbolToPair(symbol);
  const sizePct  = getPositionPct(conviction);
  const balance  = await getAccountBalance();
  const capital  = balance * sizePct;
  const volume   = (capital / price).toFixed(8);

  if (parseFloat(volume) <= 0) throw new Error("Insufficient balance.");

  console.log(`[TRADER] BUY ${volume} ${symbol} @ ~$${price} (${(sizePct * 100).toFixed(0)}% of balance)`);

  const res  = await kraken.api("AddOrder", {
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
    conviction
  };
}

/**
 * Places a spot market sell order to close a position.
 * Volume is the amount of the asset held.
 */
export async function placeSell({ symbol, volume }) {
  const pair = symbolToPair(symbol);

  console.log(`[TRADER] SELL ${volume} ${symbol}`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "market",
    volume:    volume.toFixed(8)
  });

  return {
    txid:   res.result?.txid?.[0],
    symbol,
    pair,
    side:   "sell",
    volume
  };
}

/**
 * Places a stop-loss sell order at a specific price.
 */
export async function placeStopLoss({ symbol, volume, stopPrice }) {
  const pair = symbolToPair(symbol);

  console.log(`[TRADER] STOP-LOSS ${symbol} @ $${stopPrice}`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "stop-loss",
    price:     stopPrice.toString(),
    volume:    volume.toFixed(8)
  });

  return res.result?.txid?.[0];
}

/**
 * Places a take-profit sell order at a specific price.
 */
export async function placeTakeProfit({ symbol, volume, takeProfitPrice }) {
  const pair = symbolToPair(symbol);

  console.log(`[TRADER] TAKE-PROFIT ${symbol} @ $${takeProfitPrice}`);

  const res = await kraken.api("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "take-profit",
    price:     takeProfitPrice.toString(),
    volume:    volume.toFixed(8)
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

/** Cancels an order by txid. */
export async function cancelOrder(txid) {
  try {
    await kraken.api("CancelOrder", { txid });
    console.log(`[TRADER] Cancelled order ${txid}`);
  } catch (err) {
    console.error(`[TRADER] Failed to cancel order ${txid}:`, err.message);
  }
}