/**
 * Tests for the readiness probe.
 *
 * Two jobs. First, the three hard rules — no model call, no journal write, no re-implemented freshness
 * thresholds — since a probe that violates any of them is worse than no probe: it either spends money,
 * pollutes the evidence record, or lies about the guard it claims to predict.
 *
 * Second, that it names the RIGHT blocker. A probe that says "not ready" without distinguishing a
 * missing panel from a stale one from a missing key sends someone to re-pull 21 minutes of data when the
 * actual problem was an unexported environment variable.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { panelCheck, keyCheck, journalCheck, ledgerCheck, readinessReport, formatReadiness, STATUS } from "./readiness.mjs";
import { missedSessions, sessionsAhead, sessionWeekdays } from "./loop.mjs";
import { registerVersion, inputHashes } from "./ledger.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const DAY = 86400;
const boxDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ready-"));

/** Weekday-only sessions ending `endDaysAgo` before `now`, as epoch seconds. */
function sessions({ now, endDaysAgo, count = 60 }) {
  const out = [];
  let d = new Date(now - endDaysAgo * DAY * 1000);
  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000));
    d = new Date(d.getTime() - DAY * 1000);
  }
  return out.sort((a, b) => a - b);
}

/** A directory that exists, so panelCheck gets past its existence test. */
const realDir = () => { const p = path.join(boxDir(), "bundle"); fs.mkdirSync(p, { recursive: true }); return p; };

// ---- panel -------------------------------------------------------------------------------------

test("a missing panel is BLOCKED and points at refresh.sh, not at the key", () => {
  const c = panelCheck(path.join(boxDir(), "absent"), { loadDates: () => [] });
  assert.equal(c.status, STATUS.BLOCKED);
  assert.match(c.detail, /no panel at/);
  assert.match(c.fix, /refresh\.sh/);
});

test("a current panel is ok", () => {
  const now = Date.UTC(2026, 9, 7, 20, 0, 0);   // a Wednesday
  const root = realDir();
  const c = panelCheck(root, { loadDates: () => sessions({ now, endDaysAgo: 0 }), now });
  assert.equal(c.status, STATUS.OK, c.detail);
  assert.match(c.detail, /current/);
});

test("a stale panel is BLOCKED and the session count matches the guard's own function", () => {
  // NOT a re-derived number: the expectation comes from missedSessions, which is what runOnce calls.
  const now = Date.UTC(2026, 9, 7, 20, 0, 0);
  const dates = sessions({ now, endDaysAgo: 10 });
  const root = realDir();
  const c = panelCheck(root, { loadDates: () => dates, now });
  // sessionWeekdays returns a SET, and missedSessions bails to 0 on anything without `.size` — so
  // passing an array here silently made this test assert nothing. Use the same call panelCheck makes.
  const expected = missedSessions(dates.at(-1), now, sessionWeekdays(dates));
  assert.equal(c.status, STATUS.BLOCKED);
  assert.ok(expected > 0, "the fixture was not actually stale");
  assert.match(c.detail, new RegExp(`${expected} trading session\\(s\\) stale`));
  assert.match(c.fix, /refresh\.sh/);
});

test("a future-dated panel is reported as a data fault, not as staleness", () => {
  // Reporting this as 'stale' would send someone to re-pull data that is already wrong.
  const now = Date.UTC(2026, 9, 7, 20, 0, 0);
  const dates = sessions({ now: now + 5 * DAY * 1000, endDaysAgo: 0 });
  const root = realDir();
  const c = panelCheck(root, { loadDates: () => dates, now });
  assert.equal(c.status, STATUS.BLOCKED);
  assert.ok(sessionsAhead(dates.at(-1), now) > 0, "the fixture was not actually future-dated");
  assert.match(c.detail, /in the FUTURE/);
  assert.doesNotMatch(c.detail, /stale/);
  assert.match(c.fix, /clock|timezone/);
});

test("an unreadable or empty panel is BLOCKED rather than throwing", () => {
  const root = realDir();
  assert.equal(panelCheck(root, { loadDates: () => { throw new Error("bad csv"); } }).status, STATUS.BLOCKED);
  assert.match(panelCheck(root, { loadDates: () => { throw new Error("bad csv"); } }).detail, /could not be read/);
  assert.match(panelCheck(root, { loadDates: () => [] }).detail, /no dated bars/);
});

test("a synthetic panel is BLOCKED even when perfectly fresh", () => {
  const now = Date.UTC(2026, 9, 7, 20, 0, 0);
  const root = realDir();
  fs.writeFileSync(path.join(root, "PROVENANCE.json"), JSON.stringify({ synthetic: true }));
  const c = panelCheck(root, { loadDates: () => sessions({ now, endDaysAgo: 0 }), now });
  assert.equal(c.status, STATUS.BLOCKED);
  assert.match(c.detail, /SYNTHETIC/);
});

// ---- key ---------------------------------------------------------------------------------------

test("a missing key is BLOCKED and the fix names process.env rather than .env", () => {
  // The whole point of this check: the analyst loads NO .env file, so a key that lives only there is
  // absent under cron. A fix that said 'put it in .env' would be actively wrong.
  for (const env of [{}, { ANTHROPIC_API_KEY: "" }, { ANTHROPIC_API_KEY: "   " }]) {
    const c = keyCheck(env);
    assert.equal(c.status, STATUS.BLOCKED);
    assert.match(c.fix, /process\.env/);
    assert.match(c.fix, /NO \.env/);
  }
});

test("a present key is ok, and the probe explicitly does not claim it is valid", () => {
  const c = keyCheck({ ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" });
  assert.equal(c.status, STATUS.OK);
  assert.match(c.detail, /validity NOT checked/);
  assert.doesNotMatch(c.detail, /sk-ant/, "the key value leaked into the report");
});

// ---- journal -----------------------------------------------------------------------------------

test("journal checks cover absent, writable and unwritable, and never create the file", () => {
  const dir = boxDir();
  const j = path.join(dir, "journal.jsonl");
  const cs = journalCheck(j);
  assert.equal(cs[0].status, STATUS.OK);
  assert.match(cs[0].detail, /does not exist yet/);
  assert.equal(fs.existsSync(j), false, "the probe created the journal");

  // The unwritable case needs a non-root uid: root bypasses the W_OK check entirely, so asserting
  // BLOCKED here would fail in this container (tests run as root) for a reason unrelated to the code.
  if (os.userInfo().uid !== 0) {
    const ro = path.join(boxDir(), "ro");
    fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
    const blocked = journalCheck(path.join(ro, "journal.jsonl"));
    assert.equal(blocked[0].status, STATUS.BLOCKED);
    assert.match(blocked[0].detail, /not writable/);
    fs.chmodSync(ro, 0o700);
  }
});

// ---- ledger ------------------------------------------------------------------------------------

test("an unregistered candidate WARNs rather than BLOCKs, because day one is not a fault", () => {
  const f = path.join(boxDir(), "l.jsonl");
  const cs = ledgerCheck("analyst-daily", null, { file: f });
  assert.equal(cs.find((c) => c.name === "ledger chain").status, STATUS.OK);
  const reg = cs.find((c) => c.name === "ledger registration");
  assert.equal(reg.status, STATUS.WARN);
  assert.match(reg.detail, /no version registered/);
});

test("drift from the registered configuration WARNs and names which input moved", () => {
  const f = path.join(boxDir(), "l.jsonl");
  const h = (p) => inputHashes({ systemPrompt: p, checklist: ["a"], checklistId: "v1", universeText: "AAA\n" });
  registerVersion({
    candidateId: "analyst-daily", version: "v1", whatChanged: "baseline", why: "first registration",
    registeredClaim: "positive edge at 50 periods", control: "matched random control",
    minimumPeriods: 50, mdeAtMinimum: 0.48, drawdownWindow: "60 sessions", supersedes: null, hashes: h("A"),
  }, f);

  assert.equal(ledgerCheck("analyst-daily", h("A"), { file: f })
    .find((c) => c.name === "ledger registration").status, STATUS.OK);

  const drifted = ledgerCheck("analyst-daily", h("B"), { file: f }).find((c) => c.name === "ledger registration");
  assert.equal(drifted.status, STATUS.WARN);
  assert.match(drifted.detail, /differs from registered v1 in: prompt/);
});

test("a broken ledger chain BLOCKS", () => {
  const f = path.join(boxDir(), "l.jsonl");
  fs.writeFileSync(f, "{not json\n");
  assert.equal(ledgerCheck(null, null, { file: f }).find((c) => c.name === "ledger chain").status, STATUS.BLOCKED);
});

// ---- assembly ----------------------------------------------------------------------------------

test("the report is ready only when nothing blocks, and WARN alone does not block", () => {
  const now = Date.UTC(2026, 9, 7, 20, 0, 0);
  const root = realDir();
  const dir = boxDir();
  const r = readinessReport({
    root, journalFile: path.join(dir, "j.jsonl"), candidateId: "analyst-daily",
    current: inputHashes({ systemPrompt: "A", checklist: null, checklistId: null, universeText: "AAA\n" }),
    env: { ANTHROPIC_API_KEY: "present" },
    loadDates: () => sessions({ now, endDaysAgo: 0 }), now, ledgerFile: path.join(dir, "l.jsonl"),
  });
  assert.equal(r.ready, true, JSON.stringify(r.blocked, null, 2));
  assert.ok(r.checks.some((c) => c.status === STATUS.WARN), "the unregistered candidate should WARN");
  const text = formatReadiness(r).join("\n");
  assert.match(text, /READY/);
  assert.match(text, /FIRST paper run is still manual/);
});

test("a not-ready report counts every blocker, not just the first", () => {
  const dir = boxDir();
  const r = readinessReport({
    root: path.join(dir, "absent"), journalFile: path.join(dir, "j.jsonl"),
    env: {}, loadDates: () => [], ledgerFile: path.join(dir, "l.jsonl"),
  });
  assert.equal(r.ready, false);
  assert.equal(r.blocked.length, 2, "expected both the panel and the key to block");
  assert.match(formatReadiness(r).join("\n"), /NOT READY: 2 blocking/);
});

// ---- the hard rules, through the CLI -----------------------------------------------------------

test("the CLI probe makes no model call and writes no journal, lock or ledger", () => {
  const dir = boxDir();
  const j = path.join(dir, "journal.jsonl");
  const l = path.join(dir, "ledger.jsonl");

  let out = "", status = 0;
  try {
    out = execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "readiness",
                                "--root", "sp500-bundle", "--journal", j, "--candidate", "analyst-daily"],
      { cwd: REPO, stdio: "pipe", encoding: "utf8",
        // A key IS present here. If the probe were going to call a model, this is when it would — and
        // an invalid key would surface as an API error rather than a readiness line.
        env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-deliberately-invalid", CAJH_LEDGER: l } });
  } catch (e) { status = e.status; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }

  assert.doesNotMatch(out, /authentication|invalid x-api-key|401|rate limit/i,
    "the probe appears to have contacted the API");
  assert.match(out, /model key/);
  assert.match(out, /validity NOT checked/);
  assert.equal(fs.existsSync(j), false, "the probe wrote the journal");
  assert.equal(fs.existsSync(`${j}.lock`), false, "the probe took the journal lock");
  assert.equal(fs.existsSync(l), false, "the probe wrote the ledger");
  // sp500-bundle is stale, so this must be a non-zero exit rather than a cheerful pass.
  assert.equal(status, 1, `expected exit 1 on a stale panel, got ${status}`);
  assert.match(out, /stale/);
});

test("the probe never journals a SKIP, which is what running paper to test readiness would do", () => {
  // The specific gap this closes: runOnce's freshness guard calls recordSkip BEFORE it throws, so using
  // `paper` as a readiness test leaves a skip record produced by a question rather than by a session.
  const dir = boxDir();
  const j = path.join(dir, "journal.jsonl");
  try {
    execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "readiness", "--root", "sp500-bundle", "--journal", j],
      { cwd: REPO, stdio: "pipe", encoding: "utf8" });
  } catch { /* exits 1: stale panel, no key */ }
  assert.equal(fs.existsSync(j), false);
});
