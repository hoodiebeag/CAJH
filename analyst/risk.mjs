/**
 * analyst/risk.mjs — the deterministic veto layer between the analyst and any venue.
 *
 * ONE SENTENCE: the model proposes, this file disposes, and this file contains no model.
 *
 * WHY IT IS BUILT FIRST, BEFORE THE THING IT CONSTRAINS. Every other part of the agent is a
 * judgement call that can be revised -- which indicators, which prompt, which cadence. This part
 * is the only one whose failure is unbounded. A ranking rule that is wrong loses a decile's worth
 * of return; an unconstrained sizing decision loses the account. So the envelope exists and is
 * tested before there is anything inside it to constrain, and the agent is written against a gate
 * that already says no.
 *
 * WHY IT IS PURE AND SYNCHRONOUS. No I/O, no clock, no network, no model call. Every rule is a
 * function of (proposal, portfolio state, instrument facts) and nothing else. That is what makes
 * it testable, and testability is the entire argument for putting the limits here rather than in
 * a prompt: a prompt instruction is a request, and an unattended agent's request to itself is not
 * a boundary. This project already learned that the hard way -- the pre-commit hook exists because
 * an adversarial review found that telling a loop "never edit these functions" constrained nothing.
 *
 * THE RULES ARE NOT A LIST OF FEARS. Each one is here because a specific, named failure either
 * happened in this project or is the documented way autonomous traders die. The reasoning is
 * attached to each rule rather than gathered in a doc nobody reads at the moment it matters.
 *
 * WHAT THIS FILE DOES NOT DO. It does not decide whether trading is on. It does not talk to a
 * broker. It does not know what a venue is. It takes a proposed book and returns an allowed book
 * plus the reason for every rejection, and the caller is responsible for doing nothing else.
 */

/**
 * The envelope. Every number here is a judgement call and is labelled as one; what is NOT a
 * judgement call is that some number exists in each slot.
 */
export const DEFAULT_LIMITS = Object.freeze({
  // NO LEVERAGE. Gross exposure may not exceed net asset value. Leverage is the mechanism that
  // converts "wrong" into "wiped out", and an agent with no forward track record has not earned
  // the right to convert anything. 1.0 means fully invested is the ceiling, not the target.
  maxGrossExposure: 1.0,

  // PER-POSITION CAP, as a fraction of NAV at entry. 10% means a total loss in any single name
  // costs a tenth of the account. The geometry calibration this project paid for twice says a
  // 13-name book is roughly what this universe's decile looks like, so ~8-10% per name is the
  // scale the existing evidence is denominated in.
  maxPositionPct: 0.10,

  // PER-ASSET-CLASS CAP. Equities, crypto, forex and event contracts have uncorrelated failure
  // modes but very correlated-looking backtests. This stops one class -- most likely the one with
  // the least verified cost model -- from quietly becoming the whole book.
  maxClassPct: 0.35,

  // PER-SECTOR CAP, where a classification exists. Without it, "buy the best ten names" reliably
  // returns ten of the same trade. Names with no sector label are not exempted; they are pooled
  // into one bucket under this same cap, because unclassified is not the same as uncorrelated.
  maxSectorPct: 0.25,

  // DRAWDOWN HALT, measured from peak NAV. At this point the agent stops and a human restarts it.
  // Not a stop-loss -- a circuit breaker on the hypothesis that the agent works at all.
  maxDrawdownPct: 0.15,

  // DAILY LOSS BRAKE. Softer than the halt: no NEW risk for the rest of the session, existing
  // positions untouched. Catches the case where a single bad context window restructures the book.
  dailyLossBrakePct: 0.05,

  // NEW POSITIONS PER DECISION BATCH. A model that has talked itself into a regime call will act
  // on it across every name at once. This makes that expensive rather than instant.
  maxNewPositionsPerBatch: 5,

  // LIQUIDITY FLOOR: our position may not exceed this share of the instrument's median daily
  // dollar volume. Every backtest in this repository assumes a fill at the close, and that
  // assumption is credible only while we are small relative to the tape.
  maxShareOfMedianDollarVolume: 0.01,

  // QUOTE STALENESS. IBKR delayed quotes arrive ~2.76h stale on this account. A price that old is
  // not a price. Fifteen minutes is generous for a daily-cadence agent and still refuses delayed.
  maxQuoteAgeMs: 15 * 60 * 1000,
});

/**
 * Asset classes and their standing. A class is TRADEABLE only with a verified cost model AND
 * verified executability; otherwise it is PAPER, meaning proposals are recorded and scored but
 * never leave the journal.
 *
 * THIS IS THE FEE-SCHEDULE-REBASE LESSON ENCODED. On 2026-08-08 this project discovered its cost
 * assumptions were roughly HALF the real rate, and re-running under the corrected basis changed
 * results. Forex, IBKR crypto and ForecastEx event contracts each have a completely different cost
 * structure from US equities, and none of them has been measured here. A class trades when someone
 * has measured it, not when someone has assumed it.
 */
export const CLASS_STATUS = Object.freeze({
  usEquity:   Object.freeze({ status: "verified", costModel: "usEquityIbkr", note: "IBKR long side verified executable 128/128; cost model measured" }),
  crypto:     Object.freeze({ status: "paper",    costModel: "krakenTaker", note: "Kraken cost model exists but IBKR crypto spreads are NOT measured; two vendors disagreed 34% on identical names" }),
  forex:      Object.freeze({ status: "paper",    costModel: null,          note: "IDEALPRO spread structure unmeasured here" }),
  eventContract: Object.freeze({ status: "paper", costModel: null,          note: "ForecastEx mechanics, settlement and spread unmeasured; thin books" }),
  option:     Object.freeze({ status: "forbidden", costModel: null,         note: "structurally unsuitable for this account; VRP already tested and failed" }),
});

/** Rejection codes. Stable strings so the journal can be aggregated without parsing prose. */
export const REJECT = Object.freeze({
  HALTED: "halted",
  BRAKE: "daily_loss_brake",
  CLASS_FORBIDDEN: "class_forbidden",
  CLASS_UNVERIFIED: "class_unverified_paper_only",
  SHORT_NOT_PERMITTED: "short_not_permitted",
  POSITION_CAP: "position_cap",
  CLASS_CAP: "class_cap",
  SECTOR_CAP: "sector_cap",
  GROSS_CAP: "gross_exposure_cap",
  LIQUIDITY: "liquidity_floor",
  STALE_QUOTE: "stale_quote",
  BATCH_CAP: "new_position_batch_cap",
  AVERAGING_DOWN: "averaging_down",
  NO_PRICE: "no_usable_price",
  MALFORMED: "malformed_proposal",
});

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Shape-check a single proposal. A model returns JSON and JSON can say anything; a proposal that
 * does not typecheck is rejected here rather than being coerced into something plausible.
 */
export function validateProposal(p) {
  if (!p || typeof p !== "object") return "not an object";
  if (typeof p.symbol !== "string" || !p.symbol.trim()) return "symbol missing";
  if (!["buy", "sell", "short", "cover", "hold"].includes(p.action)) return `unknown action ${JSON.stringify(p.action)}`;
  if (p.action !== "hold") {
    if (!isFiniteNum(p.targetPct)) return "targetPct must be a finite number";
    if (p.targetPct < 0) return "targetPct must be >= 0 (direction comes from `action`)";
    if (p.targetPct > 1) return "targetPct is a fraction of NAV, not a percent";
  }
  if (p.confidence !== undefined && (!isFiniteNum(p.confidence) || p.confidence < 0 || p.confidence > 1)) {
    return "confidence must be within [0,1]";
  }
  if (typeof p.thesis !== "string" || p.thesis.trim().length < 10) {
    // A decision with no stated reason cannot be reviewed, cannot be scored against its own
    // reasoning later, and is the one kind of trade that teaches nothing whatever it does.
    return "thesis missing or too short to review";
  }
  return null;
}

/**
 * Apply the envelope to a batch of proposals.
 *
 * @param {object[]} proposals   what the analyst asked for
 * @param {object}   state       { nav, peakNav, dayStartNav, positions: {sym: {pct, avgPrice, class, sector}},
 *                                 shortingPermitted }
 * @param {object}   instruments { sym: { class, sector, price, quoteAgeMs, medianDollarVolume } }
 * @param {object}   limits      overrides for DEFAULT_LIMITS
 * @returns {{ allowed, rejected, exposure, halted, braked }}
 */
export function applyRiskGate(proposals, state, instruments, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const allowed = [], rejected = [];
  const reject = (p, code, detail) => rejected.push({ proposal: p, code, detail });

  const nav = state?.nav;
  if (!isFiniteNum(nav) || nav <= 0) {
    // Without a NAV every percentage limit is meaningless. Refuse the whole batch rather than
    // fall back to a default, because a wrong NAV silently rescales every cap at once.
    return {
      allowed: [], rejected: proposals.map((p) => ({ proposal: p, code: REJECT.MALFORMED, detail: "no usable NAV" })),
      exposure: 0, halted: false, braked: false,
    };
  }

  // ---- account-level circuit breakers, checked before anything individual ---------------------
  const peak = isFiniteNum(state.peakNav) ? Math.max(state.peakNav, nav) : nav;
  const drawdown = peak > 0 ? (peak - nav) / peak : 0;
  const halted = drawdown >= L.maxDrawdownPct;

  const dayStart = isFiniteNum(state.dayStartNav) ? state.dayStartNav : nav;
  const dayLoss = dayStart > 0 ? (dayStart - nav) / dayStart : 0;
  const braked = !halted && dayLoss >= L.dailyLossBrakePct;

  if (halted) {
    // A halt is not a filter. Nothing opens, nothing adds; only flattening is coherent, and that
    // is the caller's job, not a proposal's.
    for (const p of proposals) {
      reject(p, REJECT.HALTED, `drawdown ${(drawdown * 100).toFixed(2)}% >= ${(L.maxDrawdownPct * 100).toFixed(0)}%`);
    }
    return { allowed, rejected, exposure: grossOf(state.positions), halted, braked };
  }

  const positions = state.positions ?? {};
  let gross = grossOf(positions);
  const classPct = bucketTotals(positions, (x) => x.class);
  const sectorPct = bucketTotals(positions, (x) => x.sector ?? "__unclassified__");
  let newPositions = 0;

  // Deterministic order: highest conviction first, so that when a cap binds it is the analyst's
  // own ranking that decides what gets in, not object key order.
  const ordered = [...proposals].sort((a, b) => (b?.confidence ?? 0) - (a?.confidence ?? 0));

  for (const p of ordered) {
    const bad = validateProposal(p);
    if (bad) { reject(p, REJECT.MALFORMED, bad); continue; }
    if (p.action === "hold") { allowed.push(p); continue; }

    const sym = p.symbol.toUpperCase();
    const inst = instruments?.[sym];
    if (!inst) { reject(p, REJECT.MALFORMED, `no instrument record for ${sym}`); continue; }

    const cls = CLASS_STATUS[inst.class];
    if (!cls) { reject(p, REJECT.MALFORMED, `unknown asset class ${JSON.stringify(inst.class)}`); continue; }
    if (cls.status === "forbidden") { reject(p, REJECT.CLASS_FORBIDDEN, cls.note); continue; }
    if (cls.status !== "verified") { reject(p, REJECT.CLASS_UNVERIFIED, cls.note); continue; }

    // Closing is always permitted below this line -- risk limits exist to stop risk being ADDED.
    const held = positions[sym];
    const closing = (p.action === "sell" && held && held.pct > 0) || (p.action === "cover" && held && held.pct < 0);
    if (closing && p.targetPct === 0) { allowed.push(p); continue; }

    if ((p.action === "short" || (p.action === "sell" && !held)) && !state.shortingPermitted) {
      // Shortability is UNKNOWN on 128/128 IBKR symbols on this account. An unborrowable short is
      // not a position, it is a rejected order and possibly a buy-in.
      reject(p, REJECT.SHORT_NOT_PERMITTED, "borrow not verified on this account");
      continue;
    }

    if (!isFiniteNum(inst.price) || inst.price <= 0) { reject(p, REJECT.NO_PRICE, "no positive price"); continue; }
    if (isFiniteNum(inst.quoteAgeMs) && inst.quoteAgeMs > L.maxQuoteAgeMs) {
      reject(p, REJECT.STALE_QUOTE, `quote ${(inst.quoteAgeMs / 60000).toFixed(1)}min old`);
      continue;
    }

    if (p.targetPct > L.maxPositionPct) {
      reject(p, REJECT.POSITION_CAP, `${(p.targetPct * 100).toFixed(1)}% > ${(L.maxPositionPct * 100).toFixed(0)}%`);
      continue;
    }

    // NO AVERAGING DOWN. Adding to a loser is how a wrong thesis becomes a large wrong thesis, and
    // it is the specific move a confident narrative generator is most likely to justify. Rebuilding
    // the same position after closing it is allowed; increasing one that is currently under water
    // is not.
    if (held && isFiniteNum(held.avgPrice) && held.pct > 0 && p.action === "buy" && p.targetPct > held.pct) {
      if (inst.price < held.avgPrice) {
        reject(p, REJECT.AVERAGING_DOWN, `price ${inst.price} below avg ${held.avgPrice}`);
        continue;
      }
    }

    const heldPct = held?.pct ?? 0;
    const delta = p.targetPct - Math.abs(heldPct);
    const isNew = !held || heldPct === 0;

    if (isNew && delta > 0 && newPositions >= L.maxNewPositionsPerBatch) {
      reject(p, REJECT.BATCH_CAP, `already opened ${newPositions} this batch`);
      continue;
    }

    if (isFiniteNum(inst.medianDollarVolume) && inst.medianDollarVolume > 0) {
      const notional = p.targetPct * nav;
      const share = notional / inst.medianDollarVolume;
      if (share > L.maxShareOfMedianDollarVolume) {
        reject(p, REJECT.LIQUIDITY, `${(share * 100).toFixed(2)}% of median dollar volume`);
        continue;
      }
    }

    const sector = inst.sector ?? "__unclassified__";
    const newClass = (classPct.get(inst.class) ?? 0) - Math.abs(heldPct) + p.targetPct;
    if (newClass > L.maxClassPct + 1e-9) {
      reject(p, REJECT.CLASS_CAP, `${inst.class} would be ${(newClass * 100).toFixed(1)}%`);
      continue;
    }
    const newSector = (sectorPct.get(sector) ?? 0) - Math.abs(heldPct) + p.targetPct;
    if (newSector > L.maxSectorPct + 1e-9) {
      reject(p, REJECT.SECTOR_CAP, `${sector} would be ${(newSector * 100).toFixed(1)}%`);
      continue;
    }
    const newGross = gross - Math.abs(heldPct) + p.targetPct;
    if (newGross > L.maxGrossExposure + 1e-9) {
      reject(p, REJECT.GROSS_CAP, `gross would be ${(newGross * 100).toFixed(1)}%`);
      continue;
    }

    // The daily brake stops NEW risk only. An increase to an existing winner is new risk too.
    if (braked && delta > 0) {
      reject(p, REJECT.BRAKE, `day down ${(dayLoss * 100).toFixed(2)}%, no new risk`);
      continue;
    }

    gross = newGross;
    classPct.set(inst.class, newClass);
    sectorPct.set(sector, newSector);
    if (isNew && delta > 0) newPositions++;
    allowed.push(p);
  }

  return { allowed, rejected, exposure: gross, halted, braked };
}

function grossOf(positions) {
  let g = 0;
  for (const v of Object.values(positions ?? {})) g += Math.abs(v?.pct ?? 0);
  return g;
}

function bucketTotals(positions, keyOf) {
  const m = new Map();
  for (const v of Object.values(positions ?? {})) {
    const k = keyOf(v);
    m.set(k, (m.get(k) ?? 0) + Math.abs(v?.pct ?? 0));
  }
  return m;
}
