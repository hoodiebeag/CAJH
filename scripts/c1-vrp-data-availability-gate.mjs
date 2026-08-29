/**
 * C1-VRP-DATA-AVAILABILITY-GATE (read-only diagnostic, not part of the app, no strategy code).
 *
 * Phase-directive STEP 4's data-availability gate for mechanism C1 (defined-risk short-premium /
 * variance-risk-premium on a liquid index or sector ETF via IBKR options). Per the directive:
 * "Data-availability gate first ... If the gate fails, say so plainly and stop; do not
 * substitute a proxy without disclosing it."
 *
 * SCOPE, deliberately narrower than EXOGENOUS-DATA-ACCESS-AUDIT's live-probe pattern: this run
 * has no egress and IB Gateway is parked pending the human being at their machine, so nothing
 * here makes a network call or touches IB Gateway. Every finding below comes from (a) reading
 * brokers/ibkr.mjs as it exists on disk, and (b) reading the installed @stoqey/ib package's own
 * TypeScript declarations (not general TWS API docs, not memory) to enumerate what the API
 * surface actually offers. This resolves Part A of the gate (code capability) and states Part B
 * (live account subscriptions) as a question list for the human, not a guess.
 *
 * OPTIONS-SKEW-PRIMARY-SIGNAL (2026-08-22) already found brokers/ibkr.mjs has zero options code
 * path; that was a CRYPTO options study (Deribit) that died on construct, not equity/index
 * options via IBKR. This item re-verifies the same file for a different venue/data path rather
 * than trusting that verdict to transfer, and goes further into what building it would require.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveExperiment } from "../researchlab.mjs";

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

// --- PART A: does brokers/ibkr.mjs carry any options code path today? ---
function auditCurrentIbkrFile() {
  const src = readIfExists(IBKR_SRC_PATH);
  if (src === null) {
    return { fileFound: false, note: "brokers/ibkr.mjs not found at expected path — cannot audit" };
  }
  const optionSignals = ["secType", "SecType", "new Option(", "reqSecDefOptParams", "reqContractDetails", "tickOptionComputation", "OPTION_IMPLIED_VOLATILITY", "impliedVolatility"];
  const found = optionSignals.filter((sig) => src.includes(sig));

  // What IS present: the contract-construction, historical-data, and market-data-snapshot
  // functions that exist today, quoted so this doesn't just assert absence without showing work.
  const presentLines = [];
  for (const [i, line] of src.split("\n").entries()) {
    if (/^const stockContract|reqHistoricalData\(|reqMktData\(|import \{/.test(line.trim())) {
      presentLines.push({ line: i + 1, text: line.trim() });
    }
  }

  return {
    fileFound: true,
    linesInFile: src.split("\n").length,
    optionsRelatedIdentifiersFound: found, // expected: []
    confirmsOptionsSkewPrimarySignalFinding: found.length === 0,
    whatIsActuallyPresent: presentLines,
    verdict: found.length === 0
      ? "CONFIRMED: no options-related identifier (secType/Option/reqSecDefOptParams/reqContractDetails/tickOptionComputation/OPTION_IMPLIED_VOLATILITY) appears anywhere in brokers/ibkr.mjs. Only a Stock contract (new Stock(symbol, \"SMART\", \"USD\")) is constructed anywhere in the file. This matches OPTIONS-SKEW-PRIMARY-SIGNAL's finding, re-confirmed here against the equity/IBKR path specifically rather than assumed to transfer from the Deribit/crypto finding."
      : `UNEXPECTED: found options-related identifiers already present: ${found.join(", ")} — investigate before trusting either prior verdict.`,
  };
}

// --- PART A (continued): what does the installed @stoqey/ib package actually offer for options? ---
function auditPackageCapability() {
  const apiDts = readIfExists(path.join(STOQEY_DIST, "api", "api.d.ts"));
  const optionDts = readIfExists(path.join(STOQEY_DIST, "api", "contract", "option.d.ts"));
  if (apiDts === null || optionDts === null) {
    return { packageFound: false, note: "@stoqey/ib type declarations not found under node_modules — cannot enumerate capability. Re-run after `npm.cmd install`." };
  }

  const hasOptionClass = optionDts.includes("export declare class Option implements Contract");
  const hasReqContractDetails = apiDts.includes("reqContractDetails(reqId: number, contract: Contract)");
  const hasReqSecDefOptParams = apiDts.includes("reqSecDefOptParams(reqId: number, underlyingSymbol: string");
  const hasSecDefOptParamEvent = apiDts.includes("securityDefinitionOptionParameter");
  const hasTickOptionComputation = apiDts.includes("tickOptionComputation");
  const historicalWhatToShowSupportsIV = apiDts.includes("OPTION_IMPLIED_VOLATILITY");

  return {
    packageFound: true,
    capability: {
      optionContractClass: { present: hasOptionClass, source: "api/contract/option.d.ts", signature: "new Option(symbol, expiry, strike, right: OptionType, exchange?, currency?)" },
      contractDetailsLookup: { present: hasReqContractDetails, source: "api/api.d.ts", note: "resolves conId and validates a contract before requesting data on it — same pattern the equities path implicitly relies on IBKR to resolve via SMART routing" },
      optionChainRequest: { present: hasReqSecDefOptParams && hasSecDefOptParamEvent, source: "api/api.d.ts", note: "reqSecDefOptParams(reqId, underlyingSymbol, futFopExchange, underlyingSecType, underlyingConId) -> securityDefinitionOptionParameter event delivers expirations[] and strikes[] for the underlying — this is how a defined-risk strategy would enumerate available strikes/expiries before constructing an Option contract" },
      liveImpliedVolAndGreeksSnapshot: { present: hasTickOptionComputation, source: "api/api.d.ts", note: "tickOptionComputation event delivers impliedVolatility/delta/gamma/vega/theta/optPrice per tick — this is the live-quote analogue of getCurrentPriceSnapshot()'s tickPrice(TickType.LAST) handling already in brokers/ibkr.mjs, but a different event and payload shape" },
      historicalImpliedVol: { present: historicalWhatToShowSupportsIV, source: "api/api.d.ts reqHistoricalData whatToShow enum", note: "reqHistoricalData(..., whatToShow=OPTION_IMPLIED_VOLATILITY) returns the underlying's own IBKR-modeled historical IV series (not per-contract option price history) — same reqHistoricalData call already used by fetchOHLC(), only whatToShow and the contract differ" },
    },
  };
}

// --- PART A (continued): map required surface to existing equities-side analogues + build estimate ---
function buildEstimate() {
  return {
    requiredForDefinedRiskShortPremiumStudy: [
      {
        capability: "Contract definition for secType OPT",
        analogueInIbkrMjsToday: "stockContract() at brokers/ibkr.mjs:104 — `new Stock(symbol, \"SMART\", \"USD\")` — same pattern, different class (Option vs Stock) and four more required fields (expiry, strike, right, and multiplier is defaulted by the Option class itself per option.d.ts)",
        newCodeNeeded: "small — one new contract-builder function analogous to stockContract()",
      },
      {
        capability: "Option-chain parameter request (enumerate available strikes/expiries for an underlying)",
        analogueInIbkrMjsToday: "none — nothing in brokers/ibkr.mjs today requests a chain or resolves a conId; every existing call passes a freshly-constructed Stock contract straight to reqHistoricalData/reqMktData/placeOrder",
        newCodeNeeded: "moderate — a new async function following fetchOHLC()'s request/promise/event-listener/cleanup pattern (lines 114-176), but against reqSecDefOptParams + securityDefinitionOptionParameter/securityDefinitionOptionParameterEnd instead of reqHistoricalData + historicalData",
      },
      {
        capability: "Historical bar or implied-vol retrieval per contract",
        analogueInIbkrMjsToday: "fetchOHLC() (brokers/ibkr.mjs:114-176) — the exact same reqHistoricalData call, decoder quirk (the 'finished' sentinel bar documented in the file's own header comment), and event-handling pattern apply unchanged; only the contract argument (Option vs Stock) and whatToShow (OPTION_IMPLIED_VOLATILITY vs TRADES, or per-contract TRADES for the option's own price) differ",
        newCodeNeeded: "small — reuse of an existing pattern, not new mechanism",
      },
      {
        capability: "Delta-based strike selection",
        analogueInIbkrMjsToday: "none directly, but tickOptionComputation (live) or a historical-IV-plus-Black-Scholes calc would supply delta; this is the one piece of the four with no direct precedent anywhere in this codebase",
        newCodeNeeded: "moderate — either subscribe to tickOptionComputation per candidate strike (live, needs a running Gateway) or compute delta offline from an IV series (needs a pricing-model implementation this codebase does not currently have)",
      },
    ],
    overallEstimate: "In EXOGENOUS-DATA-ACCESS-AUDIT's terms: the CODE-SIDE gate does not fail — @stoqey/ib (already the installed, already-used dependency) exposes every API call a defined-risk short-premium study needs (Option contract class, contract-details/chain lookup, historical and live IV, greeks), and three of the four required capabilities extend an existing brokers/ibkr.mjs pattern directly rather than introducing a new one. This is a multi-day build (chain-request function, per-contract historical-fetch function, and either a live-greeks subscription path or an offline pricing calc), not a multi-week one — comparable in scope to what fetchOHLC()/getCurrentPriceSnapshot() already represent, times roughly 2-3 for the added chain-lookup and strike-selection pieces. It is NOT a same-day change like C0's rank-average was. This estimate is code-only; it says nothing about whether the ACCOUNT-SIDE data (Part B below) is actually held.",
  };
}

// --- PART B: cannot be answered from here — stated as an explicit question list ---
function accountSideQuestionsForHuman() {
  return {
    answerableFromThisSession: false,
    reason: "No egress and IB Gateway is parked pending the human being at their machine — this session cannot connect to check what the account's live market-data subscriptions actually include.",
    minimalQuestionList: [
      "In IBKR Client Portal / TWS, under Settings > User Settings > Market Data Subscriptions: is 'US Securities Snapshot and Futures Value Bundle' (or equivalent OPRA-inclusive bundle) subscribed, and does it cover US index/ETF OPTIONS specifically (not just equities/futures)?",
      "Is there a separate line item for 'OPRA (Options Price Reporting Authority)' consolidated quotes, and is it active or a paid add-on not yet purchased?",
      "Under the same Market Data Subscriptions page, does historical data access include options — i.e. can reqHistoricalData with an Option contract and whatToShow=TRADES or OPTION_IMPLIED_VOLATILITY actually return bars, or does the subscription only cover live snapshots?",
      "How far back does IBKR's own historical-data retention go for the specific underlying being considered (commonly SPY/QQQ/IWM-class liquid ETFs) — IBKR's general historical-data limits are shorter for less-active option strikes than for the underlying itself; the exact retention needs checking against the account's actual entitlements, not assumed.",
      "Is there any incremental monthly cost currently NOT being paid that would turn on by requesting OPRA/options market data (as opposed to being bundled free with the existing equities subscription)?",
    ],
  };
}

function fallbackStatement() {
  return "Per the phase directive's stated fallback: if this gate fails (Part B comes back negative — no options market-data subscription, or a paid add-on the human doesn't want to buy), the next mechanism is C2, which needs one new external time series rather than options data. C2 is NOT queued by this item; that is the next restock's decision once Part B is actually answered.";
}

function main() {
  const partA_currentFile = auditCurrentIbkrFile();
  const partA_packageCapability = auditPackageCapability();
  const partA_buildEstimate = buildEstimate();
  const partB_questions = accountSideQuestionsForHuman();
  const partC_fallback = fallbackStatement();

  const result = {
    generatedAt: new Date().toISOString(),
    partA_currentFile,
    partA_packageCapability,
    partA_buildEstimate,
    partB_accountSideQuestionsForHuman: partB_questions,
    partC_fallback,
    gateVerdict: "NOT RESOLVED — code-side capability confirmed sufficient (Part A), account-side entitlement unanswerable from this session (Part B). Not a pass, not a fail: an explicit open question for the human, per the directive's instruction not to guess.",
  };

  console.log(JSON.stringify(result, null, 2));

  const file = saveExperiment("c1-vrp-data-availability-gate", { note: "static analysis only, no network, no strategy code" }, result);
  console.error(`\nSaved to ${file}`);
}

main();
