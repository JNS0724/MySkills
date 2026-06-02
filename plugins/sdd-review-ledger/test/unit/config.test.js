"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  isDisabled,
  parseIntEnv,
  parseListEnv,
  isTruthyFlag,
  readConfig,
  DEFAULT_HASH_LEN,
  DEFAULT_SCAN_BUDGET_MS,
  DEFAULT_REMINDER_DEDUPE_MS,
} = require("../../src/core/config")

test("isDisabled: SDD_REVIEW off-family values disable (R2 #1)", () => {
  for (const v of ["off", "0", "false", "disabled", "disable", "OFF", " Off "]) {
    assert.equal(isDisabled({ SDD_REVIEW: v }), true, `value ${JSON.stringify(v)} should disable`)
  }
})

test("isDisabled: SDD_REVIEW_DISABLED=1 disables; other values do not", () => {
  assert.equal(isDisabled({ SDD_REVIEW_DISABLED: "1" }), true)
  assert.equal(isDisabled({ SDD_REVIEW_DISABLED: "true" }), false, "scoped to =1, like GateGuard legacy")
})

test("isDisabled: unset / on values do not disable", () => {
  assert.equal(isDisabled({}), false)
  assert.equal(isDisabled({ SDD_REVIEW: "on" }), false)
  assert.equal(isDisabled({ SDD_REVIEW: "1" }), false, "1 is not in the disable set for SDD_REVIEW")
})

test("parseIntEnv: valid non-negative ints, else fallback", () => {
  assert.equal(parseIntEnv("42", 7), 42)
  assert.equal(parseIntEnv("0", 7), 0)
  assert.equal(parseIntEnv("-3", 7), 7, "negative falls back")
  assert.equal(parseIntEnv("abc", 7), 7)
  assert.equal(parseIntEnv(undefined, 7), 7)
})

test("parseListEnv: comma-split, trimmed, empties dropped", () => {
  assert.deepEqual(parseListEnv("a, b ,,c"), ["a", "b", "c"])
  assert.deepEqual(parseListEnv(""), [])
  assert.deepEqual(parseListEnv(undefined), [])
})

test("isTruthyFlag: 1/true only", () => {
  assert.equal(isTruthyFlag("1"), true)
  assert.equal(isTruthyFlag("true"), true)
  assert.equal(isTruthyFlag("0"), false)
  assert.equal(isTruthyFlag(undefined), false)
})

test("readConfig: defaults when env empty", () => {
  const c = readConfig({})
  assert.equal(c.disabled, false)
  assert.equal(c.hashLen, DEFAULT_HASH_LEN)
  assert.equal(c.scanBudgetMs, DEFAULT_SCAN_BUDGET_MS)
  assert.equal(c.reminderDedupeMs, DEFAULT_REMINDER_DEDUPE_MS)
  assert.equal(c.bootstrapThreshold, 1)
  assert.equal(c.scanAlwaysHash, false)
  assert.deepEqual(c.ignoreGlobs, [])
  assert.equal(c.rulesFile, null)
})

test("readConfig: overrides parsed from env", () => {
  const c = readConfig({
    SDD_REVIEW_HASH_LEN: "8",
    SDD_REVIEW_SCAN_BUDGET_MS: "500",
    SDD_REVIEW_REMINDER_DEDUPE_MS: "100",
    SDD_REVIEW_SCAN_ALWAYS_HASH: "1",
    SDD_REVIEW_IGNORE: "vendor/, tmp/",
    SDD_REVIEW_BOOTSTRAP_THRESHOLD: "0",
  })
  assert.equal(c.hashLen, 8)
  assert.equal(c.scanBudgetMs, 500)
  assert.equal(c.reminderDedupeMs, 100)
  assert.equal(c.scanAlwaysHash, true)
  assert.deepEqual(c.ignoreGlobs, ["vendor/", "tmp/"])
  assert.equal(c.bootstrapThreshold, 0, "explicit 0 honored")
})

test("readConfig: SDD_REVIEW_RULES_FILE is parsed + trimmed (扩展 A+B); blank → null", () => {
  assert.equal(readConfig({ SDD_REVIEW_RULES_FILE: " docs/sdd-rules.md " }).rulesFile, "docs/sdd-rules.md")
  assert.equal(readConfig({ SDD_REVIEW_RULES_FILE: "" }).rulesFile, null)
  assert.equal(readConfig({}).rulesFile, null)
})

test("readConfig: reminderMode defaults to stop; once/growth honored; invalid → stop", () => {
  assert.equal(readConfig({}).reminderMode, "stop", "default defers review to the Stop block")
  assert.equal(readConfig({ SDD_REVIEW_REMINDER_MODE: "once" }).reminderMode, "once")
  assert.equal(readConfig({ SDD_REVIEW_REMINDER_MODE: "growth" }).reminderMode, "growth")
  assert.equal(readConfig({ SDD_REVIEW_REMINDER_MODE: " STOP " }).reminderMode, "stop", "trimmed + lowercased")
  assert.equal(readConfig({ SDD_REVIEW_REMINDER_MODE: "bogus" }).reminderMode, "stop", "unknown → safe default")
})

test("readConfig: changeNoteCap defaults to 3; honors override; 0 disables", () => {
  assert.equal(readConfig({}).changeNoteCap, 3, "default keeps 3 recent clues per path")
  assert.equal(readConfig({ SDD_REVIEW_CHANGE_NOTE_CAP: "5" }).changeNoteCap, 5)
  assert.equal(readConfig({ SDD_REVIEW_CHANGE_NOTE_CAP: "0" }).changeNoteCap, 0, "0 → feature off")
})

test("readConfig: rationaleGate default OFF; honored; rationaleMinChars default 8", () => {
  assert.equal(readConfig({}).rationaleGate, false, "the rationale gate is opt-in")
  assert.equal(readConfig({ SDD_REVIEW_RATIONALE_GATE: "1" }).rationaleGate, true)
  assert.equal(readConfig({ SDD_REVIEW_RATIONALE_GATE: "true" }).rationaleGate, true)
  assert.equal(readConfig({}).rationaleMinChars, 8)
  assert.equal(readConfig({ SDD_REVIEW_RATIONALE_MIN_CHARS: "12" }).rationaleMinChars, 12)
})
