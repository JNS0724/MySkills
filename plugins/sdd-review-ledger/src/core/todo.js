"use strict"

const { sanitizePath } = require("./paths")

// .sdd-review-todo.md parse + render (format contract §8.6, R2 #4b/#8).
// The tool reads ONLY the structured checkbox + path + inline @hash. The rationale
// is free text, stored verbatim, never semantically parsed.

const TODO_HEADER = "只在「待评审」区把已完成评审的行原地从 [ ] 改为 [x]；不要移动、复制或改写 path@hash。"
// R1 §4.4: scan-budget truncation must be visible HERE (human-visible todo), not
// only in the diagnostics log. This is the "非静默" promise — never silently drop.
const truncationWarning = (skipped) =>
  `> ⚠ 本轮扫描超预算，约 ${skipped} 个文件未检查、其变更可能尚未列出；下轮继续（可调 SDD_REVIEW_SCAN_BUDGET_MS / SCAN_ROOTS / IGNORE）。`
const PENDING_HEADING = "## 待评审"
const REVIEWED_HEADING = "## 审计历史（只读，勿编辑）"
const DEFAULT_REVIEWED_LIMIT = 50

// Line contract: - [ ] <path>@<hash>  (候选: ...)   |   - [x] <path>@<hash> — <rationale>
// We accept an optional "  (候选: ...)" tail on pending lines and an optional
// " — rationale" tail on any line. Only checkbox + path + inline hash are structural.
const TODO_LINE = /^- \[( |x)\] (\S+)@([0-9a-f]+)(?:\s+\(候选:[^)]*\))?(?: — (.*))?$/

// Section-aware: ONLY pending-section lines are ingestable checkoffs. The audit
// section is display-only (§8.2: the sole ack is ticking a box in the pending
// list). If we re-parsed audit `[x]` lines, a stale audit entry (old hash) could
// re-pin / clobber a fresh pending checkoff (new hash) → wrong stay-pending. So we
// stop collecting once we enter the audit section. Default section = pending, so
// a flat list with no headings is still treated as ingestable (the safe direction).
const parseTodo = (text) => {
  const entries = []
  if (typeof text !== "string") return entries
  let inReviewed = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("## ")) {
      inReviewed = line.includes("已评审") || line.includes("审计历史")
      continue
    }
    if (inReviewed) continue // audit section is inert
    const m = TODO_LINE.exec(line)
    if (!m) continue // malformed / prose → skipped, never guessed
    entries.push({
      checked: m[1] === "x",
      path: m[2],
      inlineHash: m[3],
      rationale: (m[4] || "").trim(),
    })
  }
  return entries
}

// R2 #4b: display-only marker when a checkoff rationale is too thin.
// Pure function of the rationale text; never affects clearing, never parses meaning.
const THIN_RATIONALES = new Set(["", "无关", "ok", "n/a", "na", "无", "skip"])
const isThinRationale = (rationale) => THIN_RATIONALES.has(String(rationale || "").trim().toLowerCase())
const THIN_MARK = "（理由过简，建议补充）"
// Tier 1 held marker: an INERT (non-checkbox) note rendered under a pending line that the
// rationale gate withheld this run. parseTodo skips it (it does not match TODO_LINE), so
// the pending line above stays checkable. Emitted ONLY when opts.heldPaths is non-empty,
// so the default render is byte-identical.
const HELD_NOTE = "↳ 上次勾选理由过简未生效（仍为待评审）：补一句含第 3 步依据的理由后重新勾选"

// renderTodo(needs, ledger, opts) -> text. Idempotent: same inputs → same bytes.
// needs: NeedsReviewItem[] (sorted by path). ledger: for the reviewed section.
// opts.meta: compute meta; if { scanTruncated, skipped } we surface a header warning.
const renderTodo = (needs, ledger, opts = {}) => {
  const reviewedLimit = opts.reviewedLimit || DEFAULT_REVIEWED_LIMIT
  const meta = opts.meta || {}
  const lines = [TODO_HEADER]
  if (meta.scanTruncated) lines.push(truncationWarning(meta.skipped || 0))
  lines.push("")

  // —— 待评审 ——
  lines.push(PENDING_HEADING)
  const heldSet = new Set(Array.isArray(opts.heldPaths) ? opts.heldPaths : [])
  const pending = [...needs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const item of pending) {
    const candidates = Array.isArray(item.candidates) ? item.candidates.join(", ") : ""
    const tail = candidates ? `  (候选: ${candidates})` : ""
    lines.push(`- [ ] ${sanitizePath(item.path)}@${item.currentHash}${tail}`)
    // Tier 1: explain why a just-checked item is still pending (gate withheld it).
    if (heldSet.has(item.path)) lines.push(`  ${HELD_NOTE}`)
  }

  // —— 已评审 (reviewed = records whose reviewedHash is set; newest first by reviewedAt) ——
  lines.push("", REVIEWED_HEADING)
  const records = ledger && ledger.records ? ledger.records : {}
  const reviewed = Object.entries(records)
    .filter(([, r]) => r && r.reviewedHash)
    .sort((a, b) => {
      const ta = a[1].reviewedAt || ""
      const tb = b[1].reviewedAt || ""
      if (ta !== tb) return ta < tb ? 1 : -1 // newest first
      return a[0] < b[0] ? -1 : 1 // tiebreak by path for determinism
    })
    .slice(0, reviewedLimit)
  for (const [p, r] of reviewed) {
    // THIN_MARK nudges HUMAN checkoffs toward a better rationale; it must NOT apply to
    // the auto-baseline (verdict/by "bootstrap"), whose empty rationale is expected —
    // the user never reviewed those files, so "理由过简，建议补充" is wrong/noisy there
    // (otherwise a cold-start bootstrap floods the audit history with the nag).
    const isAutoBaseline = r.verdict === "bootstrap" || r.by === "bootstrap"
    const mark = !isAutoBaseline && isThinRationale(r.rationale) ? ` ${THIN_MARK}` : ""
    const rationale = r.rationale ? ` — ${r.rationale}` : " —"
    lines.push(`- [x] ${sanitizePath(p)}@${r.reviewedHash}${rationale}${mark}`)
  }

  return lines.join("\n") + "\n"
}

module.exports = {
  TODO_HEADER,
  truncationWarning,
  PENDING_HEADING,
  REVIEWED_HEADING,
  DEFAULT_REVIEWED_LIMIT,
  THIN_MARK,
  HELD_NOTE,
  TODO_LINE,
  parseTodo,
  renderTodo,
  isThinRationale,
}
