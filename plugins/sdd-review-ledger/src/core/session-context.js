"use strict"

const fs = require("fs")
const path = require("path")

// Cross-handler hint store (feature 2026-06-02: 任务标签). The triggering user prompt
// only exists at on-prompt time, but the change-note is built at on-edit/capture time —
// so on-prompt stashes a snippet here and capture reads it back. Per-session file next
// to the ledger. Fail-open: any IO error → benign no-op / empty string (a missing task
// tag never blocks anything).

const PROMPT_SNIPPET_MAX = 200

const lastPromptPath = (stateDir, sessionKey) => path.join(stateDir, `last-prompt-${sessionKey}.json`)

const snippetOf = (text) =>
  String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROMPT_SNIPPET_MAX)

const saveLastPrompt = (stateDir, sessionKey, text) => {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(lastPromptPath(stateDir, sessionKey), JSON.stringify({ prompt: snippetOf(text) }))
    return true
  } catch {
    return false
  }
}

const loadLastPrompt = (stateDir, sessionKey) => {
  try {
    const data = JSON.parse(fs.readFileSync(lastPromptPath(stateDir, sessionKey), "utf8"))
    return typeof data.prompt === "string" ? data.prompt : ""
  } catch {
    return "" // missing/corrupt → no task tag (benign)
  }
}

module.exports = {
  PROMPT_SNIPPET_MAX,
  lastPromptPath,
  snippetOf,
  saveLastPrompt,
  loadLastPrompt,
}
