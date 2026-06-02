#!/usr/bin/env node
"use strict"

// sdd-doc-sync — 轻量级 demo 插件（Claude Code hook）。
//
// 场景：用 SDD 开发，前期有 design.md/tasks.md，进入编码后滑进 vibe coding 不再同步文档
// → 代码领先于文档。本插件机械地把"受改的代码文件"登记到一个 todo 文件，在收尾（Stop）
// 时用强硬的结构化提示词逼模型自己去读这些文件 + 对应 design/tasks 评审，敦促它把文档同步，
// 并把评审结果记在同一个 todo（勾选 [x] + 理由）。
//
// 设计取舍（保持轻量）：不注入 git diff、不做内容哈希/ledger、无第三方依赖、无构建步骤。
// 不变量：MECHANICAL-ONLY（不做语义判断，只收集材料端给模型）、FAIL-OPEN（出错静默 exit 0）、
// NO-FALSE-CLEAN（只有模型勾 [x] 才算清除，编辑代码绝不自动清除）、NO-WEDGE-LOOP（stop_hook_active
// 守卫，至多打断一次）。纯函数与 I/O 分离，仅 require.main 时执行 main()，便于 node --test。

const fs = require("fs")
const path = require("path")

// ── 常量 ──────────────────────────────────────────────────────────────────────
const TODO_FILE = ".sdd-doc-sync.md"
const STATE_FILE = ".sdd-doc-sync-state.json"
const HEADER = "# SDD 文档同步评审（自动维护：代码改动后在此登记；勾选 [x] = 已评审/已同步）"
const SANITIZE_MAX = 300
const LAST_PROMPT_MAX = 120
// 可选规则文件（小 trick）：动态往 Stop 评审提示词里追加"项目附加评审要求"。优先用
// SDD_DOC_SYNC_RULES_FILE 指定的路径，否则取仓库根的 .sdd-doc-sync-rules.md。改文件即生效。
const RULES_FILE = ".sdd-doc-sync-rules.md"
const RULES_ENV = "SDD_DOC_SYNC_RULES_FILE"
const RULES_MAX_BYTES = 4096
// `- [ ] path` 或 `- [x] path — 理由`。path 不含空白；理由可选。
const TODO_LINE = /^- \[([ x])\] (\S+)(?: — (.*))?$/
// SDD change-dir 约定（与 sdd-review-ledger 一致）。
const CHANGE_PARENTS = ["sdd/changes", ".sdd/changes"]
const DOC_NAMES = ["proposal.md", "design.md", "tasks.md"]
const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/i
// 视作"代码"的后缀（命中才登记；.md / sdd 文档不登记）。
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".kt", ".kts", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php",
  ".swift", ".scala", ".m", ".sh", ".bash", ".zsh", ".sql", ".vue", ".svelte",
])

// ── 纯工具 ────────────────────────────────────────────────────────────────────

const toPosix = (p) => String(p == null ? "" : p).replace(/\\/g, "/")

// sanitize：剥离换行/C0 控制符/bidi-override（防止内容把提示词或 todo 结构带歪），截断超长。
const sanitize = (s) => {
  const input = String(s == null ? "" : s)
  let out = ""
  for (const ch of input) {
    const code = ch.codePointAt(0)
    const isCtrl = code <= 0x1f || code === 0x7f
    const isBidi =
      (code >= 0x200e && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    out += isCtrl || isBidi ? " " : ch
  }
  return out.trim().slice(0, SANITIZE_MAX)
}

// sanitizeLine：与 sanitize 一样剥离控制符/bidi，但用于规则文件的"每一行"——保留行内文本与
// 左侧缩进，只去掉行尾空白并限长（不把多行塌成一行）。
const sanitizeLine = (s) => {
  const input = String(s == null ? "" : s)
  let out = ""
  for (const ch of input) {
    const code = ch.codePointAt(0)
    const isCtrl = code <= 0x1f || code === 0x7f
    const isBidi =
      (code >= 0x200e && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    out += isCtrl || isBidi ? " " : ch
  }
  return out.replace(/\s+$/u, "").slice(0, SANITIZE_MAX)
}

// byteSlice：按 UTF-8 字节预算在码点边界处截断（中文按字节算，避免截碎多字节）。
const byteSlice = (s, maxBytes) => {
  const str = String(s == null ? "" : s)
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str
  let bytes = 0
  let out = ""
  for (const ch of str) {
    const b = Buffer.byteLength(ch, "utf8")
    if (bytes + b > maxBytes) break
    bytes += b
    out += ch
  }
  return out
}

// isCodePath：repo 相对（或任意）路径是否算"代码文件"。.md / sdd 文档目录排除。
const isCodePath = (p) => {
  const posix = toPosix(p).toLowerCase()
  if (!posix || posix.endsWith(".md")) return false
  if (posix.startsWith("sdd/") || posix.startsWith(".sdd/") || posix.includes("/sdd/")) return false
  const dot = posix.lastIndexOf(".")
  if (dot < 0) return false
  return CODE_EXT.has(posix.slice(dot))
}

// parseTodo：扁平复选框清单 → [{ checked, path, reason }]。
const parseTodo = (text) => {
  const items = []
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const m = TODO_LINE.exec(line)
    if (!m) continue
    items.push({ checked: m[1] === "x", path: m[2], reason: (m[3] || "").trim() })
  }
  return items
}

// pendingItems：仅未勾选（[ ]）项 = 待评审。
const pendingItems = (text) => parseTodo(text).filter((it) => !it.checked)

const ensureHeader = (lines) => (lines.some((l) => l.startsWith("# ")) ? lines : [HEADER, "", ...lines])

const splitLines = (text) => {
  const lines = String(text == null ? "" : text).split(/\r?\n/)
  // split 在以 \n 结尾时尾随一个空串；去掉它，写回时统一补一个 \n。
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  return lines
}

const joinTodo = (lines) => `${lines.join("\n")}\n`

// upsertPending：确保 path 在清单里有一条未勾选行（纯函数，返回新文本）。
//   - 已有未勾选行 → 原样返回（不重复、不覆盖既有理由）。
//   - 只剩已勾选行（评过又改了）→ 把该行翻回 [ ] 并更新理由（触发重评）。
//   - 没有任何行 → 追加一条新 [ ] 行（必要时补标题）。
const upsertPending = (text, rawPath, rawReason) => {
  const p = sanitize(rawPath)
  const original = String(text == null ? "" : text)
  if (!p) return original
  const reason = sanitize(rawReason)
  const lines = splitLines(original)
  let checkedIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = TODO_LINE.exec(lines[i])
    if (!m || m[2] !== p) continue
    if (m[1] === " ") return original // 已待评审 → 不动
    if (checkedIdx === -1) checkedIdx = i
  }
  const newLine = `- [ ] ${p}${reason ? ` — ${reason}` : ""}`
  if (checkedIdx >= 0) {
    const next = lines.slice()
    next[checkedIdx] = newLine
    return joinTodo(ensureHeader(next))
  }
  return joinTodo(ensureHeader([...lines, newLine]))
}

// buildRulesSegment：把可选规则文件的内容渲染成"项目附加评审要求"段（纯函数）。无规则 → []，
// 此时 buildStopPrompt 输出与未启用时逐字节一致（byte-stable）。
const buildRulesSegment = (rules) => {
  if (!rules || !Array.isArray(rules.lines) || rules.lines.length === 0) return []
  const seg = [
    "",
    `本项目附加评审要求（来自 ${rules.relPath}，务必逐条一并满足；是否偏差仍由你判断）:`,
    ...rules.lines.map((l) => `  ${l}`),
  ]
  if (rules.truncated) seg.push(`  （规则文件超长，已截断；完整内容见 ${rules.relPath}）`)
  return seg
}

// buildStopPrompt：强硬的结构化评审提示词（Stop block 的 reason）。让模型先取证、再下结论，
// 代码领先文档就直接改 design/tasks 同步。rules 可选：把项目附加评审要求插在待评审清单之后、
// 通用评审纪律之前（靠前更易被遵循）。
const buildStopPrompt = (items, rules) => {
  const list = items.map((it) => {
    const reason = sanitize(it.reason)
    return `  - ${sanitize(it.path)}${reason ? ` — ${reason}` : ""}`
  })
  return [
    "[SDD-DOC-SYNC: 待同步评审]",
    `收尾前检测到 ${items.length} 个代码文件已改动、文档可能落后，请在结束本回合前逐项评审：`,
    "待评审：",
    ...list,
    ...buildRulesSegment(rules),
    "",
    "评审纪律（你是唯一裁判；下结论前必须先取证，不接受裸判断）。对每个待评审文件，按此结构输出，最后才下结论：",
    "  1. 读取该代码文件，引用其当前关键实现（具体函数/行为）",
    "  2. 读取对应 sdd/changes/<change>/design.md 与 tasks.md，引用其当前声明（具体一句/一段）",
    '  3. 二者是否一致？指出冲突点，或写"经对照无冲突"',
    "  4. 结论：",
    "     - 代码领先文档（design/tasks 未反映该实现）→ 直接编辑 design.md / tasks.md 使其同步（这就是本工具的目的）",
    "     - 一致 / 纯重构 / 无关 → 在 .sdd-doc-sync.md 把该行 [ ] 改为 [x]，并在 — 后补一句含第 3 步依据的理由",
    "",
    "最终门槛（必做，勿略）：",
    "  ① 同步文档后你新改动的文件也要重新评审；",
    '  ② .sdd-doc-sync.md 仍有 [ ] 未勾时，不要说"已完成同步"，要说明还剩哪些；',
    "  ③ 清除待评审项的唯一方式 = 在 .sdd-doc-sync.md 把对应行 [ ] 改为 [x] 并附理由（编辑代码不自动清除，也不要手写新增 [ ] 行）。",
  ].join("\n")
}

// editedPathFromEvent：从 PostToolUse 事件取受改文件路径（Edit/Write 顶层 file_path；
// 某些形态用 edits[0].file_path 兜底）。
const editedPathFromEvent = (event) => {
  const ti = (event && event.tool_input) || {}
  if (ti.file_path) return ti.file_path
  if (Array.isArray(ti.edits) && ti.edits.length && ti.edits[0] && ti.edits[0].file_path) {
    return ti.edits[0].file_path
  }
  return undefined
}

// ── I/O（薄封装，全部 fail-open） ──────────────────────────────────────────────

const existsDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// findRepoRoot：从 cwd 向上找 .git / sdd / .sdd 标记，找不到就用 cwd。
const findRepoRoot = (start) => {
  let dir = path.resolve(start || ".")
  for (let i = 0; i < 50; i += 1) {
    if (existsDir(path.join(dir, ".git")) || existsDir(path.join(dir, "sdd")) || existsDir(path.join(dir, ".sdd"))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(start || ".")
}

// discoverChangeDirs：列出含 SDD 文档的 change-dir（相对 posix 路径，稳定排序）。
const discoverChangeDirs = (repoRoot) => {
  const out = []
  for (const parent of CHANGE_PARENTS) {
    const base = path.join(repoRoot, parent)
    let entries
    try {
      entries = fs.readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const abs = path.join(base, e.name)
      const hasDoc = DOC_NAMES.some((n) => {
        try {
          return fs.statSync(path.join(abs, n)).isFile()
        } catch {
          return false
        }
      })
      if (hasDoc) out.push(toPosix(path.relative(repoRoot, abs)))
    }
  }
  return out.sort()
}

const isSddProject = (repoRoot) => discoverChangeDirs(repoRoot).length > 0

const todoPathFor = (repoRoot) => path.join(repoRoot, TODO_FILE)
const statePathFor = (repoRoot) => path.join(repoRoot, STATE_FILE)

const readFileSafe = (file) => {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

// writeFileAtomic：tmp + rename；Windows 下 rename 覆盖已存在文件会抛 EEXIST/EPERM，
// 先 unlink 再重试一次。任何失败 → false（fail-open，调用方不依赖返回值）。
const writeFileAtomic = (file, text) => {
  const tmp = `${file}.tmp.${process.pid}`
  try {
    fs.writeFileSync(tmp, text)
    try {
      fs.renameSync(tmp, file)
    } catch (err) {
      if (err && (err.code === "EEXIST" || err.code === "EPERM")) {
        try {
          fs.unlinkSync(file)
        } catch {
          /* ignore */
        }
        fs.renameSync(tmp, file)
      } else {
        throw err
      }
    }
    return true
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore stray tmp */
    }
    return false
  }
}

const loadLastPrompt = (repoRoot) => {
  try {
    const d = JSON.parse(fs.readFileSync(statePathFor(repoRoot), "utf8"))
    return typeof d.lastPrompt === "string" ? d.lastPrompt : ""
  } catch {
    return ""
  }
}

const saveLastPrompt = (repoRoot, prompt) => {
  writeFileAtomic(statePathFor(repoRoot), JSON.stringify({ lastPrompt: sanitize(prompt).slice(0, LAST_PROMPT_MAX) }))
}

// rulesPathFor：规则文件绝对路径。env 覆盖优先（相对路径按 repoRoot 解析），否则用约定的默认名。
const rulesPathFor = (repoRoot, env = process.env) => {
  const override = String((env && env[RULES_ENV]) || "").trim()
  if (override) return path.isAbsolute(override) ? override : path.join(repoRoot, override)
  return path.join(repoRoot, RULES_FILE)
}

// loadRules：读规则文件 → { relPath, lines, truncated } | null（fail-open）。空/缺失/读不出 → null。
// 按字节上限码点安全截断，逐行消毒，去掉尾随空行。
const loadRules = (repoRoot, env = process.env) => {
  const abs = rulesPathFor(repoRoot, env)
  let raw
  try {
    raw = fs.readFileSync(abs, "utf8")
  } catch {
    return null
  }
  if (!raw || !raw.trim()) return null
  const truncated = Buffer.byteLength(raw, "utf8") > RULES_MAX_BYTES
  const body = truncated ? byteSlice(raw, RULES_MAX_BYTES) : raw
  const lines = body.split(/\r?\n/).map(sanitizeLine)
  while (lines.length && lines[lines.length - 1] === "") lines.pop()
  if (lines.length === 0) return null
  let relPath
  try {
    relPath = toPosix(path.relative(repoRoot, abs))
  } catch {
    relPath = RULES_FILE
  }
  if (!relPath || relPath.startsWith("..")) relPath = toPosix(abs)
  return { relPath: sanitize(relPath), lines, truncated }
}

// ── 事件处理（纯：给定 event + repoRoot → hook 输出对象或 null） ──────────────────

const handleEvent = (event, repoRoot, env = process.env) => {
  const hook = (event && (event.hook_event_name || event.hookEventName)) || ""
  if (!isSddProject(repoRoot)) return null // 非 SDD 项目 → 全程静默

  if (hook === "UserPromptSubmit") {
    saveLastPrompt(repoRoot, (event && (event.prompt || event.promptText)) || "")
    return null
  }

  if (hook === "PostToolUse") {
    const tool = (event && event.tool_name) || ""
    if (!EDIT_TOOLS.test(tool)) return null
    const edited = editedPathFromEvent(event)
    if (!edited) return null
    const rel = toPosix(path.isAbsolute(edited) ? path.relative(repoRoot, edited) : edited)
    if (!rel || rel.startsWith("..") || !isCodePath(rel)) return null
    const last = loadLastPrompt(repoRoot)
    const reason = `${tool}${last ? ` · ${last}` : ""}`
    const file = todoPathFor(repoRoot)
    const before = readFileSafe(file)
    const after = upsertPending(before, rel, reason)
    if (after !== before) writeFileAtomic(file, after)
    return null // 静默：评审统一推到 Stop，不打断开发
  }

  if (hook === "Stop") {
    if (event && (event.stop_hook_active || event.stopHookActive)) return null // 至多打断一次
    const items = pendingItems(readFileSafe(todoPathFor(repoRoot)))
    if (items.length === 0) return null
    return { decision: "block", reason: buildStopPrompt(items, loadRules(repoRoot, env)) }
  }

  return null
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

const MAX_STDIN = 10 * 1024 * 1024

const readStdin = () =>
  new Promise((resolve) => {
    let data = ""
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve(data)
    }
    try {
      if (process.stdin.isTTY) {
        resolve("")
        return
      }
      process.stdin.setEncoding("utf8")
    } catch {
      resolve("")
      return
    }
    process.stdin.on("data", (chunk) => {
      data += chunk
      if (data.length > MAX_STDIN) {
        data = data.slice(0, MAX_STDIN)
        finish()
      }
    })
    process.stdin.on("end", finish)
    process.stdin.on("error", finish)
  })

const main = async () => {
  const raw = await readStdin()
  let event = {}
  try {
    event = raw ? JSON.parse(raw) : {}
  } catch {
    event = {}
  }
  let out = null
  try {
    const cwd = (event && event.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
    out = handleEvent(event, findRepoRoot(cwd), process.env)
  } catch {
    out = null // fail-open
  }
  if (out) process.stdout.write(JSON.stringify(out))
  process.exit(0)
}

module.exports = {
  TODO_FILE,
  STATE_FILE,
  RULES_FILE,
  RULES_ENV,
  HEADER,
  TODO_LINE,
  toPosix,
  sanitize,
  sanitizeLine,
  byteSlice,
  isCodePath,
  parseTodo,
  pendingItems,
  upsertPending,
  buildRulesSegment,
  buildStopPrompt,
  editedPathFromEvent,
  findRepoRoot,
  discoverChangeDirs,
  isSddProject,
  todoPathFor,
  statePathFor,
  rulesPathFor,
  loadRules,
  loadLastPrompt,
  saveLastPrompt,
  writeFileAtomic,
  readFileSafe,
  handleEvent,
}

if (require.main === module) main().catch(() => process.exit(0))
