/**
 * sweep.mjs -- run a cross-product of configurations, log every one, print the top rows.
 *
 * The campaign's unit of work is a sweep over one or two axes with everything else held fixed.
 * Doing that by hand invites two mistakes that have already cost this project time: forgetting to
 * log the losers (which makes the leaderboard's denominator a lie) and forgetting to record which
 * axis was being moved (which makes the log unreadable a week later). Both are handled here.
 *
 * Every row carries `axis` and `phase`, and EVERY configuration is logged -- the empty ones, the
 * wiped-out ones, the boring ones. Nothing is filtered before it reaches campaign-log.jsonl.
 *
 * Usage from a session script:
 *   import { gridSweep } from "./sweep.mjs";
 *   gridSweep({
 *     base:  { trendGate: false, alignMode: "none", maxStopPct: 0.20, lockBreakeven: true },
 *     axes:  { entryMode: FAMILIES, minStopPct: [0.05, 0.10, 0.15], tpR: [2, 4, 6] },
 *     axis:  "tpR x minStopPct",
 *     phase: "sweep2",
 *   });
 */

import { score, logRuns } from "./campaign.mjs";

/** Cartesian product of { key: [values] } -> [{ key: value }]. Key order is insertion order. */
export function expand(axes) {
  let rows = [{}];
  for (const [key, values] of Object.entries(axes)) {
    if (!Array.isArray(values) || !values.length) throw new Error(`sweep: axis "${key}" must be a non-empty array`);
    rows = rows.flatMap((row) => values.map((v) => ({ ...row, [key]: v })));
  }
  return rows;
}

/**
 * Score every point in the grid. Returns the rows, sorted by finalBalance, and appends all of
 * them to the log first -- the log write happens before the sort so a crash mid-print still
 * leaves a complete record.
 */
export function gridSweep({ base = {}, axes, axis, phase, opts = {}, top = 12, quiet = false }) {
  if (!axis) throw new Error("sweep: `axis` is required -- an unlabelled sweep is unreadable later");
  if (!phase) throw new Error("sweep: `phase` is required");
  const points = expand(axes);
  const rows = [];
  const t0 = Date.now();
  for (const point of points) {
    const config = { ...base, ...point };
    const row = { ...score(config, opts), axis, phase };
    rows.push(row);
    if (!quiet && rows.length % 25 === 0) {
      process.stderr.write(`  ${rows.length}/${points.length} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    }
  }
  logRuns(rows);

  const ranked = [...rows].sort((a, b) => b.finalBalance - a.finalBalance);
  if (!quiet) {
    console.log(`\n${phase}: ${rows.length} configs over ${axis}, ${Math.round((Date.now() - t0) / 1000)}s`);
    console.log(fmt(ranked.slice(0, top), Object.keys(axes)));
  }
  return ranked;
}

/** A fixed-width table of the axis values plus the numbers that decide the campaign. */
export function fmt(rows, axisKeys) {
  const head = [...axisKeys, "trades", "final$", "return%", "maxDD%"];
  const body = rows.map((r) => [
    ...axisKeys.map((k) => String(r.config[k])),
    String(r.trades ?? 0),
    r.effectivelyRuined ? `${r.finalBalance} RUINED` : String(r.finalBalance),
    String(r.totalReturnPct ?? ""),
    String(r.maxDrawdownPct ?? ""),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(w[i])).join("  ");
  return [line(head), ...body.map(line)].join("\n");
}
