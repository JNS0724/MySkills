import fs from "node:fs"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"

const requestPath = process.argv[2]
if (!requestPath) {
  console.error("usage: node run-opencode-phase.mjs <request.json>")
  process.exit(2)
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"))
const startedAt = Date.now()
let timedOut = false
let killed = false

fs.mkdirSync(path.dirname(request.stdout), { recursive: true })
fs.mkdirSync(path.dirname(request.stderr), { recursive: true })

const stdout = fs.openSync(request.stdout, "w")
const stderr = fs.openSync(request.stderr, "w")

const child = spawn(request.executable, request.args || [], {
  cwd: request.cwd,
  env: { ...process.env, ...(request.env || {}) },
  stdio: ["ignore", stdout, stderr],
  windowsHide: true,
})

const killTree = () => {
  if (!child.pid) return
  killed = true
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
    return
  }
  child.kill("SIGKILL")
}

const timeoutMs = Number(request.timeoutMs || 0)
const timer = timeoutMs > 0
  ? setTimeout(() => {
      timedOut = true
      killTree()
    }, timeoutMs)
  : null

const result = await new Promise((resolve) => {
  child.on("error", (error) => {
    resolve({ exitCode: null, signal: null, error: error.message })
  })
  child.on("exit", (exitCode, signal) => {
    resolve({ exitCode, signal, error: null })
  })
})

if (timer) clearTimeout(timer)
fs.closeSync(stdout)
fs.closeSync(stderr)

const completedAt = Date.now()
process.stdout.write(JSON.stringify({
  ...result,
  timedOut,
  killed,
  pid: child.pid || null,
  durationMs: completedAt - startedAt,
  stdout: request.stdout,
  stderr: request.stderr,
}) + "\n")
