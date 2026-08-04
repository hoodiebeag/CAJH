import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  getRecentDecisions,
  recordDecision,
  resetDecisionLogForTests
} from "./logger.js";

const root = process.cwd();
const scannerUrl = pathToFileURL(path.join(root, "scanner.js")).href;
const storageUrl = pathToFileURL(path.join(root, "storage.js")).href;

test("decision log is bounded and records one structured decision per asset", () => {
  resetDecisionLogForTests();
  for (let i = 0; i < 505; i++) {
    recordDecision({
      symbol: `S${i}`,
      timeframe: "1h",
      taken: false,
      reason: "no signal",
      entry: 100,
      stop: 95,
      takeProfit: 120,
      risk: 5,
      regime: { "1h": "bull" }
    }, { now: () => `2026-08-04T00:00:${String(i % 60).padStart(2, "0")}.000Z` });
  }

  const recent = getRecentDecisions();
  assert.equal(recent.length, 500);
  assert.equal(recent[0].symbol, "S5");
  assert.deepEqual(recent.at(-1), {
    type: "asset_decision",
    ts: "2026-08-04T00:00:24.000Z",
    symbol: "S504",
    timeframe: "1h",
    taken: false,
    reason: "no signal",
    entry: 100,
    stop: 95,
    takeProfit: 120,
    risk: 5,
    regime: { "1h": "bull" },
    mode: null
  });
});

test("injected decision logging failure is non-blocking and cannot change submit result", () => {
  resetDecisionLogForTests();
  const submitResult = { traded: false, reason: "entry blocked: test gate" };
  const record = recordDecision({
    symbol: "BTC",
    timeframe: "4h",
    taken: submitResult.traded,
    reason: submitResult.reason
  }, { sink: () => { throw new Error("disk full"); } });

  assert.equal(record.symbol, "BTC");
  assert.deepEqual(submitResult, { traded: false, reason: "entry blocked: test gate" });
  assert.equal(getRecentDecisions({ limit: 1 })[0].reason, "entry blocked: test gate");
});

test("scanner decision helper appends a structured persistent record without trade side effects", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-decision-log-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as scanner from ${JSON.stringify(scannerUrl)};
    import * as storage from ${JSON.stringify(storageUrl)};
    const record = scanner.logAssetDecision({
      symbol: "ETH",
      buy: { tf: "1d", mode: "anticipation", pivotPrice: 90 },
      result: { traded: false, reason: "stop too far", entry: 100, takeProfit: 130 },
      biases: { "1h": "bear", "4h": "bull", "1d": "bull" }
    });
    console.log("__RESULT__" + JSON.stringify({ record, journal: storage.loadDecisionJournal() }));
  `], { cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find((value) => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  const parsed = JSON.parse(line.slice("__RESULT__".length));

  assert.equal(parsed.record.symbol, "ETH");
  assert.equal(parsed.record.timeframe, "1d");
  assert.equal(parsed.record.taken, false);
  assert.equal(parsed.record.reason, "stop too far");
  assert.equal(parsed.record.entry, 100);
  assert.equal(parsed.record.stop, 90);
  assert.equal(parsed.record.risk, 10);
  assert.equal(parsed.journal.length, 1);
  assert.equal(parsed.journal[0].type, "asset_decision");
});
