/**
 * analyst/context.mjs — assemble exactly what the analyst sees, and nothing it must not.
 *
 * TWO PROPERTIES DEFINE THIS FILE. Everything else is detail.
 *
 * 1. POINT-IN-TIME BY CONSTRUCTION. Every view is built from an `asOf` index and reads `[0..asOf]`
 *    inclusive. Nothing in this module can see a bar after the decision, because no function here
 *    is given a way to ask for one -- the slice happens once, at the entry point, and the rest of
 *    the file receives already-truncated series. This is deliberately structural rather than
 *    checked: a lookahead guard that relies on remembering to call it is the bug, not the fix.
 *    `contextIsPointInTime()` exists so the property is also TESTED, since "by construction" is a
 *    claim and this project has learned to distrust claims of that shape.
 *
 *    This matters more here than in any mechanical study. The agent's decision is unauditable from
 *    the outside -- you cannot read a prompt output and tell whether it used tomorrow's bar. The
 *    only defence is that tomorrow's bar was never in the room.
 *
 * 2. IT IS A BUDGET, NOT A DUMP. One batched call sees the whole cross-section, so context length
 *    is the binding cost and the binding quality constraint at once. A hundred names times twenty
 *    indicators is both expensive and worse: a model given everything attends to nothing, and the
 *    interesting signal drowns. So the cross-section is RANKED and TRUNCATED to a candidate slate,
 *    with the ranking rule recorded in the context itself so the analyst knows what it is NOT
 *    seeing. Held positions are ALWAYS included regardless of rank -- an analyst that cannot see
 *    its own book cannot manage it, and silently dropping a position from view is how a stale
 *    holding becomes permanent.
 *
 * WHAT IS DELIBERATELY ABSENT. No prices in dollars for ranking purposes, no symbol-identifying
 * prose beyond the ticker, and no future-dated anything. There is an `anonymise` mode that strips
 * tickers to "Asset A/B/C" -- see docs/ANALYST-DESIGN.md. Its purpose is narrow: the model has
 * market history memorised, so on historical dates a named ticker lets it recall the outcome
 * rather than reason about the evidence. Anonymised runs test whether the REASONING is coherent.
 * They are not evidence of edge and the mode says so in the context it emits.
 */

import { SIGNALS } from "../factors.mjs";

/** The indicators the analyst gets per name. A subset of factors.mjs, chosen for spread not count. */
export const DEFAULT_INDICATORS = Object.freeze([
  "momentum",     // 12-1, the most documented cross-sectional anomaly there is
  "reversal1m",   // the one-month counterweight to it
  "reversal1w",   // short-horizon; independently confirmed negative here, so the analyst should see it
  "nearHigh",     // distance from the 52-week high
  "trendQuality", // how monotone the path was, not just where it ended
  "highVol",      // realised vol, left unsigned so the analyst reads it rather than a preference
  "volumeTrend",  // the best of fourteen dollar-neutral spreads at +24.09% gross, and still a loser
  "acceleration", // recent vs older momentum
]);

/**
 * Build the decision context.
 *
 * @param {object} opts
 *   series        { SYM: bars[] }        full history; truncated here, once
 *   asOf          number                 index into `dates`; the decision boundary
 *   dates         number[]               sorted bar times shared across the panel
 *   positions     { SYM: {pct, avgPrice, sector, class} }
 *   nav, peakNav, dayStartNav
 *   slate         number                 how many non-held candidates to show
 *
 * THE SLATE IS WHERE THE DECISION ACTUALLY GETS MADE, so its size is a policy choice rather than a
 * performance knob. Whatever the universe holds, the analyst only ever sees the slate: a wider
 * universe behind a narrow slate means the RANKER chooses and the analyst ratifies, which is the
 * mechanical rule this project pivoted away from. Set to 300 by the owner on 2026-09-21 against a
 * ~1,000-name universe, at a measured ~365 bytes per candidate (~27K tokens). Held positions are
 * always shown on top of that, so the real count can exceed `slate`.
 *   rankBy        string                 which indicator orders the slate
 *   indicators    string[]
 *   anonymise     boolean
 *   news          { SYM: [{at, headline, source}] }
 *   sectors       Map|object             symbol -> sector, when a map exists
 */
export function buildContext({
  series, asOf, dates, positions = {}, nav = null, peakNav = null, dayStartNav = null,
  slate = 300, rankBy = "momentum", indicators = DEFAULT_INDICATORS,
  anonymise = false, news = {}, sectors = null,
} = {}) {
  if (!Number.isInteger(asOf) || asOf < 0) throw new Error("context: asOf must be a non-negative integer index");
  if (!Array.isArray(dates) || !dates.length) throw new Error("context: dates required");
  if (asOf >= dates.length) throw new Error(`context: asOf ${asOf} is beyond the panel (${dates.length} dates)`);

  const asOfTime = dates[asOf];

  // THE ONE TRUNCATION. Everything downstream receives series that physically end at the decision.
  const visible = {};
  for (const [sym, bars] of Object.entries(series ?? {})) {
    const cut = [];
    for (const b of bars) {
      if (b.time > asOfTime) break;   // bars are time-ordered; the first future bar ends the copy
      cut.push(b);
    }
    if (cut.length) visible[sym] = cut;
  }

  const sectorOf = (sym) =>
    (sectors instanceof Map ? sectors.get(sym.toUpperCase())
      : sectors?.[sym.toUpperCase()]) ?? null;

  // ---- align every symbol onto one grid ---------------------------------------------------------
  // WHY A GRID RATHER THAN PER-SYMBOL ARRAYS. Two reasons, and the second is the one that bites.
  // First, factors.mjs signals are indexed by bar position, so two symbols with different history
  // lengths would have the same index mean different dates -- and a cross-section compared at
  // mismatched dates is not a cross-section. Second, `volumeTrend`, `illiquidity` and `smallSize`
  // read `ctx.volume[ctx.symbol]` and expect it aligned to the same index, so the volume series has
  // to be built the same way. This mirrors what `testSignal` does, deliberately, so that an
  // indicator value the analyst sees means the same thing as the same indicator in a closed study.
  //
  // Forward-fill on a missing bar, never interpolate: a held-flat price is what a stale quote
  // actually looks like, whereas an interpolated one invents a trade that did not happen.
  const gridDates = dates.slice(0, asOf + 1);
  const closeGrid = {}, volGrid = {};
  for (const [sym, bars] of Object.entries(visible)) {
    const byTime = new Map(bars.map((b) => [Number(b.time), b]));
    const c = [], v = [];
    let lastC = null, lastV = 0;
    for (const t of gridDates) {
      const b = byTime.get(t);
      if (b) { lastC = Number(b.close); lastV = Number(b.volume) || 0; }
      c.push(lastC ?? 0);
      v.push(lastV);
    }
    closeGrid[sym] = c;
    volGrid[sym] = v;
  }

  // The equal-weight basket, needed by `beta` and `idioVol` if the caller asks for them. Built from
  // the aligned grid so it shares the same index space as everything else.
  const basket = gridDates.map((_, i) => {
    if (i === 0) return 0;
    const rs = [];
    for (const c of Object.values(closeGrid)) {
      if (c[i] > 0 && c[i - 1] > 0) rs.push(c[i] / c[i - 1] - 1);
    }
    return rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : 0;
  });

  // ---- per-name views --------------------------------------------------------------------------
  const iLast = gridDates.length - 1;
  const rows = [];
  for (const [sym, bars] of Object.entries(visible)) {
    const closes = closeGrid[sym];
    const i = iLast;
    if (i < 1 || !(closes[i] > 0)) continue;

    const ind = {};
    for (const name of indicators) {
      const fn = SIGNALS[name];
      if (!fn) throw new Error(`context: unknown indicator "${name}"`);
      const v = fn(closes, i, { basket, volume: volGrid, symbol: sym });
      ind[name] = v === null || !Number.isFinite(v) ? null : round(v, 4);
    }

    rows.push({
      symbol: sym,
      indicators: ind,
      // Recent path, coarse on purpose: the analyst gets shape, not a table to re-derive.
      ret5d: pctReturn(closes, i, 5),
      ret21d: pctReturn(closes, i, 21),
      ret63d: pctReturn(closes, i, 63),
      medianDollarVolume: medianDollarVolume(bars, 63),
      sector: sectorOf(sym),
      held: !!positions[sym],
      position: positions[sym] ? { pct: positions[sym].pct, avgPrice: positions[sym].avgPrice ?? null } : null,
      unrealisedPct: unrealised(positions[sym], closes[i]),
      news: (news?.[sym] ?? [])
        // A headline dated after the decision is not news, it is the answer.
        .filter((n) => !n.at || Date.parse(n.at) / 1000 <= asOfTime)
        .slice(0, 3)
        .map((n) => ({ at: n.at ?? null, headline: n.headline, source: n.source ?? null })),
    });
  }

  // ---- slate: held names always, then the top of the ranking ------------------------------------
  const held = rows.filter((r) => r.held);
  const rest = rows.filter((r) => !r.held);
  const rankable = rest.filter((r) => r.indicators[rankBy] !== null && r.indicators[rankBy] !== undefined);
  rankable.sort((a, b) => b.indicators[rankBy] - a.indicators[rankBy]);
  // Both ends of the ranking, not just the top: an analyst shown only winners can only buy winners,
  // and the cross-section's information is in its spread.
  const half = Math.max(1, Math.floor(slate / 2));
  const top = rankable.slice(0, half);
  const bottom = rankable.slice(-half).filter((r) => !top.includes(r));
  const shown = [...held, ...top, ...bottom];

  const out = {
    asOf: new Date(asOfTime * 1000).toISOString().slice(0, 10),
    // The decision bar as an epoch, so a later settlement can find it without parsing a formatted
    // string back into a date. Stripped by anonymiseContext along with every other date.
    asOfTime,
    mode: anonymise ? "anonymised" : "named",
    portfolio: {
      nav, peakNav, dayStartNav,
      grossExposure: round(Object.values(positions).reduce((s, v) => s + Math.abs(v?.pct ?? 0), 0), 4),
      positionCount: Object.keys(positions).length,
    },
    universe: {
      total: rows.length,
      shown: shown.length,
      rankedBy: rankBy,
      // Recorded so the analyst knows the shape of what it is NOT seeing.
      omitted: rows.length - shown.length,
      // The note tells the analyst the shape of what it is NOT seeing, so it has to be true when
      // it is seeing everything. With a slate wider than the universe the slices simply return the
      // whole cross-section, and telling the model it was handed "the top and bottom 150" of 127
      // names invites it to reason about a selection that was never applied.
      note: shown.length >= rows.length
        ? `the entire cross-section is shown; nothing was ranked away`
        : `held positions always shown; remaining slate is the top and bottom ${half} by ${rankBy}`,
    },
    market: marketSummary(rows),
    candidates: shown,
  };

  if (anonymise) return anonymiseContext(out);
  return out;
}

/**
 * Strip identity so the model must reason from evidence rather than recall.
 *
 * The date goes too. A named ticker on a known date lets a model retrieve what happened; so does an
 * unnamed one if the date is distinctive enough to pin the regime.
 */
export function aliasName(i) {
  let s = "", n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return `Asset ${s}`;
}

/**
 * The alias -> real symbol mapping for a NAMED context, recomputed rather than smuggled.
 *
 * The risk gate is deterministic code, not the model, so it may legitimately know which instrument
 * an anonymised label refers to -- it has to, or it cannot price anything. The mapping is purely
 * positional, so it is recomputed from the named context instead of being hidden on the anonymised
 * one. A hidden field would be one `JSON.stringify` away from leaking every identity this mode
 * exists to remove.
 */
export function aliasToSymbol(namedCtx) {
  const out = new Map();
  // KEYED UPPERCASE. `decide` normalises every proposed symbol to upper case, so a map keyed on
  // "Asset A" misses the "ASSET A" that actually comes back -- which reads exactly like the model
  // inventing a label, and silently dropped every proposal the first time this ran.
  (namedCtx?.candidates ?? []).forEach((c, i) => out.set(aliasName(i).toUpperCase(), c.symbol));
  return out;
}

export function anonymiseContext(ctx) {
  const alias = new Map();
  const nameFor = aliasName;
  const candidates = ctx.candidates.map((c, i) => {
    alias.set(c.symbol, nameFor(i));
    return {
      ...c,
      symbol: alias.get(c.symbol),
      // News is identity. There is no anonymising a headline, so the mode drops it entirely and
      // says so rather than emitting something that looks like news coverage and is not.
      news: [],
      sector: c.sector ? `Sector ${hashSector(c.sector)}` : null,
    };
  });
  return {
    ...ctx,
    asOf: null,
    asOfTime: null,          // an epoch is a date; leaving it would undo the anonymisation above
    candidates,
    anonymisationNote:
      "Tickers, dates, sectors and news removed. This mode tests reasoning quality only and is " +
      "NOT evidence of edge: with identities present the model can recall outcomes rather than " +
      "reason about evidence. See docs/ANALYST-DESIGN.md.",
  };
}

function hashSector(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String.fromCharCode(65 + (h % 26));
}

/** Breadth and dispersion: what the cross-section as a whole is doing. */
function marketSummary(rows) {
  const r21 = rows.map((r) => r.ret21d).filter((v) => typeof v === "number");
  if (!r21.length) return { breadth: null, medianRet21d: null, dispersion: null };
  const sorted = [...r21].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = r21.reduce((s, v) => s + v, 0) / r21.length;
  const sd = Math.sqrt(r21.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, r21.length - 1));
  return {
    breadth: round(r21.filter((v) => v > 0).length / r21.length, 3),
    medianRet21d: round(median, 4),
    dispersion: round(sd, 4),
  };
}

function pctReturn(closes, i, lookback) {
  if (i < lookback) return null;
  const a = closes[i - lookback], b = closes[i];
  return a > 0 && b > 0 ? round(b / a - 1, 4) : null;
}

function medianDollarVolume(bars, win) {
  const v = bars.slice(-win)
    .map((b) => Number(b.close) * Number(b.volume))
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null;
}

function unrealised(position, price) {
  if (!position || !(position.avgPrice > 0) || !(price > 0)) return null;
  return round(price / position.avgPrice - 1, 4);
}

function round(v, dp) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/**
 * Verify that a context contains nothing dated after its own decision boundary.
 *
 * "Point-in-time by construction" is a claim, and this project's standing lesson is that a claim
 * of that shape gets tested or it gets believed until it is expensively wrong. Returns a list of
 * violations; empty means clean.
 */
export function contextIsPointInTime(ctx, asOfTime) {
  const bad = [];
  if (ctx.asOf) {
    const ctxTime = Date.parse(ctx.asOf + "T00:00:00Z") / 1000;
    if (ctxTime > asOfTime) bad.push(`context asOf ${ctx.asOf} is after the boundary`);
  }
  for (const c of ctx.candidates ?? []) {
    for (const n of c.news ?? []) {
      if (n.at && Date.parse(n.at) / 1000 > asOfTime) {
        bad.push(`${c.symbol}: news dated ${n.at} is after the boundary`);
      }
    }
  }
  return bad;
}
