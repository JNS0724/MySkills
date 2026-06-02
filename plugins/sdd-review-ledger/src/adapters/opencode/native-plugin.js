"use strict"

const path = require("node:path")
const { findRepoRoot } = require("../../core/state-dir")
const { onEdit } = require("../../handlers/on-edit")
const { onPrompt } = require("../../handlers/on-prompt")
const { onStop } = require("../../handlers/on-stop")

const PLUGIN_NAME = "sdd-review-ledger-opencode"
const TOOL_INPUT_CACHE_TTL_MS = 5 * 60 * 1000
const IDLE_DEDUP_WINDOW_MS = 500

const TOOL_ARG_KEYS = ["args", "arguments", "parameters", "params", "input", "tool_input", "toolInput"]
const WRITE_TOOL_NAMES = new Set(["edit", "write", "multiedit", "patch", "apply_patch"])

const normalizeCwd = (ctx) => path.resolve(ctx?.worktree || ctx?.directory || process.cwd())

const getSessionID = (input) => input?.sessionID || input?.sessionId || input?.session_id || "default"

const getToolCallID = (input) =>
  input?.callID || input?.callId || input?.toolCallID || input?.toolCallId || input?.tool_use_id || input?.id || null

const normalizeToolName = (tool) => {
  const name = String(tool || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s.]+/g, "_")
  if (name === "multi_edit" || name === "multi-edit") return "multiedit"
  return name
}

const normalizeToolArgs = (args) => {
  const copy = { ...(args || {}) }
  const fp = getToolFilePath(copy)
  if (fp && !copy.file_path) copy.file_path = fp
  return copy
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
  return null
}

const hasToolArgs = (value) => {
  if (!value || typeof value !== "object") return false
  if (getToolFilePath(value)) return true
  return ["old_string", "new_string", "content", "edits", "patch"].some((key) => key in value)
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

const baseCtx = (ctx, input) => {
  const cwd = normalizeCwd(ctx)
  const repoRoot = findRepoRoot(cwd)
  return {
    repoRoot,
    env: process.env,
    actor: "agent",
    event: {
      hook_source: "opencode-plugin",
      session_id: getSessionID(input),
      tool_use_id: getToolCallID(input),
      cwd,
    },
  }
}

const isWriteTool = (tool) => WRITE_TOOL_NAMES.has(normalizeToolName(tool))

const appendToolOutput = (output, message) => {
  const text = String(message || "").trim()
  if (!text || !output || typeof output !== "object") return false
  const current = String(output.output || "")
  output.output = current ? `${current}\n\n${text}` : text
  output.metadata = {
    ...(output.metadata || {}),
    sddReviewLedger: {
      injected: true,
      channel: "tool.execute.after",
    },
  }
  return true
}

const contentText = (value) => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n")
  if (!value || typeof value !== "object") return ""
  return contentText(value.text || value.content || value.value || value.message?.content)
}

const isUserChatMessage = (input, output) => {
  const role = output?.message?.role || input?.message?.role || input?.role
  if (role && String(role).toLowerCase() !== "user") return false
  const text = contentText(output?.parts || output?.message?.content || input?.parts || input?.message?.content)
  return Boolean(text.trim()) || String(role || "").toLowerCase() === "user"
}

const normalizeIdleEvent = (event) => {
  if (event?.type === "session.idle") {
    return {
      sessionID: event?.properties?.sessionID || "default",
      rawType: event.type,
    }
  }

  if (event?.type === "session.status") {
    const status = event?.properties?.status
    if (status !== "idle" && status?.type !== "idle") return null
    return {
      sessionID: event?.properties?.sessionID || "default",
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

const SddReviewLedgerOpenCode = async (ctx) => {
  const toolInputCache = new Map()
  const recentIdleBySession = new Map()

  return {
    "chat.message": async (input = {}, output = {}) => {
      if (!isUserChatMessage(input, output)) return
      const c = baseCtx(ctx, input)
      c.event.hook_event_name = "UserPromptSubmit"
      // 任务标签来源：把用户消息文本带给 onPrompt，供下次编辑的变更线索打任务标签。
      c.event.prompt = contentText(output?.parts || output?.message?.content || input?.parts || input?.message?.content)
      try {
        const res = onPrompt(c)
        if (res?.deliver) {
          await logPluginIssue(ctx.client, "info", "observed SDD review carry-over", {
            sessionID: getSessionID(input),
            pending: res.result?.needs?.length || 0,
          })
        }
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "chat message carry-over did not complete", {
          sessionID: getSessionID(input),
          error: compactText(error?.message || String(error)),
        })
      }
    },

    "tool.execute.before": async (input = {}, output = {}) => {
      const args = extractToolArgs(output, input)
      cacheToolInput(toolInputCache, input, args)
    },

    "tool.execute.after": async (input = {}, output = {}) => {
      if (!isWriteTool(input.tool)) return
      const args = takeCachedToolInput(toolInputCache, input) || extractToolArgs(input, output)
      const c = baseCtx(ctx, input)
      c.event.hook_event_name = "PostToolUse"
      c.event.tool_name = normalizeToolName(input.tool)
      c.event.tool_input = args
      try {
        const res = onEdit({ ...c, editedPath: getToolFilePath(args) || undefined })
        if (res?.deliver && appendToolOutput(output, res.text)) {
          await logPluginIssue(ctx.client, "info", "injected SDD review reminder", {
            tool: normalizeToolName(input.tool),
            sessionID: getSessionID(input),
            callID: getToolCallID(input),
          })
        }
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "tool review did not complete", {
          tool: normalizeToolName(input.tool),
          sessionID: getSessionID(input),
          error: compactText(error?.message || String(error)),
        })
      }
    },

    event: async ({ event } = {}) => {
      const idle = normalizeIdleEvent(event)
      if (!idle || !shouldHandleIdle(recentIdleBySession, idle.sessionID)) return
      const c = baseCtx(ctx, { sessionID: idle.sessionID })
      c.event.hook_event_name = "Stop"
      c.event.rawType = idle.rawType
      // 改进三（P0）: run the shared end-of-turn Stop sweep at idle. OpenCode cannot
      // reliably force-continue at idle (gateguard-lessons §7.1), so onStop is used
      // here to refresh ledger+todo and log unreviewed work; enforcement degrades to
      // the next chat.message carry-over. stopHookActive:false → onStop never wedges.
      try {
        const sres = onStop({ ...c, stopHookActive: false })
        if (sres && sres.block) {
          await logPluginIssue(ctx.client, "info", "SDD review pending at idle; will resurface on next message", {
            sessionID: idle.sessionID,
            rawType: idle.rawType,
            pending: sres.result?.needs?.length || 0,
          })
        }
      } catch (error) {
        await logPluginIssue(ctx.client, "warn", "idle stop sweep did not complete", {
          sessionID: idle.sessionID,
          rawType: idle.rawType,
          error: compactText(error?.message || String(error)),
        })
      }
    },
  }
}

if (process.env.SDD_REVIEW_LEDGER_EXPOSE_PRIVATE === "1") {
  Object.defineProperty(SddReviewLedgerOpenCode, "_private", {
    enumerable: false,
    value: {
      appendToolOutput,
      cacheToolInput,
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
      shouldHandleIdle,
      takeCachedToolInput,
    },
  })
}

module.exports = SddReviewLedgerOpenCode
