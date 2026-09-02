/**
 * HEADLINE-FIGURE-REPRODUCIBILITY-SPOTCHECK (additive, read-only, cache-only — no network egress).
 *
 * WHY THIS EXISTS. Every study script in this repo is cache-only and additive, but nothing has
 * ever asked, in one place: if you re-run the ones that produced this project's most-cited
 * headline numbers today, against today's cache, do they still print the number ROADMAP.md and
 * VERDICTS.md quote? This item asks exactly that, for a fixed, pre-registered sample, and reports
 * REPRODUCES / DRIFTS / CANNOT-RUN per figure. It does not correct anything it finds.
 *
 * SELECTION RULE (fixed here, before any script below is run):
 *   One headline figure per distinct study family/mechanism, restricted to scripts whose own
 *   ROADMAP.md engineering note labels them "cache-only" / "no network egress" (so a rerun today
 *   needs nothing this environment might lack), and whose number is directly quoted — by value —
 *   in VERDICTS.md or a dated ROADMAP.md/ROADMAP_ARCHIVE.md section. Capped at five, chosen in
 *   ROADMAP.md's chronological order of first appearance, to avoid picking the ones most likely
 *   to reproduce after the fact. C1/C3's entitlement-gate scripts are excluded: they require a
 *   live IB Gateway/FRED connection and are out of scope for a cache-only rerun (see the separate
 *   C1-C3-ENTITLEMENT-PROBE-RUN work-queue item for that).
 *
 * The five selected, in that chronological order:
 *   1. EQUITIES-BREAKOUT-SIGNIFICANCE (2026-08-21) — scripts/equities-breakout-significance.mjs
 *   2. EQUITIES-MADIP-OUT-OF-SAMPLE   (2026-08-22) — scripts/equities-madip-out-of-sample.mjs
 *   3. BOS-SHORT-EQUITIES-BASELINE    (2026-08-28) — scripts/bos-short-equities-baseline.mjs
 *   4. VOL-CONTRACTION-SAMPLE-EXTENSION (2026-08-28) — scripts/vol-contraction-sample-extension.mjs
 *   5. DATE-CLUSTERED-RESAMPLING-DJTA20 (2026-08-29) — scripts/date-clustered-resampling-djta20.mjs
 *
 * METHOD. Each cited script is run UNMODIFIED as its own `node` subprocess (never imported —
 * every one of them executes its `main()` at module scope, so importing would double-run it
 * and pollute this process's own state) against the current on-disk cache, and its single
 * `console.log(JSON.stringify(...))` line is parsed back into an object. The relevant field(s)
 * are compared to the value recorded in the write-up, at the precision the write-up itself
 * states (4 decimal places unless the write-up publishes more, e.g. EQUITIES-BREAKOUT-
 * SIGNIFICANCE's "bit-for-bit" 6-decimal replication claim). A script that throws, exits
 * non-zero, or prints something that does not parse as JSON is CANNOT-RUN, with the raw reason
 * — never patched around.
 *
 * No study script is modified to make it run. No recorded figure is corrected here even if it
 * drifts — a drift is reported with the affected write-up named, and a follow-up recommended;
 * deciding whether a drifted figure should be restated is this item's stated non-scope.
 */

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { preregister, linkRun, findPreregistration } from "../registry.mjs";
import { saveExperiment } from "../researchlab.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = (name) => path.join(__dirname, name);

const near = (a, b, tol) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < tol;

export const PREREGISTRATION_ID = "HEADLINE-FIGURE-REPRODUCIBILITY-SPOTCHECK";

export const PREREGISTRATION = Object.freeze({
  id: PREREGISTRATION_ID,
  kind: "reproducibility-spotcheck",
  hypothesis:
    "Re-running, today, the exact unmodified script each headline figure below cites, against " +
    "the current on-disk cache, reproduces the figure ROADMAP.md/VERDICTS.md quotes for it, to " +
    "the precision the write-up itself states.",
  gate:
    "Per figure: REPRODUCES if every compared field matches its recorded value within the " +
    "stated precision; DRIFTS if any field differs, with the signed delta reported; CANNOT-RUN " +
    "if the cited script throws, exits non-zero, or its stdout does not parse as JSON, with the " +
    "specific reason quoted. No script is modified to force a run. No recorded figure is " +
    "corrected in this item regardless of outcome.",
  universe: [
    "EQUITIES-BREAKOUT-SIGNIFICANCE",
    "EQUITIES-MADIP-OUT-OF-SAMPLE",
    "BOS-SHORT-EQUITIES-BASELINE",
    "VOL-CONTRACTION-SAMPLE-EXTENSION",
    "DATE-CLUSTERED-RESAMPLING-DJTA20",
  ],
  timeSplit: { note: "Not applicable: each figure's own train/holdout split is reused unmodified from its cited script; nothing is re-split here." },
  symbolSplit: { note: "Not applicable: each figure's own universe is reused unmodified from its cited script; nothing is re-selected here." },
  costAssumptions: { note: "Not applicable: each figure's own cost model is reused unmodified from its cited script; no cost figure is introduced or changed by this item." },
  seed: 20260902,
  notes:
    "Selection rule and the fixed five-figure list are stated in this file's own header, written " +
    "before any script below was run. Fixed before execution, not expanded or trimmed afterward.",
});

/** One entry per selected headline figure: which script to run, and what to compare. */
const FIGURES = [
  {
    id: "EQUITIES-BREAKOUT-SIGNIFICANCE",
    date: "2026-08-21",
    script: "equities-breakout-significance.mjs",
    source: "ROADMAP_ARCHIVE.md, 2026-08-21 dated section, 'Results' table",
    extract: (r) => ({
      breakout: { trades: r.families?.breakout?.trades, avgR: r.families?.breakout?.avgR, ci95: r.families?.breakout?.ci95, p: r.families?.breakout?.p },
      anticipate: { trades: r.families?.anticipate?.trades, avgR: r.families?.anticipate?.avgR, ci95: r.families?.anticipate?.ci95, p: r.families?.anticipate?.p },
    }),
    recorded: {
      breakout: { trades: 61, avgR: 0.186624, ci95: [-0.2700, 0.6192], p: 0.2036 },
      anticipate: { trades: 303, avgR: -0.043770, ci95: [-0.2442, 0.1360], p: 0.6701 },
    },
    compare: (computed, recorded) => {
      const deltas = [];
      for (const fam of ["breakout", "anticipate"]) {
        const c = computed[fam], rec = recorded[fam];
        if (c.trades !== rec.trades) deltas.push({ field: `${fam}.trades`, recorded: rec.trades, computed: c.trades, delta: c.trades - rec.trades });
        // breakout/anticipate avgR published to 6dp as a "bit-for-bit" reproduction claim.
        if (!near(c.avgR, rec.avgR, 5e-6)) deltas.push({ field: `${fam}.avgR`, recorded: rec.avgR, computed: c.avgR, delta: (c.avgR ?? NaN) - rec.avgR });
        if (!near(c.ci95?.[0], rec.ci95[0], 5e-4)) deltas.push({ field: `${fam}.ci95[0]`, recorded: rec.ci95[0], computed: c.ci95?.[0], delta: (c.ci95?.[0] ?? NaN) - rec.ci95[0] });
        if (!near(c.ci95?.[1], rec.ci95[1], 5e-4)) deltas.push({ field: `${fam}.ci95[1]`, recorded: rec.ci95[1], computed: c.ci95?.[1], delta: (c.ci95?.[1] ?? NaN) - rec.ci95[1] });
        if (!near(c.p, rec.p, 5e-4)) deltas.push({ field: `${fam}.p`, recorded: rec.p, computed: c.p, delta: (c.p ?? NaN) - rec.p });
      }
      return deltas;
    },
  },
  {
    id: "EQUITIES-MADIP-OUT-OF-SAMPLE",
    date: "2026-08-22",
    script: "equities-madip-out-of-sample.mjs",
    source: "ROADMAP_ARCHIVE.md, 2026-08-22 dated section, 'Results, side by side' table (DJTA-20 row)",
    extract: (r) => ({ trades: r.family?.trades, avgR: r.family?.avgR, ci95: r.family?.ci95, p: r.family?.p }),
    recorded: { trades: 300, avgR: 0.2994, ci95: [0.0509, 0.5350], p: 0.0116 },
    compare: (c, rec) => {
      const deltas = [];
      if (c.trades !== rec.trades) deltas.push({ field: "trades", recorded: rec.trades, computed: c.trades, delta: c.trades - rec.trades });
      if (!near(c.avgR, rec.avgR, 5e-4)) deltas.push({ field: "avgR", recorded: rec.avgR, computed: c.avgR, delta: (c.avgR ?? NaN) - rec.avgR });
      if (!near(c.ci95?.[0], rec.ci95[0], 5e-4)) deltas.push({ field: "ci95[0]", recorded: rec.ci95[0], computed: c.ci95?.[0], delta: (c.ci95?.[0] ?? NaN) - rec.ci95[0] });
      if (!near(c.ci95?.[1], rec.ci95[1], 5e-4)) deltas.push({ field: "ci95[1]", recorded: rec.ci95[1], computed: c.ci95?.[1], delta: (c.ci95?.[1] ?? NaN) - rec.ci95[1] });
      if (!near(c.p, rec.p, 5e-4)) deltas.push({ field: "p", recorded: rec.p, computed: c.p, delta: (c.p ?? NaN) - rec.p });
      return deltas;
    },
  },
  {
    id: "BOS-SHORT-EQUITIES-BASELINE",
    date: "2026-08-28",
    script: "bos-short-equities-baseline.mjs",
    source: "ROADMAP.md, 2026-08-28 dated section, 'Result (holdout only...)' table",
    extract: (r) => ({
      long: { trades: r.long?.gross?.trades, grossAvgR: r.long?.gross?.avgR, netAvgR: r.long?.net?.avgR },
      short: { trades: r.short?.gross?.trades, grossAvgR: r.short?.gross?.avgR, netAvgR: r.short?.net?.avgR },
      pooled: { trades: r.pooledDescriptiveOnly?.net?.trades, netAvgR: r.pooledDescriptiveOnly?.net?.avgR },
    }),
    recorded: {
      long: { trades: 148, grossAvgR: 0.2162, netAvgR: 0.1838 },
      short: { trades: 188, grossAvgR: -0.3729, netAvgR: -0.4086 },
      pooled: { trades: 336, netAvgR: -0.1477 },
    },
    compare: (c, rec) => {
      const deltas = [];
      for (const leg of ["long", "short", "pooled"]) {
        const cc = c[leg], rr = rec[leg];
        if (cc.trades !== rr.trades) deltas.push({ field: `${leg}.trades`, recorded: rr.trades, computed: cc.trades, delta: cc.trades - rr.trades });
        if ("grossAvgR" in rr && !near(cc.grossAvgR, rr.grossAvgR, 5e-4)) deltas.push({ field: `${leg}.grossAvgR`, recorded: rr.grossAvgR, computed: cc.grossAvgR, delta: (cc.grossAvgR ?? NaN) - rr.grossAvgR });
        if (!near(cc.netAvgR, rr.netAvgR, 5e-4)) deltas.push({ field: `${leg}.netAvgR`, recorded: rr.netAvgR, computed: cc.netAvgR, delta: (cc.netAvgR ?? NaN) - rr.netAvgR });
      }
      return deltas;
    },
  },
  {
    id: "VOL-CONTRACTION-SAMPLE-EXTENSION",
    date: "2026-08-28",
    script: "vol-contraction-sample-extension.mjs",
    source: "ROADMAP.md, 2026-08-28 dated section, 'AXIS C' paragraph",
    extract: (r) => ({ trades: r.axes?.axisLowerTf?.trades, avgR: r.axes?.axisLowerTf?.avgR, ci95: r.axes?.axisLowerTf?.ci95 }),
    recorded: { trades: 256, avgR: 0.2524, ci95: [0.0620, 0.4427] },
    compare: (c, rec) => {
      const deltas = [];
      if (c.trades !== rec.trades) deltas.push({ field: "trades", recorded: rec.trades, computed: c.trades, delta: c.trades - rec.trades });
      if (!near(c.avgR, rec.avgR, 5e-4)) deltas.push({ field: "avgR", recorded: rec.avgR, computed: c.avgR, delta: (c.avgR ?? NaN) - rec.avgR });
      if (!near(c.ci95?.[0], rec.ci95[0], 5e-4)) deltas.push({ field: "ci95[0]", recorded: rec.ci95[0], computed: c.ci95?.[0], delta: (c.ci95?.[0] ?? NaN) - rec.ci95[0] });
      if (!near(c.ci95?.[1], rec.ci95[1], 5e-4)) deltas.push({ field: "ci95[1]", recorded: rec.ci95[1], computed: c.ci95?.[1], delta: (c.ci95?.[1] ?? NaN) - rec.ci95[1] });
      return deltas;
    },
  },
  {
    id: "DATE-CLUSTERED-RESAMPLING-DJTA20",
    date: "2026-08-29",
    script: "date-clustered-resampling-djta20.mjs",
    source: "ROADMAP.md, 2026-08-29 dated section, 'Date-clustered 95% CI, side by side' table",
    // This item's own headline is the NEW date-clustered CI, not the replication of the older
    // position-blocked one (that replication is already the script's own internal self-check).
    extract: (r) => ({ trades: r.trades, avgR: r.avgR, dateClusteredCI: r.dateClusteredCI }),
    recorded: { trades: 300, avgR: 0.2994, dateClusteredCI: [-0.0851, 0.7129] },
    compare: (c, rec) => {
      const deltas = [];
      if (c.trades !== rec.trades) deltas.push({ field: "trades", recorded: rec.trades, computed: c.trades, delta: c.trades - rec.trades });
      if (!near(c.avgR, rec.avgR, 5e-4)) deltas.push({ field: "avgR", recorded: rec.avgR, computed: c.avgR, delta: (c.avgR ?? NaN) - rec.avgR });
      if (!near(c.dateClusteredCI?.[0], rec.dateClusteredCI[0], 5e-4)) deltas.push({ field: "dateClusteredCI[0]", recorded: rec.dateClusteredCI[0], computed: c.dateClusteredCI?.[0], delta: (c.dateClusteredCI?.[0] ?? NaN) - rec.dateClusteredCI[0] });
      if (!near(c.dateClusteredCI?.[1], rec.dateClusteredCI[1], 5e-4)) deltas.push({ field: "dateClusteredCI[1]", recorded: rec.dateClusteredCI[1], computed: c.dateClusteredCI?.[1], delta: (c.dateClusteredCI?.[1] ?? NaN) - rec.dateClusteredCI[1] });
      return deltas;
    },
  },
];

/** Run one cited script UNMODIFIED as its own subprocess; never imported (each runs its own
 *  main() at module scope). Returns { ok, parsed } or { ok:false, reason }. */
function runScript(scriptFile) {
  const full = scriptPath(scriptFile);
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [full], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return { ok: false, reason: `subprocess failed: ${err.message}` };
  }
  try {
    return { ok: true, parsed: JSON.parse(stdout) };
  } catch (err) {
    return { ok: false, reason: `stdout did not parse as JSON: ${err.message}` };
  }
}

function main() {
  if (!findPreregistration(PREREGISTRATION_ID)) preregister(PREREGISTRATION);

  const results = FIGURES.map((fig) => {
    const run = runScript(fig.script);
    if (!run.ok) {
      return { id: fig.id, date: fig.date, script: fig.script, source: fig.source, classification: "CANNOT-RUN", reason: run.reason };
    }
    const computed = fig.extract(run.parsed);
    const deltas = fig.compare(computed, fig.recorded);
    return {
      id: fig.id, date: fig.date, script: fig.script, source: fig.source,
      recorded: fig.recorded, computed,
      classification: deltas.length === 0 ? "REPRODUCES" : "DRIFTS",
      deltas,
    };
  });

  const summary = {
    reproduces: results.filter((r) => r.classification === "REPRODUCES").map((r) => r.id),
    drifts: results.filter((r) => r.classification === "DRIFTS").map((r) => r.id),
    cannotRun: results.filter((r) => r.classification === "CANNOT-RUN").map((r) => r.id),
  };

  const report = { selectionRule: PREREGISTRATION.notes, figures: results, summary };
  const file = saveExperiment("headline-figure-reproducibility-spotcheck", { figureIds: FIGURES.map((f) => f.id) }, report);
  linkRun(PREREGISTRATION_ID, {
    runFile: file,
    verdict: `${summary.reproduces.length} REPRODUCES / ${summary.drifts.length} DRIFTS / ${summary.cannotRun.length} CANNOT-RUN`,
    resultSummary: summary,
  });

  console.log(JSON.stringify({ ...report, saved: file }, null, 2));
}

main();
