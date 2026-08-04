import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlight } from "./monitor.js";
import { getScanTelemetry, runScanner } from "./scanner.js";

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test("manual or scheduled scan is skipped while a prior scan is still active", async () => {
  const hold = deferred();
  const channel = { send: () => hold.promise };
  const state = { watchlist: [] };

  const first = runScanner(channel, state, false);
  await Promise.resolve();
  const during = getScanTelemetry();
  const second = await runScanner(channel, state, false);

  assert.equal(during.active, true);
  assert.equal(second, undefined);
  assert.equal(getScanTelemetry().skipped, during.skipped + 1);

  hold.resolve();
  await first;
  assert.equal(getScanTelemetry().active, false);
});

test("single-flight guard skips overlapping monitor ticks and runs again after completion", async () => {
  const flight = createSingleFlight("TEST");
  const hold = deferred();
  let ran = 0;

  const first = flight.run(async () => {
    ran++;
    await hold.promise;
    return "first";
  });
  await Promise.resolve();
  const second = await flight.run(async () => {
    ran++;
    return "second";
  });

  assert.equal(second, undefined);
  assert.deepEqual(flight.telemetry(), { active: true, skipped: 1 });
  hold.resolve();
  assert.equal(await first, "first");
  assert.deepEqual(flight.telemetry(), { active: false, skipped: 1 });
  assert.equal(await flight.run(async () => {
    ran++;
    return "third";
  }), "third");
  assert.equal(ran, 2);
});
