"use strict"

const path = require("path")
const { classifyPath } = require("./classify")
const { withRecord } = require("./ledger")
const { isThinRationale } = require("./todo")

// ingestCheckoffs(ledger, todoEntries, now, actor) -> ledger'   (detailed-design §6.5)
// Pure function: turns checked todo entries into verdicts, pinned to the INLINE
// hash (§5.3) — never the current on-disk hash — to stop cross-version false-clean.
// Editing a file never clears anything here (checkoff-only, §8.2): we only process [x].

const RATIONALE_MAX = 200

const clamp = (s, max) => String(s == null ? "" : s).slice(0, max)

// verdict label is display-only. We do NOT parse rationale meaning (§7.3);
// this is a coarse, optional tag derived from obvious keywords, default "reviewed".
const labelFromRationale = (rationale) => {
  const r = String(rationale || "").toLowerCase()
  if (/unrelated/.test(r) || /无关/.test(r)) return "unrelated"
  if (/no[- ]?change|gofmt|format|lint/.test(r) || /仅格式|无需改/.test(r)) return "no-change"
  if (/synced?|updated?/.test(r) || /已同步|已更新/.test(r)) return "synced"
  return "reviewed"
}

// basenameToken: lowercase basename WITH extension (e.g. "greet.ts") — for the
// "references-the-path" syntactic signal, since models cite the filename with its
// extension. Defensive: any odd path → "" (the refs check then just returns false).
const basenameToken = (p) => {
  try {
    return path.posix.basename(String(p || "")).toLowerCase()
  } catch {
    return ""
  }
}

// rationaleStats: SYNTACTIC facts about a checkoff rationale — for the diagnostics
// counter (Tier 0). `thin` reuses the existing isThinRationale; `refsPath` is a pure
// substring test. No semantic judgement of whether the rationale is "good".
const rationaleStats = (rationale, p) => {
  const text = String(rationale == null ? "" : rationale)
  const token = basenameToken(p)
  return {
    thin: isThinRationale(rationale),
    len: text.trim().length,
    refsPath: token.length >= 2 && text.toLowerCase().includes(token),
    verdict: labelFromRationale(rationale),
  }
}

// passesRationaleGate: Tier 1 gate, MIN-LENGTH only (no blocklist, so it never
// contradicts the REVIEW_BLOCK "纯重构/格式化/无关 + 依据 → 可勾掉" rule). Fail-open:
// any error → true (clear as before) so the gate can never wedge a checkoff on a throw.
const passesRationaleGate = (rationale, minChars) => {
  try {
    return String(rationale == null ? "" : rationale).trim().length >= (minChars || 0)
  } catch {
    return true
  }
}

// ingestCheckoffs(ledger, todoEntries, now, actor, opts?) -> ledger'
// opts.onCheckoff(summary)  — fired once per checked tracked entry (Tier 0 counter);
//   summary = { path, held, thin, len, refsPath, verdict }. Return value ignored.
// opts.gateOn / opts.minChars — Tier 1 gate: when gateOn, a rationale below minChars
//   WITHHOLDS the clear (no record written) → the item stays pending (safe direction).
// Backward-compatible: called with 4 args → opts {} → gate off, no callback, identical.
const ingestCheckoffs = (ledger, todoEntries, now, actor, opts = {}) => {
  const onCheckoff = typeof opts.onCheckoff === "function" ? opts.onCheckoff : null
  const gateOn = !!opts.gateOn
  const minChars = opts.minChars || 0
  let next = ledger
  for (const e of todoEntries) {
    if (!e.checked) continue // editing/unchecking never clears (checkoff-only)
    if (classifyPath(e.path) === "other") continue // not a tracked element
    const stats = rationaleStats(e.rationale, e.path)
    const held = gateOn && !passesRationaleGate(e.rationale, minChars)
    if (onCheckoff) {
      // The diagnostics counter must never break ingest — swallow any callback error
      // locally (belt-and-suspenders fail-open, like passesRationaleGate).
      try {
        onCheckoff({ path: e.path, held, ...stats })
      } catch {
        /* ignore */
      }
    }
    if (held) continue // Tier 1: thin rationale → withhold the clear, item stays pending
    next = withRecord(next, e.path, {
      kind: classifyPath(e.path),
      reviewedHash: e.inlineHash, // ★ pin to inline hash, not current hash
      verdict: stats.verdict,
      rationale: clamp(e.rationale, RATIONALE_MAX),
      reviewedAt: now,
      by: actor || "agent",
    })
  }
  return next
}

module.exports = {
  RATIONALE_MAX,
  clamp,
  labelFromRationale,
  basenameToken,
  rationaleStats,
  passesRationaleGate,
  ingestCheckoffs,
}
