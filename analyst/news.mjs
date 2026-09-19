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
      headlines.push({ at, atIso: new Date(at * 1000).toISOString(), providerCode, articleId, headline });
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
        headline: h.headline,
        source: h.providerCode ?? null,
      }));
  }
  return out;
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
