import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseNewsTime, listProviders, fetchHeadlines, fetchArticle, assertNotAfter, toNewsMap, parseHeadlineText } from "./news.mjs";

/**
 * THE FAKE EMITS WHAT @stoqey/ib EMITS. Signatures read out of
 * node_modules/@stoqey/ib/dist/api/api.d.ts, not recalled:
 *
 *   newsProviders(newsProviders: NewsProvider[])                      <- NO reqId. The trap.
 *   historicalNews(reqId, time, providerCode, articleId, headline)
 *   historicalNewsEnd(reqId, hasMore)
 *   newsArticle(reqId, articleType, articleText)
 *   error(err, code, reqId)
 *
 * brokers/ibkr.test.mjs once emitted this library's error events with the arguments backwards and
 * 27 green tests certified a broken adapter for weeks. Hence the care, and hence the drift test
 * at the bottom of this file.
 */
function fakeApi() {
  const api = new EventEmitter();
  api.off = api.removeListener.bind(api);
  api.calls = [];
  api.reqNewsProviders = function () { this.calls.push(["reqNewsProviders"]); };
  api.reqHistoricalNews = function (...a) { this.calls.push(["reqHistoricalNews", ...a]); };
  api.reqNewsArticle = function (...a) { this.calls.push(["reqNewsArticle", ...a]); };
  return api;
}
const ib = {
  EventName: {
    newsProviders: "newsProviders", historicalNews: "historicalNews",
    historicalNewsEnd: "historicalNewsEnd", newsArticle: "newsArticle", error: "error",
  },
  isNonFatalError: (code) => code >= 2100 && code <= 2999,
};
const conn = (api) => ({ api, ib });
const soon = (fn) => setTimeout(fn, 0);

// ---- timestamps ---------------------------------------------------------------------------------

test("IBKR's news time formats parse to the right instant", () => {
  assert.equal(parseNewsTime("2026-09-18 13:45:00.0"), Date.UTC(2026, 8, 18, 13, 45, 0) / 1000);
  assert.equal(parseNewsTime("2026-09-18T13:45:00"), Date.UTC(2026, 8, 18, 13, 45, 0) / 1000);
  assert.equal(parseNewsTime("20260918-13:45:00"), Date.UTC(2026, 8, 18, 13, 45, 0) / 1000);
  assert.equal(parseNewsTime("1789390800"), 1789390800);
  assert.equal(parseNewsTime("1789390800000"), 1789390800);
});

test("an unparseable time is null, never a fallback to now", () => {
  // Guessing a timestamp on a decision input is how a 1970 date or a future date slips in.
  for (const bad of ["", "   ", "not a date", "18/09/2026", null, undefined, "2026-09"]) {
    assert.equal(parseNewsTime(bad), null, JSON.stringify(bad));
  }
});

// ---- providers, the entitlement check ------------------------------------------------------------

test("listProviders reads the array-only event correctly", async () => {
  const api = fakeApi();
  soon(() => api.emit("newsProviders", [
    { providerCode: "BRFG", providerName: "Briefing.com" },
    { providerCode: "DJNL", providerName: "Dow Jones Newsletters" },
  ]));
  const r = await listProviders(conn(api));
  assert.equal(r.ok, true);
  assert.deepEqual(r.providers, [
    { code: "BRFG", name: "Briefing.com" },
    { code: "DJNL", name: "Dow Jones Newsletters" },
  ]);
  assert.deepEqual(api.calls[0], ["reqNewsProviders"]);
});

test("an account entitled to nothing is a clean empty answer, not an error", async () => {
  const api = fakeApi();
  soon(() => api.emit("newsProviders", []));
  const r = await listProviders(conn(api));
  assert.equal(r.ok, true);
  assert.deepEqual(r.providers, []);
});

test("a provider row with no code is skipped", async () => {
  const api = fakeApi();
  soon(() => api.emit("newsProviders", [{ providerName: "nameless" }, { providerCode: "BRFG" }]));
  const r = await listProviders(conn(api));
  assert.equal(r.providers.length, 1);
});

test("listProviders times out rather than hanging", async () => {
  const r = await listProviders(conn(fakeApi()), 20);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "timeout");
});

// ---- headlines ------------------------------------------------------------------------------------

test("headlines are collected until historicalNewsEnd", async () => {
  const api = fakeApi();
  soon(() => {
    api.emit("historicalNews", 42, "2026-09-18 09:30:00.0", "BRFG", "a1", "Guidance raised");
    api.emit("historicalNews", 42, "2026-09-18 11:00:00.0", "BRFG", "a2", "Analyst upgrade");
    api.emit("historicalNewsEnd", 42, false);
  });
  const r = await fetchHeadlines(conn(api), { conId: 265598, providerCodes: "BRFG", reqId: 42 });
  assert.equal(r.ok, true);
  assert.equal(r.headlines.length, 2);
  assert.equal(r.headlines[0].headline, "Guidance raised");
  assert.equal(r.hasMore, false);
});

test("hasMore is carried through", async () => {
  const api = fakeApi();
  soon(() => api.emit("historicalNewsEnd", 7, true));
  const r = await fetchHeadlines(conn(api), { conId: 1, providerCodes: "BRFG", reqId: 7 });
  assert.equal(r.hasMore, true);
});

test("another request's rows are ignored", async () => {
  const api = fakeApi();
  soon(() => {
    api.emit("historicalNews", 99, "2026-09-18 09:30:00.0", "BRFG", "x", "someone else's");
    api.emit("historicalNews", 42, "2026-09-18 09:30:00.0", "BRFG", "a1", "mine");
    api.emit("historicalNewsEnd", 42, false);
  });
  const r = await fetchHeadlines(conn(api), { conId: 1, providerCodes: "BRFG", reqId: 42 });
  assert.equal(r.headlines.length, 1);
  assert.equal(r.headlines[0].headline, "mine");
});

test("a headline with an unparseable timestamp is dropped, not stamped with now", async () => {
  const api = fakeApi();
  soon(() => {
    api.emit("historicalNews", 42, "garbage", "BRFG", "a1", "undated");
    api.emit("historicalNews", 42, "2026-09-18 09:30:00.0", "BRFG", "a2", "dated");
    api.emit("historicalNewsEnd", 42, false);
  });
  const r = await fetchHeadlines(conn(api), { conId: 1, providerCodes: "BRFG", reqId: 42 });
  assert.equal(r.headlines.length, 1);
  assert.equal(r.headlines[0].headline, "dated");
});

test("the data-farm warning band does not kill a request", async () => {
  // Killing a request on 2100-2999 loses good data; ignoring reqId lets real rejections time out.
  const api = fakeApi();
  soon(() => {
    api.emit("error", new Error("Market data farm connection is OK"), 2104, 42);
    api.emit("historicalNews", 42, "2026-09-18 09:30:00.0", "BRFG", "a1", "survived");
    api.emit("historicalNewsEnd", 42, false);
  });
  const r = await fetchHeadlines(conn(api), { conId: 1, providerCodes: "BRFG", reqId: 42 });
  assert.equal(r.ok, true);
  assert.equal(r.headlines.length, 1);
});

test("a real error fails the request with its code", async () => {
  const api = fakeApi();
  soon(() => api.emit("error", new Error("News feed not subscribed"), 10276, 42));
  const r = await fetchHeadlines(conn(api), { conId: 1, providerCodes: "BRFG", reqId: 42 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /10276/);
});

test("an error for another request is ignored", async () => {
  const api = fakeApi();
  soon(() => {
    api.emit("error", new Error("not mine"), 10276, 99);
    api.emit("historicalNewsEnd", 42, false);
  });
  const r = await fetchHeadlines(conn(api), { conId: 1, providerCodes: "BRFG", reqId: 42 });
  assert.equal(r.ok, true);
});

test("the request is issued with the arguments the SDK declares", async () => {
  const api = fakeApi();
  soon(() => api.emit("historicalNewsEnd", 5, false));
  await fetchHeadlines(conn(api), {
    conId: 265598, providerCodes: "BRFG+DJNL", start: "2026-09-01 00:00:00",
    end: "2026-09-18 00:00:00", total: 15, reqId: 5,
  });
  assert.deepEqual(api.calls[0],
    ["reqHistoricalNews", 5, 265598, "BRFG+DJNL", "2026-09-01 00:00:00", "2026-09-18 00:00:00", 15]);
});

// ---- the boundary ------------------------------------------------------------------------------

test("headlines at or after the boundary are dropped and counted", async () => {
  const boundary = Date.UTC(2026, 8, 18, 12, 0, 0) / 1000;
  const h = (at, headline) => ({ at, headline });
  const { kept, dropped } = assertNotAfter([
    h(boundary - 3600, "before"),
    h(boundary, "exactly at the boundary"),
    h(boundary + 1, "after"),
    { headline: "no timestamp at all" },
  ], boundary);
  assert.deepEqual(kept.map((x) => x.headline), ["before", "exactly at the boundary"]);
  assert.equal(dropped.length, 2, "a future stamp and a missing stamp are both removed");
});

// ---- context shape -------------------------------------------------------------------------------

test("toNewsMap produces what buildContext expects, newest first and truncated", () => {
  const base = Date.UTC(2026, 8, 18, 9, 0, 0) / 1000;
  const mk = (n) => ({ at: base + n * 3600, atIso: new Date((base + n * 3600) * 1000).toISOString(), headline: `h${n}`, providerCode: "BRFG" });
  const map = toNewsMap({ aapl: [mk(1), mk(4), mk(2), mk(3)] }, { perSymbol: 2 });
  assert.deepEqual(Object.keys(map), ["AAPL"]);
  assert.deepEqual(map.AAPL.map((x) => x.headline), ["h4", "h3"]);
  assert.equal(map.AAPL[0].source, "BRFG");
  assert.match(map.AAPL[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test("a symbol with no headlines yields an empty list rather than vanishing", () => {
  assert.deepEqual(toNewsMap({ AAPL: [] }), { AAPL: [] });
});

// ---- articles ------------------------------------------------------------------------------------

test("fetchArticle returns the body and its type", async () => {
  const api = fakeApi();
  soon(() => api.emit("newsArticle", 11, 0, "Full article text."));
  const r = await fetchArticle(conn(api), { providerCode: "BRFG", articleId: "a1", reqId: 11 });
  assert.equal(r.ok, true);
  assert.equal(r.text, "Full article text.");
  assert.equal(r.articleType, 0);
  assert.deepEqual(api.calls[0], ["reqNewsArticle", 11, "BRFG", "a1"]);
});

test("fetchArticle times out rather than hanging", async () => {
  const r = await fetchArticle(conn(fakeApi()), { providerCode: "BRFG", articleId: "a1", reqId: 1, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "timeout");
});

// ---- drift ------------------------------------------------------------------------------------------

test("the news event signatures still match the installed @stoqey/ib", async () => {
  // The same standing guard decide.test.mjs has against the SDK. A mock checked once at authoring
  // time is a mock that rots silently at the next dependency bump.
  const fs = await import("node:fs");
  const path = "node_modules/@stoqey/ib/dist/api/api.d.ts";
  if (!fs.existsSync(path)) return;
  const src = fs.readFileSync(path, "utf8");

  const sig = (event) => {
    const line = src.split("\n").find((l) => l.includes(`on(event: EventName.${event},`));
    if (!line) return null;
    const m = line.match(/listener:\s*\(([^)]*)\)/);
    return m ? m[1].split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean) : null;
  };

  assert.deepEqual(sig("newsProviders"), ["newsProviders"],
    "newsProviders must still deliver the array alone, with no reqId");
  assert.deepEqual(sig("historicalNews"), ["reqId", "time", "providerCode", "articleId", "headline"]);
  assert.deepEqual(sig("historicalNewsEnd"), ["reqId", "hasMore"]);
  assert.deepEqual(sig("newsArticle"), ["reqId", "articleType", "articleText"]);
});

// ---- the cache ------------------------------------------------------------------------------------

test("a cache round-trips and records when it was fetched", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const p = await import("node:path");
  const { saveNewsCache, loadNewsCache } = await import("./news.mjs");
  const f = p.join(fs.mkdtempSync(p.join(os.tmpdir(), "news-")), "cache.json");

  const at = Date.UTC(2026, 8, 18, 9, 30, 0) / 1000;
  saveNewsCache(f, { AAPL: [{ at, atIso: new Date(at * 1000).toISOString(), headline: "Guidance raised", providerCode: "BRFG" }] },
    { fetchedAt: "2026-09-18T12:00:00.000Z", providers: [{ code: "BRFG" }] });

  const c = loadNewsCache(f, { now: Date.parse("2026-09-18T13:00:00.000Z") });
  assert.equal(c.fetchedAt, "2026-09-18T12:00:00.000Z");
  assert.equal(c.headlines.AAPL[0].headline, "Guidance raised");
  assert.equal(c.providers[0].code, "BRFG");
  assert.equal(c.stale, false);
  assert.ok(Math.abs(c.ageMs - 3600000) < 1000);
});

test("a missing cache is null, not an error — running without news is normal", async () => {
  const os = await import("node:os");
  const p = await import("node:path");
  const { loadNewsCache } = await import("./news.mjs");
  assert.equal(loadNewsCache(p.join(os.tmpdir(), `absent-${Date.now()}`, "c.json")), null);
});

test("staleness is reported, not enforced", async () => {
  // Whether week-old headlines should block a decision is the caller's judgement — but it must be
  // a judgement made knowingly rather than by not noticing.
  const fs = await import("node:fs");
  const os = await import("node:os");
  const p = await import("node:path");
  const { saveNewsCache, loadNewsCache } = await import("./news.mjs");
  const f = p.join(fs.mkdtempSync(p.join(os.tmpdir(), "news-")), "cache.json");
  saveNewsCache(f, {}, { fetchedAt: "2026-09-01T00:00:00.000Z" });
  const c = loadNewsCache(f, { now: Date.parse("2026-09-18T00:00:00.000Z") });
  assert.equal(c.stale, true);
  assert.ok(c.headlines, "still returns the payload; the caller decides what to do");
});

test("a cache with an unparseable fetchedAt is treated as infinitely stale", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const p = await import("node:path");
  const { loadNewsCache } = await import("./news.mjs");
  const f = p.join(fs.mkdtempSync(p.join(os.tmpdir(), "news-")), "cache.json");
  fs.writeFileSync(f, JSON.stringify({ fetchedAt: "whenever", headlines: {} }));
  const c = loadNewsCache(f);
  assert.equal(c.stale, true);
  assert.equal(c.ageMs, Infinity);
});

// ---- the metadata envelope ---------------------------------------------------------------------
// Every one of these strings is a headline IB Gateway actually returned on 2026-09-19, copied from
// data/news-cache.json rather than invented. Rule 6: a fixture is only evidence if it is what the
// real thing emits.
test("parseHeadlineText strips the envelope IBKR actually sends", () => {
  const r = parseHeadlineText("{A:800015:L:en}Apple Bites Into Record Q3, but Supply Crunch Takes a Bite Out of Guidance");
  assert.equal(r.text, "Apple Bites Into Record Q3, but Supply Crunch Takes a Bite Out of Guidance");
  assert.deepEqual(r.meta, { A: "800015", L: "en" });
  assert.ok(!r.text.includes("{"), "no brace may reach the analyst as content");
});

test("parseHeadlineText handles the K/C variant and the leading bang", () => {
  const r = parseHeadlineText("{A:800015:L:en:K:n/a:C:0.9775911569595337}!Rosenblatt reiterated Apple (AAPL) coverage with Neutral and target $268");
  assert.equal(r.text, "Rosenblatt reiterated Apple (AAPL) coverage with Neutral and target $268");
  assert.equal(r.meta.C, "0.9775911569595337");
  assert.equal(r.meta.K, "n/a");
  assert.ok(!r.text.startsWith("!"));
});

test("parseHeadlineText leaves an unrecognised shape alone rather than eating its first characters", () => {
  const plain = "Fed holds rates steady";
  assert.equal(parseHeadlineText(plain).text, plain);
  assert.deepEqual(parseHeadlineText(plain).meta, {});
  // An unterminated brace is not an envelope and must survive intact.
  assert.equal(parseHeadlineText("{unterminated headline").text, "{unterminated headline");
});

test("parseHeadlineText keeps the original when the envelope is all there is", () => {
  const only = "{A:800015:L:en}";
  assert.equal(parseHeadlineText(only).text, only, "an empty result would hide that the headline was empty");
});

test("toNewsMap hands the analyst cleaned text, including for a cache written before the parser", () => {
  const legacy = { AAPL: [{ at: 1000, atIso: "2026-09-01T00:00:00.000Z", providerCode: "BRFG",
                            headline: "{A:800015:L:en}!BofA Securities reiterated Apple (AAPL) coverage with Buy" }] };
  const out = toNewsMap(legacy);
  assert.equal(out.AAPL[0].headline, "BofA Securities reiterated Apple (AAPL) coverage with Buy");
  assert.ok(!out.AAPL[0].headline.includes("{"));
});

test("the C field is carried but nothing consumes it as a score", () => {
  const r = parseHeadlineText("{A:1:L:en:K:n/a:C:0.42}!Something happened");
  assert.equal(r.meta.C, "0.42");
  assert.equal(typeof r.meta.C, "string", "kept as sent; interpreting it needs a larger sample");
  const mapped = toNewsMap({ X: [{ at: 1, atIso: "2026-01-01T00:00:00.000Z", headline: r.raw }] });
  assert.deepEqual(Object.keys(mapped.X[0]).sort(), ["at", "headline", "source"],
    "no score leaks into the analyst's context under an unverified meaning");
});
