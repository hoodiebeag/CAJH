/**
 * "Would an unattended `paper` run work right now, and if not, exactly why?"
 *
 * THE GAP THIS CLOSES. Every prerequisite for a scheduled run is currently discoverable only by
 * running the thing: the panel guard lives inside `runOnce` and journals a SKIP record before it
 * throws, so probing readiness against the real journal leaves a record that a readiness probe
 * produced. `--journal`/`CAJH_JOURNAL` can redirect that, but then you are testing a different journal
 * from the one the run uses — and the key check happens even later, after a real model client would
 * have been constructed. So there was no way to ask the question about the actual configuration
 * without either writing to the record or making a model call.
 *
 * THREE HARD RULES, all asserted in readiness.test.mjs:
 *   1. NO MODEL CALL. No client is constructed and no key is used. Key presence is checked; validity
 *      is NOT, because that cannot be established without spending a call.
 *   2. NO JOURNAL WRITE. Nothing here appends a decision, outcome or skip. It does not take the lock
 *      either — it reports on the lock, which is a read.
 *   3. NO RE-IMPLEMENTED THRESHOLDS. Freshness reuses `missedSessions` and `sessionsAhead` from
 *      `analyst/loop.mjs` — the same functions the real guard calls. A probe with its own copy of the
 *      staleness rule would drift from the guard and then lie about it, which is worse than no probe.
 *
 * It changes no risk limit, sizing rule, order behaviour, STOP criterion or passing criterion, and it
 * decides nothing: every check reports, and the caller reads the report.
 */

import fs from "node:fs";
import path from "node:path";
import { missedSessions, sessionsAhead, sessionWeekdays } from "./loop.mjs";
import { readLock, lockPathFor } from "./lock.mjs";
import { isDeclaredSynthetic } from "./provenance.mjs";
import { verifyLedger, familySize, currentVersion, driftFromRegistered } from "./ledger.mjs";

export const STATUS = Object.freeze({ OK: "ok", BLOCKED: "blocked", WARN: "warn" });

const check = (name, status, detail, fix = null) => ({ name, status, detail, fix });

/**
 * Panel readiness, using the guard's own functions.
 *
 * `loadDates` is injected so this module never depends on how a bundle is read, and so the test can
 * drive every branch — a future-dated panel is otherwise almost impossible to arrange honestly.
 */
export function panelCheck(root, { loadDates, now = Date.now() } = {}) {
  if (!root) return check("panel", STATUS.BLOCKED, "no panel root given");
  if (!fs.existsSync(root)) {
    return check("panel", STATUS.BLOCKED, `no panel at "${root}"`,
      "bash scripts/refresh.sh   # on a machine that reaches IB Gateway; probe first with --limit 25");
  }
  let dates;
  try {
    dates = loadDates(root);
  } catch (e) {
    return check("panel", STATUS.BLOCKED, `panel at "${root}" could not be read: ${e.message}`);
  }
  if (!Array.isArray(dates) || dates.length === 0) {
    return check("panel", STATUS.BLOCKED, `panel at "${root}" has no dated bars`);
  }

  const last = dates.at(-1);
  const lastIso = new Date(last * 1000).toISOString().slice(0, 10);

  // Same order the guard checks in: future-dating first, because a panel dated ahead is a data fault
  // rather than a staleness one and reporting it as "stale" would send someone to re-pull.
  const ahead = sessionsAhead(last, now);
  if (ahead > 0) {
    return check("panel", STATUS.BLOCKED,
      `last bar ${lastIso} is ${ahead} session(s) in the FUTURE — paper mode refuses this`,
      "the panel is wrong, not stale: check the collector's clock and timezone handling");
  }
  const missed = missedSessions(last, now, sessionWeekdays(dates));
  if (missed > 0) {
    return check("panel", STATUS.BLOCKED,
      `last bar ${lastIso} is ${missed} trading session(s) stale — paper mode refuses this`,
      "bash scripts/refresh.sh");
  }
  const detail = `last bar ${lastIso}, current; ${dates.length} dated sessions`;
  return isDeclaredSynthetic(root)
    ? check("panel", STATUS.BLOCKED, `${detail} — but this root declares itself SYNTHETIC`,
        "point --root at a real panel; generated noise cannot be a forward record")
    : check("panel", STATUS.OK, detail);
}

/**
 * Key PRESENCE only.
 *
 * Verified 2026-09-28: the analyst reads `process.env.ANTHROPIC_API_KEY` directly and loads no `.env`
 * file anywhere. A scheduler runs with a minimal environment and no login shell, so a key that works in
 * an interactive shell is routinely absent under cron — which is the specific silent failure this
 * check exists to make loud. Presence is not validity; only a real call establishes that, and this
 * module makes none.
 */
export function keyCheck(env = process.env) {
  const k = env.ANTHROPIC_API_KEY;
  if (!k || !k.trim()) {
    return check("model key", STATUS.BLOCKED,
      "ANTHROPIC_API_KEY is not set in this process's environment",
      "export it in the scheduler's wrapper — the analyst reads process.env and loads NO .env file, " +
      "so a key that only lives in .env or your shell profile will be absent under cron");
  }
  return check("model key", STATUS.OK, `present (${k.trim().length} chars); validity NOT checked — that needs a real call`);
}

/** Journal writability and lock state. Reads only: it never takes the lock. */
export function journalCheck(journalFile) {
  const dir = path.dirname(journalFile);
  const exists = fs.existsSync(journalFile);
  const checks = [];

  try {
    fs.accessSync(exists ? journalFile : dir, fs.constants.W_OK);
    checks.push(check("journal", STATUS.OK,
      exists ? `${journalFile} exists and is writable` : `${journalFile} does not exist yet; its directory is writable`));
  } catch {
    checks.push(check("journal", STATUS.BLOCKED, `${journalFile} is not writable`,
      "a scheduled run that cannot append produces no record at all"));
  }

  const held = readLock(journalFile);
  if (!held) {
    checks.push(check("journal lock", STATUS.OK, "not locked"));
  } else if (held.corrupt) {
    checks.push(check("journal lock", STATUS.BLOCKED, `lock file unreadable at ${held.path}`,
      `cat ${held.path}   # inspect before removing; an unparseable lock means something went wrong mid-write`));
  } else {
    const mins = held.ageMs === null ? "unknown" : Math.round(held.ageMs / 60000);
    checks.push(check("journal lock", STATUS.BLOCKED,
      `held by ${held.host} pid ${held.pid} since ${held.acquiredAt} (${mins} min ago)` + (held.stale ? " — STALE" : ""),
      held.stale
        ? `confirm no run is active, then: rm ${lockPathFor(journalFile)}`
        : "wait for that run; if the host is wrong, two machines are writing and the schedule must be fixed"));
  }
  return checks;
}

/**
 * Ledger state. WARN rather than BLOCKED throughout, deliberately: no candidate has been registered
 * yet because no paper decision has ever been made, and a probe that reported BLOCKED on the
 * uninitialised case would be red on day one for a reason that is not a fault.
 */
export function ledgerCheck(candidateId, current, { file } = {}) {
  const opts = file ? [file] : [];
  const chain = verifyLedger(...opts);
  const checks = [];

  checks.push(chain.ok
    ? check("ledger chain", STATUS.OK, `${chain.entries} entr${chain.entries === 1 ? "y" : "ies"}, hash chain intact`)
    : check("ledger chain", STATUS.BLOCKED,
        `chain broken: ${chain.problems.map((p) => `#${p.index} ${p.problem}`).join("; ")}`,
        "an entry was edited, removed or reordered — the ledger is evidence, so investigate before appending"));

  if (!candidateId) return checks;

  const reg = currentVersion(candidateId, ...opts);
  if (!reg) {
    checks.push(check("ledger registration", STATUS.WARN,
      `no version registered for candidate "${candidateId}" (family size ${familySize(...opts)})`,
      "register BEFORE the first decision, or that decision has no pre-registered claim"));
    return checks;
  }
  const drift = current ? driftFromRegistered(candidateId, current, ...opts) : null;
  if (drift && drift.drifted.length) {
    checks.push(check("ledger registration", STATUS.WARN,
      `running config differs from registered ${reg.version} in: ${drift.drifted.join(", ")}`,
      "a prompt, checklist or universe change is a NEW version — register it, or its decisions pool " +
      "into the previous version's evidence"));
  } else {
    checks.push(check("ledger registration", STATUS.OK,
      `${candidateId} ${reg.version}; minimum ${reg.minimumPeriods} periods, MDE ${reg.mdeAtMinimum}; family size ${familySize(...opts)}`));
  }
  return checks;
}

/** Assemble a report. Pure: every input is passed in, nothing is read from a module-level default. */
export function readinessReport({ root, journalFile, candidateId = null, current = null, env = process.env,
                                  loadDates, now = Date.now(), ledgerFile = null }) {
  const checks = [
    panelCheck(root, { loadDates, now }),
    keyCheck(env),
    ...journalCheck(journalFile),
    ...ledgerCheck(candidateId, current, ledgerFile ? { file: ledgerFile } : {}),
  ];
  const blocked = checks.filter((c) => c.status === STATUS.BLOCKED);
  return { checks, blocked, ready: blocked.length === 0 };
}

/** Render for a log a human reads at 3am. Returns lines; printing is the caller's business. */
export function formatReadiness(report) {
  const mark = { [STATUS.OK]: "ok  ", [STATUS.WARN]: "warn", [STATUS.BLOCKED]: "BLOCK" };
  const lines = [];
  for (const c of report.checks) {
    lines.push(`  [${mark[c.status]}] ${c.name.padEnd(20)} ${c.detail}`);
    if (c.fix && c.status !== STATUS.OK) lines.push(`         -> ${c.fix}`);
  }
  lines.push("");
  lines.push(report.ready
    ? "READY: nothing blocks a paper run. This is a readiness check, not a decision — the FIRST paper run is still manual."
    : `NOT READY: ${report.blocked.length} blocking condition(s) above.`);
  return lines;
}
