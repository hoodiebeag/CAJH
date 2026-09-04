import test from "node:test";
import assert from "node:assert/strict";
import { COST_MODELS, costFor, costInR } from "./costs.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

test("krakenTaker matches the constants every crypto result was computed under", () => {
  // If these ever diverge, some published number in this repo is no longer reproducible.
  assert.equal(COST_MODELS.krakenTaker.feeRate, FEE_RATE);
  assert.equal(COST_MODELS.krakenTaker.slipPct, SLIPPAGE_PCT);
});

test("the cost identity reproduces the figures the campaign turned on", () => {
  const k = COST_MODELS.krakenTaker;
  assert.ok(Math.abs(costInR(k, 0.01) - 1.70) < 0.01, `a 1% stop pays ${costInR(k, 0.01)}R`);
  assert.ok(Math.abs(costInR(k, 0.15) - 0.113) < 0.01, `a 15% stop pays ${costInR(k, 0.15)}R`);
});

test("equities cost roughly thirty times less per trade than crypto", () => {
  // The reason a cost model may not be inherited across asset classes. At a 3% stop -- the
  // campaign leader's floor -- crypto pays 0.57R a trade and equities pay 0.033R.
  const crypto = costInR(COST_MODELS.krakenTaker, 0.03);
  const equity = costInR(COST_MODELS.usEquityRetail, 0.03);
  assert.ok(crypto / equity > 15, `ratio is ${(crypto / equity).toFixed(1)}x`);
  assert.ok(crypto > 0.5 && equity < 0.05, `${crypto}R against ${equity}R`);
});

test("a crypto universe defaults to Kraken, so existing results stay reproducible", () => {
  assert.equal(costFor(["XBTUSD", "ETHUSD", "SOLUSD"]).name, "krakenTaker");
  assert.equal(costFor({ XBTUSD: [], ADAUSD: [] }).name, "krakenTaker");
});

test("anything not recognisably crypto must be named, and the error says why", () => {
  // Guessing here does not produce a slightly wrong number. It produces an equities backtest
  // charged thirty times its real cost, which looks exactly like a strategy that does not work.
  assert.throws(() => costFor(["AAPL", "MSFT", "SPY"]), /not recognisably crypto/);
  assert.throws(() => costFor(["AAPL", "MSFT", "SPY"]), /thirty times the real cost/);
  assert.throws(() => costFor(["XBTUSD", "AAPL"]), /AAPL/, "one foreign symbol is enough to refuse");
});

test("an explicit model is honoured and an unknown one is refused", () => {
  assert.equal(costFor(["AAPL"], "usEquityRetail").name, "usEquityRetail");
  assert.equal(costFor(["AAPL"], "usEquityIbkr").feeRate, 0.00005);
  assert.throws(() => costFor(["AAPL"], "freeTrades"), /unknown cost model/);
});

test("zeroCost exists and is labelled as a diagnostic, not a rate", () => {
  assert.equal(costFor(["AAPL"], "zeroCost").feeRate, 0);
  assert.match(COST_MODELS.zeroCost.note, /diagnostic only/);
});

test("the environment variable is honoured even when the call site passes null", () => {
  // Every call site reads `config.costModel ?? null`, and a JS default parameter only fires on
  // `undefined` — so a signature default made CANDLE_COST_MODEL unreachable through the harness.
  // The first equities run died on exactly this, with the env var correctly set.
  const prev = process.env.CANDLE_COST_MODEL;
  try {
    process.env.CANDLE_COST_MODEL = "usEquityRetail";
    assert.equal(costFor(["AAPL", "SPY"], null).name, "usEquityRetail");
    assert.equal(costFor(["AAPL", "SPY"]).name, "usEquityRetail");
    assert.equal(costFor(["AAPL", "SPY"], "usEquityIbkr").name, "usEquityIbkr", "an explicit request still wins");
  } finally {
    if (prev === undefined) delete process.env.CANDLE_COST_MODEL; else process.env.CANDLE_COST_MODEL = prev;
  }
});
