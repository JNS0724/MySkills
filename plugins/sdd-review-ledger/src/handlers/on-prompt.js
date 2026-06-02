"use strict"

const { readConfig } = require("../core/config")
const { resolveStateDir } = require("../core/state-dir")
const { resolveSessionKey } = require("../core/session-key")
const { loadThrottle, saveThrottle, bumpBatch } = require("../core/throttle")
const { saveLastPrompt } = require("../core/session-context")
const { buildCarryOver, buildLeftoverCarryOver } = require("../core/prompts")
const { selectActiveNeeds, selectReviewLeftover } = require("../core/compute")
const { run } = require("../pipeline")

// on-prompt (§9.4): a new user turn. Refresh ledger + todo via the pipeline and,
// if anything is pending, inject a compact cross-session carry-over summary (this
// is how历史 unreviewed changes resurface in a fresh session). We still bump a
// batch counter for diagnostics/backward-compatible throttle state, but active
// edit reminders are no longer batch-capped by default.
const onPrompt = (ctx) => {
  const env = ctx.env || process.env
  const cfg = readConfig(env)
  if (cfg.disabled) return { deliver: false, text: "" }

  // Keep batch state monotonic for diagnostics / optional caps.
  const stateDir = resolveStateDir(ctx.repoRoot)
  const sessionKey = resolveSessionKey(ctx.event || {}, env, ctx.repoRoot)
  // 任务标签来源：把本轮触发的用户提示词存一份，供 on-edit 的变更线索打"在做哪个任务"的标签。
  saveLastPrompt(stateDir, sessionKey, (ctx.event && (ctx.event.prompt || ctx.event.promptText)) || "")
  // Read BEFORE bumping: did the turn that just ended fire an active review?
  const prior = loadThrottle(stateDir, sessionKey)
  const remindedLastTurn = prior.lastRemindedBatch !== null && prior.lastRemindedBatch === prior.batch
  const next = bumpBatch(prior) // a new user turn opens a new batch

  const result = run(ctx)
  if (result.action === "silent") {
    saveThrottle(stateDir, sessionKey, next)
    return { deliver: false, text: "", result }
  }

  const needs = result.needs || []
  // 改进 B: carry-over resurfaces only CODE that still needs review. A doc change ahead of
  // code is a plan — recorded in the todo by run() above, never re-nagged on the next turn.
  const activeNeeds = selectActiveNeeds(needs)
  if (activeNeeds.length > 0) {
    saveThrottle(stateDir, sessionKey, next)
    return { deliver: true, text: buildCarryOver(activeNeeds), result }
  }

  // T2 折中兜底（跨回合一次性）: OpenCode can't force-continue at idle, so a review-induced
  // doc leftover degrades to here. If last turn fired a review and new pending appeared after
  // its snapshot, surface a SHORT hint ONCE, then consume the snapshot so we don't nag every
  // later turn (the obligation still lives in the passive todo).
  if (remindedLastTurn) {
    const leftover = selectReviewLeftover(needs, prior.reviewBaselinePending)
    if (leftover.length > 0) {
      saveThrottle(stateDir, sessionKey, { ...next, reviewBaselinePending: [] })
      return { deliver: true, text: buildLeftoverCarryOver(leftover), result }
    }
  }

  saveThrottle(stateDir, sessionKey, next)
  return { deliver: false, text: "", result }
}

module.exports = { onPrompt }
