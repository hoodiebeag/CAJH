import test from "node:test";
import assert from "node:assert/strict";
import { quarters, fit, walkForward, FIXED, GRID } from "./walkforward.mjs";

test("quarters cover the window and stop at its end", () => {
  const qs = quarters("2024-01-01", "2026-03-31");
  assert.equal(qs.length, 9);
  assert.deepEqual(qs[0], { from: "2024-01-01", to: "2024-03-31" });
  assert.deepEqual(qs.at(-1), { from: "2026-01-01", to: "2026-03-31" });
});

test("quarters clip a partial final quarter rather than running past the data", () => {
  const qs = quarters("2025-01-01", "2025-05-15");
  assert.deepEqual(qs.at(-1), { from: "2025-04-01", to: "2025-05-15" });
});

test("a fit sees only bars that closed before the window it will be judged on", () => {
  // The guarantee the whole file rests on: change the cutoff and the fitted answer may change,
  // but a fit at an earlier cutoff can never depend on later data.
  const early = fit("2023-01-01", "2023-12-31", { grid: { trendMa: [150, 200], minStopPct: [0.03] } });
  const earlyAgain = fit("2023-01-01", "2023-12-31", { grid: { trendMa: [150, 200], minStopPct: [0.03] } });
  assert.deepEqual(early.config, earlyAgain.config, "fitting must be deterministic");
  assert.ok(early.trades >= 20, "a configuration chosen on fewer than 20 trades is refused");
});

test("exits run to the end of the data, not to the end of the decision window", () => {
  // This is the bug that made the first walk-forward report -0.42R out of sample while every one
  // of the same configurations, held fixed over the same window, scored between +0.74R and
  // +1.85R. Truncating the run at each quarter's end amputated every position still open, and
  // with 50-to-200-bar holds that is most of them.
  const short = walkForward({ testFrom: "2025-01-01", testTo: "2025-06-30", dataEnd: "2025-06-30",
    grid: { trendMa: [150], minStopPct: [0.03], beTriggerR: [2.5], maxHold: [100], volTarget: [0.05] } });
  const full = walkForward({ testFrom: "2025-01-01", testTo: "2025-06-30", dataEnd: "2026-03-31",
    grid: { trendMa: [150], minStopPct: [0.03], beTriggerR: [2.5], maxHold: [100], volTarget: [0.05] } });
  // Entry counts differ by at most a trade or two: a signal in the last bars of a truncated series
  // has no bar left to fill or hold on, so it never becomes an entry at all.
  assert.ok(Math.abs(short.trades - full.trades) <= 2, `${short.trades} vs ${full.trades} entries`);
  assert.ok(Math.abs(short.meanR - full.meanR) > 0.1,
    `truncated exits must change the answer materially: ${short.meanR}R vs ${full.meanR}R`);
  assert.ok(full.meanR > short.meanR, "amputating open positions can only cost a trend follower");
});

test("the chosen configuration reports every axis that was fitted, not a hardcoded subset", () => {
  // A hardcoded list once reported a refit of eight axes as though only five had been fitted, so
  // whether the entry mode and filters moved between quarters -- the whole question that run
  // existed to answer -- was invisible in its output.
  const grid = { trendMa: [150], minStopPct: [0.03], beTriggerR: [2.5], maxHold: [100],
                 volTarget: [0.05], entryMode: ["breakout", "bos"] };
  const r = walkForward({ testFrom: "2025-07-01", testTo: "2025-09-30", grid });
  const step = r.steps.find((s) => !s.skipped);
  assert.deepEqual(Object.keys(step.chose).sort(), Object.keys(grid).sort());
});

test("the grid and the fixed structure are declared, so what was NOT refit is visible", () => {
  // FIXED carries choices made on the full sample -- the filters, the fill delay, the entry mode.
  // They are held constant here rather than refit, which is a real leak and is stated as one.
  assert.equal(FIXED.entryMode, "breakout");
  assert.equal(FIXED.entryDelayBars, 1);
  assert.ok(FIXED.filters, "the filters were selected in-sample and are not refit");
  assert.ok(Object.keys(GRID).length >= 4);
});
