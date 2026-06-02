"use strict"

const fs = require("fs")
const { TODO_LINE, THIN_MARK } = require("../../src/core/todo")
const { rationaleStats } = require("../../src/core/ingest")

// Offline rationale-quality scorer (feature 2026-06-02, Tier 0b). The go/no-go ORACLE
// for the prompt/gate levers: replay a final .sdd-review-todo.md (and, optionally, the
// real file contents) and turn each `- [x]` checkoff into objective, reproducible facts.
//
// IMPORTANT — this lives ONLY in the test harness and is NEVER imported by src/. The one
// "semantic-ish" signal (evidenceQuote) is a LITERAL substring match, done offline, so the
// product stays mechanical (answers only hash≠reviewedHash). A unit test guards that src/
// never requires this file. Reuses isThinRationale (via rationaleStats) so the offline
// "thin" definition is byte-identical to the product's.

const stripMark = (s) => String(s == null ? "" : s).split(THIN_MARK).join("").trim()

// scoreCheckoffLine(line) -> { path, hash, rationale, thin, len, refsPath } | null
// null when the line is not a checked ([x]) todo line.
const scoreCheckoffLine = (line) => {
  const m = TODO_LINE.exec(String(line == null ? "" : line))
  if (!m || m[1] !== "x") return null
  const filePath = m[2]
  const rationale = stripMark(m[4] || "")
  const { thin, len, refsPath } = rationaleStats(rationale, filePath)
  return { path: filePath, hash: m[3], rationale, thin, len, refsPath }
}

// scoreTodo(text) -> per-checkoff scores for every [x] line (audit section in practice).
const scoreTodo = (todoText) => {
  const scores = []
  for (const line of String(todoText == null ? "" : todoText).split(/\r?\n/)) {
    const s = scoreCheckoffLine(line)
    if (s) scores.push(s)
  }
  return scores
}

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0)

// aggregate(scores) -> a comparable scorecard for one (model × scenario × prompt-variant).
const aggregate = (scores) => {
  const total = scores.length
  const thin = scores.filter((s) => s.thin).length
  const refsPath = scores.filter((s) => s.refsPath).length
  return { checkoffs: total, thin, refsPath, thinPct: pct(thin, total), refsPathPct: pct(refsPath, total) }
}

// evidenceQuote: does the rationale contain a LITERAL >=minLen substring of the file's
// content? Literal only — no fuzzy/semantic similarity — so the harness can never become
// a semantic judge. Returns false for short inputs.
const evidenceQuote = (rationale, fileContent, minLen = 12) => {
  if (minLen <= 0) return false // an empty substring trivially matches → not a quote
  const r = String(rationale == null ? "" : rationale)
  const c = String(fileContent == null ? "" : fileContent)
  if (r.length < minLen || c.length < minLen) return false
  for (let i = 0; i + minLen <= r.length; i += 1) {
    if (c.includes(r.slice(i, i + minLen))) return true
  }
  return false
}

module.exports = { stripMark, scoreCheckoffLine, scoreTodo, aggregate, evidenceQuote }

// CLI: node test/eval/score-rationale.js <final .sdd-review-todo.md>
// Prints a JSON scorecard + the per-checkoff detail. Behavioral metrics (readBefore /
// evidence-quote) plug in when transcripts/file contents are supplied by the caller;
// the e2e runner's existing PowerShell read-evidence is reused, NOT reimplemented here.
if (require.main === module) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write("usage: node test/eval/score-rationale.js <.sdd-review-todo.md>\n")
    process.exit(2)
  }
  const scores = scoreTodo(fs.readFileSync(file, "utf8"))
  process.stdout.write(JSON.stringify({ scorecard: aggregate(scores), checkoffs: scores }, null, 2) + "\n")
}
