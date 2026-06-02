"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const native = require("../../src/adapters/opencode/native-plugin")
const { run } = require("../../src/pipeline")
const { todoPathFor } = require("../../src/core/state-dir")

// The product default is now reminderMode "stop" (review deferred to the Stop sweep).
// These adapter tests verify the active-reminder INJECTION wiring, which needs a mode
// that fires; force once. node --test runs each file in its own process, so this does
// not leak into other suites.
process.env.SDD_REVIEW_REMINDER_MODE = "once"

const mkRepo = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-opencode-")))
  fs.mkdirSync(path.join(root, "sdd", "changes", "greeting"), { recursive: true })
  fs.writeFileSync(path.join(root, "sdd", "changes", "greeting", "design.md"), "# Greeting behavior\n")
  return root
}

const write = (root, rel, content) => {
  const fp = path.join(root, rel)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, content)
}

const rm = (root) => fs.rmSync(root, { recursive: true, force: true })

const makeClient = () => ({
  logs: [],
  app: {
    log: async () => {},
  },
})

const makeHooks = (root) =>
  native({
    directory: root,
    worktree: root,
    client: makeClient(),
  })

const baseline = (root) => run({ repoRoot: root, env: {}, now: "2026-05-31T12:00:00Z", actor: "agent" })

test("OpenCode tool.execute.after: cached edit args drive onEdit and append a model-visible reminder", async () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    baseline(root)
    write(root, "src/a.ts", "v2")

    const hooks = await makeHooks(root)
    const output = { title: "edited", output: "updated src/a.ts", metadata: {} }
    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: "session-A", callID: "call-A" },
      { args: { filePath: "src/a.ts" } }
    )
    await hooks["tool.execute.after"]({ tool: "edit", sessionID: "session-A", callID: "call-A" }, output)

    assert.match(output.output, /updated src\/a\.ts/)
    assert.match(output.output, /\[SDD-REVIEW: NEEDS-REVIEW\]/)
    assert.equal(output.metadata.sddReviewLedger.injected, true)
    assert.equal(output.metadata.sddReviewLedger.channel, "tool.execute.after")
    assert.ok(fs.readFileSync(todoPathFor(root), "utf8").includes("src/a.ts"))
  } finally {
    rm(root)
  }
})

test("OpenCode chat.message opens a new batch; once mode reminds once per turn, re-arms next turn", async () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    baseline(root)
    write(root, "src/a.ts", "v2")

    const hooks = await makeHooks(root)
    const first = { title: "edited", output: "updated a", metadata: {} }
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID: "session-B", callID: "call-1", args: { filePath: "src/a.ts" } },
      first
    )
    assert.match(first.output, /\[SDD-REVIEW/, "first edit of the turn reminds")

    write(root, "src/b.ts", "v1")
    const second = { title: "edited", output: "updated b", metadata: {} }
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: "session-B", callID: "call-2", args: { filePath: "src/b.ts" } },
      second
    )
    assert.doesNotMatch(second.output, /\[SDD-REVIEW/, "once mode (default): a second new path in the same turn is suppressed")

    const chatOutput = {
      message: { role: "user", content: "continue" },
      parts: [{ type: "text", text: "continue" }],
      metadata: {},
    }
    await hooks["chat.message"]({ sessionID: "session-B", messageID: "msg-1" }, chatOutput)
    assert.deepEqual(chatOutput.metadata, {})
    assert.deepEqual(chatOutput.parts, [{ type: "text", text: "continue" }])

    write(root, "src/c.ts", "v1")
    const third = { title: "edited", output: "updated c", metadata: {} }
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: "session-B", callID: "call-3", args: { filePath: "src/c.ts" } },
      third
    )
    assert.match(third.output, /\[SDD-REVIEW/, "a later user turn re-arms and reminds again")
  } finally {
    rm(root)
  }
})

test("OpenCode adapter stays silent outside SDD projects", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-opencode-no-sdd-")))
  try {
    write(root, "notes.md", "# Notes\n")
    const hooks = await makeHooks(root)
    const output = { title: "edited", output: "updated notes", metadata: {} }
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID: "session-no-sdd", callID: "call-1", args: { filePath: "notes.md" } },
      output
    )
    assert.equal(output.output, "updated notes")
    assert.equal(output.metadata.sddReviewLedger, undefined)
    assert.equal(fs.existsSync(todoPathFor(root)), false)
  } finally {
    rm(root)
  }
})

test("OpenCode tool.execute.after: a doc-only change (design ahead of code) does NOT inject a reminder; todo still records it (改进B)", async () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    baseline(root) // bootstrap: design.md + a.ts recorded
    write(root, "sdd/changes/greeting/design.md", "# Greeting behavior\n\n## plan: evening greeting\n")

    const hooks = await makeHooks(root)
    const output = { title: "edited", output: "updated design.md", metadata: {} }
    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: "session-doc", callID: "call-doc" },
      { args: { filePath: "sdd/changes/greeting/design.md" } }
    )
    await hooks["tool.execute.after"]({ tool: "edit", sessionID: "session-doc", callID: "call-doc" }, output)

    assert.doesNotMatch(output.output, /\[SDD-REVIEW/, "docs-ahead-of-code does not actively nag")
    assert.ok(
      fs.readFileSync(todoPathFor(root), "utf8").includes("design.md"),
      "but the doc drift is recorded in the passive todo"
    )
  } finally {
    rm(root)
  }
})

test("OpenCode idle event refreshes passively and deduplicates status/idle bursts", async () => {
  const root = mkRepo()
  try {
    write(root, "src/a.ts", "v1")
    baseline(root)
    write(root, "src/a.ts", "v2")
    const hooks = await makeHooks(root)

    await hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: "session-idle", status: { type: "idle" } },
      },
    })
    await hooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-idle" },
      },
    })

    assert.ok(fs.readFileSync(todoPathFor(root), "utf8").includes("src/a.ts"))
  } finally {
    rm(root)
  }
})
