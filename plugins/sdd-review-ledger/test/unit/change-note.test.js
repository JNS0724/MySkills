"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { buildChangeSummary, buildChangeNote, SUMMARY_MAX } = require("../../src/core/change-note")

test("buildChangeSummary: Edit → ±line counts + first-line snippet", () => {
  const s = buildChangeSummary("Edit", { old_string: "a\nb", new_string: "x\ny\nz" })
  assert.match(s, /^Edit \+3\/-2/)
  assert.match(s, /«x»/)
})

test("buildChangeSummary: Write (content, no new_string) → line count", () => {
  const s = buildChangeSummary("Write", { content: "l1\nl2\nl3" })
  assert.match(s, /^Write \(3 行\)/)
  assert.match(s, /«l1»/)
})

test("buildChangeSummary: MultiEdit aggregates all edits", () => {
  const s = buildChangeSummary("MultiEdit", {
    edits: [
      { old_string: "a", new_string: "b\nc" },
      { old_string: "", new_string: "d" },
    ],
  })
  assert.match(s, /^MultiEdit ×2 \+3\/-1/)
})

test("buildChangeSummary: shape-driven (ignores tool-name casing/alias)", () => {
  // edits[] present → treated as MultiEdit regardless of the name string
  assert.match(buildChangeSummary("apply_patch", { edits: [{ new_string: "x" }] }), /^MultiEdit ×1/)
})

test("buildChangeSummary: strips control chars and bounds length", () => {
  const s = buildChangeSummary("Edit", { new_string: "evil‮spoof\nrest" })
  assert.ok(!/[‮]/.test(s), "control/bidi chars removed")
  assert.ok(s.length <= SUMMARY_MAX)
})

test("buildChangeNote: carries at + sanitized task; summary derived from payload", () => {
  const n = buildChangeNote({
    toolName: "Edit",
    toolInput: { new_string: "const x = 1" },
    task: "实现问候功能",
    now: "2026-06-02T00:00:00Z",
  })
  assert.equal(n.at, "2026-06-02T00:00:00Z")
  assert.equal(n.task, "实现问候功能")
  assert.match(n.summary, /^Edit \+1\/-0/)
})

test("buildChangeNote: empty/missing input is safe", () => {
  const n = buildChangeNote({})
  assert.equal(n.task, "")
  assert.equal(n.at, "")
  assert.match(n.summary, /^Edit \+0\/-0/)
})
