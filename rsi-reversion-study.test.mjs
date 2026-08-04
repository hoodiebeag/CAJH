import test from "node:test";
import assert from "node:assert/strict";
import {
  reversionTrades,
  runRsiReversionStudy,
  scoreAsset
} from "./rsi-reversion-study.mjs";

const DAY = 86400;
const candle = (i, close) => ({ time: Date.UTC(2024, 0, 1) / 1000 + i * DAY, close });

/**
 * Shared prefix (indices 0-24), hand-verified against Wilder's RSI(14) formula:
 *   0-9:   flat at 200 (10 bars; contributes 0 gain/0 loss to the RSI(14) seed window
 *          and pads MA(20)'s later windows with high values).
 *   10-23: a pure -1/day decline, 199 down to 186 (14 bars). Every change in this run
 *          is a loss of exactly 1, so Wilder's avgGain seeds at 0 and STAYS at 0 for as
 *          long as the decline continues (0*13+0=0 every step) — RSI(14) is therefore
 *          exactly 0 for the whole decline, not merely "low".
 *   24:    a +4 reversal (186 -> 190). avgGain(24) = 4/14 = 0.2857; avgLoss(24) carries
 *          forward Wilder's smoothed value from the decline (~0.6221, nine smoothing
 *          steps from the seed 5/14). RSI(24) = 100 - 100/(1 + 0.2857/0.6221) = 31.47 —
 *          crosses up through 30 (RSI(23)=0 -> RSI(24)=31.47), entry fills at close[25].
 */
function prefixCloses() {
  const closes = [];
  for (let i = 0; i < 10; i++) closes.push(200);
  for (let i = 0; i < 14; i++) closes.push(199 - i);   // 199, 198, ..., 186
  closes.push(190);                                     // index 24
  return closes;
}

test("MR1 exits at the first close ≥ MA(20) strictly AFTER entry, not on day 1 and not late", () => {
  // Tail (indices 25-28): 189, 189, 189, 195. MA(20) at 26/27/28 = 193.15 / 192.60 /
  // 192.35 (hand-summed from the 20-bar window each day); 189 stays below it on days
  // 1-2, and 195 clears 192.35 on day 3 — proving the loop searches forward rather than
  // firing immediately or missing the correct day.
  const closes = [...prefixCloses(), 189, 189, 189, 195];
  const candles = closes.map((close, i) => candle(i, close));

  const trades = reversionTrades(candles);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].entryIndex, 25);
  assert.equal(trades[0].entry, 189);
  assert.equal(trades[0].exitIndex, 28);
  assert.equal(trades[0].exit, 195);
  assert.equal(trades[0].exitReason, "ma_reclaim");
  assert.equal(trades[0].holdingDays, 3);
  const grossReturn = 195 / 189 - 1;
  assert.ok(Math.abs(trades[0].grossReturn - grossReturn) < 1e-12);
  assert.ok(Math.abs(trades[0].netReturn - (grossReturn - 0.009)) < 1e-12);
});

test("MR1 exits via the 7-day timeout when MA(20) never reclaims", () => {
  // Tail (indices 25-32): flat at 189 for all 8 bars (entry + 7 held days). MA(20) drifts
  // down from 193.15 to 190.15 over that span (hand-summed each day) but never reaches
  // 189, so the ma_reclaim branch never fires and the 7-day cap forces the exit.
  const closes = [...prefixCloses(), 189, 189, 189, 189, 189, 189, 189, 189];
  const candles = closes.map((close, i) => candle(i, close));

  const trades = reversionTrades(candles);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].entryIndex, 25);
  assert.equal(trades[0].exitIndex, 32);
  assert.equal(trades[0].holdingDays, 7);
  assert.equal(trades[0].exitReason, "timeout");
  assert.equal(trades[0].exit, 189);
  assert.equal(trades[0].grossReturn, 0);
  assert.ok(Math.abs(trades[0].netReturn - -0.009) < 1e-12);
});

test("MR1 does not open a second position on the same bar the first one exits", () => {
  // Reuses the day-1 scenario's own numbers: RSI dips back to 29.01 while held (indices
  // 25-27), then jumps to 55.22 at index 28 — the SAME bar whose close (195) also
  // triggers the ma_reclaim exit. Hand-verified: rsi[27]=29.01 < 30, rsi[28]=55.22 >= 30,
  // so index 28 independently satisfies "crossed up through 30" — meaning an unguarded
  // implementation would open a SECOND position (entryIndex 29) same-bar as the first
  // one's exit. The position-then-continue structure must suppress that.
  const closes = [...prefixCloses(), 189, 189, 189, 195, 195, 195];
  const candles = closes.map((close, i) => candle(i, close));

  const trades = reversionTrades(candles);
  assert.equal(trades.length, 1, "the same-bar re-cross must not open a concurrent second trade");
  assert.equal(trades[0].exitIndex, 28);
  assert.ok(!trades.some((t) => t.entryIndex === 29), "no trade may open at the exit bar's very next index from this guard alone");
});

test("MR1 score reports signals, timeouts, position days, net cost, and buy-and-hold", () => {
  const closes = [...prefixCloses(), 189, 189, 189, 195];
  const score = scoreAsset("BTC", closes.map((close, i) => candle(i, close)));

  assert.equal(score.symbol, "BTC");
  assert.equal(score.signals, 1);
  assert.equal(score.timeouts, 0);
  assert.equal(score.positionDays, 3);
  const grossReturn = 195 / 189 - 1;
  assert.ok(Math.abs(score.netReturn - (grossReturn - 0.009)) < 1e-12);
  assert.ok(Math.abs(score.buyHoldReturn - (195 / 200 - 1)) < 1e-12);
});

test("MR1 study preserves symbol and recent holdouts and computes a verdict from them", () => {
  const base = [...prefixCloses(), 189, 189, 189, 195].map((close, i) => candle(i, close));
  const series = new Map([
    ["BTC", base],
    ["ETH", base.map((row) => ({ ...row }))],
    ["ATOM", base.map((row) => ({ ...row }))]
  ]);
  const study = runRsiReversionStudy(series, {
    universe: ["BTC", "ETH", "ATOM"],
    symbolHoldout: ["ATOM"],
    recentHoldoutDays: 9999   // the whole short fixture counts as "recent" here
  });

  assert.equal(study.input.specification, "MR1-RSI14x30-MA20-7day-long-cash/v1");
  assert.deepEqual(study.input.trainSymbols, ["BTC", "ETH"]);
  assert.deepEqual(study.input.symbolHoldout, ["ATOM"]);
  assert.equal(study.result.symbolHoldout.signals, 1);
  // Same fixture as the score test above: one +3.17% gross / +2.27% net trade.
  const grossReturn = 195 / 189 - 1;
  assert.ok(Math.abs(study.result.holdout.netReturn - (grossReturn - 0.009)) < 1e-12);
});

test("MR1 returns CONTEXT-ONLY when holdout has too few completed signals", () => {
  // Monotonically rising closes never let RSI(14) dip below 30 in the first place, so
  // no signal ever fires — a thin/empty holdout must not be read as a null result.
  const rising = Array.from({ length: 260 }, (_, i) => candle(i, 100 + i));
  const study = runRsiReversionStudy(new Map([
    ["BTC", rising],
    ["ATOM", rising]
  ]), {
    universe: ["BTC", "ATOM"],
    symbolHoldout: ["ATOM"],
    recentHoldoutDays: 30
  });

  assert.equal(study.result.holdout.signals, 0);
  assert.equal(study.result.verdict, "CONTEXT-ONLY");
});
