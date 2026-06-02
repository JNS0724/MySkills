"use strict"

// The minimal ledger (极简账本): a plain JSON map  path -> record  (detailed-design §5.1).
// This module is pure shape + (de)serialization. No locks, no IO orchestration —
// that lives in the pipeline. Corruption self-heals to an empty ledger (§5.1).

const LEDGER_VERSION = 1

const emptyLedger = () => ({ version: LEDGER_VERSION, records: {} })

// Parse text → ledger. Anything malformed (bad JSON, wrong shape) → empty ledger.
// This is the "delete & rebuild" self-heal: worst case we re-judge one round.
const parseLedger = (text) => {
  if (typeof text !== "string" || text.trim() === "") return emptyLedger()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return emptyLedger()
  }
  if (!data || typeof data !== "object" || typeof data.records !== "object" || data.records === null) {
    return emptyLedger()
  }
  return { version: LEDGER_VERSION, records: { ...data.records } }
}

const serializeLedger = (ledger) =>
  JSON.stringify({ version: LEDGER_VERSION, records: ledger.records || {} }, null, 2)

// Immutable upsert of a record (coding-style: never mutate input).
const withRecord = (ledger, key, record) => ({
  version: LEDGER_VERSION,
  records: { ...ledger.records, [key]: record },
})

const getRecord = (ledger, key) => (ledger.records ? ledger.records[key] : undefined)

// trackCodePath: ensure a code path is tracked, WITHOUT clobbering an existing
// reviewedHash (capture path, §七). First sighting → reviewedHash:null.
const trackCodePath = (ledger, key, meta = {}) => {
  if (getRecord(ledger, key)) return ledger // already tracked; capture never overwrites
  return withRecord(ledger, key, {
    kind: "code",
    reviewedHash: null,
    verdict: null,
    rationale: "",
    reviewedAt: null,
    by: null,
    ...meta,
  })
}

// appendChangeNote: attach a change-note clue to a code record WITHOUT clobbering its
// reviewedHash/verdict (capture-side, like trackCodePath). Keeps only the most recent
// `cap` notes. A checkoff (ingestCheckoffs rebuilds the whole record via withRecord and
// drops changeNotes) naturally clears them, so changeNotes always means "changes since
// last review". cap<=0 or a falsy note → no-op (feature disabled). Immutable.
const appendChangeNote = (ledger, key, note, cap = 3) => {
  if (!note || cap <= 0) return ledger
  const base =
    getRecord(ledger, key) || {
      kind: "code",
      reviewedHash: null,
      verdict: null,
      rationale: "",
      reviewedAt: null,
      by: null,
    }
  const prev = Array.isArray(base.changeNotes) ? base.changeNotes : []
  return withRecord(ledger, key, { ...base, changeNotes: [...prev, note].slice(-cap) })
}

module.exports = {
  LEDGER_VERSION,
  emptyLedger,
  parseLedger,
  serializeLedger,
  withRecord,
  getRecord,
  trackCodePath,
  appendChangeNote,
}
