import test from "node:test";
import assert from "node:assert/strict";
import { applyRiskGate, validateProposal, DEFAULT_LIMITS, REJECT } from "./risk.mjs";

const THESIS = "earnings beat, guidance raised, volume confirms";

const prop = (over = {}) => ({ symbol: "AAPL", action: "buy", targetPct: 0.05, confidence: 0.8, thesis: THESIS, ...over });
const inst = (over = {}) => ({ class: "usEquity", sector: "Information Technology", price: 100, quoteAgeMs: 1000, medianDollarVolume: 1e9, ...over });
const state = (over = {}) => ({ nav: 100000, peakNav: 100000, dayStartNav: 100000, positions: {}, shortingPermitted: false, ...over });

const codes = (r) => r.rejected.map((x) => x.code);

// ---- proposal shape -------------------------------------------------------------------------

test("a proposal with no thesis is refused", () => {
  // A decision with no stated reason cannot be reviewed or scored against its own reasoning later.
  assert.match(validateProposal(prop({ thesis: "" })), /thesis/);
  assert.match(validateProposal(prop({ thesis: "up" })), /thesis/);
});

test("targetPct is a fraction, not a percent", () => {
  assert.match(validateProposal(prop({ targetPct: 5 })), /fraction of NAV/);
  assert.equal(validateProposal(prop({ targetPct: 0.05 })), null);
});

test("direction comes from action, never from a negative size", () => {
  assert.match(validateProposal(prop({ targetPct: -0.05 })), />= 0/);
});

test("an unknown action is refused rather than guessed at", () => {
  assert.match(validateProposal(prop({ action: "yolo" })), /unknown action/);
});

test("confidence outside [0,1] is refused", () => {
  assert.match(validateProposal(prop({ confidence: 1.4 })), /confidence/);
});

// ---- account-level breakers -----------------------------------------------------------------

test("drawdown halt rejects the entire batch, including holds", () => {
  const r = applyRiskGate([prop(), prop({ symbol: "MSFT", action: "hold" })],
    state({ nav: 80000, peakNav: 100000 }), { AAPL: inst(), MSFT: inst() });
  assert.equal(r.halted, true);
  assert.equal(r.allowed.length, 0);
  assert.deepEqual(new Set(codes(r)), new Set([REJECT.HALTED]));
});

test("halt fires exactly at the threshold, not just past it", () => {
  const r = applyRiskGate([prop()], state({ nav: 85000, peakNav: 100000 }), { AAPL: inst() });
  assert.equal(r.halted, true);
});

test("a NAV above the recorded peak re-bases the peak rather than reporting a negative drawdown", () => {
  const r = applyRiskGate([prop()], state({ nav: 120000, peakNav: 100000 }), { AAPL: inst() });
  assert.equal(r.halted, false);
  assert.equal(r.allowed.length, 1);
});

test("daily brake blocks new risk but lets closes through", () => {
  const s = state({
    nav: 94000, dayStartNav: 100000,
    positions: { AAPL: { pct: 0.05, avgPrice: 90, class: "usEquity", sector: "Information Technology" } },
  });
  const r = applyRiskGate(
    [prop({ action: "buy", targetPct: 0.08 }), prop({ action: "sell", targetPct: 0 })],
    s, { AAPL: inst() });
  assert.equal(r.braked, true);
  assert.equal(r.allowed.length, 1);
  assert.equal(r.allowed[0].action, "sell");
  assert.deepEqual(codes(r), [REJECT.BRAKE]);
});

test("no NAV refuses the whole batch instead of assuming one", () => {
  // A wrong NAV silently rescales every percentage cap at once, so there is no safe default.
  const r = applyRiskGate([prop()], state({ nav: 0 }), { AAPL: inst() });
  assert.equal(r.allowed.length, 0);
  assert.deepEqual(codes(r), [REJECT.MALFORMED]);
});

// ---- asset class ----------------------------------------------------------------------------

test("options are forbidden outright", () => {
  const r = applyRiskGate([prop()], state(), { AAPL: inst({ class: "option" }) });
  assert.deepEqual(codes(r), [REJECT.CLASS_FORBIDDEN]);
});

test("a class without a verified cost model cannot trade", () => {
  // FEE-SCHEDULE-REBASE: this project's cost assumptions were once half the real rate.
  for (const c of ["crypto", "forex", "eventContract"]) {
    const r = applyRiskGate([prop()], state(), { AAPL: inst({ class: c }) });
    assert.deepEqual(codes(r), [REJECT.CLASS_UNVERIFIED], `${c} should be paper-only`);
  }
});

test("an unknown asset class is refused, not defaulted to equity", () => {
  const r = applyRiskGate([prop()], state(), { AAPL: inst({ class: "commodity" }) });
  assert.deepEqual(codes(r), [REJECT.MALFORMED]);
});

// ---- shorting -------------------------------------------------------------------------------

test("shorting is refused while borrow is unverified", () => {
  const r = applyRiskGate([prop({ action: "short" })], state(), { AAPL: inst() });
  assert.deepEqual(codes(r), [REJECT.SHORT_NOT_PERMITTED]);
});

test("selling a name we do not hold is a short, not a sale", () => {
  const r = applyRiskGate([prop({ action: "sell", targetPct: 0.05 })], state(), { AAPL: inst() });
  assert.deepEqual(codes(r), [REJECT.SHORT_NOT_PERMITTED]);
});

test("shorting is allowed once borrow is permitted", () => {
  const r = applyRiskGate([prop({ action: "short" })], state({ shortingPermitted: true }), { AAPL: inst() });
  assert.equal(r.allowed.length, 1);
});

// ---- sizing and concentration ---------------------------------------------------------------

test("a position over the per-name cap is refused, not trimmed", () => {
  // Silently resizing would mean the journal records a trade nobody proposed.
  const r = applyRiskGate([prop({ targetPct: 0.20 })], state(), { AAPL: inst() });
  assert.deepEqual(codes(r), [REJECT.POSITION_CAP]);
});

test("sector cap stops ten of the same trade", () => {
  const instruments = {}, proposals = [];
  for (const s of ["A", "B", "C", "D", "E", "F"]) {
    instruments[s] = inst({ sector: "Information Technology" });
    proposals.push(prop({ symbol: s, targetPct: 0.05 }));
  }
  const r = applyRiskGate(proposals, state(), instruments, { maxNewPositionsPerBatch: 99 });
  // 0.25 cap at 0.05 each = five fit, the sixth does not.
  assert.equal(r.allowed.length, 5);
  assert.deepEqual(codes(r), [REJECT.SECTOR_CAP]);
});

test("unclassified names share one bucket rather than being exempt", () => {
  const instruments = {}, proposals = [];
  for (const s of ["A", "B", "C", "D", "E", "F"]) {
    instruments[s] = inst({ sector: undefined });
    proposals.push(prop({ symbol: s, targetPct: 0.05 }));
  }
  const r = applyRiskGate(proposals, state(), instruments, { maxNewPositionsPerBatch: 99 });
  assert.equal(r.allowed.length, 5);
  assert.deepEqual(codes(r), [REJECT.SECTOR_CAP]);
});

test("gross exposure cannot exceed NAV", () => {
  const instruments = {}, proposals = [];
  for (let i = 0; i < 14; i++) {
    const s = `S${i}`;
    instruments[s] = inst({ sector: `Sector${i}`, class: "usEquity" });
    proposals.push(prop({ symbol: s, targetPct: 0.10 }));
  }
  // The class and sector caps are lifted ABOVE the gross cap so that gross is the binding limit.
  // Left at 1.0 they bind at exactly the same point and mask it -- the proposal is rejected either
  // way, but by the wrong rule, which would make this test pass without testing anything.
  const r = applyRiskGate(proposals, state(), instruments,
    { maxNewPositionsPerBatch: 99, maxSectorPct: 2, maxClassPct: 2 });
  assert.equal(r.allowed.length, 10);
  assert.ok(r.exposure <= DEFAULT_LIMITS.maxGrossExposure + 1e-9);
  assert.ok(codes(r).every((c) => c === REJECT.GROSS_CAP), `got ${codes(r)}`);
});

test("existing exposure counts toward the caps", () => {
  const s = state({
    positions: {
      X: { pct: 0.20, avgPrice: 50, class: "usEquity", sector: "Energy" },
    },
  });
  const r = applyRiskGate([prop({ symbol: "Y", targetPct: 0.08 })], s,
    { Y: inst({ sector: "Energy" }), X: inst({ sector: "Energy" }) });
  assert.deepEqual(codes(r), [REJECT.SECTOR_CAP]);
});

// ---- the behavioural rules ------------------------------------------------------------------

test("averaging down is refused", () => {
  const s = state({ positions: { AAPL: { pct: 0.05, avgPrice: 120, class: "usEquity", sector: "Information Technology" } } });
  const r = applyRiskGate([prop({ targetPct: 0.09 })], s, { AAPL: inst({ price: 100 }) });
  assert.deepEqual(codes(r), [REJECT.AVERAGING_DOWN]);
});

test("adding to a winner is allowed", () => {
  const s = state({ positions: { AAPL: { pct: 0.05, avgPrice: 80, class: "usEquity", sector: "Information Technology" } } });
  const r = applyRiskGate([prop({ targetPct: 0.09 })], s, { AAPL: inst({ price: 100 }) });
  assert.equal(r.allowed.length, 1);
});

test("closing a losing position is always allowed", () => {
  const s = state({ positions: { AAPL: { pct: 0.05, avgPrice: 120, class: "usEquity", sector: "Information Technology" } } });
  const r = applyRiskGate([prop({ action: "sell", targetPct: 0 })], s, { AAPL: inst({ price: 100 }) });
  assert.equal(r.allowed.length, 1);
});

test("new positions per batch are capped", () => {
  const instruments = {}, proposals = [];
  for (let i = 0; i < 9; i++) {
    const s = `S${i}`;
    instruments[s] = inst({ sector: `Sector${i}` });
    proposals.push(prop({ symbol: s, targetPct: 0.02 }));
  }
  const r = applyRiskGate(proposals, state(), instruments);
  assert.equal(r.allowed.length, DEFAULT_LIMITS.maxNewPositionsPerBatch);
  assert.ok(codes(r).every((c) => c === REJECT.BATCH_CAP));
});

test("when a cap binds, the analyst's own conviction ordering decides who gets in", () => {
  const instruments = {}, proposals = [];
  for (let i = 0; i < 9; i++) {
    const s = `S${i}`;
    instruments[s] = inst({ sector: `Sector${i}` });
    proposals.push(prop({ symbol: s, targetPct: 0.02, confidence: i / 10 }));
  }
  const r = applyRiskGate(proposals, state(), instruments);
  // Highest confidence is S8; it must survive the batch cap.
  assert.ok(r.allowed.some((p) => p.symbol === "S8"));
  assert.ok(!r.allowed.some((p) => p.symbol === "S0"));
});

// ---- data quality ---------------------------------------------------------------------------

test("a stale quote blocks the order", () => {
  // IBKR delayed quotes arrive ~2.76h stale on this account.
  const r = applyRiskGate([prop()], state(), { AAPL: inst({ quoteAgeMs: 2.76 * 3600 * 1000 }) });
  assert.deepEqual(codes(r), [REJECT.STALE_QUOTE]);
});

test("no usable price blocks the order", () => {
  for (const price of [0, -1, NaN, undefined]) {
    const r = applyRiskGate([prop()], state(), { AAPL: inst({ price }) });
    assert.deepEqual(codes(r), [REJECT.NO_PRICE], `price ${price}`);
  }
});

test("a position too large for the tape is refused", () => {
  // Every backtest here assumes a fill at the close; that holds only while we are small.
  const r = applyRiskGate([prop({ targetPct: 0.10 })], state({ nav: 1e7 }),
    { AAPL: inst({ medianDollarVolume: 1e6 }) });
  assert.deepEqual(codes(r), [REJECT.LIQUIDITY]);
});

test("an instrument we have no record of is refused", () => {
  const r = applyRiskGate([prop({ symbol: "NOPE" })], state(), {});
  assert.deepEqual(codes(r), [REJECT.MALFORMED]);
});

// ---- the gate is pure -------------------------------------------------------------------------

test("the gate does not mutate the state or proposals it is given", () => {
  const s = state({ positions: { AAPL: { pct: 0.05, avgPrice: 80, class: "usEquity", sector: "Information Technology" } } });
  const before = JSON.stringify(s);
  const proposals = [prop({ targetPct: 0.09 })];
  const propsBefore = JSON.stringify(proposals);
  applyRiskGate(proposals, s, { AAPL: inst() });
  assert.equal(JSON.stringify(s), before);
  assert.equal(JSON.stringify(proposals), propsBefore);
});

test("an empty batch is not an error", () => {
  const r = applyRiskGate([], state(), {});
  assert.deepEqual(r.allowed, []);
  assert.deepEqual(r.rejected, []);
});
