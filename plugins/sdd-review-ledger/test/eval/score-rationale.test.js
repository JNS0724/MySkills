"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { scoreCheckoffLine, scoreTodo, aggregate, evidenceQuote } = require("./score-rationale")
const { REVIEWED_HEADING, PENDING_HEADING } = require("../../src/core/todo")

const SAMPLE = [
  "只在「待评审」区把已完成评审的行原地从 [ ] 改为 [x]。",
  "",
  PENDING_HEADING,
  "- [ ] src/pending.ts@ffff  (候选: x)",
  "",
  REVIEWED_HEADING,
  "- [x] src/greet.ts@aaaa — greet.ts 按时段返回，已对照 design 无冲突",
  "- [x] src/util.ts@bbbb — ok",
  "- [x] sdd/changes/x/design.md@cccc — 已同步",
].join("\n")

test("scoreCheckoffLine: parses a [x] line into syntactic facts; ignores [ ] and prose", () => {
  const s = scoreCheckoffLine("- [x] src/greet.ts@aaaa — greet.ts 已对照 design 无冲突")
  assert.equal(s.path, "src/greet.ts")
  assert.equal(s.hash, "aaaa")
  assert.equal(s.thin, false)
  assert.equal(s.refsPath, true, "rationale names the basename")
  assert.equal(scoreCheckoffLine("- [ ] src/p.ts@ffff"), null, "pending line is not a checkoff")
  assert.equal(scoreCheckoffLine("just prose"), null)
})

test("scoreTodo + aggregate: scorecard over all checkoffs", () => {
  const scores = scoreTodo(SAMPLE)
  assert.equal(scores.length, 3, "three [x] checkoffs; the [ ] pending line is excluded")
  const card = aggregate(scores)
  assert.equal(card.checkoffs, 3)
  assert.equal(card.thin, 1, "'ok' is thin; the other two are substantive")
  assert.equal(card.refsPath, 1, "only the greet.ts rationale names its basename")
  assert.equal(card.thinPct, Math.round((1 / 3) * 1000) / 10)
})

test("aggregate: empty → zeros, no divide-by-zero", () => {
  assert.deepEqual(aggregate([]), { checkoffs: 0, thin: 0, refsPath: 0, thinPct: 0, refsPathPct: 0 })
})

test("evidenceQuote: literal substring of file content only (no fuzzy match)", () => {
  const file = "export function greet(hour) { return hour < 12 ? 'morning' : 'afternoon' }"
  assert.equal(evidenceQuote("理由：code 写了 return hour < 12 ? 这一分支", file), true)
  assert.equal(evidenceQuote("大意是按时段返回", file), false, "paraphrase is not a literal quote")
  assert.equal(evidenceQuote("short", file), false)
})

// MECHANICAL-ONLY guard: the offline scorer must never leak into the product.
test("guard: nothing under src/ imports the offline scorer", () => {
  const srcDir = path.join(__dirname, "..", "..", "src")
  const walk = (dir) => {
    const out = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...walk(fp))
      else if (e.name.endsWith(".js")) out.push(fp)
    }
    return out
  }
  for (const f of walk(srcDir)) {
    assert.ok(!fs.readFileSync(f, "utf8").includes("score-rationale"), `${f} must not import the eval scorer`)
  }
})
