"use strict"

const fs = require("fs")
const path = require("path")

// Active reminder state + decision (改进一：按回合合并 + 按路径集去重).
//
// The active-reminder dedupe key is the set of pending PATHS within the current
// user turn (batch), NOT path@hash. Rationale (real-model report 2026-05-31):
// keying on content-hash made any mid-review re-edit of an already-pending file
// mint a fresh signature and re-fire a full reminder. Path-set + turn batching
// collapses that churn while GUARANTEEING new obligations are never silenced:
//   - same turn, pending path-set did not grow  → suppress (already nudged)
//   - any new path appears (set grows)           → ALWAYS remind (by construction)
//   - new user turn (bumpBatch)                  → re-arm, even for the same set
// A missed review is still worse than a repeated nudge, so growth always wins.
// The optional SDD_REVIEW_SESSION_MAX_REMINDERS env var remains a hard cap;
// 0 means passive todo only.

const emptyThrottle = () => ({
  batch: 0,
  sent: 0,
  lastRemindedBatch: null,
  lastRemindedPathSet: [],
  lastReminderAtMs: 0,
  // T2: snapshot of ALL pending `path@hash` captured when the first active review of a
  // turn fired. Used to detect review-induced leftovers (pending that appeared after).
  reviewBaselinePending: [],
})

const throttlePath = (stateDir, sessionKey) => path.join(stateDir, `throttle-${sessionKey}.json`)

const loadThrottle = (stateDir, sessionKey) => {
  try {
    const data = JSON.parse(fs.readFileSync(throttlePath(stateDir, sessionKey), "utf8"))
    return {
      batch: Number.isFinite(data.batch) ? data.batch : 0,
      sent: Number.isFinite(data.sent) ? data.sent : 0,
      lastRemindedBatch: Number.isFinite(data.lastRemindedBatch) ? data.lastRemindedBatch : null,
      lastRemindedPathSet: Array.isArray(data.lastRemindedPathSet)
        ? data.lastRemindedPathSet.filter((s) => typeof s === "string")
        : [],
      lastReminderAtMs: Number.isFinite(data.lastReminderAtMs) ? data.lastReminderAtMs : 0,
      reviewBaselinePending: Array.isArray(data.reviewBaselinePending)
        ? data.reviewBaselinePending.filter((s) => typeof s === "string")
        : [],
    }
  } catch {
    return emptyThrottle() // missing/corrupt → fresh (throttle loss is benign)
  }
}

const saveThrottle = (stateDir, sessionKey, state) => {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(throttlePath(stateDir, sessionKey), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

// Pure: a new user turn opens a new batch.
const bumpBatch = (state) => ({ ...state, batch: (state.batch || 0) + 1 })

// Pure decision for an active reminder. Returns { remind, state }.
// remind iff there is something to review, the optional cap is not reached, and the
// within-turn suppression for the active mode does not apply.
//   mode "stop"   → NEVER actively remind on edit (always suppressed). Review is
//                   deferred to the end-of-turn Stop block + next-prompt carry-over.
//                   The PRODUCT default (set in readConfig); ledger/todo + change-notes
//                   still refresh on every edit.
//   mode "once"   → at most one active reminder per turn (suppress every same-turn
//                   repeat, even path-set growth). The previous default; now opt-in.
//   mode "growth" → also re-fire when a new path appears (suppress only same-turn
//                   no-growth repeats). Safety/audit-first.
// Defaults to "growth" here (the safe, louder direction) for direct/unit callers; the
// product layer always passes cfg.reminderMode explicitly.
// pathSet: the current pending paths (order-independent; caller may sort/dedupe).
const decideReminder = (state, { hasNeeds, maxReminders, pathSet = [], mode = "growth", nowMs = Date.now() }) => {
  const cur = state || emptyThrottle()
  const lastSet = new Set(cur.lastRemindedPathSet || [])
  const grew = pathSet.some((p) => !lastSet.has(p))
  const sameTurn = cur.lastRemindedBatch !== null && cur.lastRemindedBatch === cur.batch
  const suppressed = mode === "stop" ? true : mode === "once" ? sameTurn : sameTurn && !grew
  const remind = !!hasNeeds && maxReminders > 0 && (cur.sent || 0) < maxReminders && !suppressed
  if (!remind) return { remind: false, state: cur }
  return {
    remind: true,
    state: {
      ...cur,
      sent: (cur.sent || 0) + 1,
      lastRemindedBatch: cur.batch,
      lastRemindedPathSet: [...pathSet],
      lastReminderAtMs: nowMs,
    },
  }
}

module.exports = {
  emptyThrottle,
  throttlePath,
  loadThrottle,
  saveThrottle,
  bumpBatch,
  decideReminder,
}
