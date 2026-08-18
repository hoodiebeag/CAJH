/**
 * brokers/kraken.mjs — wraps trader.js's Kraken-specific implementation into
 * the broker-agnostic interface (see brokers/interface.md).
 *
 * Pure delegation, no new logic: trader.js is a frozen_path (live-trading-
 * safety code the autonomous loop cannot touch), so this file re-shapes its
 * existing exports instead of modifying it. Every function here calls straight
 * through to trader.js with no behavior change.
 */
import * as trader from "../trader.js";

export const KrakenBroker = {
  fetchOHLC: trader.fetchOHLC,
  getCurrentPriceSnapshot: trader.getCurrentPriceSnapshot,
  getAccountBalanceSnapshot: trader.getAccountBalanceSnapshot,
  placeBuy: trader.placeBuy,
  placeSell: trader.placeSell,
  symbolToNativeId: trader.symbolToPair,
};
