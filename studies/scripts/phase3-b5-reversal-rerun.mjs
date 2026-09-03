/**
 * PHASE3-RERUN-REAL-SIGNALS-NEW-COSTS diagnostic (throwaway, read-only). Not part of the
 * app — re-runs B5-REVERSAL's ONLY surviving PHASE2 candidate (L=3 top-3/top-5, train leg
 * crossed positive from spot maker onward) as a genuine SYMBOL-HOLDOUT economics check,
 * which has never been computed before: the original B5-REVERSAL study (momentum.mjs's
 * `sealed-reversal` CLI path) only ever ran `economicMomentumViews` on
 * `splitRecentRows(panel.rows, 4).train` over the CONTROLLED (STABLE_13) universe - never
 * on the actual held-out 16-symbol universe that its own statistical-significance test
 * (`study.primary.symbolHoldout`) already uses. That gap is exactly what PHASE3 exists to
 * close. Deletable after ROADMAP_ARCHIVE.md's finding is written.
 *
 * PRE-REGISTRATION (written before any holdout number below is computed or examined,
 * per this item's own methodology requirement):
 *
 *   Signal: B5-REVERSAL, L=3 only (L=5 already failed the train-significance gate
 *   independently of cost per VERDICTS.md — not re-tested here, cost can't rescue a
 *   train-significance failure).
 *   Cost scenario: FUTURES TAKER (0.10% round trip), chosen over futures maker because
 *   this is a systematic per-rebalance cross-sectional strategy that must execute
 *   promptly at each 3-day rebalance boundary — resting maker orders risking a missed
 *   fill are not a realistic assumption for a signal whose edge depends on entering at
 *   the scheduled rebalance, not whenever a passive order happens to fill. Taker is still
 *   a real ~17x reduction from the 1.70% spot-taker basis this project has used
 *   throughout, so it is a fair test of the cost-reduction thesis without assuming the
 *   most optimistic execution.
 *   Universe: watchlist minus STABLE_13 (the actual held-out 16-symbol universe used by
 *   this study's own statistical-significance test) for holdout; STABLE_13 for train, on
 *   the same recency split the original study used, so the comparison is apples-to-apples
 *   with the already-published train numbers.
 *   Gate (must clear ALL, matching PHASE3's own done_when): holdout net return positive at
 *   the futures-taker cost; same sign as the train-leg net return at that same cost;
 *   >=150 panel observations (dates x per-date selection width, this project's own
 *   sample-size convention for this study type); reported honestly either way.
 *   "Positive across >=50% of assets" (done_when's single-asset clause) does not map
 *   cleanly onto a cross-sectional multi-asset selection strategy — reinterpreted here as
 *   "uses the full available universe, not silently narrowed," which the universe choice
 *   above satisfies.
 */
import { loadWatchlist, symbolToKrakenId } from "./../researchlib.mjs";
import { loadDailyCandles } from "./../researchlab.mjs";
import { STABLE_13, buildMomentumPanel, economicMomentumViews, blockBootstrapCI } from "./../momentum.mjs";

const L = 3;
const FUTURES_TAKER_COST = 0.0010; // round trip, from cost-model.mjs / PWR5

function dailySeries(watchlist) {
  return new Map(watchlist.map(({ symbol, id }) => [symbol, loadDailyCandles(id)]));
}
function splitRecentRows(rows, holdoutDates = 4) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const held = new Set(dates.slice(Math.max(0, dates.length - holdoutDates)));
  return { train: rows.filter((r) => !held.has(r.date)), recentHoldout: rows.filter((r) => held.has(r.date)) };
}

const watchlist = loadWatchlist().map((s) => (typeof s === "string" ? { symbol: s, id: symbolToKrakenId(s) } : s));
const series = dailySeries(watchlist);
const available = [...series.keys()];
const holdoutUniverse = available.filter((asset) => !STABLE_13.includes(asset));

console.log(`Controlled (train) universe: ${STABLE_13.length} symbols: ${STABLE_13.join(",")}`);
console.log(`Held-out universe: ${holdoutUniverse.length} symbols: ${holdoutUniverse.join(",")}`);

function reversalEconomics(universe) {
  const panel = buildMomentumPanel(series, { universe, lookback: L, horizon: L, step: L, minAssets: 8, tagRegime: true, transform: "raw" });
  const rows = universe === STABLE_13 ? splitRecentRows(panel.rows, 4).train : panel.rows; // train uses the SAME split as the original study; holdout universe uses every valid row (it's already out-of-sample by symbol)
  const reversed = rows.map((r) => ({ ...r, trailR: -r.trailR }));
  return economicMomentumViews(reversed, { minAssets: 8, roundTripCost: FUTURES_TAKER_COST });
}

const train = reversalEconomics(STABLE_13);
const holdout = reversalEconomics(holdoutUniverse);

console.log(`\n=== B5-REVERSAL L=3, futures-taker cost (${(FUTURES_TAKER_COST * 100).toFixed(2)}%) ===`);
console.log(`TRAIN  (STABLE_13, ${train.observations} obs): tercile net=${train.tercile.netSpread.toFixed(4)}  top3 net=${train.topN[3].netReturn.toFixed(4)}  top5 net=${train.topN[5].netReturn.toFixed(4)}`);
console.log(`HOLDOUT (16-symbol, ${holdout.observations} obs): tercile net=${holdout.tercile.netSpread.toFixed(4)}  top3 net=${holdout.topN[3].netReturn.toFixed(4)}  top5 net=${holdout.topN[5].netReturn.toFixed(4)}`);

for (const n of [3, 5]) {
  const t = train.topN[n].netReturn, h = holdout.topN[n].netReturn;
  const sameSign = Math.sign(t) === Math.sign(h);
  const positive = h > 0;
  const enoughObs = holdout.observations >= 150;
  const pass = positive && sameSign && enoughObs;
  const ci = blockBootstrapCI(holdout.topN[n].perDateNet, { iterations: 2000, blockSize: 4, seed: 20260813 });
  const ciExcludesZero = ci[0] !== null && ci[0] > 0;
  console.log(`\ntop-${n}: train=${t.toFixed(4)} holdout=${h.toFixed(4)} sameSign=${sameSign} holdoutPositive=${positive} obs=${holdout.observations}(>=150:${enoughObs}) => ${pass ? "PASSES pre-registered gate" : "FAILS pre-registered gate"}`);
  console.log(`   robustness (not part of the pre-registered gate, reported for honesty): holdout 95% block-bootstrap CI [blockSize=4, matching this project's own convention] = [${ci[0]?.toFixed(4)}, ${ci[1]?.toFixed(4)}] — excludes zero: ${ciExcludesZero}`);
}
