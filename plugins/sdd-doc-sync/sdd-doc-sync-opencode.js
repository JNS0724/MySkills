import { createRequire as __sddCreateRequire } from "node:module"

const require = __sddCreateRequire(import.meta.url)

const path = require("node:path")

const CORE_MODULE = process.env.SDD_DOC_SYNC_CORE
  ? path.resolve(process.env.SDD_DOC_SYNC_CORE)
  : "./sdd-doc-sync"
const {
  findRepoRoot,
  handleEvent,
} = require(CORE_MODULE)

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
  buildPostToolUseInput,
  buildPromptInput,
  buildStopInput,
  cacheToolInput,
  claudeToolName,
  contentText,
  extractToolArgs,
  getSessionID,
  getToolCallID,
  getToolFilePath,
  isUserChatMessage,
  isWriteTool,
  normalizeCwd,
  normalizeIdleEvent,
  normalizeToolArgs,
  normalizeToolName,
  patchFilePath,
  promptSession,
  promptSessionCompat,
  runHookInput,
  shouldHandleIdle,
  shouldInjectStopPrompt,
  takeCachedToolInput,
})
export { SddDocSyncOpenCode, privateApi as _private }
