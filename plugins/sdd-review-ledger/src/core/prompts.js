"use strict"

const { sanitizePath } = require("./paths")

// system-reminder templates (§9.2 fact-forcing R2 #4, §9.4 carry-over).
// Byte-stable: same inputs → same bytes (snapshot contract §8.6 / §9.2). Every
// path is run through sanitizePath before being placed in the human/model-visible
// text (R2 #8 render-side sanitization).

const HEADER = "[SDD-REVIEW: NEEDS-REVIEW]"

// The fact-forcing review block (R2 #4): demand evidence BEFORE a verdict. This is
// the only place GateGuard's "force investigation, don't self-evaluate" lesson
// enters the product — it lowers the lowest-effort rubber-stamp path, but carries
// no DENY force (architecture §10#9). Frozen constant for snapshot stability.
const REVIEW_BLOCK = [
  "示例（照此格式：先取证，再到「待评审」区把 [ ] 改成 [x] 并附依据）：",
  "    - [x] src/greet.ts@ab12 — design说\"按时段返回问候\" / code做\"已按 hour 分支返回\" → 一致",
  "    - [x] sdd/changes/x/tasks.md@cd34 — 另一篇 design说\"需 marker\" / 本文档已列同一 marker → 一致",
  "REVIEW（你是唯一语义裁判；下结论前必须先取证，不接受裸判断）:",
  "  对每一项，先读当前内容，再按此结构给出事实，最后才下结论：",
  "    1. design/tasks 此刻声称什么（引用具体一句/一段）",
  "    2. code 此刻实现什么（引用具体函数/行为）",
  "    3. 二者是否一致（指出冲突点，或写\"经对照无冲突\"）",
  "    4. 结论：需改 → 直接编辑对应 design/tasks（这本身是同步动作）；",
  "             无需改（纯重构/格式化/无关）→ 在 .sdd-review-todo.md 的「待评审」区原地勾掉，理由须含第 3 步的依据",
  "  （Layer A 纯文档对纯文档：第 2 步替换为\"另一篇 doc 此刻声称什么\"，不强求 importer 式取证。）",
  "  规则见 sdd-review-rules.md。",
].join("\n")

// T1 提示词硬化：把最易被漏掉的"二次闭环"提成短而硬的最终门槛领头（含"待评审区非空
// 不得说已完成"），再跟清除机制。MiniMax 等模型对长提示后半段遵循差，硬门槛靠前更有效。
const ACTION_LINE = [
  "最终门槛（必做，勿略）：① 若本轮 review 中你编辑过 code/design/tasks，立刻重读最新 .sdd-review-todo.md；② 其中新出现的 path@hash 也要逐项评审并勾选；③ 待评审区非空时，不要说\"SDD review 已完成\"，要说明还剩哪些待人工确认。",
  "ACTION: 回到用户原始任务。清除待评审项的唯一方式是在 .sdd-review-todo.md 的「## 待评审」区原地把已评审行从 [ ] 改为 [x]，保留原 path@hash 并追加一句证据理由；不要把条目移到「审计历史」区，不要手写新增待评审条目（编辑文件不自动清除）。",
].join("\n")

const changedLine = (item) => {
  const p = sanitizePath(item.path)
  if (item.kind === "code" && Array.isArray(item.candidates) && item.candidates.length) {
    return `  - ${p}  (候选 change-dir: ${item.candidates.map(sanitizePath).join(", ")})`
  }
  return `  - ${p}`
}

// 变更线索 (feature 2026-06-02): optional per-item change-note clues for the review.
// Dynamic + OPTIONAL — an item with no notes yields zero lines, so output stays
// byte-identical to before. Every field is sanitized (the payload is untrusted).
const noteLines = (item) => {
  const notes = item && Array.isArray(item.notes) ? item.notes : []
  return notes.map((n) => {
    const summary = sanitizePath((n && n.summary) || "")
    const task = sanitizePath((n && n.task) || "")
    return `      ↳ 变更线索: ${summary}${task ? `  [任务: ${task}]` : ""}`
  })
}

// 扩展 A+B: optional project-rules addendum. The rules OBJECT (resolved + capped +
// per-line sanitized by core/rules-file) renders as a dynamic, OPTIONAL segment — same
// shape as CONTEXT — so the frozen REVIEW_BLOCK/ACTION_LINE never change and the default
// (no rules object) stays byte-identical to before. The header echoes the resolved file
// path, folding option A (a reachable pointer) into the same segment. The tool only
// renders text the model treats as guidance (§2: still the model's call, not the tool's).
const buildProjectRulesSegment = (rules) => {
  if (!rules || !rules.text) return []
  const src = sanitizePath(rules.relPath || "")
  const lines = [
    "",
    `项目附加规则（来自 ${src}；仅供参考，不改变清除判定，是否偏差仍由你判断）:`,
    ...rules.text.split("\n").map((l) => `  ${l}`),
  ]
  if (rules.truncated) lines.push(`  （规则文件超长，已截断；完整内容见 ${src}）`)
  return lines
}

// buildReminder(needs, designFirstLineByDir, projectRules) -> string | "" (empty if no needs).
// designFirstLineByDir: { [relDir]: firstNonEmptyLine } for CONTEXT hints.
// projectRules: { relPath, text, truncated } | null — optional 扩展 A+B addendum.
const buildReminder = (needs, designFirstLineByDir = {}, projectRules = null) => {
  if (!needs || needs.length === 0) return ""
  const items = [...needs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const lines = ["<system-reminder>", HEADER, "", "CHANGED (未评审，本批):"]
  for (const item of items) {
    lines.push(changedLine(item))
    for (const nl of noteLines(item)) lines.push(nl)
  }

  // CONTEXT: design first line per referenced change-dir (sorted, deduped).
  const dirs = new Set()
  for (const item of items) {
    for (const d of item.candidates || []) {
      if (designFirstLineByDir[d]) dirs.add(d)
    }
  }
  const sortedDirs = [...dirs].sort()
  if (sortedDirs.length) {
    lines.push("", "CONTEXT (change-dir design 首行):")
    for (const d of sortedDirs) {
      lines.push(`  - ${sanitizePath(d)}: ${sanitizePath(designFirstLineByDir[d])}`)
    }
  }

  // 扩展 A+B: project-rules addendum (optional; absent → byte-identical to before).
  for (const line of buildProjectRulesSegment(projectRules)) lines.push(line)

  lines.push("", REVIEW_BLOCK, "", ACTION_LINE, "</system-reminder>")
  return lines.join("\n") + "\n"
}

// Compact cross-session carry-over (§9.4): just resurface the count + pointer.
const buildCarryOver = (needs) => {
  if (!needs || needs.length === 0) return ""
  return (
    [
      "<system-reminder>",
      HEADER,
      `有 ${needs.length} 项变更尚未评审（见 .sdd-review-todo.md）。逐项先取证后下结论；评审过的在该文件勾掉。`,
      "</system-reminder>",
    ].join("\n") + "\n"
  )
}

// Compact in-session repeat (改进二 P1): when the full protocol was already shown
// earlier THIS turn, a later path-set growth re-fires only this lean body — paths +
// count + pointer, no REVIEW_BLOCK/ACTION_LINE re-paste. Byte-stable; sanitized.
const buildCompactReminder = (needs) => {
  if (!needs || needs.length === 0) return ""
  const items = [...needs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const lines = [
    "<system-reminder>",
    HEADER,
    `本回合仍有 ${items.length} 项待评审（完整评审纪律见本回合首条提醒 / sdd-review-rules.md）:`,
  ]
  for (const item of items) lines.push(`  - ${sanitizePath(item.path)}`)
  lines.push(
    "逐项先取证后下结论；评审过的在 .sdd-review-todo.md「待评审」区原地从 [ ] 改为 [x] 并附证据理由。",
    "</system-reminder>",
  )
  return lines.join("\n") + "\n"
}

// Stop end-of-turn safety net (改进三 P0): the `reason` text for a Claude Code Stop
// `decision:"block"` (and OpenCode idle surfacing). It is the last line of defense
// before the turn ends, so it carries the FULL fact-forcing protocol. Not wrapped in
// <system-reminder> — it is delivered as the block reason, not injected context.
const buildStopBlock = (needs) => {
  if (!needs || needs.length === 0) return ""
  const items = [...needs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const lines = [
    HEADER,
    `收尾前检测到 ${items.length} 项 SDD 变更尚未评审，请先完成评审再结束本回合：`,
  ]
  for (const item of items) {
    lines.push(`  - ${sanitizePath(item.path)}`)
    for (const nl of noteLines(item)) lines.push(nl)
  }
  lines.push("", REVIEW_BLOCK, "", ACTION_LINE)
  return lines.join("\n") + "\n"
}

// T2 折中兜底（review 后自造的新 pending）：短提示，点名 path@hash，不重灌完整协议
// （报告 §8.2：只补一刀，别回到频繁打断）。两个变体：
//   buildLeftoverStopBlock → Claude Code Stop block reason（裸文本，最后一道防线）。
//   buildLeftoverCarryOver → OpenCode 下一轮一次性 carry-over（包 <system-reminder>）。
const leftoverItemLines = (items) =>
  [...items]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((it) => `  - ${sanitizePath(it.path)}@${it.currentHash}`)

const buildLeftoverStopBlock = (items) => {
  if (!items || items.length === 0) return ""
  return (
    [
      HEADER,
      "你在本轮 review 后又编辑了文件，.sdd-review-todo.md 出现新的待评审项；最终回复前请重新读取并逐项勾选（先取证后下结论）：",
      ...leftoverItemLines(items),
    ].join("\n") + "\n"
  )
}

const buildLeftoverCarryOver = (items) => {
  if (!items || items.length === 0) return ""
  return (
    [
      "<system-reminder>",
      HEADER,
      "上一轮 review 后又编辑了文件，.sdd-review-todo.md 仍有新增的待评审项，请先重新读取并逐项勾选：",
      ...leftoverItemLines(items),
      "</system-reminder>",
    ].join("\n") + "\n"
  )
}

module.exports = {
  HEADER,
  REVIEW_BLOCK,
  ACTION_LINE,
  changedLine,
  buildProjectRulesSegment,
  buildReminder,
  buildCarryOver,
  buildCompactReminder,
  buildStopBlock,
  buildLeftoverStopBlock,
  buildLeftoverCarryOver,
}
