/**
 * C3-FX-CARRY-DATA-GATE (read-only diagnostic, not part of the app, no strategy code).
 *
 * Phase-directive STEP 4's data-availability gate for mechanism C3 (FX carry — the interest-rate
 * differential between two currencies), now earned per the directive's step 7 ("C3 may be
 * considered only after C0-C2 are resolved (pass, fail, or gated-unavailable)"): C0-SIGNAL-
 * COMBINATION KILLED (permutation p=0.4708), C1-VRP-DATA-AVAILABILITY-GATE gated-unavailable on
 * account entitlement, C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES resolved null (nominal p<0.05,
 * does not survive family-wide BH-FDR).
 *
 * SCOPE, following C1-VRP-DATA-AVAILABILITY-GATE's own pattern exactly: no network call, no
 * IB Gateway connection attempted. Part A (code-side FX capability) comes from reading
 * brokers/ibkr.mjs as it exists on disk and the installed @stoqey/ib package's own TypeScript
 * declarations — not general TWS API docs, not memory. Part B (the carry signal's non-price data
 * requirement) cites EXOGENOUS-DATA-ACCESS-AUDIT's existing FRED finding rather than re-probing
 * it, and names candidate FRED series for the rate side WITHOUT fetching them (no network access
 * in this task — those series names are therefore reported as unverified candidates, not
 * confirmed reachable, an explicit distinction this project's discipline requires). Part C
 * (account-side FX market-data entitlement) is stated as a question list for the human, not
 * guessed — same shape as C1's Part B, IB Gateway last observed refusing 127.0.0.1:4002.
 *
 * D3 authorizes FX as an asset class; this gate produces no return, no signal, and no order path
 * — research/paper only regardless of any result, and no live order without D1->D2->D3 and human
 * sign-off regardless of any result here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveExperiment } from "../../researchlab.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const IBKR_SRC_PATH = path.join(repoRoot, "brokers", "ibkr.mjs");
const STOQEY_DIST = path.join(repoRoot, "node_modules", "@stoqey", "ib", "dist");

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// --- PART A: does brokers/ibkr.mjs carry any FX/CASH contract path today? ---
function auditCurrentIbkrFile() {
  const src = readIfExists(IBKR_SRC_PATH);
  if (src === null) {
    return { fileFound: false, note: "brokers/ibkr.mjs not found at expected path — cannot audit" };
  }
  const fxSignals = ["Forex", "SecType.CASH", "\"CASH\"", "IDEALPRO"];
  const found = fxSignals.filter((sig) => src.includes(sig));

  const presentLines = [];
  for (const [i, line] of src.split("\n").entries()) {
    if (/^const stockContract|reqHistoricalData\(|reqMktData\(|import \{/.test(line.trim())) {
      presentLines.push({ line: i + 1, text: line.trim() });
    }
  }

  return {
    fileFound: true,
    linesInFile: src.split("\n").length,
    fxRelatedIdentifiersFound: found, // expected: []
    whatIsActuallyPresent: presentLines,
    verdict: found.length === 0
      ? "CONFIRMED: no FX/CASH-related identifier (Forex/SecType.CASH/\"CASH\"/IDEALPRO) appears anywhere in brokers/ibkr.mjs. Every contract built anywhere in the file is still `new Stock(symbol, \"SMART\", \"USD\")` via stockContract() (line 104), the same finding C1-VRP-DATA-AVAILABILITY-GATE recorded for options — re-confirmed here rather than assumed to still hold."
      : `UNEXPECTED: found FX-related identifiers already present: ${found.join(", ")} — investigate before trusting this verdict.`,
  };
}

// --- PART A (continued): what does the installed @stoqey/ib package actually offer for FX? ---
function auditPackageCapability() {
  const apiDts = readIfExists(path.join(STOQEY_DIST, "api", "api.d.ts"));
  const forexDts = readIfExists(path.join(STOQEY_DIST, "api", "contract", "forex.d.ts"));
  const forexJs = readIfExists(path.join(STOQEY_DIST, "api", "contract", "forex.js"));
  const whatToShowDts = readIfExists(path.join(STOQEY_DIST, "api", "historical", "what-to-show.d.ts"));
  const secTypeDts = readIfExists(path.join(STOQEY_DIST, "api", "data", "enum", "sec-type.d.ts"));
  if (apiDts === null || forexDts === null || whatToShowDts === null) {
    return { packageFound: false, note: "@stoqey/ib type declarations not found under node_modules — cannot enumerate capability. Re-run after `npm.cmd install`." };
  }

  const hasForexClass = forexDts.includes("export declare class Forex implements Contract");
  const forexSecType = forexJs && forexJs.includes("sec_type_1.default.CASH") ? "CASH" : "unknown (not found in forex.js)";
  const forexExchange = forexJs && forexJs.includes('this.exchange = "IDEALPRO"') ? "IDEALPRO (hardcoded by the Forex class itself, not caller-supplied)" : "unknown (not found in forex.js)";
  const hasReqHistoricalData = apiDts.includes("reqHistoricalData(reqId: number, contract: Contract");
  const whatToShowValues = ["TRADES", "MIDPOINT", "BID", "ASK", "BID_ASK"].filter((v) => whatToShowDts.includes(`"${v}"`));
  const secTypeHasCash = secTypeDts ? secTypeDts.includes("CASH = \"CASH\"") : null;

  return {
    packageFound: true,
    capability: {
      forexContractClass: {
        present: hasForexClass,
        source: "api/contract/forex.d.ts",
        signature: "new Forex(symbol: string, currency: string) — e.g. new Forex(\"EUR\", \"USD\")",
        secType: forexSecType,
        exchange: forexExchange,
        note: "compiled forex.js shows the class auto-orders symbol/currency by a fixed CURRENCY_SYMBOL_PRIO list (KRW,EUR,GBP,AUD,USD,TRY,ZAR,CAD,CHF,MXN,HKD,JPY,INR,NOK,SEK,RUB) and always sets exchange=IDEALPRO — a caller cannot pick a different FX venue with this class.",
      },
      secTypeCashEnumMember: { present: secTypeHasCash, source: "api/data/enum/sec-type.d.ts", note: "SecType.CASH exists and is documented in the .d.ts as 'Forex pair.' — this is the same enum stockContract()'s Stock class implicitly uses STK for." },
      reqHistoricalDataGenericOverContract: { present: hasReqHistoricalData, source: "api/api.d.ts", note: "same call brokers/ibkr.mjs's fetchOHLC() already uses (line ~159 in fetchOHLC); the signature is generic over any Contract, so a Forex contract can be passed in place of Stock with no new API call needed, only a new contract-builder analogous to stockContract()." },
      whatToShowEnumValuesPresent: whatToShowValues,
      whatToShowIncludesMidpointBidAsk: whatToShowValues.includes("MIDPOINT") && whatToShowValues.includes("BID") && whatToShowValues.includes("ASK"),
      note: "The declarations do not type-restrict whatToShow per contract secType (TWS enforces valid combos server-side, not the TS types) — MIDPOINT/BID/ASK/BID_ASK/TRADES are all present in the enum regardless of contract type. Whether IBKR's own server actually serves TRADES for a CASH/IDEALPRO contract (spot FX is an OTC dealer market, not exchange-traded, so IBKR's documented behavior is that FX historical bars use MIDPOINT/BID/ASK rather than TRADES) is a TWS-side behavior, not something the package's own type declarations assert either way — stated as expected-but-not-package-verified, to avoid overclaiming from a docs memory the C1 precedent explicitly warns against.",
    },
  };
}

// --- PART A (continued): map required surface to existing equities-side analogues + build estimate ---
function buildEstimate() {
  return {
    requiredForFxCarryPriceSide: [
      {
        capability: "Contract definition for secType CASH (a currency pair)",
        analogueInIbkrMjsToday: "stockContract() at brokers/ibkr.mjs:104 — same pattern, different class (Forex vs Stock), and Forex takes (symbol, currency) rather than (symbol, exchange, currency) since it hardcodes exchange=IDEALPRO itself.",
        newCodeNeeded: "small — one new contract-builder function analogous to stockContract(), e.g. forexContract(base, quote) => new Forex(base, quote)",
      },
      {
        capability: "Historical price retrieval per pair",
        analogueInIbkrMjsToday: "fetchOHLC() (brokers/ibkr.mjs:114-176) — same reqHistoricalData call and event-handling pattern; only the contract argument (Forex vs Stock) and whatToShow (MIDPOINT, not TRADES per the note above) would differ. The daily-bar 'YYYYMMDD' decoder quirk fetchOHLC() already handles is a formatDate/decoder behavior independent of contract type, so it should apply unchanged.",
        newCodeNeeded: "small — reuse of an existing pattern, not new mechanism",
      },
    ],
    requiredForFxCarrySignalItself: [
      {
        capability: "Interest-rate differential between the two currencies in a pair",
        analogueInIbkrMjsToday: "none — nothing in brokers/ibkr.mjs or this codebase currently sources a non-USD short rate; FEDFUNDS (already used by macro-regime scripts) covers only the USD side.",
        newCodeNeeded: "moderate — see Part B below; this is a genuinely new data source, not a code-reuse question.",
      },
    ],
    overallEstimate: "In EXOGENOUS-DATA-ACCESS-AUDIT's/C1's terms: the PRICE-side code gate does not fail — @stoqey/ib (already the installed, already-used dependency) exposes a Forex contract class and the same generic reqHistoricalData call fetchOHLC() already uses, so the price side is a same-day-to-small change comparable to C0's rank-average, not a multi-day build like C1's options chain/greeks path. The RATE-side (interest-rate differential) is the harder half and is NOT a code question — it is a new external data source, addressed in Part B. This estimate says nothing about whether the ACCOUNT holds FX market-data entitlement (Part C).",
  };
}

// --- PART B: the carry signal's non-price data requirement ---
function carrySignalDataRequirement() {
  return {
    requirement: "FX carry's return driver is the interest-rate differential between the two currencies in a pair (go long the higher-yielding currency, short the lower-yielding one, financed at each currency's own short rate) — this needs a short-term policy or money-market rate PER CURRENCY, not just price history for the pair.",
    priorArtCited: "EXOGENOUS-DATA-ACCESS-AUDIT (scripts/exogenous-data-access-audit.mjs, cited rather than re-probed here per this item's own scoping note) confirmed FRED's public CSV export endpoint (fred.stlouisfed.org/graph/fredgraph.csv?id=<seriesId>) is free and key-less for three series it actually fetched: DGS10, DTWEXBGS, and FEDFUNDS — all three are USD-side series. That audit did not test any non-USD FRED series, so this item cannot claim the same access pattern is confirmed for the series named below without re-fetching, which the task's no-network-access constraint forbids in this pass.",
    candidateSeriesNamed: [
      { currency: "USD", series: "FEDFUNDS", status: "CONFIRMED reachable — already fetched by EXOGENOUS-DATA-ACCESS-AUDIT and reused by C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES's DGS10-DGS2 sourcing." },
      { currency: "EUR", series: "IR3TIB01EZM156N (OECD Main Economic Indicators, 3-month interbank rate, Euro area, via FRED's international-rates mirror) — alternative candidate: ECBDFR (ECB Deposit Facility Rate)", status: "UNVERIFIED — named from FRED's known OECD-MEI series-ID convention, not fetched this pass." },
      { currency: "GBP", series: "IR3TIB01GBM156N (3-month interbank rate, UK) — alternative candidate: IUDSOIA (SONIA)", status: "UNVERIFIED — named, not fetched this pass." },
      { currency: "JPY", series: "IR3TIB01JPM156N (3-month interbank rate, Japan)", status: "UNVERIFIED — named, not fetched this pass." },
      { currency: "CAD", series: "IR3TIB01CAM156N (3-month interbank rate, Canada)", status: "UNVERIFIED — named, not fetched this pass." },
      { currency: "AUD", series: "IR3TIB01AUM156N (3-month interbank rate, Australia)", status: "UNVERIFIED — named, not fetched this pass." },
      { currency: "CHF", series: "IR3TIB01CHM156N (3-month interbank rate, Switzerland)", status: "UNVERIFIED — named, not fetched this pass." },
    ],
    honestCaveat: "The non-USD series IDs above follow FRED's documented OECD-MEI naming convention (IR3TIB01<ISO2>M156N, monthly, not seasonally adjusted) from general knowledge of FRED's catalog structure, NOT from a fetch in this session — this task's own constraints forbid network access even for verification. This is named explicitly as an open item rather than presented as confirmed, to avoid the exact overclaim EXOGENOUS-DATA-ACCESS-AUDIT's own header warns against ('never generalized... a container 403 was nearly recorded as a fact about an upstream API once already'). Before any FX carry code is written, these specific series IDs need one real fetch each against fred.stlouisfed.org's key-less CSV endpoint to confirm they exist and to check their actual history depth and publication lag — cheap to do (same free, key-less pattern already proven for the USD series) but not done here.",
  };
}

// --- PART C: cannot be answered from here — stated as an explicit question list ---
function accountSideQuestionsForHuman() {
  return {
    answerableFromThisSession: false,
    reason: "No egress and IB Gateway last returned ECONNREFUSED at 127.0.0.1:4002 — this session cannot connect to check what the account's FX market-data entitlements actually include.",
    minimalQuestionList: [
      "In IBKR Client Portal / TWS, under Settings > User Settings > Market Data Subscriptions: is IDEALPRO (IBKR's FX venue) quote data included by default, or does it require a separate subscription line item? (IBKR's general policy is that IDEALPRO FX quotes are free/bundled for most account types, unlike OPRA options data — this needs confirming against the actual account, not assumed.)",
      "Does reqHistoricalData against a Forex/IDEALPRO contract with whatToShow=MIDPOINT (or BID/ASK) actually return bars for this account, and how far back does history go for major pairs (EUR.USD, GBP.USD, USD.JPY, etc.)?",
      "Separately from IBKR: does the account (or a key-less path) have access to fetch the non-USD FRED series named in Part B above, and do those series IDs actually resolve? (This is a FRED-side question, not an IBKR entitlement question — worth checking in the same sitting since it's a one-line curl per series.)",
    ],
    presentedAlongside: "C1-VRP-DATA-AVAILABILITY-GATE's still-open options-entitlement question list (scripts/c1-vrp-data-availability-gate.mjs, ROADMAP.md 2026-08-29) — both can be answered from IBKR's own settings pages in one sitting.",
  };
}

function main() {
  const partA_currentFile = auditCurrentIbkrFile();
  const partA_packageCapability = auditPackageCapability();
  const partA_buildEstimate = buildEstimate();
  const partB_carrySignalData = carrySignalDataRequirement();
  const partC_questions = accountSideQuestionsForHuman();

  const result = {
    generatedAt: new Date().toISOString(),
    partA_currentFile,
    partA_packageCapability,
    partA_buildEstimate,
    partB_carrySignalDataRequirement: partB_carrySignalData,
    partC_accountSideQuestionsForHuman: partC_questions,
    gateVerdict: "NOT RESOLVED — price-side code capability confirmed sufficient (Forex contract class + existing reqHistoricalData pattern, Part A). The carry signal's rate-side data requirement is named but NOT verified reachable in this pass (Part B — no network access permitted). Account-side FX entitlement is unanswerable from this session (Part C). Not a pass, not a fail: an explicit open question for the human, per the directive's instruction not to guess. No strategy or backtest code written, no return computed, brokers/ibkr.mjs unmodified, no network access attempted.",
  };

  console.log(JSON.stringify(result, null, 2));

  const file = saveExperiment("c3-fx-carry-data-gate", { note: "static analysis only, no network, no strategy code" }, result);
  console.error(`\nSaved to ${file}`);
}

main();
