"use strict"

const { sanitizePath } = require("./paths")

// 变更线索 (feature 2026-06-02): give the end-of-turn Stop review a clue about each
// pending code change. Two AUTO sources, no model cooperation required:
//   - 改动摘要: derived from the PostToolUse tool payload (tool shape + ±line counts
//     + a short snippet of the new content) → "what changed".
//   - 任务标签: the triggering user prompt (stashed by on-prompt via session-context)
//     → "which task this change was for".
// Pure functions, no IO. Every field that can reach model/human-visible text is run
// through sanitizePath (strips control/bidi chars, bounded) — the payload is untrusted.

const SUMMARY_MAX = 120
const SNIPPET_MAX = 80
const TASK_MAX = 120

const lineCount = (s) => {
  const str = String(s == null ? "" : s)
  return str === "" ? 0 : str.split(/\r?\n/).length
}

const firstNonEmptyLine = (s) => {
  for (const line of String(s == null ? "" : s).split(/\r?\n/)) {
    const t = line.trim()
    if (t) return t
  }
  return ""
}

const snippet = (s) => firstNonEmptyLine(s).slice(0, SNIPPET_MAX)

// buildChangeSummary(toolName, toolInput) -> compact, sanitized "what changed" string.
// Shape-driven (robust to tool-name casing/aliases): edits[] → MultiEdit; content with
// no new_string → Write; otherwise Edit.
const buildChangeSummary = (toolName, toolInput) => {
  const ti = toolInput && typeof toolInput === "object" ? toolInput : {}
  let raw
  if (Array.isArray(ti.edits)) {
    let adds = 0
    let dels = 0
    for (const e of ti.edits) {
      adds += lineCount(e && e.new_string)
      dels += lineCount(e && e.old_string)
    }
    const snip = ti.edits.length ? snippet(ti.edits[0] && ti.edits[0].new_string) : ""
    raw = `MultiEdit ×${ti.edits.length} +${adds}/-${dels}${snip ? `: «${snip}»` : ""}`
  } else if ("content" in ti && !("new_string" in ti)) {
    const snip = snippet(ti.content)
    raw = `Write (${lineCount(ti.content)} 行)${snip ? `: «${snip}»` : ""}`
  } else {
    const snip = snippet(ti.new_string)
    raw = `Edit +${lineCount(ti.new_string)}/-${lineCount(ti.old_string)}${snip ? `: «${snip}»` : ""}`
  }
  return sanitizePath(raw).slice(0, SUMMARY_MAX)
}

// buildChangeNote({ toolName, toolInput, task, now }) -> { at, summary, task }
// `at` is carried for ordering/diagnostics; renderers do NOT print it (keeps the Stop
// block stable w.r.t. the logical change-set rather than wall-clock).
const buildChangeNote = ({ toolName, toolInput, task = "", now } = {}) => ({
  at: now || "",
  summary: buildChangeSummary(toolName, toolInput),
  task: sanitizePath(String(task == null ? "" : task)).slice(0, TASK_MAX),
})

module.exports = {
  SUMMARY_MAX,
  SNIPPET_MAX,
  TASK_MAX,
  lineCount,
  firstNonEmptyLine,
  snippet,
  buildChangeSummary,
  buildChangeNote,
}
