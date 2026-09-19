import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSector, parseSectorMap, applySectorMap, GICS_SECTORS } from "./sector-map.mjs";

const envelope = (sectors, over = {}) => ({
  scheme: "GICS", source: "test fixture", asOf: "2026-09-18", sectors, ...over,
});

test("canonicalSector accepts transcription noise and rejects other schemes", () => {
  assert.equal(canonicalSector("Health Care"), "Health Care");
  assert.equal(canonicalSector("health care"), "Health Care");
  assert.equal(canonicalSector("HEALTHCARE"), "Health Care");
  assert.equal(canonicalSector("Health-Care"), "Health Care");
  // IBKR's own vocabulary is not GICS and must not be silently coerced into it.
  assert.equal(canonicalSector("Technology"), null);
  assert.equal(canonicalSector("Consumer, Cyclical"), null);
  assert.equal(canonicalSector(""), null);
  assert.equal(canonicalSector(undefined), null);
});

test("every GICS sector round-trips through canonicalSector", () => {
  for (const s of GICS_SECTORS) assert.equal(canonicalSector(s), s);
});

test("a map without provenance is refused", () => {
  // The whole point of the envelope: a study must not run on labels of unrecorded origin.
  assert.throws(() => parseSectorMap({ scheme: "GICS", asOf: "2026-09-18", sectors: {} }), /source/);
  assert.throws(() => parseSectorMap({ scheme: "GICS", source: "x", sectors: {} }), /asOf/);
  assert.throws(() => parseSectorMap({ scheme: "GICS", source: "x", asOf: "09/18/26", sectors: {} }), /asOf/);
  assert.throws(() => parseSectorMap({ source: "x", asOf: "2026-09-18", sectors: {} }), /scheme/);
  assert.throws(() => parseSectorMap({ scheme: "MSCI", source: "x", asOf: "2026-09-18", sectors: {} }), /scheme/);
});

test("GICS scheme rejects a label outside the eleven rather than bucketing it", () => {
  assert.throws(
    () => parseSectorMap(envelope({ AAPL: "Information Technology", XYZ: "Technology" })),
    /not one of the GICS 11/,
  );
});

test("a non-GICS scheme keeps its own vocabulary", () => {
  const m = parseSectorMap(envelope(
    { AAPL: "Technology", JPM: "Financial", F: "Consumer, Cyclical" },
    { scheme: "IBKR-industry" },
  ));
  assert.equal(m.map.get("AAPL"), "Technology");
  assert.equal(m.map.get("F"), "Consumer, Cyclical");
  assert.equal(m.scheme, "IBKR-industry");
});

test("a non-GICS scheme still rejects empty labels", () => {
  assert.throws(
    () => parseSectorMap(envelope({ AAPL: "Technology", JPM: "   " }, { scheme: "IBKR-industry" })),
    /empty or not strings/,
  );
});

test("symbols are keyed case-insensitively", () => {
  const m = parseSectorMap(envelope({ aapl: "Information Technology" }));
  assert.equal(m.map.get("AAPL"), "Information Technology");
});

test("applySectorMap drops uncovered names instead of inventing a bucket for them", () => {
  const { map } = parseSectorMap(envelope({
    A: "Energy", B: "Energy", C: "Energy", D: "Utilities", E: "Utilities", F: "Utilities",
  }));
  const r = applySectorMap(["A", "B", "C", "D", "E", "F", "ZZZ"], map);
  assert.deepEqual(r.uncovered, ["ZZZ"]);
  assert.equal(r.kept.length, 6);
  assert.ok(!r.kept.includes("ZZZ"));
  // No "Other"/"Unknown" group is created -- that would be a fake sector whose only shared
  // property is that the vendor did not classify its members.
  assert.ok(![...r.bySector.keys()].some((k) => /other|unknown/i.test(k)));
});

test("a sector too thin to neutralise is dropped whole and counted", () => {
  // A one-name sector's residual against its own sector index is identically zero, which would
  // hand that name a meaningless z-score and let it rank anywhere.
  const { map } = parseSectorMap(envelope({
    A: "Energy", B: "Energy", C: "Energy", D: "Utilities",
  }));
  const r = applySectorMap(["A", "B", "C", "D"], map, { minPerSector: 3 });
  assert.deepEqual(r.thin, [["Utilities", 1]]);
  assert.deepEqual(r.kept.sort(), ["A", "B", "C"]);
  assert.ok(!r.bySector.has("Utilities"));
});

test("minPerSector is respected at the boundary", () => {
  const { map } = parseSectorMap(envelope({ A: "Energy", B: "Energy", C: "Energy" }));
  assert.equal(applySectorMap(["A", "B", "C"], map, { minPerSector: 3 }).kept.length, 3);
  assert.equal(applySectorMap(["A", "B", "C"], map, { minPerSector: 4 }).kept.length, 0);
});

test("bySector partitions kept exactly once each", () => {
  const { map } = parseSectorMap(envelope({
    A: "Energy", B: "Energy", C: "Energy", D: "Utilities", E: "Utilities", F: "Utilities",
  }));
  const r = applySectorMap(["A", "B", "C", "D", "E", "F"], map);
  const flat = [...r.bySector.values()].flat();
  assert.equal(flat.length, r.kept.length);
  assert.equal(new Set(flat).size, flat.length);
});
