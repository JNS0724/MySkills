"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  ingestCheckoffs,
  labelFromRationale,
  passesRationaleGate,
  rationaleStats,
} = require("../../src/core/ingest")
const { emptyLedger, getRecord } = require("../../src/core/ledger")

const NOW = "2026-05-31T12:00:00Z"

test("ingestCheckoffs: checked entry → verdict pinned to INLINE hash (§5.3)", () => {
  const entries = [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "无需改" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent")
  const rec = getRecord(led, "src/a.ts")
  assert.equal(rec.reviewedHash, "H1", "pinned to inline hash, not current")
  assert.equal(rec.reviewedAt, NOW)
  assert.equal(rec.by, "agent")
})

test("ingestCheckoffs: unchecked entries never clear (checkoff-only, §8.2)", () => {
  const entries = [{ checked: false, path: "src/a.ts", inlineHash: "H1", rationale: "" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent")
  assert.equal(getRecord(led, "src/a.ts"), undefined, "no record written for unchecked")
})

test("ingestCheckoffs: non-tracked paths (other) ignored", () => {
  const entries = [{ checked: true, path: "package-lock.json", inlineHash: "H1", rationale: "x" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent")
  assert.equal(getRecord(led, "package-lock.json"), undefined)
})

test("ingestCheckoffs: idempotent on repeated identical checkoff", () => {
  const entries = [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "ok" }]
  const once = ingestCheckoffs(emptyLedger(), entries, NOW, "agent")
  const twice = ingestCheckoffs(once, entries, NOW, "agent")
  assert.deepEqual(once.records, twice.records)
})

test("ingestCheckoffs: immutable — input ledger untouched", () => {
  const before = emptyLedger()
  ingestCheckoffs(before, [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "ok" }], NOW, "agent")
  assert.deepEqual(before.records, {})
})

test("ingestCheckoffs: classifies kind for sdd-doc vs code", () => {
  const entries = [
    { checked: true, path: "sdd/changes/x/design.md", inlineHash: "D1", rationale: "synced" },
    { checked: true, path: "src/a.ts", inlineHash: "C1", rationale: "无关" },
  ]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "user")
  assert.equal(getRecord(led, "sdd/changes/x/design.md").kind, "sdd-doc")
  assert.equal(getRecord(led, "src/a.ts").kind, "code")
})

test("labelFromRationale: coarse display tags, default reviewed", () => {
  assert.equal(labelFromRationale("无关 hotfix"), "unrelated")
  assert.equal(labelFromRationale("仅 gofmt"), "no-change")
  assert.equal(labelFromRationale("已同步 design"), "synced")
  assert.equal(labelFromRationale("looked at it"), "reviewed")
})

// ─── Tier 0 counter: onCheckoff callback (no return-type change) ───
test("ingestCheckoffs: onCheckoff fires once per checked TRACKED entry with syntactic stats", () => {
  const entries = [
    { checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "" },
    { checked: false, path: "src/b.ts", inlineHash: "H2", rationale: "x" }, // unchecked → skip
    { checked: true, path: "package-lock.json", inlineHash: "H3", rationale: "ok" }, // other → skip
    { checked: true, path: "src/c.ts", inlineHash: "H4", rationale: "c.ts 已对照 design 无冲突" },
  ]
  const seen = []
  ingestCheckoffs(emptyLedger(), entries, NOW, "agent", { onCheckoff: (s) => seen.push(s) })
  assert.deepEqual(seen.map((s) => s.path), ["src/a.ts", "src/c.ts"], "only checked tracked entries")
  assert.equal(seen[0].thin, true, "empty rationale is thin")
  assert.equal(seen[1].thin, false, "substantive rationale is not thin")
  assert.equal(seen[1].refsPath, true, "names the basename c.ts")
})

test("ingestCheckoffs: onCheckoff does NOT change the return type (still a bare ledger)", () => {
  const entries = [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "looked at it carefully" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent", { onCheckoff: () => {} })
  assert.ok(led.records, "return value is a ledger (has .records)")
  assert.equal(getRecord(led, "src/a.ts").reviewedHash, "H1")
})

// ─── Tier 1 gate: min-length withholds the clear; gate OFF = backward compatible ───
test("ingestCheckoffs: gate ON withholds the clear for a too-short rationale (stays pending)", () => {
  const entries = [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "ok" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent", { gateOn: true, minChars: 8 })
  assert.equal(getRecord(led, "src/a.ts"), undefined, "short rationale → no record written → still pending")
})

test("ingestCheckoffs: gate ON clears when the rationale meets the min length", () => {
  const entries = [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "经对照无冲突，纯格式化" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent", { gateOn: true, minChars: 8 })
  assert.equal(getRecord(led, "src/a.ts").reviewedHash, "H1", "long-enough evidence-bearing rationale clears")
})

test("ingestCheckoffs: gate OFF (default, no opts) clears regardless of length (backward compat)", () => {
  const entries = [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "ok" }]
  const led = ingestCheckoffs(emptyLedger(), entries, NOW, "agent")
  assert.equal(getRecord(led, "src/a.ts").reviewedHash, "H1")
})

test("ingestCheckoffs: onCheckoff reports held=true for a gated-out entry", () => {
  const seen = []
  ingestCheckoffs(
    emptyLedger(),
    [{ checked: true, path: "src/a.ts", inlineHash: "H1", rationale: "ok" }],
    NOW,
    "agent",
    { gateOn: true, minChars: 8, onCheckoff: (s) => seen.push(s) }
  )
  assert.equal(seen[0].held, true)
})

test("passesRationaleGate: MIN-LENGTH only (no blocklist), fail-open", () => {
  assert.equal(passesRationaleGate("ok", 8), false)
  assert.equal(passesRationaleGate("", 8), false)
  assert.equal(passesRationaleGate("经对照无冲突，纯格式化", 8), true, "evidence-bearing '无关/格式化' clears, not blocklisted")
  assert.equal(passesRationaleGate("anything", 0), true, "minChars 0 → always passes")
})

test("rationaleStats: thin reuses isThinRationale; refsPath is a basename substring test", () => {
  assert.equal(rationaleStats("greet.ts 仅格式化", "src/greet.ts").refsPath, true)
  assert.equal(rationaleStats("纯格式化", "src/greet.ts").refsPath, false)
  assert.equal(rationaleStats("无关", "src/greet.ts").thin, true)
})
