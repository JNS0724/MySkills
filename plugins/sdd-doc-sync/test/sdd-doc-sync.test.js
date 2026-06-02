"use strict"

const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")

const {
  sanitize,
  isCodePath,
  parseTodo,
  pendingItems,
  upsertPending,
  buildRulesSegment,
  buildStopPrompt,
  editedPathFromEvent,
  discoverChangeDirs,
  isSddProject,
  todoPathFor,
  statePathFor,
  rulesPathFor,
  loadRules,
  handleEvent,
} = require("../sdd-doc-sync")

// ── helpers ───────────────────────────────────────────────────────────────────

// 造一个临时 SDD 仓：sdd/changes/x/design.md 让 isSddProject 为真。
const mkSddRepo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-doc-sync-"))
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

  // .md 文档不登记
  handleEvent(postEdit("sdd/changes/x/design.md"), root)
  const todo2 = fs.readFileSync(todoPathFor(root), "utf8")
  assert.ok(!todo2.includes("design.md"))
})

test("Stop：有待评审 → block 且 reason 含路径；stop_hook_active → 不 block", () => {
  const root = mkSddRepo()
  handleEvent(postEdit("src/foo.ts"), root)

  const res = handleEvent({ hook_event_name: "Stop" }, root)
  assert.ok(res && res.decision === "block")
  assert.ok(res.reason.includes("src/foo.ts"))

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

// ── 规则文件（动态追加评审要求） ──────────────────────────────────────────────

test("无规则 → buildStopPrompt 与不传参逐字节一致（byte-stable）", () => {
  const items = [{ path: "src/a.ts", reason: "Edit" }]
  assert.strictEqual(buildStopPrompt(items), buildStopPrompt(items, null))
  assert.strictEqual(buildStopPrompt(items), buildStopPrompt(items, { lines: [] }))
})

test("buildRulesSegment：无规则 → []；有规则 → 含标题 + 缩进行 + 截断标记", () => {
  assert.deepStrictEqual(buildRulesSegment(null), [])
  assert.deepStrictEqual(buildRulesSegment({ relPath: "x", lines: [] }), [])
  const seg = buildRulesSegment({ relPath: ".sdd-doc-sync-rules.md", lines: ["必须更新 CHANGELOG", "公共 API 改动要标 @since"], truncated: true })
  const joined = seg.join("\n")
  assert.ok(joined.includes("本项目附加评审要求（来自 .sdd-doc-sync-rules.md"))
  assert.ok(joined.includes("  必须更新 CHANGELOG"))
  assert.ok(joined.includes("已截断"))
})

test("loadRules：默认约定文件 / env 覆盖 / 缺失 / 超长截断", () => {
  const root = mkSddRepo()
  assert.strictEqual(loadRules(root, {}), null) // 无文件 → null

  // 默认约定文件
  fs.writeFileSync(path.join(root, ".sdd-doc-sync-rules.md"), "- 必须更新 CHANGELOG\n- 标注 @since\n")
  const r = loadRules(root, {})
  assert.deepStrictEqual(r.lines, ["- 必须更新 CHANGELOG", "- 标注 @since"])
  assert.strictEqual(r.truncated, false)
  assert.strictEqual(r.relPath, ".sdd-doc-sync-rules.md")

  // env 覆盖（相对路径按 repoRoot 解析）
  fs.writeFileSync(path.join(root, "custom.md"), "- 覆盖规则\n")
  const r2 = loadRules(root, { SDD_DOC_SYNC_RULES_FILE: "custom.md" })
  assert.deepStrictEqual(r2.lines, ["- 覆盖规则"])

  // 超长 → 截断标记
  fs.writeFileSync(path.join(root, ".sdd-doc-sync-rules.md"), "x".repeat(5000))
  assert.strictEqual(loadRules(root, {}).truncated, true)
})

test("rulesPathFor：env 优先、绝对路径直用、否则约定默认名", () => {
  assert.ok(rulesPathFor("/repo", {}).endsWith(".sdd-doc-sync-rules.md"))
  assert.strictEqual(rulesPathFor("/repo", { SDD_DOC_SYNC_RULES_FILE: "/abs/rules.md" }), "/abs/rules.md")
})

test("Stop 集成：有规则文件 → 评审提示词追加项目附加评审要求", () => {
  const root = mkSddRepo()
  fs.writeFileSync(path.join(root, ".sdd-doc-sync-rules.md"), "- 必须更新 CHANGELOG\n")
  handleEvent(postEdit("src/foo.ts"), root)
  const res = handleEvent({ hook_event_name: "Stop" }, root)
  assert.ok(res && res.decision === "block")
  assert.ok(res.reason.includes("本项目附加评审要求"))
  assert.ok(res.reason.includes("必须更新 CHANGELOG"))
})

test("Stop 集成：env 覆盖规则文件路径", () => {
  const root = mkSddRepo()
  const abs = path.join(root, "team-rules.md")
  fs.writeFileSync(abs, "- 团队规则：先更新 design\n")
  handleEvent(postEdit("src/foo.ts"), root)
  const res = handleEvent({ hook_event_name: "Stop" }, root, { SDD_DOC_SYNC_RULES_FILE: abs })
  assert.ok(res.reason.includes("团队规则：先更新 design"))
})
