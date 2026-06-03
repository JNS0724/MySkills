"use strict"

const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { pathToFileURL } = require("node:url")

const {
  sanitize,
  isCodePath,
  parseTodo,
  pendingItems,
  upsertPending,
  DEFAULT_STOP_PROMPT_TEMPLATE,
  buildStopPrompt,
  renderPromptTemplate,
  editedPathFromEvent,
  discoverChangeDirs,
  generatedDirFor,
  isSddProject,
  todoPathFor,
  todoRefFor,
  statePathFor,
  rulesPathFor,
  loadRules,
  handleEvent,
} = require("../sdd-doc-sync")

let SddDocSyncOpenCode
let opencodePrivate

test.before(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "sdd-doc-sync-opencode.js")).href)
  SddDocSyncOpenCode = mod.SddDocSyncOpenCode
  opencodePrivate = mod._private
})

// ── helpers ───────────────────────────────────────────────────────────────────

// 造一个临时 SDD 仓：sdd/changes/x/design.md 让 isSddProject 为真。
const mkSddRepo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-"))
  fs.mkdirSync(path.join(root, ".git"), { recursive: true })
  fs.mkdirSync(path.join(root, "sdd", "changes", "x"), { recursive: true })
  fs.writeFileSync(path.join(root, "sdd", "changes", "x", "design.md"), "# X\n按时段返回问候\n")
  return root
}

const mkPlainRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-plain-"))

const postEdit = (filePath, tool = "Edit") => ({
  hook_event_name: "PostToolUse",
  tool_name: tool,
  tool_input: { file_path: filePath },
})

const makeOpenCodeHooks = (root, prompts = [], logs = [], toasts = []) =>
  SddDocSyncOpenCode({
    directory: root,
    worktree: root,
    client: {
      app: {
        log: async (entry) => logs.push(entry),
      },
      tui: {
        showToast: async (entry) => toasts.push(entry),
      },
      session: {
        prompt: async (payload) => prompts.push(payload),
      },
    },
  })

const readJsonl = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : []

// ── 纯函数 ────────────────────────────────────────────────────────────────────

test("sanitize 剥离换行/控制符/bidi 并截断", () => {
  assert.strictEqual(sanitize("a\nb\tc"), "a b c")
  assert.strictEqual(sanitize("  trim me  "), "trim me")
  assert.ok(!sanitize("x‮y").includes("‮"))
  assert.strictEqual(sanitize("z".repeat(400)).length, 300)
})

test("isCodePath: 代码命中、文档/sdd 不命中", () => {
  assert.strictEqual(isCodePath("src/foo.ts"), true)
  assert.strictEqual(isCodePath("a/b/c.py"), true)
  assert.strictEqual(isCodePath("lib\\win\\path.go"), true) // 反斜杠归一化
  assert.strictEqual(isCodePath("docs/readme.md"), false)
  assert.strictEqual(isCodePath("sdd/changes/x/design.md"), false)
  assert.strictEqual(isCodePath("sdd/changes/x/notes.ts"), false) // sdd 目录排除
  assert.strictEqual(isCodePath("Makefile"), false) // 无后缀
})

test("parseTodo 解析勾选/未勾选 + 理由", () => {
  const text = [
    "# 标题",
    "",
    "- [ ] src/a.ts — Edit · 修复登录",
    "- [x] src/b.ts — design 说X，code 做X，一致",
    "随便一行",
    "- [ ] src/c.ts",
  ].join("\n")
  const items = parseTodo(text)
  assert.strictEqual(items.length, 3)
  assert.deepStrictEqual(items[0], { checked: false, path: "src/a.ts", reason: "Edit · 修复登录" })
  assert.deepStrictEqual(items[1], { checked: true, path: "src/b.ts", reason: "design 说X，code 做X，一致" })
  assert.deepStrictEqual(items[2], { checked: false, path: "src/c.ts", reason: "" })
})

test("pendingItems 只返回未勾选项", () => {
  const text = "- [ ] a.ts — r\n- [x] b.ts — done\n- [ ] c.ts\n"
  assert.deepStrictEqual(
    pendingItems(text).map((i) => i.path),
    ["a.ts", "c.ts"],
  )
})

test("upsertPending: 新路径追加 [ ] 行 + 标题", () => {
  const out = upsertPending("", "src/foo.ts", "Edit · 修复")
  assert.ok(out.includes("# SDD"))
  assert.ok(out.includes("- [ ] src/foo.ts — Edit · 修复"))
})

test("upsertPending: 已存在未勾行 → 原样不动（不重复、不覆盖理由）", () => {
  const before = "# t\n\n- [ ] src/foo.ts — 原理由\n"
  const after = upsertPending(before, "src/foo.ts", "新理由")
  assert.strictEqual(after, before)
})

test("upsertPending: 只剩已勾行（评过又改）→ 翻回 [ ] 并更新理由", () => {
  const before = "# t\n\n- [x] src/foo.ts — 上次评审一致\n"
  const after = upsertPending(before, "src/foo.ts", "Edit · 又改了")
  const items = parseTodo(after)
  const foo = items.filter((i) => i.path === "src/foo.ts")
  assert.strictEqual(foo.length, 1) // 至多一行 per path
  assert.strictEqual(foo[0].checked, false)
  assert.strictEqual(foo[0].reason, "Edit · 又改了")
})

test("buildStopPrompt: 含路径 + 同步指令 + 三条门槛", () => {
  const prompt = buildStopPrompt([
    { path: "src/a.ts", reason: "Edit" },
    { path: "src/b.ts", reason: "" },
  ])
  assert.ok(prompt.includes("[SDD-DOC-SYNC: 待同步评审]"))
  assert.ok(prompt.includes("src/a.ts — Edit"))
  assert.ok(prompt.includes("src/b.ts"))
  assert.ok(prompt.includes("直接编辑 design.md / tasks.md"))
  assert.ok(prompt.includes("①") && prompt.includes("②") && prompt.includes("③"))
})

test("buildStopPrompt: 注入换行的路径不产生越界列表行", () => {
  const prompt = buildStopPrompt([{ path: "a.ts\n  - 伪造越界行", reason: "" }])
  const bulletLines = prompt.split("\n").filter((l) => /^ {2}- /.test(l))
  assert.strictEqual(bulletLines.length, 1) // 仍只有 1 个列表项
})

test("editedPathFromEvent: file_path 与 edits[0].file_path 兜底", () => {
  assert.strictEqual(editedPathFromEvent({ tool_input: { file_path: "a.ts" } }), "a.ts")
  assert.strictEqual(
    editedPathFromEvent({ tool_input: { edits: [{ file_path: "b.ts" }] } }),
    "b.ts",
  )
  assert.strictEqual(editedPathFromEvent({ tool_input: {} }), undefined)
})

// ── SDD 探测 ──────────────────────────────────────────────────────────────────

test("discoverChangeDirs / isSddProject", () => {
  const sdd = mkSddRepo()
  const plain = mkPlainRepo()
  assert.deepStrictEqual(discoverChangeDirs(sdd), ["sdd/changes/x"])
  assert.strictEqual(isSddProject(sdd), true)
  assert.strictEqual(isSddProject(plain), false)
})

test("generated files live under .git/sdd-doc-sync in git repositories", () => {
  const root = mkSddRepo()
  try {
    assert.strictEqual(generatedDirFor(root), path.join(root, ".git", "sdd-doc-sync"))
    assert.strictEqual(todoPathFor(root), path.join(root, ".git", "sdd-doc-sync", ".sdd-doc-sync.md"))
    assert.strictEqual(statePathFor(root), path.join(root, ".git", "sdd-doc-sync", ".sdd-doc-sync-state.json"))
    assert.strictEqual(todoRefFor(root), ".git/sdd-doc-sync/.sdd-doc-sync.md")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ── handleEvent 集成 ──────────────────────────────────────────────────────────

test("非 SDD 项目：全程静默、不建文件", () => {
  const root = mkPlainRepo()
  assert.strictEqual(handleEvent(postEdit("src/foo.ts"), root), null)
  assert.strictEqual(handleEvent({ hook_event_name: "Stop" }, root), null)
  assert.strictEqual(handleEvent({ hook_event_name: "UserPromptSubmit", prompt: "hi" }, root), null)
  assert.strictEqual(fs.existsSync(todoPathFor(root)), false)
})

test("PostToolUse 代码改动 → 登记 [ ] 行；文档改动不登记", () => {
  const root = mkSddRepo()
  assert.strictEqual(handleEvent(postEdit("src/foo.ts"), root), null) // 静默
  const todo = fs.readFileSync(todoPathFor(root), "utf8")
  assert.ok(todo.includes("- [ ] src/foo.ts"))
  assert.strictEqual(fs.existsSync(path.join(root, ".sdd-doc-sync.md")), false)

  // .md 文档不登记
  handleEvent(postEdit("sdd/changes/x/design.md"), root)
  const todo2 = fs.readFileSync(todoPathFor(root), "utf8")
  assert.ok(!todo2.includes("design.md"))
})

test("legacy root todo is read when upgrading to internal generated files", () => {
  const root = mkSddRepo()
  try {
    fs.writeFileSync(path.join(root, ".sdd-doc-sync.md"), "# old\n\n- [ ] src/old.ts — legacy\n")
    handleEvent(postEdit("src/new.ts"), root)
    const todo = fs.readFileSync(todoPathFor(root), "utf8")
    assert.ok(todo.includes("- [ ] src/old.ts"))
    assert.ok(todo.includes("- [ ] src/new.ts"))
    const res = handleEvent({ hook_event_name: "Stop" }, root)
    assert.ok(res.reason.includes("src/old.ts"))
    assert.ok(res.reason.includes("src/new.ts"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Stop：有待评审 → block 且 reason 含路径；stop_hook_active → 不 block", () => {
  const root = mkSddRepo()
  handleEvent(postEdit("src/foo.ts"), root)

  const res = handleEvent({ hook_event_name: "Stop" }, root)
  assert.ok(res && res.decision === "block")
  assert.ok(res.reason.includes("src/foo.ts"))
  assert.ok(res.reason.includes(".git/sdd-doc-sync/.sdd-doc-sync.md"))

  // 已经打断过一次 → 放行（NO-WEDGE-LOOP）
  assert.strictEqual(handleEvent({ hook_event_name: "Stop", stop_hook_active: true }, root), null)
})

test("Stop：勾掉 [x] 后不再 block（评审记录留存）", () => {
  const root = mkSddRepo()
  handleEvent(postEdit("src/foo.ts"), root)
  // 模拟模型评审后勾选
  fs.writeFileSync(todoPathFor(root), "# t\n\n- [x] src/foo.ts — design 与 code 一致\n")
  assert.strictEqual(handleEvent({ hook_event_name: "Stop" }, root), null)
})

test("UserPromptSubmit：写 lastPrompt，并作为后续登记的理由标签", () => {
  const root = mkSddRepo()
  handleEvent({ hook_event_name: "UserPromptSubmit", prompt: "修复登录流程" }, root)
  const state = JSON.parse(fs.readFileSync(statePathFor(root), "utf8"))
  assert.strictEqual(state.lastPrompt, "修复登录流程")

  handleEvent(postEdit("src/login.ts"), root)
  const todo = fs.readFileSync(todoPathFor(root), "utf8")
  assert.ok(todo.includes("- [ ] src/login.ts — Edit · 修复登录流程"))
})

// ── Stop prompt 模板文件 ─────────────────────────────────────────────────────

test("无模板 → buildStopPrompt 使用当前内置默认模板", () => {
  const items = [{ path: "src/a.ts", reason: "Edit" }]
  assert.strictEqual(buildStopPrompt(items), buildStopPrompt(items, null))
  assert.strictEqual(buildStopPrompt(items), renderPromptTemplate(DEFAULT_STOP_PROMPT_TEMPLATE, items, ".sdd-doc-sync.md"))
})

test("renderPromptTemplate：只替换动态占位符，不追加默认提示词", () => {
  const text = renderPromptTemplate(
    "CUSTOM {{pendingCount}}\n{{pendingItems}}\nTODO={{todoFile}}",
    [{ path: "src/a.ts", reason: "Edit" }],
    ".git/sdd-doc-sync/.sdd-doc-sync.md",
  )
  assert.strictEqual(text, "CUSTOM 1\n  - src/a.ts — Edit\nTODO=.git/sdd-doc-sync/.sdd-doc-sync.md")
})

test("loadRules：仓库根模板优先，其次插件同级模板，都不存在则返回 null", () => {
  const root = mkSddRepo()
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-plugin-"))
  const emptyPluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-empty-plugin-"))
  try {
    assert.strictEqual(loadRules(root, {}, emptyPluginDir), null)

    fs.writeFileSync(path.join(pluginDir, ".sdd-doc-sync-rules.md"), "PLUGIN {{pendingItems}}")
    const pluginRules = loadRules(root, {}, pluginDir)
    assert.strictEqual(pluginRules.text, "PLUGIN {{pendingItems}}")

    fs.writeFileSync(path.join(root, ".sdd-doc-sync-rules.md"), "ROOT {{pendingItems}}")
    const rootRules = loadRules(root, {}, pluginDir)
    assert.strictEqual(rootRules.relPath, ".sdd-doc-sync-rules.md")
    assert.strictEqual(rootRules.text, "ROOT {{pendingItems}}")

    fs.writeFileSync(path.join(root, "custom.md"), "ENV {{pendingItems}}")
    const envRules = loadRules(root, { SDD_DOC_SYNC_RULES_FILE: "custom.md" }, pluginDir)
    assert.strictEqual(envRules.relPath, "custom.md")
    assert.strictEqual(envRules.text, "ENV {{pendingItems}}")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(pluginDir, { recursive: true, force: true })
    fs.rmSync(emptyPluginDir, { recursive: true, force: true })
  }
})

test("示例模板文件可复制为仓库根完整 Stop prompt 模板", () => {
  const root = mkSddRepo()
  try {
    fs.copyFileSync(
      path.join(__dirname, "..", ".sdd-doc-sync-rules.example.md"),
      path.join(root, ".sdd-doc-sync-rules.md"),
    )
    const r = loadRules(root, {})
    const rendered = buildStopPrompt([{ path: "src/example.ts", reason: "Write" }], r.text, todoRefFor(root))
    assert.strictEqual(r.relPath, ".sdd-doc-sync-rules.md")
    assert.ok(rendered.includes("[SDD-DOC-SYNC: 待同步评审]"))
    assert.ok(rendered.includes("src/example.ts — Write"))
    assert.ok(rendered.includes(".git/sdd-doc-sync/.sdd-doc-sync.md"))
    assert.ok(!rendered.includes("{{pendingItems}}"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("rulesPathFor：env 优先、仓库根优先于插件同级目录", () => {
  const root = mkSddRepo()
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-plugin-"))
  try {
    fs.writeFileSync(path.join(pluginDir, ".sdd-doc-sync-rules.md"), "PLUGIN")
    assert.strictEqual(rulesPathFor(root, {}, pluginDir), path.join(pluginDir, ".sdd-doc-sync-rules.md"))
    fs.writeFileSync(path.join(root, ".sdd-doc-sync-rules.md"), "ROOT")
    assert.strictEqual(rulesPathFor(root, {}, pluginDir), path.join(root, ".sdd-doc-sync-rules.md"))
    assert.strictEqual(rulesPathFor(root, { SDD_DOC_SYNC_RULES_FILE: "/abs/rules.md" }, pluginDir), "/abs/rules.md")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(pluginDir, { recursive: true, force: true })
  }
})

test("Stop 集成：仓库根模板完全覆盖默认提示词", () => {
  const root = mkSddRepo()
  fs.writeFileSync(path.join(root, ".sdd-doc-sync-rules.md"), "CUSTOM ONLY\n{{pendingCount}}\n{{pendingItems}}\n{{todoFile}}")
  handleEvent(postEdit("src/foo.ts"), root)
  const res = handleEvent({ hook_event_name: "Stop" }, root)
  assert.ok(res && res.decision === "block")
  assert.ok(res.reason.startsWith("CUSTOM ONLY\n1\n  - src/foo.ts"))
  assert.ok(res.reason.includes(".git/sdd-doc-sync/.sdd-doc-sync.md"))
  assert.ok(!res.reason.includes("评审纪律"))
})

test("Stop 集成：env 覆盖模板文件路径", () => {
  const root = mkSddRepo()
  const abs = path.join(root, "team-rules.md")
  fs.writeFileSync(abs, "ENV ONLY {{pendingItems}}")
  handleEvent(postEdit("src/foo.ts"), root)
  const res = handleEvent({ hook_event_name: "Stop" }, root, { SDD_DOC_SYNC_RULES_FILE: abs })
  assert.strictEqual(res.reason, "ENV ONLY   - src/foo.ts — Edit")
})

// OpenCode native plugin adapter

test("OpenCode chat.message + edit tool registers a code file with the user prompt tag", async () => {
  assert.strictEqual(typeof opencodePrivate, "function")
  const root = mkSddRepo()
  try {
    const hooks = await makeOpenCodeHooks(root)

    await hooks["chat.message"](
      { sessionID: "session-A", message: { role: "user", content: "fix login flow" } },
      { message: { role: "user" }, parts: [{ type: "text", text: "fix login flow" }] }
    )
    assert.strictEqual(JSON.parse(fs.readFileSync(statePathFor(root), "utf8")).lastPrompt, "fix login flow")
    assert.strictEqual(fs.existsSync(path.join(root, ".sdd-doc-sync-state.json")), false)

    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: "session-A", callID: "call-A" },
      { args: { filePath: "src/login.ts" } }
    )
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID: "session-A", callID: "call-A" },
      { title: "edited", output: "updated login" }
    )

    const todo = fs.readFileSync(todoPathFor(root), "utf8")
    assert.ok(todo.includes("- [ ] src/login.ts"))
    assert.ok(todo.includes("Edit · fix login flow"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OpenCode adapter works after copying only the plugin file", async () => {
  const root = mkSddRepo()
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-opencode-only-"))
  try {
    const copied = path.join(pluginDir, "sdd-doc-sync-opencode.js")
    fs.copyFileSync(path.join(__dirname, "..", "sdd-doc-sync-opencode.js"), copied)
    assert.strictEqual(fs.existsSync(path.join(pluginDir, "sdd-doc-sync.js")), false)

    const mod = await import(`${pathToFileURL(copied).href}?standalone=${Date.now()}`)
    const prompts = []
    const hooks = await mod.SddDocSyncOpenCode({
      directory: root,
      worktree: root,
      client: {
        app: { log: async () => {} },
        session: { prompt: async (payload) => prompts.push(payload) },
      },
    })

    await hooks["chat.message"](
      { sessionID: "session-standalone", message: { role: "user", content: "standalone install" } },
      { message: { role: "user" }, parts: [{ type: "text", text: "standalone install" }] }
    )
    await hooks["tool.execute.after"](
      {
        tool: "write",
        sessionID: "session-standalone",
        callID: "call-standalone",
        args: { filePath: "src/standalone.ts" },
      },
      { title: "written", output: "created src/standalone.ts" }
    )

    const todo = fs.readFileSync(mod._private.todoPathFor(root), "utf8")
    assert.ok(todo.includes("- [ ] src/standalone.ts"))
    assert.ok(todo.includes("Write"))
    assert.ok(todo.includes("standalone install"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(pluginDir, { recursive: true, force: true })
  }
})

test("OpenCode adapter extracts apply_patch paths and records them as edits", async () => {
  const root = mkSddRepo()
  const patchText = [
    "*** Begin Patch",
    "*** Update File: src/patched.ts",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n")

  try {
    assert.strictEqual(opencodePrivate.patchFilePath(patchText), "src/patched.ts")
    const hooks = await makeOpenCodeHooks(root)

    await hooks["tool.execute.after"](
      { tool: "apply_patch", sessionID: "session-patch", callID: "call-patch", args: { patch: patchText } },
      { title: "patched", output: "patched src/patched.ts" }
    )

    assert.ok(fs.readFileSync(todoPathFor(root), "utf8").includes("- [ ] src/patched.ts"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OpenCode idle event sends the Stop review prompt as an automatic session message", async () => {
  const root = mkSddRepo()
  const prompts = []
  const toasts = []
  try {
    handleEvent(postEdit("src/foo.ts"), root)
    const hooks = await makeOpenCodeHooks(root, prompts, [], toasts)
    await hooks["chat.message"](
      {
        sessionID: "session-idle",
        agent: "docsync",
        model: { providerID: "deepseek", modelID: "deepseek-chat" },
        message: { role: "user", content: "implement checkout badge" },
      },
      { message: { role: "user" }, parts: [{ type: "text", text: "implement checkout badge" }] }
    )

    await hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: "session-idle", status: { type: "idle" } },
      },
    })
    assert.strictEqual(prompts.length, 1)
    assert.deepStrictEqual(prompts[0].path, { id: "session-idle" })
    assert.deepStrictEqual(prompts[0].query, { directory: path.resolve(root) })
    assert.deepStrictEqual(prompts[0].body.model, { providerID: "deepseek", modelID: "deepseek-chat" })
    assert.strictEqual(prompts[0].body.agent, "docsync")
    assert.strictEqual(prompts[0].body.parts[0].type, "text")
    assert.strictEqual(prompts[0].body.parts[0].synthetic, true)
    assert.strictEqual(prompts[0].body.parts[0].metadata.source, "sdd-doc-sync-opencode")
    assert.ok(prompts[0].body.parts[0].text.includes("[SDD-DOC-SYNC"))
    assert.ok(prompts[0].body.parts[0].text.includes("src/foo.ts"))
    assert.ok(prompts[0].body.parts[0].text.includes(".git/sdd-doc-sync/.sdd-doc-sync.md"))

    const outbox = readJsonl(opencodePrivate.outboxPathFor(root))
    assert.strictEqual(outbox.length, 2)
    assert.strictEqual(opencodePrivate.outboxPathFor(root), path.join(root, ".git", "sdd-doc-sync", ".sdd-doc-sync-outbox.jsonl"))
    assert.strictEqual(fs.existsSync(path.join(root, ".sdd-doc-sync-outbox.jsonl")), false)
    assert.strictEqual(outbox[0].status, "queued")
    assert.strictEqual(outbox[1].status, "sent")
    assert.strictEqual(outbox[0].id, outbox[1].id)
    assert.strictEqual(outbox[0].sessionID, "session-idle")
    assert.strictEqual(outbox[0].reason, "automatic-stop-review")
    assert.strictEqual(outbox[0].pendingCount, 1)
    assert.strictEqual(outbox[0].message, prompts[0].body.parts[0].text)
    assert.strictEqual(outbox[1].message, prompts[0].body.parts[0].text)
    assert.strictEqual(toasts.length, 1)
    assert.strictEqual(toasts[0].body.title, "SDD doc-sync reminder sent")
    assert.ok(toasts[0].body.message.includes(".git/sdd-doc-sync/.sdd-doc-sync-outbox.jsonl"))
    assert.ok(toasts[0].body.message.includes(".sdd-doc-sync-outbox.jsonl"))
    assert.ok(!toasts[0].body.message.includes("[SDD-DOC-SYNC"))
    assert.ok(!toasts[0].body.message.includes("src/foo.ts"))

    await hooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-idle" },
      },
    })
    assert.strictEqual(prompts.length, 1)
    assert.strictEqual(readJsonl(opencodePrivate.outboxPathFor(root)).length, 2)
    assert.strictEqual(toasts.length, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OpenCode idle event records failed automatic Stop review prompts without changing the prompt payload", async () => {
  const root = mkSddRepo()
  const prompts = []
  const logs = []
  const toasts = []
  try {
    handleEvent(postEdit("src/failing.ts"), root)
    const hooks = await SddDocSyncOpenCode({
      directory: root,
      worktree: root,
      client: {
        app: {
          log: async (entry) => logs.push(entry),
        },
        tui: {
          showToast: async (entry) => toasts.push(entry),
        },
        session: {
          promptAsync: async (payload) => {
            prompts.push(payload)
            throw new Error("prompt transport down")
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-failed" },
      },
    })

    assert.strictEqual(prompts.length, 2, "v1 payload and flat fallback were both attempted")
    const outbox = readJsonl(opencodePrivate.outboxPathFor(root))
    assert.strictEqual(outbox.length, 2)
    assert.strictEqual(outbox[0].status, "queued")
    assert.strictEqual(outbox[1].status, "failed")
    assert.strictEqual(outbox[0].id, outbox[1].id)
    assert.strictEqual(outbox[0].message, prompts[0].body.parts[0].text)
    assert.strictEqual(outbox[1].message, prompts[0].body.parts[0].text)
    assert.ok(outbox[1].error.includes("prompt transport down"))
    assert.strictEqual(toasts.length, 1)
    assert.strictEqual(toasts[0].body.title, "SDD doc-sync reminder queued")
    assert.ok(!toasts[0].body.message.includes("[SDD-DOC-SYNC"))
    assert.ok(logs.some((entry) => entry.body?.message === "automatic Stop review continuation failed"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OpenCode idle event without pending items does not write outbox or toast", async () => {
  const root = mkSddRepo()
  const prompts = []
  const toasts = []
  try {
    const hooks = await makeOpenCodeHooks(root, prompts, [], toasts)
    await hooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-empty" },
      },
    })

    assert.strictEqual(prompts.length, 0)
    assert.strictEqual(toasts.length, 0)
    assert.strictEqual(fs.existsSync(opencodePrivate.outboxPathFor(root)), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OpenCode promptSessionCompat falls back to the v2 flat SDK payload shape", async () => {
  const root = mkSddRepo()
  const calls = []
  try {
    const sent = await opencodePrivate.promptSessionCompat(
      {
        directory: root,
        worktree: root,
        client: {
          session: {
            promptAsync: async (payload) => {
              calls.push(payload)
              if (calls.length === 1) throw new Error("v1 shape unavailable")
            },
          },
        },
      },
      "session-v2",
      "review pending docs",
      { agent: "docsync", model: { providerID: "minimax", modelID: "minimax-text" } }
    )
    assert.strictEqual(sent, true)
    assert.strictEqual(calls.length, 2)
    assert.deepStrictEqual(calls[1], {
      sessionID: "session-v2",
      directory: path.resolve(root),
      agent: "docsync",
      model: { providerID: "minimax", modelID: "minimax-text" },
      parts: [
        {
          type: "text",
          text: "review pending docs",
          synthetic: true,
          metadata: { source: "sdd-doc-sync-opencode" },
        },
      ],
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OpenCode adapter stays silent outside SDD projects", async () => {
  const root = mkPlainRepo()
  try {
    const hooks = await makeOpenCodeHooks(root)
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: "session-plain", callID: "call-plain", args: { filePath: "src/plain.ts" } },
      { title: "written", output: "created src/plain.ts" }
    )
    assert.strictEqual(fs.existsSync(todoPathFor(root)), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
