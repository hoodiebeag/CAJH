/**
 * ibkr-intraday-probe.mjs — ask the Gateway what intraday history it will actually serve.
 *
 * READ-ONLY. It issues `reqHistoricalData` and nothing else; there is no order path in this file.
 *
 * WHY IT EXISTS. The strategy manual's largest gated data class is intraday: 275 mentions against
 * 205 for options and 133 for borrow. Every strategy resting on it was triaged into Tier C, "must
 * be bought". That triage assumed intraday is a purchase. It may be a pull — `ibkr-bars.mjs` simply
 * had `BarSizeSetting.DAYS_ONE` hard-coded into its one request, and the same transport has already
 * returned 501 daily bars from a live Gateway. This settles which, with a measurement.
 *
 * IT DOES NOT ENCODE TWS'S PACING LIMITS, deliberately. Those limits are widely documented and
 * widely misquoted, and writing a guessed table into this repository would convert a guess into a
 * fact the next reader trusts. The ladder below is ASKED, not assumed, and the last rung is a
 * deliberate over-ask — one year of one-minute bars — which TWS should refuse. If that rung comes
 * back OK, the probe is not discriminating and its other rows mean nothing. A control, on the same
 * principle as every study in this campaign.
 *
 * Usage: node scripts/ibkr-intraday-probe.mjs [SYMBOL]   (default AAPL)
 */
import { connect, fetchBars } from "../ibkr-bars.mjs";

const SYMBOL = process.argv[2] || "AAPL";

const LADDER = [
  { duration: "1 D",  barSize: "1 min",   note: "one day of minute bars" },
  { duration: "2 D",  barSize: "1 min",   note: "two days of minute bars" },
  { duration: "5 D",  barSize: "5 mins",  note: "a week at 5m" },
  { duration: "1 M",  barSize: "30 mins", note: "a month at 30m" },
  { duration: "6 M",  barSize: "1 hour",  note: "six months hourly" },
  { duration: "1 Y",  barSize: "1 hour",  note: "a year hourly" },
  { duration: "1 Y",  barSize: "1 day",   note: "daily — the known-good control, proven 4/4 live" },
  { duration: "1 Y",  barSize: "1 min",   note: "DELIBERATE OVER-ASK — TWS should REFUSE this" },
];

const iso = (t) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

const conn = await connect();
if (!conn.status.connected) {
  console.error(`no Gateway: ${conn.status.error}`);
  console.error("This probe needs IB Gateway up and the API enabled. Nothing was changed.");
  process.exit(1);
}
console.log(`connected. probing ${SYMBOL}, ${LADDER.length} rungs, read-only.\n`);

const contract = { symbol: SYMBOL, secType: "STK", exchange: "SMART", currency: "USD" };
const results = [];
let reqId = 900;

for (const rung of LADDER) {
  const r = await fetchBars(conn, contract, rung.duration, conn.ib.WhatToShow.TRADES, reqId++, rung.barSize);
  const span = r.bars.length
    ? `${iso(r.bars[0].time)} → ${iso(r.bars[r.bars.length - 1].time)}`
    : "—";
  results.push({ ...rung, ok: r.ok, bars: r.bars.length, reason: r.reason ?? "", span });
  console.log(
    `${(rung.duration + " / " + rung.barSize).padEnd(18)}` +
    `${(r.ok ? "OK" : "REFUSED").padEnd(9)}${String(r.bars.length).padStart(7)} bars  ${span}` +
    (r.ok ? "" : `  [${r.reason}]`),
  );
  // TWS paces historical requests; spacing them is politeness toward the Gateway, not a limit claim.
  await new Promise((res) => setTimeout(res, 11000));
}

conn.api.disconnect();

const control = results.find((r) => r.note.startsWith("DELIBERATE"));
const known = results.find((r) => r.barSize === "1 day");
const intraday = results.filter((r) => r.barSize !== "1 day" && r.ok && r.bars > 0);

console.log("\n--- verdict ---");
if (!known?.ok) {
  console.log("The known-good daily rung FAILED. That is a transport or entitlement problem, not an");
  console.log("answer about intraday. Fix that first; every other row here is uninterpretable.");
} else if (control?.ok) {
  console.log("THE CONTROL PASSED, which it should not have. A year of one-minute bars was accepted,");
  console.log("so this probe is not discriminating between served and refused. Do not read the rows");
  console.log("above as a capability map.");
} else if (!intraday.length) {
  console.log("No intraday rung returned data. Intraday is NOT available under the current entitlement,");
  console.log("so the manual's largest gated class stays a PURCHASE. The triage in");
  console.log("docs/MANUAL-STRATEGY-TRIAGE.md stands unchanged.");
} else {
  const finest = intraday[0];
  console.log(`Intraday IS available: ${intraday.length} of ${LADDER.length - 2} intraday rungs served,`);
  console.log(`finest granularity reached ${finest.barSize} over ${finest.duration} (${finest.bars} bars).`);
  console.log("That makes the manual's largest gated data class a PULL, not a purchase, and moves its");
  console.log("intraday strategies from Tier C toward Tier A. Update docs/MANUAL-STRATEGY-TRIAGE.md and");
  console.log("campaign-state.json with THESE numbers, not with the ladder's assumptions.");
  console.log("\nNOTE BEFORE ANY STUDY IS BUILT ON THIS: bars served is not the same as bars deep enough");
  console.log("to test. Check the span above against what a cross-sectional study over 127 names would");
  console.log("need, and remember no equities bundle here is survivorship-free.");
}
