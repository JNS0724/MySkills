"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  computeNeedsReview,
  selectActiveNeeds,
  selectReviewLeftover,
  pendingKeys,
} = require("../../src/core/compute")
const { hashElement } = require("../../src/core/hash")
const { emptyLedger, withRecord } = require("../../src/core/ledger")

const mkRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), "sdd-compute-"))
const write = (root, rel, content) => {
  const fp = path.join(root, rel)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, content)
}
const baselineFor = (root, rel, ledger) =>
  withRecord(ledger, rel, {
    kind: rel.endsWith(".md") ? "sdd-doc" : "code",
    reviewedHash: hashElement(path.join(root, rel)),
    verdict: "reviewed",
    rationale: "baseline",
    reviewedAt: "2026-05-31T00:00:00Z",
    by: "user",
  })
const paths = (res) => res.items.map((i) => i.path).sort()

test("Layer A: changed doc surfaces as needs-review (never-reviewed)", () => {
  const root = mkRepo()
  try {
    write(root, "sdd/changes/greeting/design.md", "# v1")
    const res = computeNeedsReview(root, emptyLedger())
    assert.deepEqual(paths(res), ["sdd/changes/greeting/design.md"])
    assert.equal(res.items[0].kind, "sdd-doc")
    assert.equal(res.items[0].reason, "never-reviewed")
    assert.deepEqual(res.items[0].candidates, ["sdd/changes/greeting"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Layer A: doc at baseline does NOT surface; edit → changed-since-review", () => {
  const root = mkRepo()
  try {
    write(root, "sdd/changes/g/design.md", "# v1")
    const led = baselineFor(root, "sdd/changes/g/design.md", emptyLedger())
    assert.equal(computeNeedsReview(root, led).items.length, 0, "at baseline = clean")
    write(root, "sdd/changes/g/design.md", "# v2 edited")
    const res = computeNeedsReview(root, led)
    assert.deepEqual(paths(res), ["sdd/changes/g/design.md"])
    assert.equal(res.items[0].reason, "changed-since-review")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Layer B: code file surfaces via scan even with empty ledger (no capture)", () => {
  const root = mkRepo()
  try {
    write(root, "src/greet.ts", "export const x = 1")
    const res = computeNeedsReview(root, emptyLedger())
    assert.deepEqual(paths(res), ["src/greet.ts"])
    assert.equal(res.items[0].kind, "code")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Layer B: code at baseline clean; content edit surfaces it again", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    const led = baselineFor(root, "src/a.ts", emptyLedger())
    assert.equal(computeNeedsReview(root, led).items.length, 0)
    write(root, "src/a.ts", "v2")
    assert.deepEqual(paths(computeNeedsReview(root, led)), ["src/a.ts"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("determinism: same (working tree, ledger) → identical output across runs", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "1")
    write(root, "sdd/changes/g/tasks.md", "- t")
    const led = emptyLedger()
    const r1 = computeNeedsReview(root, led)
    const r2 = computeNeedsReview(root, led)
    assert.deepEqual(r1, r2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("deleted file does not surface and does not throw", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "1")
    const led = baselineFor(root, "src/a.ts", emptyLedger())
    fs.rmSync(path.join(root, "src/a.ts"))
    const res = computeNeedsReview(root, led)
    assert.equal(res.items.length, 0, "missing file is skipped, not reported")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// R1 CORE REGRESSION: commit-invariance. The whole reason for dropping git.
// A missed-capture file must keep surfacing regardless of git commit state,
// because compute is a pure function of the working tree (NOT git refs).
// ─────────────────────────────────────────────────────────────────────────────
test("R1 commit-invariance: missed-capture code surfaces, and STILL surfaces after a git commit", () => {
  const root = mkRepo()
  try {
    // "subagent/shell wrote X without capture" — never entered into the ledger
    write(root, "src/sneaky.ts", "export const y = 2")
    const before = computeNeedsReview(root, emptyLedger())
    assert.ok(paths(before).includes("src/sneaky.ts"), "surfaces pre-commit")

    // Simulate a git commit: working-tree bytes unchanged, ledger unchanged.
    // We don't even need a real git repo — compute must not consult git at all.
    const after = computeNeedsReview(root, emptyLedger())
    assert.deepEqual(after, before, "IDENTICAL after 'commit' — git plays no role (v0.1 git version would drop it)")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("R1: works with no .git directory at all", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "1")
    assert.equal(fs.existsSync(path.join(root, ".git")), false)
    assert.deepEqual(paths(computeNeedsReview(root, emptyLedger())), ["src/a.ts"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// §12.4 误报对账 (false-positive reconciliation): "no semantic drift" edits must
// not produce HARMFUL wrong conclusions — only benign "please review" items that
// a one-line checkoff clears. The tool never declares synced/aligned on its own.
// ─────────────────────────────────────────────────────────────────────────────
test("误报对账: gofmt-style reformat surfaces benignly (not a harmful verdict)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "const x=1")
    const led = baselineFor(root, "src/a.ts", emptyLedger())
    assert.equal(computeNeedsReview(root, led).items.length, 0, "clean at baseline")
    // reformat (bytes change, behavior identical)
    write(root, "src/a.ts", "const x = 1\n")
    const res = computeNeedsReview(root, led)
    // It surfaces (benign) — but only as a needs-review item, never as "drift/aligned".
    assert.deepEqual(paths(res), ["src/a.ts"])
    assert.equal(res.items[0].reason, "changed-since-review")
    assert.ok(!("verdict" in res.items[0]), "tool emits no verdict; that is the LLM's job")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("误报对账: editing one file in a multi-file repo surfaces ONLY that file", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "1")
    write(root, "src/b.ts", "2")
    write(root, "src/c.ts", "3")
    let led = emptyLedger()
    for (const f of ["src/a.ts", "src/b.ts", "src/c.ts"]) led = baselineFor(root, f, led)
    assert.equal(computeNeedsReview(root, led).items.length, 0, "all at baseline")
    write(root, "src/b.ts", "2 changed")
    assert.deepEqual(paths(computeNeedsReview(root, led)), ["src/b.ts"], "no over-reporting")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 改进 B（文档领先代码 = 计划，不是 build order）: the ACTIVE channel is driven only
// by code changes; doc changes (design/tasks/proposal ahead of code) stay PASSIVE —
// recorded in the todo, never an active nag. The split is mechanical (by item.kind,
// i.e. classifyPath), so the tool still makes no semantic judgement (§2).
// ─────────────────────────────────────────────────────────────────────────────
test("selectActiveNeeds: only code items drive the active channel; docs stay passive", () => {
  const items = [
    { path: "sdd/changes/g/design.md", kind: "sdd-doc" },
    { path: "src/a.ts", kind: "code" },
    { path: "sdd/changes/g/tasks.md", kind: "sdd-doc" },
  ]
  assert.deepEqual(
    selectActiveNeeds(items).map((i) => i.path),
    ["src/a.ts"],
    "code is the only active-channel material"
  )
  assert.deepEqual(
    selectActiveNeeds([{ path: "sdd/changes/g/design.md", kind: "sdd-doc" }]),
    [],
    "doc-only (docs ahead of code) → empty active set → no active nag"
  )
  assert.deepEqual(selectActiveNeeds([]), [])
  assert.deepEqual(selectActiveNeeds(undefined), [])
})

// ─────────────────────────────────────────────────────────────────────────────
// T2 折中信号（同回合状态差集）: a pending is "review-induced" iff its path@hash was
// NOT present in the snapshot taken when the active review fired. This isolates the
// model's own post-review edits from pre-existing pending and from unfinished items.
// ─────────────────────────────────────────────────────────────────────────────
test("pendingKeys: sorted path@hash keys for the review-time snapshot", () => {
  assert.deepEqual(
    pendingKeys([
      { path: "src/b.ts", currentHash: "h2" },
      { path: "src/a.ts", currentHash: "h1" },
    ]),
    ["src/a.ts@h1", "src/b.ts@h2"]
  )
  assert.deepEqual(pendingKeys([]), [])
  assert.deepEqual(pendingKeys(undefined), [])
})

test("selectReviewLeftover: only needs whose path@hash is absent from the review-time snapshot", () => {
  const needs = [
    { path: "src/a.ts", kind: "code", currentHash: "h1" }, // was pending at review time
    { path: "sdd/changes/g/tasks.md", kind: "sdd-doc", currentHash: "hT2" }, // edited AFTER review → new hash
    { path: "sdd/changes/g/design.md", kind: "sdd-doc", currentHash: "hOld" }, // pre-existing, untouched
  ]
  const baseline = ["src/a.ts@h1", "sdd/changes/g/design.md@hOld"]
  assert.deepEqual(
    selectReviewLeftover(needs, baseline).map((i) => i.path),
    ["sdd/changes/g/tasks.md"],
    "only the post-review path@hash counts as review-induced; pre-existing stays out"
  )
  assert.deepEqual(
    selectReviewLeftover(needs, []).map((i) => i.path).sort(),
    ["sdd/changes/g/design.md", "sdd/changes/g/tasks.md", "src/a.ts"],
    "empty snapshot → everything is 'new'"
  )
  assert.deepEqual(selectReviewLeftover([], baseline), [])
  assert.deepEqual(selectReviewLeftover(undefined, baseline), [])
})

// 变更线索 (feature 2026-06-02): compute threads a record's changeNotes onto its item.
test("computeNeedsReview: a surfaced code item carries the record's changeNotes as clues", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v2")
    const led = withRecord(emptyLedger(), "src/a.ts", {
      kind: "code",
      reviewedHash: "oldhash", // ≠ current → surfaces
      verdict: "synced",
      changeNotes: [{ at: "t", summary: "Edit +1/-0", task: "do X" }],
    })
    const item = computeNeedsReview(root, led).items.find((i) => i.path === "src/a.ts")
    assert.ok(item, "a.ts surfaces (changed since review)")
    assert.deepEqual(item.notes, [{ at: "t", summary: "Edit +1/-0", task: "do X" }])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("computeNeedsReview: item has NO notes key when the record has none (byte-identical shape)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    const item = computeNeedsReview(root, emptyLedger()).items.find((i) => i.path === "src/a.ts")
    assert.ok(item)
    assert.ok(!("notes" in item), "absent notes → no key")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
