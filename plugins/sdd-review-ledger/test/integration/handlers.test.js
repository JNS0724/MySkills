"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { onEdit } = require("../../src/handlers/on-edit")
const { onPrompt } = require("../../src/handlers/on-prompt")
const { onStop } = require("../../src/handlers/on-stop")
const { dispatch } = require("../../src/dispatch")
const { run } = require("../../src/pipeline")
const { todoPathFor, ledgerPathFor } = require("../../src/core/state-dir")

const mkRepo = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-h-")))
  fs.mkdirSync(path.join(root, "sdd", "changes", "greeting"), { recursive: true })
  fs.writeFileSync(path.join(root, "sdd", "changes", "greeting", "design.md"), "# Greeting 行为\n")
  return root
}
const write = (root, rel, c) => {
  const fp = path.join(root, rel)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, c)
}
const rm = (root) => fs.rmSync(root, { recursive: true, force: true })
const NOW = "2026-05-31T12:00:00Z"
const SID = { session_id: "sess-A" }
// The PRODUCT DEFAULT is now reminderMode "stop" (review deferred to the end-of-turn
// Stop block). These tests exercise the active-reminder MECHANICS (once/growth/T2),
// which are now opt-in, so ectx defaults env to once mode and merges any per-test env
// on top. Dedicated tests below cover the new "stop" default explicitly.
const ectx = (root, extra = {}) => {
  const env = { SDD_REVIEW_REMINDER_MODE: "once", ...(extra.env || {}) }
  return { repoRoot: root, now: NOW, actor: "agent", event: SID, ...extra, env }
}

test("onEdit: first edit with needs delivers a fact-forcing reminder; pipeline wrote todo", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline (no needs)
    write(root, "src/a.ts", "v2")
    const r = onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") }))
    assert.equal(r.deliver, true)
    assert.ok(r.text.includes("[SDD-REVIEW: NEEDS-REVIEW]"))
    assert.ok(r.text.includes("src/a.ts"))
    assert.ok(fs.existsSync(todoPathFor(root)), "passive todo always written by pipeline")
  } finally {
    rm(root)
  }
})

test("onEdit: growth mode — every new-path edit reminds; passive todo still refreshes", () => {
  const root = mkRepo()
  const env = { SDD_REVIEW_REMINDER_MODE: "growth" }
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { env, editedPath: path.join(root, "src/a.ts") })).deliver, true)
    write(root, "src/b.ts", "v1")
    const r2 = onEdit(ectx(root, { env, editedPath: path.join(root, "src/b.ts") }))
    assert.equal(r2.deliver, true, "growth mode: second new path reminds too")
    assert.ok(fs.readFileSync(todoPathFor(root), "utf8").includes("src/b.ts"), "todo still reflects b.ts")
  } finally {
    rm(root)
  }
})

test("onEdit: todo housekeeping writes ingest but do not actively remind", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true)
    write(root, ".sdd-review-todo.md", fs.readFileSync(todoPathFor(root), "utf8"))
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, ".sdd-review-todo.md") })).deliver, false)
  } finally {
    rm(root)
  }
})

test("onPrompt keeps carry-over visible and later edits still remind", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts"), nowMs: 1000 })).deliver, true)
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts"), nowMs: 1001 })).deliver, false, "same-turn re-edit, no path-set growth → suppressed")
    const p = onPrompt(ectx(root))
    assert.equal(p.deliver, true, "carry-over surfaces pending count")
    assert.ok(p.text.includes(".sdd-review-todo.md"))
    write(root, "src/a.ts", "v3")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts"), nowMs: 1002 })).deliver, true, "changed hash reminds again")
  } finally {
    rm(root)
  }
})

test("onEdit: optional session cap (SDD_REVIEW_SESSION_MAX_REMINDERS=1) → only one active reminder", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    const env = { SDD_REVIEW_SESSION_MAX_REMINDERS: "1", SDD_REVIEW_REMINDER_MODE: "once" }
    run({ ...ectx(root), env })
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit({ ...ectx(root), env, editedPath: path.join(root, "src/a.ts") }).deliver, true)
    onPrompt({ ...ectx(root), env }) // new batch
    write(root, "src/a.ts", "v3")
    assert.equal(onEdit({ ...ectx(root), env, editedPath: path.join(root, "src/a.ts") }).deliver, false, "session cap 1 reached")
  } finally {
    rm(root)
  }
})

test("onEdit: no needs → no delivery", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline; nothing pending
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, false)
  } finally {
    rm(root)
  }
})

// ─── dispatch (adapter-level) ───
test("dispatch: PostToolUse Edit → additionalContext JSON; Read → empty", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    const editEvent = {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, "src/a.ts") },
      cwd: root,
      session_id: "sess-A",
    }
    const parsed = JSON.parse(dispatch(editEvent, { SDD_REVIEW_REMINDER_MODE: "once" }).stdout)
    assert.equal(parsed.hookSpecificOutput.hookEventName, "PostToolUse")
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes("[SDD-REVIEW"))

    const readEvent = { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "x" }, cwd: root, session_id: "s" }
    assert.equal(dispatch(readEvent, {}).stdout, "", "Read is not a write tool → silent")
  } finally {
    rm(root)
  }
})

test("dispatch: UserPromptSubmit → carry-over additionalContext when pending", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    run(ectx(root)) // make a.ts pending
    const out = dispatch({ hook_event_name: "UserPromptSubmit", cwd: root, session_id: "sess-A" }, {})
    const parsed = JSON.parse(out.stdout)
    assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit")
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes(".sdd-review-todo.md"))
  } finally {
    rm(root)
  }
})

test("dispatch: escape hatch SDD_REVIEW=off → empty stdout, no writes", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    const ev = { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(root, "src/a.ts") }, cwd: root, session_id: "s" }
    assert.equal(dispatch(ev, { SDD_REVIEW: "off" }).stdout, "")
    assert.equal(fs.existsSync(ledgerPathFor(root)), false)
  } finally {
    rm(root)
  }
})

test("dispatch: unknown event → empty, never throws", () => {
  assert.equal(dispatch({ hook_event_name: "SessionStart" }, {}).stdout, "")
  assert.equal(dispatch({}, {}).stdout, "")
  assert.equal(dispatch(null, {}).stdout, "")
})

// ─── improvement 1 (path-set/turn) + 2 (compact) at the handler level ───
test("onEdit: re-editing the same pending file in one turn is suppressed (改进一)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true, "first edit reminds")
    write(root, "src/a.ts", "v3")
    assert.equal(
      onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver,
      false,
      "same path re-hashed in the same turn → quiet (no growth)"
    )
  } finally {
    rm(root)
  }
})

test("onEdit: growth mode — a new pending path in the same turn re-fires as a COMPACT reminder (改进二)", () => {
  const root = mkRepo()
  const env = { SDD_REVIEW_REMINDER_MODE: "growth" }
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    const first = onEdit(ectx(root, { env, editedPath: path.join(root, "src/a.ts") }))
    assert.equal(first.deliver, true)
    assert.ok(first.text.includes("你是唯一语义裁判"), "first reminder of the turn carries the full protocol")
    write(root, "src/b.ts", "v1")
    const second = onEdit(ectx(root, { env, editedPath: path.join(root, "src/b.ts") }))
    assert.equal(second.deliver, true, "new path b grows the set → re-fire")
    assert.ok(second.text.includes("src/b.ts"))
    assert.ok(!second.text.includes("你是唯一语义裁判"), "same-turn growth uses the compact body, not the full protocol")
  } finally {
    rm(root)
  }
})

test("onEdit: growth mode — a file checked off then re-edited in the SAME turn re-fires (active-channel invariant)", () => {
  const root = mkRepo()
  const env = { SDD_REVIEW_REMINDER_MODE: "growth" }
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline
    write(root, "src/a.ts", "v2")
    // 1) first edit → active reminder
    assert.equal(onEdit(ectx(root, { env, editedPath: path.join(root, "src/a.ts") })).deliver, true)
    // 2) model reviews + checks off a.ts in the pending list (current hash → really clears it)
    const todo = fs.readFileSync(todoPathFor(root), "utf8").replace("- [ ] ", "- [x] ")
    write(root, ".sdd-review-todo.md", todo)
    onEdit(ectx(root, { env, editedPath: path.join(root, ".sdd-review-todo.md") })) // ingest checkoff + prune throttle
    // 3) genuine re-edit of a.ts in the SAME turn → a new obligation, must re-fire (not silenced)
    write(root, "src/a.ts", "v3")
    assert.equal(
      onEdit(ectx(root, { env, editedPath: path.join(root, "src/a.ts") })).deliver,
      true,
      "growth mode: a re-edit after checkoff is a new obligation → active reminder must re-fire"
    )
  } finally {
    rm(root)
  }
})

// ─── once mode (产品默认): one active reminder per turn, turn-end/idle/carry-over backstops ───
test("onEdit: once mode (default) — a second new path in the same turn is suppressed; todo still tracks it", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true, "first edit of the turn reminds")
    write(root, "src/b.ts", "v1")
    assert.equal(
      onEdit(ectx(root, { editedPath: path.join(root, "src/b.ts") })).deliver,
      false,
      "once mode default: a second new path in the same turn does NOT actively remind"
    )
    assert.ok(fs.readFileSync(todoPathFor(root), "utf8").includes("src/b.ts"), "the passive todo still tracks b.ts")
  } finally {
    rm(root)
  }
})

test("once mode: a within-turn-suppressed path is still caught by the end-of-turn Stop sweep", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true)
    write(root, "src/b.ts", "v1")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/b.ts") })).deliver, false, "suppressed in once mode")
    const blocked = onStop(ectx(root, { stopHookActive: false }))
    assert.equal(blocked.block, true, "turn-end Stop blocks while anything is pending")
    assert.ok(blocked.text.includes("src/b.ts"), "the within-turn-suppressed path is surfaced at turn end")
  } finally {
    rm(root)
  }
})

// ─── NEW PRODUCT DEFAULT: reminderMode "stop" — review deferred to the Stop block ───
// Raw ctx with env:{} so the true default (stop) applies, not the once-mode ectx helper.
const sctx = (root, extra = {}) => ({ repoRoot: root, env: {}, now: NOW, actor: "agent", event: SID, ...extra })

test("stop mode (default): an edit does NOT actively remind; ledger+todo refresh; Stop reviews instead", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(sctx(root)) // baseline
    write(root, "src/a.ts", "v2")
    const r = onEdit(sctx(root, { editedPath: path.join(root, "src/a.ts") }))
    assert.equal(r.deliver, false, "default stop mode: no mid-turn active reminder")
    assert.ok(fs.readFileSync(todoPathFor(root), "utf8").includes("src/a.ts"), "todo still refreshes on edit")
    const blocked = onStop(sctx(root, { stopHookActive: false }))
    assert.equal(blocked.block, true, "review happens at the end-of-turn Stop block")
    assert.ok(blocked.text.includes("src/a.ts"))
  } finally {
    rm(root)
  }
})

test("change-note: a prompt's task + the edit's summary surface as clues in the Stop review", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(sctx(root)) // baseline a.ts
    // a user turn states the task → stashed for the task tag
    onPrompt(sctx(root, { event: { session_id: "sess-A", prompt: "实现问候功能" } }))
    // then the model edits the code (Write of new content)
    const content = "export const greet = () => 'hi'"
    write(root, "src/a.ts", content)
    onEdit(
      sctx(root, {
        editedPath: path.join(root, "src/a.ts"),
        event: { session_id: "sess-A", tool_name: "Write", tool_input: { content } },
      })
    )
    const blocked = onStop(sctx(root, { stopHookActive: false }))
    assert.equal(blocked.block, true)
    assert.ok(blocked.text.includes("↳ 变更线索"), "the Stop review carries the change clue")
    assert.ok(blocked.text.includes("[任务: 实现问候功能]"), "and the task tag from the triggering prompt")
  } finally {
    rm(root)
  }
})

// ─── on-stop / Stop end-of-turn safety net (改进三) ───
test("onStop: pending → block once with full review protocol; stop_hook_active → no block", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    run(ectx(root)) // a.ts pending
    const blocked = onStop(ectx(root, { stopHookActive: false }))
    assert.equal(blocked.block, true)
    assert.ok(blocked.text.includes("[SDD-REVIEW"))
    assert.ok(blocked.text.includes("src/a.ts"))
    assert.ok(blocked.text.includes("你是唯一语义裁判"), "stop block carries the full protocol")
    const second = onStop(ectx(root, { stopHookActive: true }))
    assert.equal(second.block, false, "stop_hook_active → at most one block (no wedge loop)")
  } finally {
    rm(root)
  }
})

test("onStop: no pending → never blocks (lets the turn finish)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline; nothing pending
    assert.equal(onStop(ectx(root, { stopHookActive: false })).block, false)
  } finally {
    rm(root)
  }
})

test("dispatch: Stop with pending → decision block + reason; stop_hook_active → empty", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    run(ectx(root))
    const out = dispatch({ hook_event_name: "Stop", cwd: root, session_id: "sess-A" }, {})
    const parsed = JSON.parse(out.stdout)
    assert.equal(parsed.decision, "block")
    assert.ok(parsed.reason.includes("[SDD-REVIEW"))
    assert.ok(parsed.reason.includes("src/a.ts"))
    const guarded = dispatch({ hook_event_name: "Stop", stop_hook_active: true, cwd: root, session_id: "sess-A" }, {})
    assert.equal(guarded.stdout, "", "stop_hook_active → no re-block")
  } finally {
    rm(root)
  }
})

test("dispatch: Stop with nothing pending → empty stdout", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline only
    assert.equal(dispatch({ hook_event_name: "Stop", cwd: root, session_id: "sess-A" }, {}).stdout, "")
  } finally {
    rm(root)
  }
})

test("dispatch: Stop escape hatch SDD_REVIEW=off → empty, no block", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    run(ectx(root))
    assert.equal(dispatch({ hook_event_name: "Stop", cwd: root, session_id: "sess-A" }, { SDD_REVIEW: "off" }).stdout, "")
  } finally {
    rm(root)
  }
})

// ─── 改进 B（文档领先代码 = 计划，不主动催、不自动写实现）───
// 主动通道（onEdit 提醒 / onStop 收尾 / onPrompt carry-over）只由 code 变更驱动。
// design/tasks/proposal 领先 code 永远只被动记进 todo（绝不丢项），不主动打扰。
test("onEdit: a design-doc change with code unchanged does NOT actively remind; todo still records it (改进B)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline: design.md + a.ts recorded, nothing pending
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## 计划：晚间问候\n")
    const r = onEdit(ectx(root, { editedPath: path.join(root, "sdd/changes/greeting/design.md") }))
    assert.equal(r.deliver, false, "docs ahead of code is a plan, not a build order → no active reminder")
    assert.ok(
      fs.readFileSync(todoPathFor(root), "utf8").includes("design.md"),
      "the passive todo still records the doc drift (nothing dropped)"
    )
  } finally {
    rm(root)
  }
})

test("onStop: doc-only drift (design ahead of code) does NOT block the turn end (改进B)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## 计划：晚间问候\n")
    run(ectx(root)) // design.md now pending (doc only)
    assert.equal(
      onStop(ectx(root, { stopHookActive: false })).block,
      false,
      "doc-ahead drift never blocks the turn end"
    )
  } finally {
    rm(root)
  }
})

test("onPrompt: doc-only drift does NOT resurface as carry-over (改进B: 改文档下一轮不被唠叨)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## 计划：晚间问候\n")
    run(ectx(root)) // design.md pending (doc only)
    assert.equal(onPrompt(ectx(root)).deliver, false, "a fresh turn does not nag about doc-ahead drift")
  } finally {
    rm(root)
  }
})

test("onEdit: a real code change still reminds even while a doc is also pending; the doc rides only in the todo (改进B)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## 计划\n")
    write(root, "src/a.ts", "v2")
    const r = onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") }))
    assert.equal(r.deliver, true, "a code change is the direction that actively nags")
    assert.ok(r.text.includes("src/a.ts"))
    assert.ok(!r.text.includes("design.md"), "the active reminder is code-driven; the doc is not in the active list")
    assert.ok(
      fs.readFileSync(todoPathFor(root), "utf8").includes("design.md"),
      "the doc is still tracked in the passive todo"
    )
  } finally {
    rm(root)
  }
})

// ─── 扩展 A+B：项目自定义规则真正进入首条完整提醒（opt-in；缺省零变化）───
test("onEdit: a repo-root sdd-review-rules.md injects a project-rules addendum into the full reminder (扩展B)", () => {
  const root = mkRepo()
  try {
    write(root, "sdd-review-rules.md", "团队规则：改了支付代码必须同步更新风控文档\n问候语改动需检查 i18n 资源\n")
    write(root, "src/a.ts", "v1")
    run(ectx(root)) // baseline
    write(root, "src/a.ts", "v2")
    const r = onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") }))
    assert.equal(r.deliver, true)
    assert.ok(r.text.includes("项目附加规则"), "addendum segment present")
    assert.ok(r.text.includes("改了支付代码必须同步更新风控文档"), "custom rule content reaches the model")
    assert.ok(r.text.includes("sdd-review-rules.md"), "segment header points at the resolved file (A)")
    assert.ok(r.text.includes("你是唯一语义裁判"), "frozen protocol still rides intact after the addendum")
  } finally {
    rm(root)
  }
})

test("onEdit: SDD_REVIEW_RULES_FILE custom path overrides; no rules file → no addendum (扩展A)", () => {
  const root = mkRepo()
  try {
    write(root, "docs/team-rules.md", "唯一来自 env 的规则行\n")
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    const env = { SDD_REVIEW_RULES_FILE: "docs/team-rules.md" }
    const r = onEdit(ectx(root, { env, editedPath: path.join(root, "src/a.ts") }))
    assert.ok(r.text.includes("唯一来自 env 的规则行"), "env-pointed rules injected")
    assert.ok(r.text.includes("docs/team-rules.md"), "header points at the env path")

    // no rules file at all → addendum absent (default install: byte-unchanged behavior)
    const root2 = mkRepo()
    try {
      write(root2, "src/a.ts", "v1")
      run(ectx(root2))
      write(root2, "src/a.ts", "v2")
      const r2 = onEdit(ectx(root2, { editedPath: path.join(root2, "src/a.ts") }))
      assert.ok(!r2.text.includes("项目附加规则"), "no rules file → no addendum segment")
    } finally {
      rm(root2)
    }
  } finally {
    rm(root)
  }
})

// ─── T2 折中兜底：review 后自造的新 pending（同回合 Stop / 跨回合一次性 carry）───
// 信号：本回合触发过 active review（快照了当时 pending）+ 回合末出现快照里没有的 path@hash。
const tickPath = (root, rel) => {
  const todo = fs.readFileSync(todoPathFor(root), "utf8")
  write(root, ".sdd-review-todo.md", todo.replace(`- [ ] ${rel}@`, `- [x] ${rel}@`))
}

test("onStop: model edits a doc AFTER this turn's code review → short leftover block names it (T2 同回合)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true, "code review fires + snapshots pending")
    tickPath(root, "src/a.ts")
    onEdit(ectx(root, { editedPath: path.join(root, ".sdd-review-todo.md") })) // ingest checkoff
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## review 后补的说明\n")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "sdd/changes/greeting/design.md") })).deliver, false, "the doc edit itself stays quiet (B)")
    const blocked = onStop(ectx(root, { stopHookActive: false }))
    assert.equal(blocked.block, true, "the review-induced new pending is caught at turn end")
    assert.ok(blocked.text.includes("design.md"), "names the post-review doc")
    assert.ok(!blocked.text.includes("你是唯一语义裁判"), "short hint, NOT the full 4-step protocol")
    assert.equal(onStop(ectx(root, { stopHookActive: true })).block, false, "stop_hook_active → no wedge")
  } finally {
    rm(root)
  }
})

test("onStop: a doc pending BEFORE this turn's review is in the snapshot → NOT a leftover (T2 不误报既有 pending)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## 计划\n")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "sdd/changes/greeting/design.md") })).deliver, false, "planning doc edit is quiet (B); no review → no snapshot yet")
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true, "code review fires; snapshot includes the already-pending design.md")
    tickPath(root, "src/a.ts")
    onEdit(ectx(root, { editedPath: path.join(root, ".sdd-review-todo.md") }))
    assert.equal(
      onStop(ectx(root, { stopHookActive: false })).block,
      false,
      "the design.md was pending at review time → in the snapshot → not review-induced"
    )
  } finally {
    rm(root)
  }
})

test("onStop: only a doc changed this turn (pure planning, no review fired) → no leftover block (T2 不误报规划)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## 计划\n")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "sdd/changes/greeting/design.md") })).deliver, false)
    assert.equal(
      onStop(ectx(root, { stopHookActive: false })).block,
      false,
      "no active review this turn → no snapshot → leftover backstop must stay silent"
    )
  } finally {
    rm(root)
  }
})

test("onPrompt: a review-induced doc leftover surfaces once next turn, then stops repeating (T2 跨回合一次性)", () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    run(ectx(root))
    // turn 1: code review fires (snapshots), tick a.ts, then edit a doc → leftover (idle can't block on OpenCode)
    write(root, "src/a.ts", "v2")
    assert.equal(onEdit(ectx(root, { editedPath: path.join(root, "src/a.ts") })).deliver, true)
    tickPath(root, "src/a.ts")
    onEdit(ectx(root, { editedPath: path.join(root, ".sdd-review-todo.md") }))
    write(root, "sdd/changes/greeting/design.md", "# Greeting 行为\n\n## review 后补\n")
    onEdit(ectx(root, { editedPath: path.join(root, "sdd/changes/greeting/design.md") }))
    // turn 2: next prompt → one-shot carry names the leftover
    const p2 = onPrompt(ectx(root))
    assert.equal(p2.deliver, true, "cross-turn one-shot surfaces the review-induced leftover")
    assert.ok(p2.text.includes("design.md"))
    assert.ok(p2.text.includes("<system-reminder>"))
    // turn 3: consumed → no repeat, even though design.md is still passively pending
    assert.equal(onPrompt(ectx(root)).deliver, false, "one-shot: not nagged on every later turn")
  } finally {
    rm(root)
  }
})
