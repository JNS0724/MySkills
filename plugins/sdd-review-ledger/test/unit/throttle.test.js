"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  emptyThrottle,
  loadThrottle,
  saveThrottle,
  bumpBatch,
  decideReminder,
} = require("../../src/core/throttle")

test("decideReminder: reminds when needs present, under cap, new batch", () => {
  const { remind, state } = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3 })
  assert.equal(remind, true)
  assert.equal(state.sent, 1)
  assert.equal(state.lastRemindedBatch, 0)
})

// 改进一（按回合合并 + 按路径集去重）：去重键 = 当前回合内的 pending 路径集，
// 不再绑 @hash。路径集增长 → 必报（新义务结构上不会被静音）；同回合无增长 → 抑制；
// 跨回合（bumpBatch）→ 重新算。
test("decideReminder: path-set grows in same turn → reminds (new obligation never silenced)", () => {
  const s = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a"] }).state
  const grew = decideReminder(s, { hasNeeds: true, maxReminders: 3, pathSet: ["a", "b"] })
  assert.equal(grew.remind, true, "a new path b in the same turn must remind")
  assert.equal(grew.state.sent, 2, "sent advances")
  assert.deepEqual(grew.state.lastRemindedPathSet, ["a", "b"])
})

test("decideReminder: same path re-hashed in same turn → suppressed (no growth)", () => {
  const s = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a"] }).state
  const same = decideReminder(s, { hasNeeds: true, maxReminders: 3, pathSet: ["a"] })
  assert.equal(same.remind, false, "re-editing an already-reminded file in the same turn stays quiet")
  assert.equal(same.state.sent, 1, "sent does not advance")
})

test("decideReminder: pending set shrinks to a subset in same turn → suppressed", () => {
  const s = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a", "b"] }).state
  const subset = decideReminder(s, { hasNeeds: true, maxReminders: 3, pathSet: ["b"] })
  assert.equal(subset.remind, false, "{a,b} → {b} has no new path")
})

test("decideReminder: new turn re-arms even for the same path-set", () => {
  let s = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a"] }).state
  s = bumpBatch(s) // user turn boundary
  const next = decideReminder(s, { hasNeeds: true, maxReminders: 3, pathSet: ["a"] })
  assert.equal(next.remind, true, "a new turn re-fires for the same file")
  assert.equal(next.state.lastRemindedBatch, 1)
})

// 6.1 (产品默认): once 模式——每个 turn 至多一次主动提醒，路径集增长也不再提醒
// （兜底靠 always-written todo + Stop/idle + 下轮 carry-over）。
test("decideReminder: once mode suppresses any same-turn repeat, even path-set growth", () => {
  const s = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a"], mode: "once" }).state
  const grew = decideReminder(s, { hasNeeds: true, maxReminders: 3, pathSet: ["a", "b"], mode: "once" })
  assert.equal(grew.remind, false, "once mode: a second new path in the same turn is suppressed")
  assert.equal(grew.state.sent, 1, "sent does not advance")
})

test("decideReminder: once mode still reminds first-of-turn and re-arms next turn", () => {
  const first = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a"], mode: "once" })
  assert.equal(first.remind, true, "first of turn always reminds")
  const next = decideReminder(bumpBatch(first.state), { hasNeeds: true, maxReminders: 3, pathSet: ["a", "b"], mode: "once" })
  assert.equal(next.remind, true, "a new turn re-arms in once mode")
})

// 6.0 (产品默认): stop 模式——编辑中永不主动提醒，评审推迟到 Stop block
test("decideReminder: stop mode never reminds, even first-of-turn or across new turns", () => {
  const first = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3, pathSet: ["a"], mode: "stop" })
  assert.equal(first.remind, false, "stop mode: no active reminder on edit, even the first")
  const next = decideReminder(bumpBatch(first.state), { hasNeeds: true, maxReminders: 3, pathSet: ["a", "b"], mode: "stop" })
  assert.equal(next.remind, false, "a new turn does NOT re-arm in stop mode (review stays deferred)")
})

test("decideReminder: batch still records the latest reminded batch", () => {
  let s = decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 3 }).state
  s = bumpBatch(s) // user turn → batch 1
  const next = decideReminder(s, { hasNeeds: true, maxReminders: 3 })
  assert.equal(next.remind, true)
  assert.equal(next.state.sent, 2)
  assert.equal(next.state.lastRemindedBatch, 1)
})

test("decideReminder: respects session cap", () => {
  let s = emptyThrottle()
  for (let i = 0; i < 3; i++) {
    s = decideReminder(s, { hasNeeds: true, maxReminders: 3 }).state
    s = bumpBatch(s)
  }
  assert.equal(decideReminder(s, { hasNeeds: true, maxReminders: 3 }).remind, false, "cap reached")
})

test("decideReminder: maxReminders 0 → never reminds (pure todo)", () => {
  assert.equal(decideReminder(emptyThrottle(), { hasNeeds: true, maxReminders: 0 }).remind, false)
})

test("decideReminder: no needs → never reminds", () => {
  assert.equal(decideReminder(emptyThrottle(), { hasNeeds: false, maxReminders: 3 }).remind, false)
})

test("load/save round-trip; missing/corrupt → empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-thr-"))
  try {
    assert.deepEqual(loadThrottle(dir, "k"), emptyThrottle(), "missing → empty")
    saveThrottle(dir, "k", { batch: 2, sent: 1, lastRemindedBatch: 1 })
    assert.deepEqual(loadThrottle(dir, "k"), {
      batch: 2,
      sent: 1,
      lastRemindedBatch: 1,
      lastRemindedPathSet: [],
      lastReminderAtMs: 0,
      reviewBaselinePending: [],
    })
    fs.writeFileSync(path.join(dir, "throttle-k.json"), "{ corrupt")
    assert.deepEqual(loadThrottle(dir, "k"), emptyThrottle(), "corrupt → empty")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("bumpBatch: pure, increments batch only", () => {
  assert.deepEqual(bumpBatch({ batch: 0, sent: 5, lastRemindedBatch: 0 }), { batch: 1, sent: 5, lastRemindedBatch: 0 })
})

// T2 折中信号：throttle 携带 review 触发时的 pending 快照（path@hash）；round-trips intact.
test("reviewBaselinePending: persists round-trip; non-array/missing → []", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-thr-base-"))
  try {
    saveThrottle(dir, "k", { ...emptyThrottle(), reviewBaselinePending: ["src/a.ts@h1", "sdd/changes/g/tasks.md@hT"] })
    assert.deepEqual(loadThrottle(dir, "k").reviewBaselinePending, ["src/a.ts@h1", "sdd/changes/g/tasks.md@hT"])
    saveThrottle(dir, "k", { ...emptyThrottle(), reviewBaselinePending: "oops" })
    assert.deepEqual(loadThrottle(dir, "k").reviewBaselinePending, [], "non-array → []")
    assert.deepEqual(emptyThrottle().reviewBaselinePending, [], "empty throttle carries the field")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Migration: an OLD on-disk throttle (legacy lastReminderSignature, no lastRemindedPathSet)
// must upgrade in the fail-safe direction — defaults filled, never silences an obligation.
test("loadThrottle: OLD-schema file upgrades safely; subsequent decide re-fires (never silences)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-thr-mig-"))
  try {
    fs.writeFileSync(
      path.join(dir, "throttle-k.json"),
      JSON.stringify({ batch: 2, sent: 1, lastRemindedBatch: 2, lastReminderSignature: "src/a.ts@abcd" })
    )
    const loaded = loadThrottle(dir, "k")
    assert.deepEqual(loaded, {
      batch: 2,
      sent: 1,
      lastRemindedBatch: 2,
      lastRemindedPathSet: [],
      lastReminderAtMs: 0,
      reviewBaselinePending: [],
    })
    // legacy key ignored; empty reminded set → a pending path counts as growth → re-fires
    assert.equal(decideReminder(loaded, { hasNeeds: true, maxReminders: 3, pathSet: ["src/a.ts"] }).remind, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
