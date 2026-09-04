/**
 * costs.mjs -- named cost models, so a second asset class cannot silently inherit the first one's.
 *
 * Cost is not a detail in this project, it is the finding. Cost in R is
 *
 *     (feeRate + slipPct) * (entry + exit) / risk    ~=    2 * (feeRate + slipPct) / stopPct
 *
 * so at Kraken taker rates a 1% stop pays 1.70R before the trade does anything and a 15% stop pays
 * 0.11R. That single identity explains the whole crypto campaign: ma_dip at no stop floor takes
 * 2,796 trades and ends at $0, and the same family at a 15% floor takes 65 trades and ends at
 * $1,138. Families that traded often were destroyed by cost, not by direction.
 *
 * US equities cost roughly THIRTY TIMES LESS per trade. Running an equities bundle under Kraken
 * rates would therefore not be a small conservatism -- it would suppress exactly the strategies
 * that the crypto data could not afford, and the answer would be wrong in the interesting
 * direction. Running crypto under equity rates would be worse still: it would manufacture an edge.
 *
 * So the model is named, its numbers are sourced in the comments, and `costFor` refuses to guess.
 */

/**
 * feeRate and slipPct are PER LEG, as fractions of notional -- the backtest charges both on entry
 * and on exit. Round-trip cost is therefore about 2*(feeRate + slipPct) of notional.
 */
export const COST_MODELS = Object.freeze({
  // What every crypto number in this repository was computed under. Kraken Tier 1 taker is 0.26%
  // at the time of writing; 0.8% is the conservative figure this project has used throughout and
  // it is kept unchanged so old results stay comparable. Do not "correct" it without re-running
  // everything that depends on it.
  krakenTaker: Object.freeze({
    feeRate: 0.008, slipPct: 0.0005,
    note: "Kraken taker, the conservative rate every crypto result in this repo was computed under",
  }),

  // US equities at a zero-commission retail broker. The commission line really is ~0, so the cost
  // is spread and impact: a liquid large cap quotes a penny or two wide on a $100 stock, which is
  // 5-10 bps half-spread, and 5 bps per leg is the conservative end of that for retail size.
  usEquityRetail: Object.freeze({
    feeRate: 0.0000, slipPct: 0.0005,
    note: "US equities, zero-commission retail: no fee, 5bp per-leg slippage for spread and impact",
  }),

  // IBKR tiered, $0.0035/share with a $0.35 minimum. On a $100 stock that is 3.5bp per leg at one
  // share and far less at size; 0.005% is the round figure. Slippage unchanged.
  usEquityIbkr: Object.freeze({
    feeRate: 0.00005, slipPct: 0.0005,
    note: "US equities, IBKR tiered: ~0.5bp commission, 5bp per-leg slippage",
  }),

  // For isolating what cost is doing, never for reporting a result. `zeroCost` exists because this
  // project has twice needed to answer "is there a gross edge at all, before any fee?" -- and the
  // answer for crypto was +0.0091R, which is the reason the campaign went where it did.
  zeroCost: Object.freeze({ feeRate: 0, slipPct: 0, note: "diagnostic only: no fee, no slippage" }),
});

/** Round-trip cost in R for a given stop distance. The identity the campaign turns on. */
export function costInR(model, stopPct) {
  if (!(stopPct > 0)) throw new Error("costs: stopPct must be positive");
  return 2 * (model.feeRate + model.slipPct) / stopPct;
}

const CRYPTO_SUFFIX = /(USD|USDT|EUR|GBP|BTC|ETH)$/;

/**
 * The cost model for a universe. Crypto is recognised and defaulted; ANYTHING ELSE must be named.
 *
 * The asymmetry is deliberate. Every crypto result here was computed under krakenTaker, so
 * defaulting to it keeps them reproducible. Nothing else has a default, because the failure mode
 * of guessing is not a slightly wrong number -- it is an equities backtest charged 30x its real
 * cost, or a crypto backtest charged a thirtieth of its own, and both look like findings.
 */
export function costFor(universe, override = process.env.CANDLE_COST_MODEL || null) {
  const symbols = Array.isArray(universe) ? universe : Object.keys(universe ?? {});
  if (override) {
    const model = COST_MODELS[override];
    if (!model) throw new Error(`costs: unknown cost model "${override}" (known: ${Object.keys(COST_MODELS).join(", ")})`);
    return { name: override, ...model };
  }
  if (symbols.length && symbols.every((s) => CRYPTO_SUFFIX.test(s))) {
    return { name: "krakenTaker", ...COST_MODELS.krakenTaker };
  }
  const foreign = symbols.filter((s) => !CRYPTO_SUFFIX.test(s)).slice(0, 5);
  throw new Error(
    `costs: this universe is not recognisably crypto (${foreign.join(", ")}${symbols.length > 5 ? ", ..." : ""}) `
    + `and has no cost model. Name one explicitly or set CANDLE_COST_MODEL. Known: ${Object.keys(COST_MODELS).join(", ")}. `
    + `Reusing Kraken taker rates on equities would charge about thirty times the real cost.`);
}
