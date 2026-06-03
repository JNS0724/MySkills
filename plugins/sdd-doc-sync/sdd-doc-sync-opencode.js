import { createRequire as __sddCreateRequire } from "node:module"

const require = __sddCreateRequire(import.meta.url)

const fs = require("node:fs")
const path = require("node:path")

const TODO_FILE = ".sdd-doc-sync.md"
const STATE_FILE = ".sdd-doc-sync-state.json"
const RULES_FILE = ".sdd-doc-sync-rules.md"
const RULES_ENV = "SDD_DOC_SYNC_RULES_FILE"
const RULES_MAX_BYTES = 4096
const HEADER = "# SDD 文档同步评审（自动维护：代码改动后在此登记；勾选 [x] = 已评审/已同步）"
const SANITIZE_MAX = 300
const LAST_PROMPT_MAX = 120
const TODO_LINE = /^- \[([ x])\] (\S+)(?: — (.*))?$/
const CHANGE_PARENTS = ["sdd/changes", ".sdd/changes"]
const DOC_NAMES = ["proposal.md", "design.md", "tasks.md"]
const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/i
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".kt", ".kts", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php",
  ".swift", ".scala", ".m", ".sh", ".bash", ".zsh", ".sql", ".vue", ".svelte",
])

const toPosix = (p) => String(p == null ? "" : p).replace(/\\/g, "/")

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

const isCodePath = (p) => {
  const posix = toPosix(p).toLowerCase()
  if (!posix || posix.endsWith(".md")) return false
  if (posix.startsWith("sdd/") || posix.startsWith(".sdd/") || posix.includes("/sdd/")) return false
  const dot = posix.lastIndexOf(".")
  if (dot < 0) return false
  return CODE_EXT.has(posix.slice(dot))
}

const parseTodo = (text) => {
  const items = []
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const m = TODO_LINE.exec(line)
    if (!m) continue
    items.push({ checked: m[1] === "x", path: m[2], reason: (m[3] || "").trim() })
  }
  return items
}

const pendingItems = (text) => parseTodo(text).filter((it) => !it.checked)
const ensureHeader = (lines) => (lines.some((l) => l.startsWith("# ")) ? lines : [HEADER, "", ...lines])

const splitLines = (text) => {
  const lines = String(text == null ? "" : text).split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  return lines
}

const joinTodo = (lines) => `${lines.join("\n")}\n`

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
    if (m[1] === " ") return original
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

const buildRulesSegment = (rules) => {
  if (!rules || !Array.isArray(rules.lines) || rules.lines.length === 0) return []
  const seg = [
    "",
    `本项目附加评审要求（来自 ${rules.relPath}，必须逐条评估；是否偏差仍由你判断）:`,
    ...rules.lines.map((l) => `  ${l}`),
  ]
  if (rules.truncated) seg.push(`  （规则文件超长，已截断；完整内容见 ${rules.relPath}）`)
  return seg
}

const buildStopPrompt = (items, rules) => {
  const list = items.map((it) => {
    const reason = sanitize(it.reason)
    return `  - ${sanitize(it.path)}${reason ? ` — ${reason}` : ""}`
  })
  return [
    "[SDD-DOC-SYNC: 待同步评审]",
    `收尾前检测到 ${items.length} 个代码文件已改动，文档可能落后。请在结束前逐项评审。`,
    "待评审：",
    ...list,
    ...buildRulesSegment(rules),
    "",
    "评审纪律：你是唯一裁判；下结论前必须先取证，不接受裸判断。对每个待评审文件按此结构处理：",
    "  1. 读取该代码文件，引用具体关键实现（函数/行为）。",
    "  2. 读取对应 sdd/changes/<change>/design.md 和 tasks.md，引用当前声明。",
    "  3. 判断代码与文档是否一致，指出冲突点，或写“经对照无冲突”。",
    "  4. 结论：",
    "     - 代码领先文档：直接编辑 design.md / tasks.md 使其同步。",
    "     - 一致 / 纯重构 / 无关：在 .sdd-doc-sync.md 把该行 [ ] 改为 [x]，并在 — 后补一条包含第 3 步依据的理由。",
    "",
    "最终门槛（必须做到）：",
    "  1. 同步文档后，你新改动的文件也要重新评审。",
    "  2. .sdd-doc-sync.md 仍有 [ ] 时，不要说已经完成同步，要说明还剩哪些。",
    "  3. 清除待评审项的唯一方式 = 在 .sdd-doc-sync.md 把对应行 [ ] 改为 [x] 并附理由。",
  ].join("\n")
}

const editedPathFromEvent = (event) => {
  const ti = (event && event.tool_input) || {}
  if (ti.file_path) return ti.file_path
  if (Array.isArray(ti.edits) && ti.edits.length && ti.edits[0] && ti.edits[0].file_path) {
    return ti.edits[0].file_path
  }
  return undefined
}

const existsDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

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

const writeFileAtomic = (file, text) => {
  const tmp = `${file}.tmp.${process.pid}`
  try {
    fs.writeFileSync(tmp, text)
    try {
      fs.renameSync(tmp, file)
    } catch (error) {
      if (error && (error.code === "EEXIST" || error.code === "EPERM")) {
        try {
          fs.unlinkSync(file)
        } catch {
          /* ignore */
        }
        fs.renameSync(tmp, file)
      } else {
        throw error
      }
    }
    return true
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    return false
  }
}

const loadLastPrompt = (repoRoot) => {
  try {
    const data = JSON.parse(fs.readFileSync(statePathFor(repoRoot), "utf8"))
    return typeof data.lastPrompt === "string" ? data.lastPrompt : ""
  } catch {
    return ""
  }
}

const saveLastPrompt = (repoRoot, prompt) => {
  writeFileAtomic(statePathFor(repoRoot), JSON.stringify({ lastPrompt: sanitize(prompt).slice(0, LAST_PROMPT_MAX) }))
}

const rulesPathFor = (repoRoot, env = process.env) => {
  const override = String((env && env[RULES_ENV]) || "").trim()
  if (override) return path.isAbsolute(override) ? override : path.join(repoRoot, override)
  return path.join(repoRoot, RULES_FILE)
}

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

const handleEvent = (event, repoRoot, env = process.env) => {
  const hook = (event && (event.hook_event_name || event.hookEventName)) || ""
  if (!isSddProject(repoRoot)) return null

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
    return null
  }

  if (hook === "Stop") {
    if (event && (event.stop_hook_active || event.stopHookActive)) return null
    const items = pendingItems(readFileSafe(todoPathFor(repoRoot)))
    if (items.length === 0) return null
    return { decision: "block", reason: buildStopPrompt(items, loadRules(repoRoot, env)) }
  }

  return null
}

const PLUGIN_NAME = "sdd-doc-sync-opencode"
const TOOL_INPUT_CACHE_TTL_MS = 5 * 60 * 1000
const IDLE_DEDUP_WINDOW_MS = 500
const STOP_INJECT_DEDUP_WINDOW_MS = Number.parseInt(
  process.env.SDD_DOC_SYNC_OPENCODE_STOP_INJECT_DEDUP_MS || String(30 * 1000),
  10
)

const TOOL_ARG_KEYS = ["args", "arguments", "parameters", "params", "input", "tool_input", "toolInput"]
const WRITE_TOOL_NAMES = new Set(["edit", "write", "multiedit", "patch", "apply_patch"])

const normalizeCwd = (ctx) => path.resolve(ctx?.worktree || ctx?.directory || process.cwd())

const getSessionID = (input = {}) =>
  input.sessionID || input.sessionId || input.session_id || input.properties?.sessionID || "default"

const getToolCallID = (input = {}) =>
  input.callID ||
  input.callId ||
  input.toolCallID ||
  input.toolCallId ||
  input.tool_use_id ||
  input.id ||
  null

const normalizeToolName = (tool) => {
  const name = String(tool || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s.]+/g, "_")
  if (name === "multi_edit") return "multiedit"
  return name
}

const claudeToolName = (tool) => {
  const name = normalizeToolName(tool)
  if (name === "write") return "Write"
  if (name === "multiedit") return "MultiEdit"
  return "Edit"
}

const patchFilePath = (value) => {
  const text = String(value || "")
  for (const line of text.split(/\r?\n/)) {
    const patchMatch = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line)
    if (patchMatch) return patchMatch[1].trim()
    const diffMatch = /^\+\+\+ b\/(.+)$/.exec(line)
    if (diffMatch) return diffMatch[1].trim()
  }
  return null
}

const getToolFilePath = (args) => {
  if (!args || typeof args !== "object") return null
  if (args.file_path || args.filePath || args.path || args.file) {
    return args.file_path || args.filePath || args.path || args.file
  }
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      const fp = getToolFilePath(edit)
      if (fp) return fp
    }
  }
  return patchFilePath(args.patch || args.diff)
}

const normalizeToolArgs = (args) => {
  const copy = { ...(args || {}) }
  const fp = getToolFilePath(copy)
  if (fp && !copy.file_path) copy.file_path = fp
  return copy
}

const hasToolArgs = (value) => {
  if (!value || typeof value !== "object") return false
  if (getToolFilePath(value)) return true
  return ["old_string", "new_string", "content", "edits", "patch", "diff"].some((key) => key in value)
}

const extractToolArgs = (...sources) => {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue
    for (const key of TOOL_ARG_KEYS) {
      if (hasToolArgs(source[key])) return normalizeToolArgs(source[key])
    }
    if (hasToolArgs(source)) return normalizeToolArgs(source)
  }
  return {}
}

const toolCacheKey = (input) => {
  const callID = getToolCallID(input)
  if (!callID) return null
  return `${getSessionID(input)}:${normalizeToolName(input?.tool)}:${callID}`
}

const pruneToolInputCache = (cache, now = Date.now()) => {
  for (const [key, item] of cache.entries()) {
    if (now - item.updatedAtMs > TOOL_INPUT_CACHE_TTL_MS) cache.delete(key)
  }
}

const cacheToolInput = (cache, input, args, now = Date.now()) => {
  const key = toolCacheKey(input)
  if (!key) return false
  pruneToolInputCache(cache, now)
  cache.set(key, { args: normalizeToolArgs(args), updatedAtMs: now })
  return true
}

const takeCachedToolInput = (cache, input, now = Date.now()) => {
  const key = toolCacheKey(input)
  if (!key) return null
  pruneToolInputCache(cache, now)
  const item = cache.get(key)
  if (!item) return null
  cache.delete(key)
  return normalizeToolArgs(item.args)
}

const compactText = (value, max = 1000) => {
  const text = String(value || "")
  return text.length > max ? `${text.slice(0, max)}...` : text
}

const logPluginIssue = async (client, level, message, extra = {}) => {
  try {
    await client?.app?.log?.({
      body: {
        service: PLUGIN_NAME,
        level,
        message,
        extra,
      },
    })
  } catch {
    // Keep OpenCode sessions quiet when app logging is unavailable.
  }
}

const textValue = (value) => {
  if (typeof value === "string") return value
  if (value && typeof value.value === "string") return value.value
  return ""
}

const contentText = (value) => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n")
  if (!value || typeof value !== "object") return ""
  return (
    textValue(value.text) ||
    textValue(value.content) ||
    textValue(value.value) ||
    contentText(value.parts) ||
    contentText(value.message?.content)
  )
}

const messageText = (input = {}, output = {}) =>
  contentText(output.parts || output.message?.content || input.parts || input.message?.content || input.prompt || input.text)

const isUserChatMessage = (input = {}, output = {}) => {
  const role = output.message?.role || input.message?.role || input.role
  if (role && String(role).toLowerCase() !== "user") return false
  return Boolean(messageText(input, output).trim()) || String(role || "").toLowerCase() === "user"
}

const normalizeIdleEvent = (event) => {
  if (event?.type === "session.idle") {
    return {
      sessionID: event.properties?.sessionID || "default",
      rawType: event.type,
    }
  }

  if (event?.type === "session.status") {
    const status = event.properties?.status
    if (status !== "idle" && status?.type !== "idle") return null
    return {
      sessionID: event.properties?.sessionID || "default",
      rawType: event.type,
    }
  }

  return null
}

const shouldHandleIdle = (recentIdleBySession, sessionID, now = Date.now()) => {
  const id = sessionID || "default"
  for (const [key, lastAt] of recentIdleBySession.entries()) {
    if (now - lastAt > IDLE_DEDUP_WINDOW_MS * 10) recentIdleBySession.delete(key)
  }
  const lastAt = recentIdleBySession.get(id)
  if (lastAt && now - lastAt < IDLE_DEDUP_WINDOW_MS) return false
  recentIdleBySession.set(id, now)
  return true
}

const stopPromptSignature = (prompt) => {
  const text = String(prompt || "")
  return `${text.length}:${text.slice(0, 256)}:${text.slice(-256)}`
}

const shouldInjectStopPrompt = (cache, sessionID, prompt, now = Date.now()) => {
  const windowMs = Number.isFinite(STOP_INJECT_DEDUP_WINDOW_MS)
    ? Math.max(0, STOP_INJECT_DEDUP_WINDOW_MS)
    : 30 * 1000
  if (windowMs === 0) return true

  const id = sessionID || "default"
  const signature = stopPromptSignature(prompt)
  for (const [key, item] of cache.entries()) {
    if (now - item.updatedAtMs > windowMs * 10) cache.delete(key)
  }

  const existing = cache.get(id)
  if (existing?.signature === signature && now - existing.updatedAtMs < windowMs) return false

  cache.set(id, { signature, updatedAtMs: now })
  return true
}

const buildPromptPart = (prompt) => ({
  type: "text",
  text: prompt,
  synthetic: true,
  metadata: {
    source: PLUGIN_NAME,
  },
})

const compactSessionOptions = (options = {}) => {
  const out = {}
  if (options.agent) out.agent = options.agent
  if (options.model) out.model = options.model
  if (options.variant) out.variant = options.variant
  return out
}

const promptSession = async (ctx, sessionID, prompt, options = {}) => {
  const session = ctx?.client?.session
  const fn =
    typeof session?.promptAsync === "function"
      ? session.promptAsync.bind(session)
      : typeof session?.prompt === "function"
        ? session.prompt.bind(session)
        : null
  if (!fn) return false

  const id = sessionID || "default"
  const directory = normalizeCwd(ctx)
  const bodyOptions = compactSessionOptions(options)
  const parts = [buildPromptPart(prompt)]

  try {
    await fn({
      path: { id },
      query: { directory },
      body: {
        ...bodyOptions,
        parts,
      },
    })
    return true
  } catch (error) {
    if (!options.__allowFlatFallback) throw error
  }

  await fn({
    sessionID: id,
    directory,
    ...bodyOptions,
    parts,
  })
  return true
}

const promptSessionCompat = async (ctx, sessionID, prompt, options = {}) =>
  promptSession(ctx, sessionID, prompt, { ...options, __allowFlatFallback: true })

const runHookInput = (hookInput, env = process.env) => {
  const cwd = hookInput?.cwd || env.CLAUDE_PROJECT_DIR || process.cwd()
  return handleEvent(hookInput || {}, findRepoRoot(cwd), env)
}

const buildPromptInput = (ctx, input, output) => ({
  hook_source: "opencode-plugin",
  hook_event_name: "UserPromptSubmit",
  session_id: getSessionID(input),
  prompt: messageText(input, output),
  cwd: normalizeCwd(ctx),
})

const buildPostToolUseInput = (ctx, input, args) => ({
  hook_source: "opencode-plugin",
  hook_event_name: "PostToolUse",
  session_id: getSessionID(input),
  tool_use_id: getToolCallID(input),
  tool_name: claudeToolName(input?.tool),
  tool_input: normalizeToolArgs(args || {}),
  cwd: normalizeCwd(ctx),
})

const buildStopInput = (ctx, sessionID, rawType) => ({
  hook_source: "opencode-plugin",
  hook_event_name: "Stop",
  session_id: sessionID || "default",
  raw_event_type: rawType || null,
  stop_hook_active: false,
  cwd: normalizeCwd(ctx),
})

const isWriteTool = (tool) => WRITE_TOOL_NAMES.has(normalizeToolName(tool))

const SddDocSyncOpenCode = async (ctx = {}) => {
  const toolInputCache = new Map()
  const recentIdleBySession = new Map()
  const recentStopPromptBySession = new Map()
  const sessionOptionsByID = new Map()
  const hookRunner =
    typeof ctx.__sddDocSyncRunHookInput === "function" ? ctx.__sddDocSyncRunHookInput : runHookInput

  return {
    "chat.message": async (input = {}, output = {}) => {
      if (!isUserChatMessage(input, output)) return
      sessionOptionsByID.set(getSessionID(input), {
        agent: input.agent,
        model: input.model,
        variant: input.variant,
      })
      try {
        hookRunner(buildPromptInput(ctx, input, output), process.env)
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "chat prompt capture did not complete", {
          sessionID: getSessionID(input),
          error: compactText(error?.message || String(error)),
        })
      }
    },

    "tool.execute.before": async (input = {}, output = {}) => {
      cacheToolInput(toolInputCache, input, extractToolArgs(output, input))
    },

    "tool.execute.after": async (input = {}, output = {}) => {
      if (!isWriteTool(input.tool)) return
      const args = takeCachedToolInput(toolInputCache, input) || extractToolArgs(input, output)
      try {
        hookRunner(buildPostToolUseInput(ctx, input, args), process.env)
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "tool edit capture did not complete", {
          tool: normalizeToolName(input.tool),
          sessionID: getSessionID(input),
          callID: getToolCallID(input),
          error: compactText(error?.message || String(error)),
        })
      }
    },

    event: async ({ event } = {}) => {
      const idle = normalizeIdleEvent(event)
      if (!idle || !shouldHandleIdle(recentIdleBySession, idle.sessionID)) return

      let result
      try {
        result = hookRunner(buildStopInput(ctx, idle.sessionID, idle.rawType), process.env)
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "idle stop check did not complete", {
          sessionID: idle.sessionID,
          rawType: idle.rawType,
          error: compactText(error?.message || String(error)),
        })
        return
      }

      const prompt = result?.decision === "block" ? String(result.reason || "").trim() : ""
      if (!prompt) return
      if (!shouldInjectStopPrompt(recentStopPromptBySession, idle.sessionID, prompt)) {
        await logPluginIssue(ctx.client, "info", "suppressed duplicate Stop continuation", {
          sessionID: idle.sessionID,
          rawType: idle.rawType,
        })
        return
      }

      try {
        const injected = await promptSessionCompat(ctx, idle.sessionID, prompt, sessionOptionsByID.get(idle.sessionID))
        await logPluginIssue(ctx.client, injected ? "info" : "warn", "sent automatic Stop review continuation", {
          sessionID: idle.sessionID,
          rawType: idle.rawType,
          injected,
        })
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "automatic Stop review continuation failed", {
          sessionID: idle.sessionID,
          rawType: idle.rawType,
          error: compactText(error?.message || String(error)),
        })
      }
    },
  }
}

const privateApi = Object.assign(async () => ({}), {
  buildRulesSegment,
  buildPostToolUseInput,
  buildPromptInput,
  buildStopInput,
  buildStopPrompt,
  cacheToolInput,
  claudeToolName,
  contentText,
  discoverChangeDirs,
  editedPathFromEvent,
  extractToolArgs,
  findRepoRoot,
  getSessionID,
  getToolCallID,
  getToolFilePath,
  handleEvent,
  isCodePath,
  isSddProject,
  isUserChatMessage,
  isWriteTool,
  loadRules,
  normalizeCwd,
  normalizeIdleEvent,
  normalizeToolArgs,
  normalizeToolName,
  parseTodo,
  patchFilePath,
  pendingItems,
  promptSession,
  promptSessionCompat,
  runHookInput,
  rulesPathFor,
  sanitize,
  shouldHandleIdle,
  shouldInjectStopPrompt,
  statePathFor,
  takeCachedToolInput,
  todoPathFor,
  upsertPending,
})
export { SddDocSyncOpenCode, privateApi as _private }
