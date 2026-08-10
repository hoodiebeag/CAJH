/**
 * trader.js — Kraken Spot Trading API
 * Handles authenticated requests, balance queries, and order placement.
 * Uses the kraken-api library for battle-tested authentication.
 */

import Kraken from "kraken-api";
import axios  from "axios";
import * as logger from './logger.js';

// ─── Client ────────────────────────────────────────────────────────────────────

const kraken = new Kraken(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);
const defaultKrakenApi = (method, params) => kraken.api(method, params);
let krakenApi = defaultKrakenApi;
let orderConfirmDelayMs = 700;
const DEFAULT_KRAKEN_ATTEMPTS = 2;

// R-013: explicit exchange-error retry policy, keyed by Kraken method. AddOrder is NOT
// idempotent — if a request times out after Kraken already accepted it, retrying would
// place a second real order, so it gets exactly one attempt: any error (terminal or
// ambiguous) surfaces immediately as "state unknown", never auto-retried and never
// treated as an implicit success. Read-only/idempotent methods (Balance, Ticker,
// AssetPairs, QueryOrders) keep the prior bounded-retry behavior unchanged. Backoff is
// deliberately 0ms for both: these are user-facing lookups where added latency has no
// correctness benefit (unlike AddOrder, retrying a read carries no duplication risk).
const KRAKEN_RETRY_POLICY = {
  AddOrder: { attempts: 1 },
  default:  { attempts: DEFAULT_KRAKEN_ATTEMPTS }
};

export function setKrakenApiForTests(fn = null) {
  krakenApi = fn || defaultKrakenApi;
  pairInfoCache = null;
}

export function setOrderConfirmDelayForTests(ms = 700) {
  orderConfirmDelayMs = ms;
}

export function classifyKrakenError(err) {
  const text = `${err?.code ?? ""} ${err?.message ?? err ?? ""}`.toLowerCase();
  if (/canceled|expired|rejected|invalid|permission|denied|nonce|signature/.test(text)) return "terminal";
  if (/timeout|timedout|econnreset|econnaborted|temporar|rate|busy|unavailable|socket|network|fetch/.test(text)) return "retryable";
  return "unknown";
}

export async function callKraken(method, params) {
  const { attempts } = KRAKEN_RETRY_POLICY[method] ?? KRAKEN_RETRY_POLICY.default;
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await krakenApi(method, params);
    } catch (err) {
      lastErr = err;
      if (classifyKrakenError(err) === "terminal") {
        const terminal = new Error(`Kraken ${method} terminal error: ${err?.message ?? err}`);
        terminal.cause = err;
        terminal.krakenState = "terminal";
        throw terminal;
      }
      if (attempt === attempts) break;
    }
  }
  const wrapped = new Error(`Kraken ${method} state unknown after ${attempts} attempt(s): ${lastErr?.message ?? lastErr}`);
  wrapped.cause = lastErr;
  wrapped.krakenState = "unknown";
  throw wrapped;
}

if (!process.env.KRAKEN_API_KEY || !process.env.KRAKEN_API_SECRET) {
  logger.warn("[TRADER] Warning: KRAKEN_API_KEY or KRAKEN_API_SECRET not set.");
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

export function resolveSupportedPair(symbol) {
  const pair = PAIR_MAP[String(symbol ?? "").toUpperCase()];
  if (!pair) throw new Error(`Unsupported trading symbol: ${symbol}`);
  return pair;
}

const positiveFinite = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
export const MAX_ORDER_SNAPSHOT_AGE_MS = 10_000;

export function validateFreshPositiveSnapshot({ value, asOf }, label, now = Date.now(), maxAgeMs = MAX_ORDER_SNAPSHOT_AGE_MS) {
  if (!positiveFinite(value)) throw new Error(`${label} must be finite and positive.`);
  if (!Number.isFinite(asOf)) throw new Error(`${label} snapshot is missing a timestamp.`);
  if (now - asOf > maxAgeMs) throw new Error(`${label} snapshot is stale.`);
  if (asOf - now > 1_000) throw new Error(`${label} snapshot timestamp is in the future.`);
  return value;
}

export function validateOrderRequest({ symbol, side, price, capital, volume }) {
  const pair = resolveSupportedPair(symbol);
  if (side !== "buy" && side !== "sell") throw new Error(`Unsupported order side: ${side}`);
  if (!positiveFinite(price)) throw new Error("Order price must be finite and positive.");
  if (side === "buy" && !positiveFinite(capital)) throw new Error("Buy capital must be finite and positive.");
  if (side === "sell" && !positiveFinite(volume)) throw new Error("Sell volume must be finite and positive.");
  return { pair };
}

export function validateOrderTransportBoundary({
  symbol, side, price, priceAsOf, capital, volume, balance, balanceAsOf,
  now = Date.now(), maxAgeMs = MAX_ORDER_SNAPSHOT_AGE_MS
}) {
  const { pair } = validateOrderRequest({ symbol, side, price, capital, volume });
  validateFreshPositiveSnapshot({ value: price, asOf: priceAsOf }, "price", now, maxAgeMs);
  if (side === "buy") {
    const available = validateFreshPositiveSnapshot({ value: balance, asOf: balanceAsOf }, "balance", now, maxAgeMs);
    if (capital > available) throw new Error("Buy capital exceeds available balance.");
  }
  return { pair };
}

export function validateTrackedTrade(trade) {
  if (!trade || typeof trade !== "object") throw new Error("Tracked trade must be an object.");
  resolveSupportedPair(trade.symbol);
  for (const field of ["entry", "stopLoss", "takeProfit", "risk", "volume"]) {
    if (!positiveFinite(trade[field])) throw new Error(`Tracked trade ${field} must be finite and positive.`);
  }
  if (trade.stopLoss >= trade.entry) throw new Error("Tracked long stopLoss must be strictly below entry.");
  if (trade.takeProfit <= trade.entry) throw new Error("Tracked long takeProfit must be above entry.");
  return true;
}

// ─── Pair metadata (lot decimals + minimum order size) ─────────────────────────
// Kraken rejects orders with too many volume decimals or below the per-pair
// minimum. We fetch AssetPairs once and cache it for the process lifetime.

let pairInfoCache = null;

async function loadPairInfo() {
  if (pairInfoCache) return pairInfoCache;
  const res = await callKraken("AssetPairs");
  pairInfoCache = res.result ?? {};
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
  if (!positiveFinite(volume)) throw new Error(`Computed volume for ${pair} must be finite and positive.`);
  const info     = await getPairInfo(pair);
  if (!info) throw new Error(`Kraken pair metadata unavailable for ${pair}.`);
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
  const { balance } = await getAccountBalanceSnapshot();
  return balance;
}

export async function getAccountBalanceSnapshot() {
  const res     = await callKraken("Balance");
  const balance = parseFloat(res.result?.ZUSD ?? res.result?.USD ?? 0);
  if (!Number.isFinite(balance) || balance < 0) throw new Error("Available balance must be finite and non-negative.");
  logger.info(`[TRADER] Available balance: $${balance.toFixed(2)}`);
  return { balance, asOf: Date.now() };
}

/** Map a Kraken asset code to a friendly ticker (XXBT → BTC, ZUSD → USD, etc.). */
function displayAsset(a) {
  if (a === "ZUSD") return "USD";
  if (a === "XXBT" || a === "XBT") return "BTC";
  if (a.length === 4 && (a.startsWith("X") || a.startsWith("Z"))) return a.slice(1);
  return a;
}

const STABLES = ["USD", "USDT", "USDC", "DAI", "PYUSD"];

// Kraken's non-spot balance variants, including staked XTZ.S and the observed
// bonded/staking INJ.B balance, cannot be reconciled as spot inventory. They
// are outside cajh's execution universe and must not trigger ticker failures.
export function isIgnoredReconciliationBalance(assetCode) {
  return typeof assetCode === "string" && /\.(?:S|B)$/i.test(assetCode);
}

/**
 * Returns every non-dust asset held on the Kraken account, priced in USD:
 *   { holdings: [{ asset, qty, price, value }], totalUsd }
 * Stablecoins are valued at $1. Cost basis isn't available from the API, so this is
 * market value only — true entry-based P&L is tracked separately for cajh's own trades.
 */
export async function getHoldings() {
  const res = await callKraken("Balance");
  const bal = res.result || {};
  const holdings = [];
  let totalUsd = 0;

  for (const [code, qtyStr] of Object.entries(bal)) {
    const qty = parseFloat(qtyStr);
    if (!qty || qty < 1e-8) continue;
    if (isIgnoredReconciliationBalance(code)) {
      logger.info(`[TRADER] Ignoring staked Kraken balance ${code} during reconciliation.`);
      continue;
    }
    const asset = displayAsset(code);

    if (STABLES.includes(asset)) {
      holdings.push({ asset, qty, price: 1, value: qty });
      totalUsd += qty;
      continue;
    }

    let price = 0;
    try {
      const pairCode = asset === "BTC" ? "XBT" : asset;
      const t = await callKraken("Ticker", { pair: `${pairCode}USD` });
      const k = Object.keys(t.result)[0];
      price = parseFloat(t.result[k].c[0]);
      if (!positiveFinite(price)) throw new Error(`Ticker returned invalid price for ${asset}`);
    } catch (err) {
      throw new Error(`holding price for ${asset} is unknown: ${err.message}`);
    }

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
  const { price } = await getCurrentPriceSnapshot(symbol);
  return price;
}

export async function getCurrentPriceSnapshot(symbol) {
  const pair = symbolToPair(symbol);
  const res  = await callKraken("Ticker", { pair });
  const data = Object.values(res.result)[0];
  const price = parseFloat(data?.c?.[0] ?? 0);
  if (!positiveFinite(price)) throw new Error("Price must be finite and positive.");
  return { price, asOf: Date.now() };
}

// ─── Orders ────────────────────────────────────────────────────────────────────

/**
 * Confirm a buy actually FILLED before the caller tracks it as a position. Throws if
 * Kraken canceled/expired the order or never confirms the fill — a thrown error here
 * means "do NOT register a trade", which is exactly what prevents phantom positions
 * (a trade cajh lists on Discord that doesn't exist on Kraken). Returns the executed
 * volume and average price so tracking matches reality, not the request.
 */
async function confirmBuyFill(txid, quotedPrice) {
  if (!txid) throw new Error("Kraken returned no transaction id — order state unknown; run !reconcile before retrying.");
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, orderConfirmDelayMs));
    let order = null;
    try {
      const res = await callKraken("QueryOrders", { txid });
      order = res.result?.[txid] ?? null;
    } catch (err) {
      logger.error(`[TRADER] QueryOrders failed for ${txid}:`, err.message);
      continue;
    }
    if (!order) continue;
    if (order.status === "canceled" || order.status === "expired") {
      throw new Error(`buy order ${txid} was ${order.status} by Kraken — nothing filled, position not tracked.`);
    }
    const volExec = parseFloat(order.vol_exec ?? 0);
    if (order.status === "closed" && volExec > 0) {
      return {
        price:  parseFloat(order.price) || quotedPrice,
        volume: volExec,
        fee:    parseFloat(order.fee ?? 0)
      };
    }
  }
  throw new Error(
    `could not confirm buy ${txid} filled — NOT tracking it. Run !reconcile: if the coin appears as an orphan, ` +
    `the buy did go through and should be closed manually or re-tracked.`
  );
}

/** Convert a terminal Kraken sell order into a confirmed execution. */
export function parseConfirmedSell(order, requestedVolume) {
  if (order?.status !== "closed") {
    throw new Error(`sell order is not terminally confirmed (${order?.status ?? "unknown"})`);
  }
  const volume = parseFloat(order.vol_exec ?? 0);
  const price = parseFloat(order.price ?? 0);
  if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error("sell order closed without a valid executed volume and price");
  }
  return {
    volume: Math.min(volume, requestedVolume),
    price,
    fee: parseFloat(order.fee ?? 0)
  };
}

async function confirmSellFill(txid, requestedVolume, quotedPrice) {
  if (!txid) throw new Error("Kraken returned no sell transaction id; execution state is unknown.");
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, orderConfirmDelayMs));
    try {
      const res = await callKraken("QueryOrders", { txid });
      const order = res.result?.[txid];
      if (order?.status === "canceled" || order?.status === "expired" || order?.status === "rejected") {
        throw new Error(`sell order ${txid} was ${order.status}; no confirmed close`);
      }
      if (order?.status === "closed") return parseConfirmedSell(order, requestedVolume);
    } catch (err) {
      if (/was (canceled|expired|rejected)/.test(err.message)) throw err;
      logger.error(`[TRADER] QueryOrders failed for sell ${txid}:`, err.message);
    }
  }
  throw new Error(`could not confirm sell ${txid} terminal execution; tracked position retained`);
}

/**
 * Places a spot market buy order for `capital` USD.
 * Volume is capital / price, rounded to the pair's lot decimals. The returned volume
 * and price are the CONFIRMED executed values from Kraken (throws if unconfirmed).
 */
export async function placeBuy({ symbol, capital, price, priceAsOf, balance, balanceAsOf }) {
  const { pair } = validateOrderTransportBoundary({ symbol, side: "buy", price, priceAsOf, capital, balance, balanceAsOf });
  const volume  = await normalizeVolume(pair, capital / price);

  logger.info(`[TRADER] BUY ${volume} ${symbol} @ ~$${price} ($${capital.toFixed(2)})`);

  const res = await callKraken("AddOrder", {
    pair,
    type:      "buy",
    ordertype: "market",
    volume
  });

  const txid = res.result?.txid?.[0];
  const fill = await confirmBuyFill(txid, price);

  return {
    txid,
    symbol,
    pair,
    side:    "buy",
    volume:  fill.volume,   // executed, not requested
    price:   fill.price,
    fee:     fill.fee,
    capital,
    balance
  };
}

/**
 * Places a spot market sell order to close a position.
 * Volume is the amount of the asset held. `price` (optional) is a pre-trade quote used
 * only for logging; the returned result always uses a confirmed terminal fill.
 */
export async function placeSell({ symbol, volume, price, priceAsOf = Date.now() }) {
  validateOrderTransportBoundary({ symbol, side: "sell", price, priceAsOf, volume });
  const { pair } = validateOrderRequest({ symbol, side: "sell", price, volume });
  const volStr  = await normalizeVolume(pair, volume);

  logger.info(`[TRADER] SELL ${volStr} ${symbol}`);

  const res = await callKraken("AddOrder", {
    pair,
    type:      "sell",
    ordertype: "market",
    volume:    volStr
  });

  const txid      = res.result?.txid?.[0];
  const fill = await confirmSellFill(txid, parseFloat(volStr), price);

  return {
    txid,
    symbol,
    pair,
    side:   "sell",
    volume: fill.volume,
    price:  fill.price,
    fee:    fill.fee
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
              logger.error(`Kraken error for ${pair}:`, response.data.error);
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
          logger.error(`Fetch attempt ${attempt} failed for ${pair}:`, error.message);
      if (attempt === 3) return null;
      await new Promise(res => setTimeout(res, 5000 * attempt));
    }
  }
  return null;
}
