"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  emptyLedger,
  parseLedger,
  serializeLedger,
  withRecord,
  getRecord,
  trackCodePath,
  appendChangeNote,
  LEDGER_VERSION,
} = require("../../src/core/ledger")

test("emptyLedger: versioned empty map", () => {
  assert.deepEqual(emptyLedger(), { version: LEDGER_VERSION, records: {} })
})

test("parseLedger: round-trips a valid ledger", () => {
  const led = withRecord(emptyLedger(), "src/a.ts", {
    kind: "code",
    reviewedHash: "a1b2c3d4e5f60718",
    verdict: "synced",
    rationale: "ok",
    reviewedAt: "2026-05-31T10:00:00Z",
    by: "agent",
  })
  const parsed = parseLedger(serializeLedger(led))
  assert.deepEqual(parsed, led)
})

test("parseLedger: corruption self-heals to empty (bad JSON)", () => {
  assert.deepEqual(parseLedger("{ not json"), emptyLedger())
})

test("parseLedger: corruption self-heals to empty (wrong shape)", () => {
  assert.deepEqual(parseLedger(JSON.stringify({ version: 1 })), emptyLedger(), "missing records")
  assert.deepEqual(parseLedger(JSON.stringify([1, 2, 3])), emptyLedger(), "array not object")
  assert.deepEqual(parseLedger(""), emptyLedger(), "empty string")
})

test("withRecord: immutable — does not mutate input", () => {
  const a = emptyLedger()
  const b = withRecord(a, "k", { kind: "code", reviewedHash: "x" })
  assert.deepEqual(a.records, {}, "original untouched")
  assert.equal(getRecord(b, "k").reviewedHash, "x")
})

test("trackCodePath: first sighting → reviewedHash null; never clobbers existing", () => {
  let led = trackCodePath(emptyLedger(), "src/a.ts")
  assert.equal(getRecord(led, "src/a.ts").reviewedHash, null)
  assert.equal(getRecord(led, "src/a.ts").kind, "code")

  // simulate it later getting reviewed
  led = withRecord(led, "src/a.ts", { kind: "code", reviewedHash: "deadbeef", verdict: "synced" })
  // capture again must NOT reset reviewedHash
  const after = trackCodePath(led, "src/a.ts")
  assert.equal(getRecord(after, "src/a.ts").reviewedHash, "deadbeef")
})

test("appendChangeNote: creates a tracked record carrying the note (reviewedHash null)", () => {
  const led = appendChangeNote(emptyLedger(), "src/a.ts", { at: "t", summary: "Edit +1/-0", task: "x" }, 3)
  const r = getRecord(led, "src/a.ts")
  assert.equal(r.kind, "code")
  assert.equal(r.reviewedHash, null)
  assert.deepEqual(r.changeNotes, [{ at: "t", summary: "Edit +1/-0", task: "x" }])
})

test("appendChangeNote: appends bounded to the most recent `cap`; never clobbers reviewedHash", () => {
  let led = withRecord(emptyLedger(), "src/a.ts", { kind: "code", reviewedHash: "dead", verdict: "synced" })
  for (const i of [1, 2, 3, 4]) led = appendChangeNote(led, "src/a.ts", { at: `t${i}`, summary: `s${i}`, task: "" }, 2)
  const r = getRecord(led, "src/a.ts")
  assert.equal(r.reviewedHash, "dead", "capture never resets the reviewed hash")
  assert.deepEqual(r.changeNotes.map((n) => n.summary), ["s3", "s4"], "keeps only newest 2")
})

test("appendChangeNote: cap<=0 or falsy note → no-op; input ledger never mutated", () => {
  const base = emptyLedger()
  assert.equal(appendChangeNote(base, "src/a.ts", { summary: "s" }, 0), base, "cap 0 → same ref / no-op")
  assert.equal(appendChangeNote(base, "src/a.ts", null, 3), base, "no note → no-op")
  assert.deepEqual(base.records, {}, "input ledger untouched")
})
