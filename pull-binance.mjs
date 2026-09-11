// Run this ON A MACHINE WITH WORKING NETWORK ACCESS. This container has none -- every exchange
// endpoint returns http=000 from here, which is why the two datasets below have never been tested.
//
// Needs Node 18 or newer. No install, no dependencies, no API key -- both endpoints are public.
//   node pull-binance.mjs
//   tar czf crypto-pull.tar.gz funding candles-long
// then upload crypto-pull.tar.gz.
//
// It writes two directories:
//   funding/<SYMBOL>.csv       symbol,fundingTime,fundingRate,markPrice   (8-hourly, from listing)
//   candles-long/<SYMBOL>.csv  time,open,high,low,close,volume            (daily, from 2017)
//
// WHY EACH ONE MATTERS
//
// funding/ is carry -- the only untested return mechanism left that does not require short access.
// Everything this campaign has measured is a transform of price. Funding is not; it is a payment
// stream, and it is the one place a genuinely different edge could still be hiding.
//
// candles-long/ is the harder test, and it is aimed at the result we would most like to keep. Our
// sample starts 2023-01 and contains no momentum crash. Momentum's documented way of dying is not
// decay -- it is a violent reversal after a market bottom, when the beaten-down names in the short
// leg rebound hardest. Pulling back to 2017 puts the 2018 collapse and the 2022 unwind in sample.
// It could take the crypto result down. That is the point of running it.
const FAPI = "https://fapi.binance.com/fapi/v1";     // USD-M perpetuals: funding history
const SPOT = "https://api.binance.com/api/v3";       // spot: daily candles back to 2017

// Our bundle uses Kraken tickers; Binance quotes in USDT. XBT is Kraken's name for BTC, and POL is
// the post-rebrand MATIC. Everything else is a straight XXXUSD -> XXXUSDT swap.
const KRAKEN = ["ADA","ALGO","APT","ATOM","AVAX","BCH","DOGE","DOT","EOS","ETC","ETH","FIL","INJ",
  "LINK","LTC","NEAR","POL","SOL","SUI","TAO","TIA","TRX","UNI","XBT","XLM","XMR","XRP","XTZ","ZEC"];
const toBinance = k => (k === "XBT" ? "BTC" : k) + "USDT";

import { mkdirSync, writeFileSync } from "node:fs";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = Date.parse("2017-01-01T00:00:00Z");

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 400 || res.status === 404) return null;      // symbol not listed here
    await sleep(1000 * 2 ** attempt);                               // 418/429/5xx: back off and retry
  }
  return null;
}

// Both endpoints cap a response and ignore anything past it, so a single call silently returns a
// PREFIX of the range asked for. Paging until the page stops advancing is what makes the pull
// complete rather than merely successful.
async function pageAll(url, limit, timeOf) {
  const out = [];
  let from = START;
  for (;;) {
    const page = await get(`${url}&startTime=${from}&limit=${limit}`);
    if (!page || !page.length) break;
    out.push(...page);
    const last = timeOf(page[page.length - 1]);
    if (page.length < limit || last <= from) break;
    from = last + 1;
    await sleep(120);
  }
  return out;
}

mkdirSync("funding", { recursive: true });
mkdirSync("candles-long", { recursive: true });
const report = [];

for (const k of KRAKEN) {
  const sym = toBinance(k), row = { kraken: k, binance: sym };

  const funding = await pageAll(`${FAPI}/fundingRate?symbol=${sym}`, 1000, r => r.fundingTime);
  if (funding.length) {
    writeFileSync(`funding/${k}USD.csv`, "symbol,fundingTime,fundingRate,markPrice\n" +
      funding.map(r => `${k}USD,${r.fundingTime},${r.fundingRate},${r.markPrice ?? ""}`).join("\n") + "\n");
    row.funding = `${funding.length} from ${new Date(funding[0].fundingTime).toISOString().slice(0, 10)}`;
  } else row.funding = "none (no perp listed)";

  const kl = await pageAll(`${SPOT}/klines?symbol=${sym}&interval=1d`, 1000, r => r[0]);
  if (kl.length) {
    // Seconds not milliseconds, to match the bundle format exactly. o,h,l,c,v are indices 1..5.
    writeFileSync(`candles-long/${k}USD.csv`, "time,open,high,low,close,volume\n" +
      kl.map(r => [Math.floor(r[0] / 1000), r[1], r[2], r[3], r[4], r[5]].join(",")).join("\n") + "\n");
    row.candles = `${kl.length} from ${new Date(kl[0][0]).toISOString().slice(0, 10)}`;
  } else row.candles = "none";

  report.push(row);
  console.log(`${k.padEnd(6)} ${sym.padEnd(10)} funding: ${String(row.funding).padEnd(28)} candles: ${row.candles}`);
}

console.log(`\n${report.filter(r => !String(r.funding).startsWith("none")).length}/${KRAKEN.length} symbols have funding history.`);
console.log("Expect a few gaps -- XMR perps were delisted, and the newer names list late. Gaps are");
console.log("data, not failure; a symbol with no perp is a symbol that cannot carry, which is itself");
console.log("part of the answer. Send the whole thing including the empty ones.");
