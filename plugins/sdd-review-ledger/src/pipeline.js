"use strict"

const fs = require("fs")
const path = require("path")
const { readConfig } = require("./core/config")
const { rel, toPosix, resolveFile } = require("./core/paths")
const { classifyPath } = require("./core/classify")
const { hashElement } = require("./core/hash")
const {
  emptyLedger,
  parseLedger,
  serializeLedger,
  withRecord,
  trackCodePath,
  appendChangeNote,
} = require("./core/ledger")
const { resolveSessionKey } = require("./core/session-key")
const { loadLastPrompt } = require("./core/session-context")
const { buildChangeNote } = require("./core/change-note")
const { ingestCheckoffs } = require("./core/ingest")
const { parseTodo, renderTodo } = require("./core/todo")
const { discoverChangeDirs } = require("./core/change-dirs")
const { scanWorkTree } = require("./core/scan")
const { computeNeedsReview } = require("./core/compute")
const { acquireFileLock, releaseFileLock } = require("./core/locks")
const { writeTextAtomic } = require("./core/atomic")
const { resolveStateDir, ledgerPathFor, todoPathFor } = require("./core/state-dir")
const { diag } = require("./core/diagnostics")

// pipeline.run(ctx) — the single-run backbone shared by every handler (§七).
// Order铁律: INGEST → CAPTURE → COMPUTE → WRITE → DELIVER, all under one lock,
// reading the todo once. Fail-open everywhere: any error → SILENT.

const isSddProject = (repoRoot) => discoverChangeDirs(repoRoot).length > 0

const ledgerEmpty = (ledger) => !ledger || !ledger.records || Object.keys(ledger.records).length === 0

const loadLedgerFile = (ledgerPath) => {
  try {
    return parseLedger(fs.readFileSync(ledgerPath, "utf8"))
  } catch {
    return emptyLedger() // missing or unreadable → empty (self-heal §5.1)
  }
}

const readTodoFile = (todoPath) => {
  try {
    return fs.readFileSync(todoPath, "utf8")
  } catch {
    return ""
  }
}

const fileMeta = (abs) => {
  try {
    const s = fs.statSync(abs)
    return { mtimeMs: s.mtimeMs, size: s.size }
  } catch {
    return {}
  }
}

const keyFor = (repoRoot, fp) => toPosix(rel(repoRoot, resolveFile(repoRoot, fp)))

// R1 §6.1 auto-baseline (承重): only when this IS an sdd project and the ledger is
// empty. Records existing docs+code at their current hash with verdict "bootstrap"
// so a stock repo does not surface as all-pending. Honest silent baseline, not
// "verified".
const bootstrapIfEmpty = (repoRoot, ledger, cfg, now) => {
  if (!ledgerEmpty(ledger)) return { ledger, bootstrapped: false, count: 0 }
  const files = []
  for (const d of discoverChangeDirs(repoRoot)) {
    for (const doc of d.docs) files.push(`${d.relDir}/${doc}`)
  }
  for (const c of scanWorkTree(repoRoot, ledger, cfg).codePaths) files.push(c)
  const uniq = [...new Set(files)]
  if (uniq.length < cfg.bootstrapThreshold) return { ledger, bootstrapped: false, count: 0 }

  let next = ledger
  let count = 0
  for (const relPath of uniq) {
    const abs = path.join(repoRoot, relPath)
    const h = hashElement(abs, cfg.hashLen)
    if (h === null) continue
    next = withRecord(next, relPath, {
      kind: classifyPath(relPath),
      reviewedHash: h,
      verdict: "bootstrap",
      rationale: "",
      reviewedAt: now,
      by: "bootstrap",
      ...fileMeta(abs),
    })
    count += 1
  }
  return { ledger: next, bootstrapped: true, count }
}

const runInner = (ctx) => {
  const env = ctx.env || process.env
  const cfg = readConfig(env)

  // R2 #1: escape hatch — first line, before anything (even isSddProject / scan).
  if (cfg.disabled) return { action: "silent", reason: "disabled" }

  const repoRoot = ctx.repoRoot
  const now = ctx.now || new Date().toISOString()
  const actor = ctx.actor || "agent"
  const stateDir = resolveStateDir(repoRoot)
  const ledgerPath = ledgerPathFor(repoRoot)
  const todoPath = todoPathFor(repoRoot)

  // Non-SDD project with empty ledger → silent, write nothing.
  const probe = loadLedgerFile(ledgerPath)
  if (!isSddProject(repoRoot) && ledgerEmpty(probe)) {
    return { action: "silent", reason: "not-sdd" }
  }

  const lock = acquireFileLock(ledgerPath, { waitMs: 500, retryMs: 25, staleMs: 30000 })
  if (!lock) {
    // fail-open: read-only recompute + deliver, skip write, defer ingest to next run.
    diag(stateDir, { event: "lock-fail", repoRoot })
    const needs = computeNeedsReview(repoRoot, probe, cfg)
    return { action: "deliver", needs: needs.items, meta: needs.meta, wrote: false, ledger: probe }
  }

  try {
    let ledger = loadLedgerFile(ledgerPath)

    // INGEST must precede render (§5.3): turn checkoffs into verdicts first.
    // Tier 0 counter + Tier 1 gate ride here: classify each checkoff syntactically, and
    // when the gate is on, withhold the clear for a too-short rationale (stays pending).
    const checkoffStats = { thin: 0, substantive: 0, refsPath: 0, held: 0, total: 0 }
    const heldPaths = []
    ledger = ingestCheckoffs(ledger, parseTodo(readTodoFile(todoPath)), now, actor, {
      gateOn: cfg.rationaleGate,
      minChars: cfg.rationaleMinChars,
      onCheckoff: (s) => {
        checkoffStats.total += 1
        checkoffStats[s.thin ? "thin" : "substantive"] += 1
        if (s.refsPath) checkoffStats.refsPath += 1
        if (s.held) {
          checkoffStats.held += 1
          heldPaths.push(s.path)
        }
      },
    })
    if (checkoffStats.total > 0) diag(stateDir, { event: "checkoff-rationale", ...checkoffStats })

    // auto-baseline (cold start) before capture/compute.
    const boot = bootstrapIfEmpty(repoRoot, ledger, cfg, now)
    ledger = boot.ledger
    if (boot.bootstrapped) diag(stateDir, { event: "auto-baseline", count: boot.count })

    // CAPTURE: ensure the just-edited code path is tracked (never clobbers a hash),
    // then record a change-note clue (改了什么 + 在做哪个任务) for the Stop review.
    if (ctx.editedPath && classifyPath(ctx.editedPath) === "code") {
      const key = keyFor(repoRoot, ctx.editedPath)
      ledger = trackCodePath(ledger, key, fileMeta(path.join(repoRoot, key)))
      if (cfg.changeNoteCap > 0) {
        const sessionKey = resolveSessionKey(ctx.event || {}, env, repoRoot)
        const note = buildChangeNote({
          toolName: ctx.event && ctx.event.tool_name,
          toolInput: ctx.event && ctx.event.tool_input,
          task: loadLastPrompt(stateDir, sessionKey),
          now,
        })
        ledger = appendChangeNote(ledger, key, note, cfg.changeNoteCap)
      }
    }

    const needs = computeNeedsReview(repoRoot, ledger, cfg)
    if (needs.meta && needs.meta.scanTruncated) {
      diag(stateDir, { event: "scan-truncated", skipped: needs.meta.skipped })
    }

    const okLedger = writeTextAtomic(ledgerPath, serializeLedger(ledger))
    const okTodo = writeTextAtomic(todoPath, renderTodo(needs.items, ledger, { meta: needs.meta, heldPaths }))
    if (!okLedger || !okTodo) diag(stateDir, { event: "write-skipped", okLedger, okTodo })

    return {
      action: boot.bootstrapped ? "bootstrap" : "deliver",
      needs: needs.items,
      meta: needs.meta,
      wrote: okLedger && okTodo,
      bootstrapped: boot.bootstrapped,
      bootstrapCount: boot.count,
      ledger,
      ledgerPath,
      todoPath,
    }
  } finally {
    releaseFileLock(lock)
  }
}

const run = (ctx) => {
  try {
    return runInner(ctx)
  } catch (e) {
    // NFR: never throw to the user. Best-effort diag, then silent.
    try {
      diag(resolveStateDir(ctx.repoRoot), { event: "error", error: String((e && e.message) || e) })
    } catch {
      /* ignore */
    }
    return { action: "silent", reason: "error", error: String((e && e.message) || e) }
  }
}

module.exports = {
  run,
  runInner,
  isSddProject,
  ledgerEmpty,
  bootstrapIfEmpty,
  loadLedgerFile,
  keyFor,
}
