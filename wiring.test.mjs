/**
 * The two wiring defects: the analyst read a different bundle than the panel collector wrote, and
 * the news collector enumerated a different universe than the panel it was meant to cover.
 *
 * Both were configuration mismatches between files that each looked correct alone, which is why the
 * suite was green through them. These tests assert the OBSERVABLE behaviour — which root a command
 * reports, what it does when that root is missing, and which universe the collector picks — rather
 * than the values of the constants, so a future edit that reintroduces the mismatch fails here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUniverseSource, parseSymbolFile } from "./universe.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(REPO, "analyst-run.mjs");
const tmpJournal = () => path.join(mkdtempSync(path.join(tmpdir(), "wiring-")), "j.jsonl");

/** Run analyst-run.mjs; never throws, because the exit code is part of what is under test. */
function run(...args) {
  try {
    const stdout = execFileSync("node", [RUN, ...args], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

// ---- fix 1: the reader root follows the mode, and paper fails closed ---------------------------

test("paper mode reads the current IBKR panel, not the research bundle", () => {
  // The defect: paper read sp500-bundle, whose last bar is months old, while scripts/ibkr-panel.mjs
  // wrote ibkr-bundle. A full refresh landed in a directory nothing read, and paper then refused as
  // stale with the fresh data sitting beside it.
  const r = run("paper", "--journal", tmpJournal());

  assert.equal(r.status, 3, "a missing current panel must exit non-zero, not fall back");
  const out = r.stdout + r.stderr;
  assert.match(out, /no panel at "ibkr-bundle"/);
  assert.ok(!/panel: sp500-bundle/.test(out), "paper must never silently read the research bundle");
});

test("the fail-closed message names the command that fixes it", () => {
  // A guard nobody can act on gets worked around. This one has to say where the data comes from.
  const out = (({ stdout, stderr }) => stdout + stderr)(run("paper", "--journal", tmpJournal()));
  assert.match(out, /refresh\.sh/);
  assert.match(out, /will not fall back to historical data/);
});

test("dry-run still reads the research bundle, so historical access is preserved", () => {
  const r = run("dry-run", "--stub", "--asOf", "880", "--journal", tmpJournal());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /panel: sp500-bundle/);
});

test("settle follows its --mode rather than the subcommand", () => {
  // Settling a paper decision against a different panel looks its entry bar up in a series that
  // never contained it, so every batch would report an unknown bar and nothing would ever settle.
  const paper = run("settle", "--mode", "paper", "--journal", tmpJournal());
  assert.equal(paper.status, 3);
  assert.match(paper.stdout + paper.stderr, /no panel at "ibkr-bundle"/);

  const dry = run("settle", "--mode", "dry-run", "--journal", tmpJournal());
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /settle mode "dry-run"/);
});

test("--root still overrides, in either direction", () => {
  const r = run("dry-run", "--stub", "--asOf", "880", "--root", "sp500-bundle", "--journal", tmpJournal());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /panel: sp500-bundle/);

  // And an explicit nonsense root fails closed rather than falling back to a default.
  const bad = run("dry-run", "--stub", "--root", "no-such-bundle", "--journal", tmpJournal());
  assert.equal(bad.status, 3);
  assert.match(bad.stdout + bad.stderr, /no panel at "no-such-bundle"/);
});

test("the run reports which panel it used", () => {
  // Otherwise the only way to know which universe a journalled decision was made against is to
  // reconstruct the defaults in force on the day.
  const r = run("dry-run", "--stub", "--asOf", "880", "--journal", tmpJournal());
  assert.match(r.stdout, /^panel: \S+, \d+ symbols/m);
});

// ---- fix 2: the collector covers the panel's universe ------------------------------------------

/** A sandbox holding whichever universe files a case needs. */
function sandbox(files) {
  const root = mkdtempSync(path.join(tmpdir(), "universe-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return {
    root,
    resolved: path.join(root, "ibkr-bundle", "universe-resolved.txt"),
    candidates: path.join(root, "universe", "candidates.txt"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("the verified universe wins when a previous panel pull has written one", () => {
  const sb = sandbox({
    "ibkr-bundle/universe-resolved.txt": "AAA BBB CCC\n",
    "universe/candidates.txt": "AAA BBB CCC DDD EEE\n",
  });
  try {
    const r = resolveUniverseSource({ resolvedFile: sb.resolved, candidatesFile: sb.candidates });
    assert.deepEqual(r.symbols, ["AAA", "BBB", "CCC"]);
    assert.equal(r.verified, true);
    assert.match(r.source, /IBKR-verified/);
  } finally { sb.cleanup(); }
});

test("on a FIRST refresh there is no verified list, so the candidate universe is used", () => {
  // This is the case the defect made impossible: the panel stage has not run, so nothing has been
  // verified, and enumerating a bundle would have given the wrong 128 names.
  const sb = sandbox({ "universe/candidates.txt": "# a comment\nAAA BBB\nCCC, DDD\n\n" });
  try {
    const r = resolveUniverseSource({ resolvedFile: sb.resolved, candidatesFile: sb.candidates });
    assert.deepEqual(r.symbols, ["AAA", "BBB", "CCC", "DDD"]);
    assert.equal(r.verified, false, "the caller must be able to expect resolution failures");
    assert.match(r.source, /UNVERIFIED/);
  } finally { sb.cleanup(); }
});

test("an explicit --symbols file beats both", () => {
  const sb = sandbox({
    "explicit.txt": "ZZZ\n",
    "ibkr-bundle/universe-resolved.txt": "AAA\n",
    "universe/candidates.txt": "BBB\n",
  });
  try {
    const r = resolveUniverseSource({
      symbolsFile: path.join(sb.root, "explicit.txt"),
      resolvedFile: sb.resolved, candidatesFile: sb.candidates,
    });
    assert.deepEqual(r.symbols, ["ZZZ"]);
    assert.equal(r.verified, null, "an explicit list makes no claim about verification");
  } finally { sb.cleanup(); }
});

test("with no universe file at all it falls back to the bundle, as it used to", () => {
  const sb = sandbox({});
  try {
    const r = resolveUniverseSource({
      resolvedFile: sb.resolved, candidatesFile: sb.candidates,
      bundleRoot: "sp500-bundle", fromBundle: () => ["AAPL", "MSFT"],
    });
    assert.deepEqual(r.symbols, ["AAPL", "MSFT"]);
    assert.match(r.source, /candle bundle/);
  } finally { sb.cleanup(); }
});

test("with no source and no bundle reader it throws rather than returning an empty universe", () => {
  // An empty universe would collect nothing, report success, and leave news at zero coverage.
  const sb = sandbox({});
  try {
    assert.throws(
      () => resolveUniverseSource({ resolvedFile: sb.resolved, candidatesFile: sb.candidates }),
      /no symbol source/,
    );
  } finally { sb.cleanup(); }
});

test("the shared parser strips comments, splits on commas and whitespace, and dedupes", () => {
  assert.deepEqual(parseSymbolFile("aaa BBB\n# skip\nCCC, aaa\n\n  ddd  "),
                   ["AAA", "BBB", "CCC", "DDD"]);
  assert.deepEqual(parseSymbolFile("AAA # trailing comment\n"), ["AAA"]);
  assert.deepEqual(parseSymbolFile(""), []);
});

test("the shared parser applies the panel puller's shape filter, not a looser one", () => {
  // The first version of this claimed the collector and the panel puller shared a parser while the
  // puller still had its own, and the two disagreed: the puller filtered on a ticker shape and
  // sorted, this did neither. That is precisely the divergence the sharing was supposed to close,
  // so the strict rules are the shared ones.
  assert.deepEqual(parseSymbolFile("AAA toolongtickername B@D 123 BBB"), ["AAA", "BBB"]);
  assert.deepEqual(parseSymbolFile("BRK.B RDS-A"), ["BRK.B", "RDS-A"], "dots and hyphens are real tickers");
  assert.deepEqual(parseSymbolFile("ZZZ AAA MMM"), ["AAA", "MMM", "ZZZ"], "sorted, as the puller expected");
});

test("a heading in a universe file contributes no tickers", () => {
  // The scar: "# Semis and memory" contributed SEMIS, AND and MEMORY as tickers, which then showed
  // up as unresolvable names in a report that also listed genuine delistings.
  assert.deepEqual(parseSymbolFile("# ---- Semis and memory ----\nNVDA AMD\n"), ["AMD", "NVDA"]);
});

test("the real candidate universe parses to the count the repo claims", () => {
  // Guards against a stray edit to candidates.txt silently shrinking the universe.
  const r = resolveUniverseSource({
    resolvedFile: path.join(REPO, "does-not-exist.txt"),
    candidatesFile: path.join(REPO, "universe", "candidates.txt"),
  });
  assert.equal(r.symbols.length, 1047);
  assert.equal(r.verified, false);
});
