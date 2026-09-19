/**
 * sector-map.mjs — load and validate a ticker -> sector classification, with provenance attached.
 *
 * WHY THIS IS A MODULE AND NOT A CONSTANT IN A RUNNER. A sector label is the first piece of
 * genuinely non-price information this project has admitted into an equities study, and it is
 * unverifiable from the bundle: nothing in a price series says whether a name is a utility. That
 * makes it exactly the input class that produced this project's worst failure -- the 34% figure
 * two crypto vendors disagreed by on identical names and dates, which was only caught because the
 * data was cross-checked across SOURCES rather than implementations (rule 4). A wrong label here
 * would not throw. It would quietly put a bank in the energy bucket, neutralise the wrong
 * exposure, and produce a confident number.
 *
 * SO THE MAP CARRIES ITS OWN PROVENANCE AND THE LOADER REFUSES A MAP THAT DOES NOT. `source` must
 * say where the labels came from and `asOf` when they were taken. This is not ceremony: a GICS
 * classification is a point-in-time fact that reissues -- names are reclassified, and the 2018
 * creation of the Communication Services sector moved Google, Meta and Disney out of the sectors
 * they had been in for a decade. A map taken today and applied to a window starting in 2022 is
 * mildly anachronistic, and the study that uses it has to say so rather than discover it.
 *
 * NO FALLBACK, DELIBERATELY. There is no "unknown" bucket and no guessing from the ticker. A name
 * the map does not cover is dropped from the study and counted, because a residual that is
 * sector-neutral for 90% of the book and not for the rest is neither thing, and silently bucketing
 * the remainder into "other" would create a fake sector whose only shared property is that the
 * vendor did not classify it.
 */

import fs from "node:fs";

/**
 * THE SCHEME IS DECLARED, NOT ASSUMED, AND THE REASON IS CONCRETE.
 *
 * The two routes to a map here produce DIFFERENT TAXONOMIES. A vendor S&P 500 list gives the GICS
 * 11. IBKR's `reqContractDetails` gives its own `industry` field -- "Technology", "Consumer,
 * Cyclical", "Financial" -- which is not GICS, has a different cardinality, and splits the economy
 * along different lines.
 *
 * The tempting move is a hand-written crosswalk from one to the other. That move is refused. A
 * crosswalk is a set of judgement calls written by whoever needed the study to run, it is
 * unverifiable against either vendor, and it would manufacture precisely the unchecked labels this
 * module exists to keep out. It would also be unnecessary: the study does not need GICS
 * specifically. It needs A CONSISTENT PARTITION of the universe into economically similar groups,
 * used the same way at every rebalance.
 *
 * So `scheme` is a required field. "GICS" is validated against the canonical eleven, because for
 * that scheme a misspelling is detectable and worth catching. Any other scheme is accepted with its
 * own vocabulary and only checked for internal consistency -- non-empty labels, and enough members
 * per group to mean anything. What is NOT allowed is mixing two schemes in one map, which would
 * neutralise different names against differently-drawn groups.
 */
export const SCHEMES = Object.freeze(["GICS", "IBKR-industry", "IBKR-category", "custom"]);

/** Sectors we will accept as a spelling of the GICS 11. Anything else is a typo or another scheme. */
export const GICS_SECTORS = Object.freeze([
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
]);

const CANON = new Map(GICS_SECTORS.map((s) => [s.toLowerCase().replace(/[^a-z]/g, ""), s]));

/**
 * Canonicalise a sector spelling, or null if it is not one of the GICS 11.
 *
 * Accepts case and punctuation variation ("health care", "Health-Care", "HEALTHCARE") because
 * those are transcription noise, and rejects everything else because a name that is not one of the
 * eleven is a different classification scheme wearing the same field name.
 */
export function canonicalSector(raw) {
  if (typeof raw !== "string") return null;
  return CANON.get(raw.toLowerCase().replace(/[^a-z]/g, "")) ?? null;
}

/**
 * Parse a sector map from a JSON object.
 *
 * Shape: { scheme, source, asOf, sectors: { SYM: "Sector", ... } }
 * Throws on a missing or malformed envelope -- a study must not run on a map whose origin is
 * unrecorded, and an exception here is cheaper than a verdict built on mystery labels.
 */
export function parseSectorMap(obj) {
  if (!obj || typeof obj !== "object") throw new Error("sector map: not an object");
  const { scheme, source, asOf, sectors } = obj;
  if (!SCHEMES.includes(scheme)) {
    throw new Error(`sector map: \`scheme\` must be one of ${SCHEMES.join(", ")} (got ${JSON.stringify(scheme)})`);
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("sector map: `source` is required and must say where the labels came from");
  }
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("sector map: `asOf` is required as YYYY-MM-DD (labels are point-in-time)");
  }
  if (!sectors || typeof sectors !== "object") throw new Error("sector map: `sectors` is required");

  const map = new Map();
  const bad = [];
  for (const [sym, raw] of Object.entries(sectors)) {
    if (scheme === "GICS") {
      const s = canonicalSector(raw);
      if (s === null) bad.push([sym, raw]);
      else map.set(sym.toUpperCase(), s);
    } else {
      // Another scheme's vocabulary is its own. Only check that a label is actually a label.
      if (typeof raw !== "string" || !raw.trim()) bad.push([sym, raw]);
      else map.set(sym.toUpperCase(), raw.trim());
    }
  }
  if (bad.length) {
    const shown = bad.slice(0, 5).map(([s, v]) => `${s}=${JSON.stringify(v)}`).join(", ");
    const why = scheme === "GICS"
      ? "are not one of the GICS 11"
      : "are empty or not strings";
    throw new Error(
      `sector map: ${bad.length} label(s) ${why} (${shown}` +
      `${bad.length > 5 ? ", ..." : ""}). Fix or drop them; they are not guessed.`,
    );
  }
  return { scheme, source, asOf, map };
}

/** Read a sector map from disk. Returns null if the file does not exist, throws if it is malformed. */
export function loadSectorMap(file) {
  if (!fs.existsSync(file)) return null;
  return parseSectorMap(JSON.parse(fs.readFileSync(file, "utf8")));
}

/**
 * Restrict a symbol list to those the map covers, and report what was dropped and how the survivors
 * distribute across sectors.
 *
 * `minPerSector` exists because a "sector" of one name is not a sector: its residual against its own
 * sector mean is identically zero, which would silently hand that name a z-score of nothing and let
 * it rank anywhere. Such sectors are dropped whole, and counted.
 */
export function applySectorMap(symbols, sectorMap, { minPerSector = 3 } = {}) {
  const covered = [], uncovered = [];
  for (const s of symbols) (sectorMap.has(s.toUpperCase()) ? covered : uncovered).push(s);

  const bySector = new Map();
  for (const s of covered) {
    const sec = sectorMap.get(s.toUpperCase());
    if (!bySector.has(sec)) bySector.set(sec, []);
    bySector.get(sec).push(s);
  }

  const thin = [];
  for (const [sec, members] of [...bySector.entries()]) {
    if (members.length < minPerSector) { thin.push([sec, members.length]); bySector.delete(sec); }
  }
  const kept = [...bySector.values()].flat();
  return { kept, uncovered, thin, bySector };
}
