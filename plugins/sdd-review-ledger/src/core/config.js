"use strict"

// Runtime configuration read from env. Pure helpers + a single readConfig()
// snapshot so the rest of the pipeline never touches process.env directly.
// Defaults mirror detailed-design §14.

const DEFAULT_HASH_LEN = 16
const DEFAULT_SESSION_MAX_REMINDERS = Number.MAX_SAFE_INTEGER
const DEFAULT_LEDGER_CODE_CAP = 1000
const DEFAULT_SCAN_BUDGET_MS = 1500
const DEFAULT_REMINDER_DEDUPE_MS = 2000
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MiB
const DEFAULT_BOOTSTRAP_THRESHOLD = 1
// How many recent change-note clues to keep per pending code path (feature 2026-06-02:
// 给 Stop 评审喂"改了什么 + 在做哪个任务"的线索). 0 → feature off (record nothing).
const DEFAULT_CHANGE_NOTE_CAP = 3
// Min-length rationale gate (feature 2026-06-02, Tier 1): when SDD_REVIEW_RATIONALE_GATE
// is on, a [x] whose rationale is shorter than this (after trim) does NOT clear — the
// item stays pending. SYNTACTIC length only (no blocklist), so it never contradicts the
// REVIEW_BLOCK rule that "纯重构/格式化/无关 + 依据" is a valid clear. Default OFF.
const DEFAULT_RATIONALE_MIN_CHARS = 8

// Active-reminder cadence (基于 2026-06-01 体验报告 §6 + 2026-06-02 提速调整):
//   stop   — NO mid-turn active reminder. Review is DEFERRED to the end-of-turn Stop
//            block (+ next-prompt carry-over backstop). Ledger/todo still refresh on every
//            edit, and each code change records a change-note clue for that Stop review.
//            Throughput/experience-first; the PRODUCT DEFAULT.
//   once   — at most one active reminder per user turn (opt-in; the previous default).
//   growth — also re-fire when the pending path-set grows in a turn (safety/audit-first).
const DEFAULT_REMINDER_MODE = "stop"
const REMINDER_MODES = new Set(["stop", "once", "growth"])

// R2 #1: escape-hatch master switch. Ported from GateGuard's ECC_DISABLE_VALUES.
const DISABLE_VALUES = new Set(["0", "false", "off", "disabled", "disable"])

const normalizeEnvValue = (value) => String(value == null ? "" : value).trim().toLowerCase()

// R2 #1: SDD_REVIEW=off / SDD_REVIEW_DISABLED=1 → whole-run silence.
const isDisabled = (env = process.env) => {
  if (normalizeEnvValue(env.SDD_REVIEW_DISABLED) === "1") return true
  return DISABLE_VALUES.has(normalizeEnvValue(env.SDD_REVIEW))
}

const parseIntEnv = (raw, fallback) => {
  const n = Number.parseInt(String(raw == null ? "" : raw).trim(), 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// Comma-separated env list → trimmed non-empty entries.
const parseListEnv = (raw) =>
  String(raw == null ? "" : raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

const isTruthyFlag = (raw) => normalizeEnvValue(raw) === "1" || normalizeEnvValue(raw) === "true"

// SDD_REVIEW_REMINDER_MODE → stop | once | growth. Unknown/blank → stop (the quiet default).
const parseReminderMode = (raw) => {
  const v = normalizeEnvValue(raw)
  return REMINDER_MODES.has(v) ? v : DEFAULT_REMINDER_MODE
}

const readConfig = (env = process.env) => ({
  disabled: isDisabled(env),
  hashLen: parseIntEnv(env.SDD_REVIEW_HASH_LEN, DEFAULT_HASH_LEN) || DEFAULT_HASH_LEN,
  sessionMaxReminders: parseIntEnv(env.SDD_REVIEW_SESSION_MAX_REMINDERS, DEFAULT_SESSION_MAX_REMINDERS),
  ledgerCodeCap: parseIntEnv(env.SDD_REVIEW_LEDGER_CODE_CAP, DEFAULT_LEDGER_CODE_CAP) || DEFAULT_LEDGER_CODE_CAP,
  scanBudgetMs: parseIntEnv(env.SDD_REVIEW_SCAN_BUDGET_MS, DEFAULT_SCAN_BUDGET_MS) || DEFAULT_SCAN_BUDGET_MS,
  reminderDedupeMs: parseIntEnv(env.SDD_REVIEW_REMINDER_DEDUPE_MS, DEFAULT_REMINDER_DEDUPE_MS),
  reminderMode: parseReminderMode(env.SDD_REVIEW_REMINDER_MODE),
  maxFileBytes: parseIntEnv(env.SDD_REVIEW_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES,
  bootstrapThreshold: parseIntEnv(env.SDD_REVIEW_BOOTSTRAP_THRESHOLD, DEFAULT_BOOTSTRAP_THRESHOLD),
  scanAlwaysHash: isTruthyFlag(env.SDD_REVIEW_SCAN_ALWAYS_HASH),
  ignoreGlobs: parseListEnv(env.SDD_REVIEW_IGNORE),
  scanRoots: parseListEnv(env.SDD_REVIEW_SCAN_ROOTS),
  rulesFile: String(env.SDD_REVIEW_RULES_FILE || "").trim() || null,
  changeNoteCap: parseIntEnv(env.SDD_REVIEW_CHANGE_NOTE_CAP, DEFAULT_CHANGE_NOTE_CAP),
  rationaleGate: isTruthyFlag(env.SDD_REVIEW_RATIONALE_GATE),
  rationaleMinChars: parseIntEnv(env.SDD_REVIEW_RATIONALE_MIN_CHARS, DEFAULT_RATIONALE_MIN_CHARS),
})

module.exports = {
  DEFAULT_HASH_LEN,
  DEFAULT_SESSION_MAX_REMINDERS,
  DEFAULT_LEDGER_CODE_CAP,
  DEFAULT_SCAN_BUDGET_MS,
  DEFAULT_REMINDER_DEDUPE_MS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_BOOTSTRAP_THRESHOLD,
  DEFAULT_CHANGE_NOTE_CAP,
  DEFAULT_RATIONALE_MIN_CHARS,
  DEFAULT_REMINDER_MODE,
  REMINDER_MODES,
  DISABLE_VALUES,
  normalizeEnvValue,
  isDisabled,
  parseIntEnv,
  parseListEnv,
  isTruthyFlag,
  parseReminderMode,
  readConfig,
}
