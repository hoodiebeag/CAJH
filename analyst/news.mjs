/**
 * analyst/news.mjs — headlines from IB Gateway, for the analyst to read.
 *
 * READ-ONLY. It issues `reqNewsProviders`, `reqHistoricalNews` and `reqNewsArticle`. There is no
 * order path in this file.
 *
 * WHY IBKR AND NOT A NEWS API. Chosen against four criteria -- hands-off, cheap, fast, reliable --
 * and it wins all four: no second vendor, no extra key or billing, one integration already needed
 * for the sector map. But the substantive reason is the fourth one, and it is not about
 * convenience.
 *
 * FREE NEWS TIERS GIVE PUBLICATION TIME, NOT AVAILABILITY TIME. An article stamped 09:31 may have
 * reached that vendor's API at 14:00, and many get silently revised after publication. Feed those
 * timestamps into a decision log and you have imported a lookahead bug that looks exactly like
 * alpha: the agent appears to react to news before the market did, because the clock is wrong
 * rather than because it was fast. Broker-delivered headlines carry the timestamp the broker
 * released them at, on the same connection that would place the order. That is the number a
 * decision can honestly be said to have been made after.
 *
 * WHICH DOES NOT MAKE THEM SAFE, AND `assertNotAfter` EXISTS FOR THAT. A provider can still stamp
 * something wrong. Every headline is checked against the decision boundary before it reaches the
 * analyst, and anything dated after is dropped and counted rather than trusted -- the same posture
 * context.mjs takes, applied at the source as well.
 *
 * TRANSPORT UNVERIFIED AGAINST A LIVE GATEWAY as of writing. The event signatures below were read
 * out of node_modules/@stoqey/ib/dist/api/api.d.ts rather than recalled, because rule 12 says a
 * mock is only evidence if it emits what the real library emits and this project has already paid
 * for forgetting that once. One signature in particular is a trap worth naming: `newsProviders`
 * delivers ONLY the provider array, with NO reqId, unlike every other event here. Anything written
 * from memory would almost certainly have added one and then quietly never matched.
 */

import fs from "node:fs";
import path from "node:path";

/** IBKR returns "YYYY-MM-DD HH:MM:SS.0" for historical news. Epoch seconds, or null if unparseable. */
export function parseNewsTime(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Some builds return epoch seconds directly. Distinguish by shape, never by trying one and
  // seeing whether the answer looks plausible -- "looks plausible" is how a 1970 date slips in.
  if (/^\d{10}$/.test(s)) return Number(s);
  if (/^\d{13}$/.test(s)) return Math.floor(Number(s) / 1000);

  // "2026-09-18 13:45:00.0" and "20260918-13:45:00" both appear in the wild.
  const dashed = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (dashed) {
    const [, y, mo, d, h, mi, sec] = dashed;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) / 1000;
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})[- ](\d{2}):(\d{2}):(\d{2})/);
  if (compact) {
    const [, y, mo, d, h, mi, sec] = compact;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) / 1000;
  }
  return null;
}

/**
 * What this account can actually read. THE ENTITLEMENT CHECK.
 *
 * Worth running before anything else: IBKR bundles some providers and charges for others, and the
 * difference decides whether the analyst's news slot is a real input or decoration. Asking is
 * cheaper and more truthful than assuming, and the answer goes in the record rather than in
 * somebody's memory of what the account had last year.
 */
export function listProviders({ api, ib }, timeoutMs = 15000) {
  const { EventName } = ib;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      api.off(EventName.newsProviders, onProviders);
      clearTimeout(timer);
      resolve(v);
    };
    // NOTE THE SIGNATURE: the provider array arrives alone. There is no reqId on this event.
    const onProviders = (providers) => finish({
      ok: true,
      providers: (providers ?? [])
        .filter((p) => p?.providerCode)
        .map((p) => ({ code: p.providerCode, name: p.providerName ?? null })),
    });
    const timer = setTimeout(() => finish({ ok: false, providers: [], reason: "timeout" }), timeoutMs);
    api.on(EventName.newsProviders, onProviders);
    try { api.reqNewsProviders(); }
    catch (e) { finish({ ok: false, providers: [], reason: String(e?.message ?? e) }); }
  });
}

/**
 * Split IBKR's metadata envelope off a headline.
 *
 * MEASURED, NOT REMEMBERED. Every headline the Gateway actually returned on 2026-09-19 arrives as
 * `{A:800015:L:en}Apple Bites Into Record Q3...` or, on three of ten,
 * `{A:800015:L:en:K:n/a:C:0.9775911569595337}!Rosenblatt reiterated Apple (AAPL) coverage...`.
 * Without this the analyst reads the braces as content -- forty tokens of vendor bookkeeping at
 * the front of every headline, in a context that is explicitly a budget.
 *
 * The leading `!` is stripped too. It appeared on the BRFUPDN analyst-action headlines and not on
 * the BRFG prose ones, so it is a provider marker rather than emphasis, and `providerCode` already
 * carries that information in a form the analyst can use.
 *
 * `C:` IS PARSED AND DELIBERATELY NOT INTERPRETED. It looks like a relevance or confidence score
 * and it would be easy to surface as one. Three samples, all above 0.77, is not a basis for
 * telling an analyst what a number means, and a misread score is worse than no score because it
 * arrives wearing the authority of the vendor. It is exposed under `meta` for a later probe to
 * settle against a larger sample or IBKR's own documentation. Nothing reads it today.
 *
 * An unrecognised shape is returned UNCHANGED rather than guessed at: a provider that stops
 * sending the envelope must not have its first characters eaten.
 */
export function parseHeadlineText(raw) {
  const s = String(raw ?? "");
  const m = /^\{([^}]*)\}\s*(!)?\s*([\s\S]*)$/.exec(s);
  if (!m) return { text: s.trim(), meta: {}, raw: s };
  const meta = {};
  const parts = m[1].split(":");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const k = parts[i].trim(), v = parts[i + 1].trim();
    if (k) meta[k] = v;
  }
  const text = m[3].trim();
  // An envelope with nothing after it is not a headline; keep the original so the emptiness is
  // visible rather than silently becoming "".
  return text ? { text, meta, raw: s } : { text: s.trim(), meta, raw: s };
}

/**
 * Historical headlines for one contract.
 *
 * `conId` is required and is NOT derivable from a ticker here -- it comes from
 * `reqContractDetails`, which `scripts/ibkr-contract-details.mjs` already calls for the sector
 * map. Those two are the same round trip and should share it when this runs for real.
 *
 * Resolves `{ ok, headlines, hasMore, reason }`. Never throws on a request-level failure: a symbol
 * with no news entitlement is a fact to record, not an exception to propagate.
 */
export function fetchHeadlines({ api, ib }, {
  conId, providerCodes, start = "", end = "", total = 30, reqId, timeoutMs = 20000,
}) {
  const { EventName, isNonFatalError } = ib;
  return new Promise((resolve) => {
    const headlines = [];
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      api.off(EventName.historicalNews, onNews);
      api.off(EventName.historicalNewsEnd, onEnd);
      api.off(EventName.error, onErr);
      clearTimeout(timer);
      resolve(v);
    };
    // historicalNews(reqId, time, providerCode, articleId, headline)
    const onNews = (rid, time, providerCode, articleId, headline) => {
      if (rid !== reqId) return;
      const at = parseNewsTime(time);
      // A headline whose timestamp will not parse is DROPPED, not stamped with "now". An
      // unparseable time on a decision input is exactly the thing that must never be guessed.
      if (at === null) return;
      const parsed = parseHeadlineText(headline);
      headlines.push({ at, atIso: new Date(at * 1000).toISOString(), providerCode, articleId,
                       headline, text: parsed.text, meta: parsed.meta });
    };
    // historicalNewsEnd(reqId, hasMore)
    const onEnd = (rid, hasMore) => { if (rid === reqId) finish({ ok: true, headlines, hasMore: !!hasMore }); };
    const onErr = (err, code, rid) => {
      if (rid !== reqId) return;
      if (typeof isNonFatalError === "function" && isNonFatalError(code, err)) return;
      finish({ ok: false, headlines: [], hasMore: false, reason: `${code}: ${String(err?.message ?? err)}` });
    };
    const timer = setTimeout(() => finish({ ok: false, headlines: [], hasMore: false, reason: "timeout" }), timeoutMs);
    api.on(EventName.historicalNews, onNews);
    api.on(EventName.historicalNewsEnd, onEnd);
    api.on(EventName.error, onErr);
    try { api.reqHistoricalNews(reqId, conId, providerCodes, start, end, total); }
    catch (e) { finish({ ok: false, headlines: [], hasMore: false, reason: String(e?.message ?? e) }); }
  });
}

/**
 * Drop anything dated at or after the decision boundary.
 *
 * Belt and braces with context.mjs, deliberately. That module filters news too, but this one runs
 * at the source and counts what it removed, so a provider that is systematically stamping articles
 * wrong shows up as a number rather than as an agent that mysteriously does well on certain days.
 */
export function assertNotAfter(headlines, boundaryEpoch) {
  const kept = [], dropped = [];
  for (const h of headlines ?? []) {
    if (typeof h.at !== "number" || h.at > boundaryEpoch) dropped.push(h);
    else kept.push(h);
  }
  return { kept, dropped };
}

/**
 * Shape headlines the way `buildContext` expects: { SYM: [{ at, headline, source }] }.
 *
 * Sorted newest first and truncated per symbol, because the context is a budget rather than a dump
 * and an analyst handed forty stale headlines about one name is worse off than one handed three.
 */
export function toNewsMap(bySymbol, { perSymbol = 3 } = {}) {
  const out = {};
  for (const [sym, headlines] of Object.entries(bySymbol ?? {})) {
    out[sym.toUpperCase()] = (headlines ?? [])
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, perSymbol)
      .map((h) => ({
        at: h.atIso ?? new Date(h.at * 1000).toISOString(),
        // `text` for caches written since the envelope parser landed; older caches and any
        // hand-built fixture fall back through the parser rather than leaking braces into context.
        headline: h.text ?? parseHeadlineText(h.headline).text,
        source: h.providerCode ?? null,
      }));
  }
  return out;
}

/**
 * Persist headlines to disk, and read them back.
 *
 * WHY A CACHE FILE RATHER THAN FETCHING INSIDE THE DECISION LOOP. Three reasons, and the third is
 * the one that matters.
 *
 * Fetching needs a Gateway; deciding does not. Coupling them means no news integration exists
 * until the Gateway does, and then it gets written under time pressure at the worst moment.
 *
 * Historical news costs a `reqContractDetails` round trip per symbol to resolve a conId plus a
 * `reqHistoricalNews` per symbol on top. Doing that inside every decision batch would make the
 * analyst's latency a function of TWS pacing limits, which are documented badly and enforced
 * strictly.
 *
 * AND MOST IMPORTANTLY: a cache is a point-in-time record. Every headline carries the timestamp
 * the broker released it at, so a decision made from the cache can be replayed against exactly the
 * headlines that existed then. Fetching live inside the loop would silently give a replay TODAY'S
 * news for YESTERDAY'S decision -- the precise contamination this whole design exists to prevent,
 * arriving through the back door of a convenience.
 *
 * The file records `fetchedAt` so staleness is visible: news that is a week old is not news, and
 * the caller is told rather than left to infer it from the headlines.
 */
export function saveNewsCache(file, bySymbol, { fetchedAt = new Date().toISOString(), providers = [] } = {}) {
  const dir = path.dirname(file);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ fetchedAt, providers, headlines: bySymbol }, null, 2) + "\n");
  return { fetchedAt, providers, symbols: Object.keys(bySymbol ?? {}).length };
}

/**
 * Read a news cache. Returns null when absent -- a missing cache is a normal state, not an error:
 * the analyst runs without news and the context simply carries none.
 *
 * `maxAgeMs` is checked and REPORTED rather than enforced. Whether week-old headlines should block
 * a decision is a judgement for the caller, but it must be a judgement made knowingly.
 */
export function loadNewsCache(file, { maxAgeMs = 24 * 3600 * 1000, now = Date.now() } = {}) {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const fetchedMs = Date.parse(raw.fetchedAt ?? "");
  const ageMs = Number.isFinite(fetchedMs) ? now - fetchedMs : Infinity;
  return {
    fetchedAt: raw.fetchedAt ?? null,
    providers: raw.providers ?? [],
    headlines: raw.headlines ?? {},
    ageMs,
    stale: ageMs > maxAgeMs,
  };
}

/**
 * Full article body for one headline.
 *
 * NOT WIRED INTO THE CONTEXT, deliberately. Bodies are long, and a context that carries three full
 * articles per name for forty names is mostly article -- the model would attend to whichever
 * happened to be first rather than to the cross-section. Headlines go to the analyst; this exists
 * so a human reviewing a thesis afterwards can read what the agent was reacting to.
 */
export function fetchArticle({ api, ib }, { providerCode, articleId, reqId, timeoutMs = 20000 }) {
  const { EventName, isNonFatalError } = ib;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      api.off(EventName.newsArticle, onArticle);
      api.off(EventName.error, onErr);
      clearTimeout(timer);
      resolve(v);
    };
    // newsArticle(reqId, articleType, articleText)
    const onArticle = (rid, articleType, articleText) => {
      if (rid !== reqId) return;
      finish({ ok: true, articleType, text: articleText ?? "" });
    };
    const onErr = (err, code, rid) => {
      if (rid !== reqId) return;
      if (typeof isNonFatalError === "function" && isNonFatalError(code, err)) return;
      finish({ ok: false, text: "", reason: `${code}: ${String(err?.message ?? err)}` });
    };
    const timer = setTimeout(() => finish({ ok: false, text: "", reason: "timeout" }), timeoutMs);
    api.on(EventName.newsArticle, onArticle);
    api.on(EventName.error, onErr);
    try { api.reqNewsArticle(reqId, providerCode, articleId); }
    catch (e) { finish({ ok: false, text: "", reason: String(e?.message ?? e) }); }
  });
}
