import { createRequire as __sddCreateRequire } from "node:module";
const require = __sddCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/core/state-dir.js
var require_state_dir = __commonJS({
  "src/core/state-dir.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var os = __require("os");
    var path = __require("path");
    var STATE_DIRNAME = "sdd-review-ledger-state";
    var TODO_FILENAME = ".sdd-review-todo.md";
    var LEDGER_FILENAME = "ledger.json";
    var REPO_MARKERS = [".git", "sdd", ".sdd", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", `.${STATE_DIRNAME}`];
    var hasMarker = (dir) => REPO_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
    var findRepoRoot = (cwd) => {
      let current = path.resolve(cwd);
      while (true) {
        if (hasMarker(current)) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return path.resolve(cwd);
    };
    var ensureDir = (dir) => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        return true;
      } catch {
        return false;
      }
    };
    var stateDirCandidates = (repoRoot) => {
      const candidates = [];
      if (fs.existsSync(path.join(repoRoot, ".git"))) {
        candidates.push(path.join(repoRoot, ".git", STATE_DIRNAME));
      }
      candidates.push(path.join(repoRoot, `.${STATE_DIRNAME}`));
      candidates.push(path.join(os.tmpdir(), STATE_DIRNAME));
      return candidates;
    };
    var resolveStateDir = (repoRoot) => {
      const candidates = stateDirCandidates(repoRoot);
      for (const c of candidates) {
        if (ensureDir(c)) return c;
      }
      return candidates[candidates.length - 1];
    };
    var ledgerPathFor = (repoRoot) => path.join(resolveStateDir(repoRoot), LEDGER_FILENAME);
    var todoPathFor = (repoRoot) => path.join(repoRoot, TODO_FILENAME);
    module.exports = {
      STATE_DIRNAME,
      TODO_FILENAME,
      LEDGER_FILENAME,
      REPO_MARKERS,
      findRepoRoot,
      hasMarker,
      ensureDir,
      stateDirCandidates,
      resolveStateDir,
      ledgerPathFor,
      todoPathFor
    };
  }
});

// src/core/config.js
var require_config = __commonJS({
  "src/core/config.js"(exports, module) {
    "use strict";
    var DEFAULT_HASH_LEN = 16;
    var DEFAULT_SESSION_MAX_REMINDERS = Number.MAX_SAFE_INTEGER;
    var DEFAULT_LEDGER_CODE_CAP = 1e3;
    var DEFAULT_SCAN_BUDGET_MS = 1500;
    var DEFAULT_REMINDER_DEDUPE_MS = 2e3;
    var DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
    var DEFAULT_BOOTSTRAP_THRESHOLD = 1;
    var DEFAULT_CHANGE_NOTE_CAP = 3;
    var DEFAULT_RATIONALE_MIN_CHARS = 8;
    var DEFAULT_REMINDER_MODE = "stop";
    var REMINDER_MODES = /* @__PURE__ */ new Set(["stop", "once", "growth"]);
    var DISABLE_VALUES = /* @__PURE__ */ new Set(["0", "false", "off", "disabled", "disable"]);
    var normalizeEnvValue = (value) => String(value == null ? "" : value).trim().toLowerCase();
    var isDisabled = (env = process.env) => {
      if (normalizeEnvValue(env.SDD_REVIEW_DISABLED) === "1") return true;
      return DISABLE_VALUES.has(normalizeEnvValue(env.SDD_REVIEW));
    };
    var parseIntEnv = (raw, fallback) => {
      const n = Number.parseInt(String(raw == null ? "" : raw).trim(), 10);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    var parseListEnv = (raw) => String(raw == null ? "" : raw).split(",").map((s) => s.trim()).filter(Boolean);
    var isTruthyFlag = (raw) => normalizeEnvValue(raw) === "1" || normalizeEnvValue(raw) === "true";
    var parseReminderMode = (raw) => {
      const v = normalizeEnvValue(raw);
      return REMINDER_MODES.has(v) ? v : DEFAULT_REMINDER_MODE;
    };
    var readConfig = (env = process.env) => ({
      disabled: isDisabled(env),
      hashLen: parseIntEnv(env.SDD_REVIEW_HASH_LEN, DEFAULT_HASH_LEN) || DEFAULT_HASH_LEN,
      sessionMaxReminders: parseIntEnv(env.SDD_REVIEW_SESSION_MAX_REMINDERS, DEFAULT_SESSION_MAX_REMINDERS),
      ledgerCodeCap: parseIntEnv(env.SDD_REVIEW_LEDGER_CODE_CAP, DEFAULT_LEDGER_CODE_CAP) || DEFAULT_LEDGER_CODE_CAP,
      scanBudgetMs: parseIntEnv(env.SDD_REVIEW_SCAN_BUDGET_MS, DEFAULT_SCAN_BUDGET_MS) || DEFAULT_SCAN_BUDGET_MS,
      reminderDedupeMs: parseIntEnv(env.SDD_REVIEW_REMINDER_DEDUPE_MS, DEFAULT_REMINDER_DEDUPE_MS),
      reminderMode: parseReminderMode(env.SDD_REVIEW_REMINDER_MODE),
      maxFileBytes: parseIntEnv(env.SDD_REVIEW_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES,
      bootstrapThreshold: parseIntEnv(env.SDD_REVIEW_BOOTSTRAP_THRESHOLD, DEFAULT_BOOTSTRAP_THRESHOLD),
      scanAlwaysHash: isTruthyFlag(env.SDD_REVIEW_SCAN_ALWAYS_HASH),
      ignoreGlobs: parseListEnv(env.SDD_REVIEW_IGNORE),
      scanRoots: parseListEnv(env.SDD_REVIEW_SCAN_ROOTS),
      rulesFile: String(env.SDD_REVIEW_RULES_FILE || "").trim() || null,
      changeNoteCap: parseIntEnv(env.SDD_REVIEW_CHANGE_NOTE_CAP, DEFAULT_CHANGE_NOTE_CAP),
      rationaleGate: isTruthyFlag(env.SDD_REVIEW_RATIONALE_GATE),
      rationaleMinChars: parseIntEnv(env.SDD_REVIEW_RATIONALE_MIN_CHARS, DEFAULT_RATIONALE_MIN_CHARS)
    });
    module.exports = {
      DEFAULT_HASH_LEN,
      DEFAULT_SESSION_MAX_REMINDERS,
      DEFAULT_LEDGER_CODE_CAP,
      DEFAULT_SCAN_BUDGET_MS,
      DEFAULT_REMINDER_DEDUPE_MS,
      DEFAULT_MAX_FILE_BYTES,
      DEFAULT_BOOTSTRAP_THRESHOLD,
      DEFAULT_CHANGE_NOTE_CAP,
      DEFAULT_RATIONALE_MIN_CHARS,
      DEFAULT_REMINDER_MODE,
      REMINDER_MODES,
      DISABLE_VALUES,
      normalizeEnvValue,
      isDisabled,
      parseIntEnv,
      parseListEnv,
      isTruthyFlag,
      parseReminderMode,
      readConfig
    };
  }
});

// src/core/session-key.js
var require_session_key = __commonJS({
  "src/core/session-key.js"(exports, module) {
    "use strict";
    var crypto = __require("crypto");
    var path = __require("path");
    var hashKey = (prefix, value) => `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
    var sanitizeSessionKey = (value) => {
      const raw = String(value == null ? "" : value).trim();
      if (!raw) return "";
      const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (sanitized && sanitized.length <= 64) return sanitized;
      return hashKey("sid", raw);
    };
    var resolveSessionKey = (event = {}, env = {}, repoRoot) => {
      const direct = [
        event && event.session_id,
        event && event.sessionId,
        event && event.session && event.session.id,
        env.CLAUDE_SESSION_ID,
        env.SDD_REVIEW_SESSION_ID
      ];
      for (const candidate of direct) {
        const s = sanitizeSessionKey(candidate);
        if (s) return s;
      }
      const transcript = event && (event.transcript_path || event.transcriptPath) || env.CLAUDE_TRANSCRIPT_PATH;
      if (transcript && String(transcript).trim()) {
        return hashKey("tx", path.resolve(String(transcript).trim()));
      }
      const fingerprint = repoRoot || env.CLAUDE_PROJECT_DIR || process.cwd();
      return hashKey("proj", path.resolve(fingerprint));
    };
    module.exports = { sanitizeSessionKey, hashKey, resolveSessionKey };
  }
});

// src/core/throttle.js
var require_throttle = __commonJS({
  "src/core/throttle.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var emptyThrottle = () => ({
      batch: 0,
      sent: 0,
      lastRemindedBatch: null,
      lastRemindedPathSet: [],
      lastReminderAtMs: 0,
      // T2: snapshot of ALL pending `path@hash` captured when the first active review of a
      // turn fired. Used to detect review-induced leftovers (pending that appeared after).
      reviewBaselinePending: []
    });
    var throttlePath = (stateDir, sessionKey) => path.join(stateDir, `throttle-${sessionKey}.json`);
    var loadThrottle = (stateDir, sessionKey) => {
      try {
        const data = JSON.parse(fs.readFileSync(throttlePath(stateDir, sessionKey), "utf8"));
        return {
          batch: Number.isFinite(data.batch) ? data.batch : 0,
          sent: Number.isFinite(data.sent) ? data.sent : 0,
          lastRemindedBatch: Number.isFinite(data.lastRemindedBatch) ? data.lastRemindedBatch : null,
          lastRemindedPathSet: Array.isArray(data.lastRemindedPathSet) ? data.lastRemindedPathSet.filter((s) => typeof s === "string") : [],
          lastReminderAtMs: Number.isFinite(data.lastReminderAtMs) ? data.lastReminderAtMs : 0,
          reviewBaselinePending: Array.isArray(data.reviewBaselinePending) ? data.reviewBaselinePending.filter((s) => typeof s === "string") : []
        };
      } catch {
        return emptyThrottle();
      }
    };
    var saveThrottle = (stateDir, sessionKey, state) => {
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(throttlePath(stateDir, sessionKey), JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    };
    var bumpBatch = (state) => ({ ...state, batch: (state.batch || 0) + 1 });
    var decideReminder = (state, { hasNeeds, maxReminders, pathSet = [], mode = "growth", nowMs = Date.now() }) => {
      const cur = state || emptyThrottle();
      const lastSet = new Set(cur.lastRemindedPathSet || []);
      const grew = pathSet.some((p) => !lastSet.has(p));
      const sameTurn = cur.lastRemindedBatch !== null && cur.lastRemindedBatch === cur.batch;
      const suppressed = mode === "stop" ? true : mode === "once" ? sameTurn : sameTurn && !grew;
      const remind = !!hasNeeds && maxReminders > 0 && (cur.sent || 0) < maxReminders && !suppressed;
      if (!remind) return { remind: false, state: cur };
      return {
        remind: true,
        state: {
          ...cur,
          sent: (cur.sent || 0) + 1,
          lastRemindedBatch: cur.batch,
          lastRemindedPathSet: [...pathSet],
          lastReminderAtMs: nowMs
        }
      };
    };
    module.exports = {
      emptyThrottle,
      throttlePath,
      loadThrottle,
      saveThrottle,
      bumpBatch,
      decideReminder
    };
  }
});

// src/core/paths.js
var require_paths = __commonJS({
  "src/core/paths.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var toPosix = (fp) => String(fp == null ? "" : fp).replace(/\\/g, "/");
    var isCaseInsensitiveFs = () => process.platform === "win32" || process.platform === "darwin";
    var normalizeKey = (fp) => {
      const normalized = toPosix(path.resolve(fp));
      return isCaseInsensitiveFs() ? normalized.toLowerCase() : normalized;
    };
    var samePath = (left, right) => normalizeKey(left) === normalizeKey(right);
    var rel = (root, fp) => toPosix(path.relative(root, fp));
    var resolveFile = (root, fp) => path.isAbsolute(fp) ? path.normalize(fp) : path.resolve(root, fp);
    var MAX_RENDERED_PATH = 500;
    var sanitizePath = (fp) => {
      const input = String(fp == null ? "" : fp);
      let out = "";
      for (const ch of input) {
        const code = ch.codePointAt(0);
        const isAsciiControl = code <= 31 || code === 127;
        const isBidiOverride = code >= 8206 && code <= 8207 || code >= 8234 && code <= 8238 || code >= 8294 && code <= 8297;
        out += isAsciiControl || isBidiOverride ? " " : ch;
      }
      return out.trim().slice(0, MAX_RENDERED_PATH);
    };
    module.exports = {
      MAX_RENDERED_PATH,
      isCaseInsensitiveFs,
      normalizeKey,
      rel,
      resolveFile,
      samePath,
      sanitizePath,
      toPosix
    };
  }
});

// src/core/change-dirs.js
var require_change_dirs = __commonJS({
  "src/core/change-dirs.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var { toPosix, rel } = require_paths();
    var CHANGE_PARENTS = ["sdd/changes", ".sdd/changes"];
    var DOC_NAMES = ["proposal.md", "design.md", "tasks.md"];
    var firstNonEmptyLine = (absFile) => {
      let text;
      try {
        text = fs.readFileSync(absFile, "utf8");
      } catch {
        return "";
      }
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) return trimmed;
      }
      return "";
    };
    var isArchived = (absDir) => {
      const base = path.basename(absDir).toLowerCase();
      if (base.startsWith("archived") || base.startsWith("_archived") || base.endsWith(".archived")) return true;
      if (fs.existsSync(path.join(absDir, "ARCHIVED")) || fs.existsSync(path.join(absDir, ".archived"))) return true;
      try {
        const design = fs.readFileSync(path.join(absDir, "design.md"), "utf8").slice(0, 400);
        if (/^\s*status:\s*archived\s*$/im.test(design)) return true;
      } catch {
      }
      return false;
    };
    var listChangeDirs = (repoRoot) => {
      const dirs = [];
      for (const parentRel of CHANGE_PARENTS) {
        const parentAbs = path.join(repoRoot, parentRel);
        let entries;
        try {
          entries = fs.readdirSync(parentAbs, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.isDirectory()) dirs.push(path.join(parentAbs, entry.name));
        }
      }
      return dirs;
    };
    var discoverChangeDirs = (repoRoot) => {
      const out = [];
      for (const absDir of listChangeDirs(repoRoot)) {
        if (isArchived(absDir)) continue;
        const docs = DOC_NAMES.filter((name) => {
          try {
            return fs.statSync(path.join(absDir, name)).isFile();
          } catch {
            return false;
          }
        });
        out.push({
          relDir: toPosix(rel(repoRoot, absDir)),
          absDir,
          docs,
          designFirstLine: firstNonEmptyLine(path.join(absDir, "design.md"))
        });
      }
      out.sort((a, b) => a.relDir < b.relDir ? -1 : a.relDir > b.relDir ? 1 : 0);
      return out;
    };
    module.exports = {
      CHANGE_PARENTS,
      DOC_NAMES,
      discoverChangeDirs,
      firstNonEmptyLine,
      isArchived
    };
  }
});

// src/core/hash.js
var require_hash = __commonJS({
  "src/core/hash.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var crypto = __require("crypto");
    var { DEFAULT_HASH_LEN } = require_config();
    var hashBuffer = (buf, hashLen = DEFAULT_HASH_LEN) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, hashLen);
    var hashElement = (absPath, hashLen = DEFAULT_HASH_LEN) => {
      let buf;
      try {
        buf = fs.readFileSync(absPath);
      } catch {
        return null;
      }
      return hashBuffer(buf, hashLen);
    };
    module.exports = {
      hashBuffer,
      hashElement
    };
  }
});

// src/core/classify.js
var require_classify = __commonJS({
  "src/core/classify.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var { toPosix } = require_paths();
    var CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|html|css|vue|svelte|py|go|rs|java|kt|swift|cc|cpp|c|h|hpp|rb|php|cs|scss|sql)$/i;
    var SDD_DOC_NAMES = /* @__PURE__ */ new Set(["proposal.md", "design.md", "tasks.md"]);
    var inSddTree = (posix) => posix.includes("/sdd/") || posix.includes("/.sdd/") || posix.startsWith("sdd/") || posix.startsWith(".sdd/");
    var inSddChanges = (posix) => posix.includes("/sdd/changes/") || posix.includes("/.sdd/changes/") || posix.startsWith("sdd/changes/") || posix.startsWith(".sdd/changes/");
    var classifyPath = (fp) => {
      const posix = toPosix(fp);
      const base = path.posix.basename(posix).toLowerCase();
      if (inSddChanges(posix) && SDD_DOC_NAMES.has(base)) return "sdd-doc";
      if (CODE_EXT.test(posix) && !inSddTree(posix)) return "code";
      return "other";
    };
    module.exports = {
      CODE_EXT,
      SDD_DOC_NAMES,
      classifyPath,
      inSddChanges,
      inSddTree
    };
  }
});

// src/core/scan.js
var require_scan = __commonJS({
  "src/core/scan.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var { toPosix, rel } = require_paths();
    var { classifyPath } = require_classify();
    var DEFAULT_IGNORE_DIRS = /* @__PURE__ */ new Set([
      ".git",
      ".claude",
      ".home",
      ".opencode",
      "node_modules",
      "dist",
      "build",
      "out",
      "coverage",
      ".next",
      ".nuxt",
      "vendor",
      ".venv",
      "venv",
      "__pycache__",
      "target",
      ".gradle",
      ".idea",
      ".cache",
      ".sdd-review-ledger-state",
      "sdd-review-ledger-state"
    ]);
    var makeDirIgnored = (ignoreGlobs) => {
      const extraDirs = /* @__PURE__ */ new Set();
      const extraSubstrings = [];
      for (const g of ignoreGlobs || []) {
        const trimmed = g.replace(/^\.\//, "");
        if (trimmed.endsWith("/")) extraDirs.add(trimmed.slice(0, -1));
        else extraSubstrings.push(trimmed);
      }
      return (name, relPosix) => {
        if (DEFAULT_IGNORE_DIRS.has(name) || extraDirs.has(name)) return true;
        return extraSubstrings.some((s) => relPosix.includes(s));
      };
    };
    var defaultNow = () => Number(process.hrtime.bigint() / 1000000n);
    var scanWorkTree = (repoRoot, ledger, cfg = {}, opts = {}) => {
      const maxFileBytes = cfg.maxFileBytes || 2 * 1024 * 1024;
      const budgetMs = cfg.scanBudgetMs || 1500;
      const alwaysHash = !!cfg.scanAlwaysHash;
      const now = opts.now || defaultNow;
      const dirIgnored = makeDirIgnored(cfg.ignoreGlobs);
      const roots = cfg.scanRoots && cfg.scanRoots.length ? cfg.scanRoots.map((r) => path.resolve(repoRoot, r)) : [repoRoot];
      const codePaths = [];
      const hashCache = {};
      let truncated = false;
      let skipped = 0;
      const start = now();
      const stack = [...roots];
      while (stack.length) {
        if (now() - start > budgetMs) {
          truncated = true;
          skipped += stack.length;
          break;
        }
        const dir = stack.pop();
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          const abs = path.join(dir, entry.name);
          const relPosix = toPosix(rel(repoRoot, abs));
          if (entry.isDirectory()) {
            if (dirIgnored(entry.name, relPosix)) continue;
            stack.push(abs);
            continue;
          }
          if (!entry.isFile()) continue;
          if (classifyPath(relPosix) !== "code") continue;
          let stat;
          try {
            stat = fs.statSync(abs);
          } catch {
            continue;
          }
          if (stat.size > maxFileBytes) {
            skipped += 1;
            continue;
          }
          codePaths.push(relPosix);
          if (!alwaysHash) hashCache[relPosix] = { size: stat.size, mtimeMs: stat.mtimeMs };
        }
      }
      codePaths.sort();
      return { codePaths, truncated, skipped, hashCache };
    };
    module.exports = {
      DEFAULT_IGNORE_DIRS,
      makeDirIgnored,
      scanWorkTree
    };
  }
});

// src/core/ledger.js
var require_ledger = __commonJS({
  "src/core/ledger.js"(exports, module) {
    "use strict";
    var LEDGER_VERSION = 1;
    var emptyLedger = () => ({ version: LEDGER_VERSION, records: {} });
    var parseLedger = (text) => {
      if (typeof text !== "string" || text.trim() === "") return emptyLedger();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return emptyLedger();
      }
      if (!data || typeof data !== "object" || typeof data.records !== "object" || data.records === null) {
        return emptyLedger();
      }
      return { version: LEDGER_VERSION, records: { ...data.records } };
    };
    var serializeLedger = (ledger) => JSON.stringify({ version: LEDGER_VERSION, records: ledger.records || {} }, null, 2);
    var withRecord = (ledger, key, record) => ({
      version: LEDGER_VERSION,
      records: { ...ledger.records, [key]: record }
    });
    var getRecord = (ledger, key) => ledger.records ? ledger.records[key] : void 0;
    var trackCodePath = (ledger, key, meta = {}) => {
      if (getRecord(ledger, key)) return ledger;
      return withRecord(ledger, key, {
        kind: "code",
        reviewedHash: null,
        verdict: null,
        rationale: "",
        reviewedAt: null,
        by: null,
        ...meta
      });
    };
    var appendChangeNote = (ledger, key, note, cap = 3) => {
      if (!note || cap <= 0) return ledger;
      const base = getRecord(ledger, key) || {
        kind: "code",
        reviewedHash: null,
        verdict: null,
        rationale: "",
        reviewedAt: null,
        by: null
      };
      const prev = Array.isArray(base.changeNotes) ? base.changeNotes : [];
      return withRecord(ledger, key, { ...base, changeNotes: [...prev, note].slice(-cap) });
    };
    module.exports = {
      LEDGER_VERSION,
      emptyLedger,
      parseLedger,
      serializeLedger,
      withRecord,
      getRecord,
      trackCodePath,
      appendChangeNote
    };
  }
});

// src/core/compute.js
var require_compute = __commonJS({
  "src/core/compute.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var { hashElement } = require_hash();
    var { discoverChangeDirs } = require_change_dirs();
    var { scanWorkTree } = require_scan();
    var { getRecord } = require_ledger();
    var DOC_NAMES = ["design.md", "tasks.md", "proposal.md"];
    var reasonFor = (record) => record ? "changed-since-review" : "never-reviewed";
    var hashWithCache = (repoRoot, relPath, record, hashCache, hashLen) => {
      const hint = hashCache && hashCache[relPath];
      if (hint && record && record.reviewedHash && typeof record.size === "number" && typeof record.mtimeMs === "number" && record.size === hint.size && record.mtimeMs === hint.mtimeMs) {
        return record.reviewedHash;
      }
      return hashElement(path.join(repoRoot, relPath), hashLen);
    };
    var computeNeedsReview = (repoRoot, ledger, cfg = {}) => {
      const hashLen = cfg.hashLen || 16;
      const items = [];
      const changeDirs = discoverChangeDirs(repoRoot);
      const records = ledger && ledger.records || {};
      for (const dir of changeDirs) {
        for (const docName of DOC_NAMES) {
          const relPath = `${dir.relDir}/${docName}`;
          const abs = path.join(repoRoot, relPath);
          const h = hashElement(abs, hashLen);
          if (h === null) continue;
          const record = getRecord(ledger, relPath);
          if (h !== (record ? record.reviewedHash : void 0)) {
            items.push({
              path: relPath,
              kind: "sdd-doc",
              currentHash: h,
              candidates: [dir.relDir],
              reason: reasonFor(record)
            });
          }
        }
      }
      const scan = scanWorkTree(repoRoot, ledger, cfg);
      const pool = new Set(scan.codePaths);
      for (const key of Object.keys(records)) {
        if (records[key] && records[key].kind === "code") {
          if (hashElement(path.join(repoRoot, key), hashLen) !== null) pool.add(key);
        }
      }
      const nonArchived = changeDirs.map((d) => d.relDir);
      for (const relPath of [...pool].sort()) {
        const record = getRecord(ledger, relPath);
        const h = hashWithCache(repoRoot, relPath, record, scan.hashCache, hashLen);
        if (h === null) continue;
        if (h !== (record ? record.reviewedHash : void 0)) {
          const item = {
            path: relPath,
            kind: "code",
            currentHash: h,
            candidates: nonArchived,
            reason: reasonFor(record)
          };
          if (record && Array.isArray(record.changeNotes) && record.changeNotes.length) {
            item.notes = record.changeNotes;
          }
          items.push(item);
        }
      }
      const meta = scan.truncated ? { scanTruncated: true, skipped: scan.skipped } : {};
      return { items, meta };
    };
    var isActiveNeed = (item) => Boolean(item) && item.kind === "code";
    var selectActiveNeeds = (items) => (items || []).filter(isActiveNeed);
    var pendingKey = (item) => `${item.path}@${item.currentHash}`;
    var pendingKeys = (items) => (items || []).map(pendingKey).sort();
    var selectReviewLeftover = (needs, baselinePending = []) => {
      const base = new Set(baselinePending);
      return (needs || []).filter((item) => !base.has(pendingKey(item)));
    };
    module.exports = {
      DOC_NAMES,
      computeNeedsReview,
      isActiveNeed,
      selectActiveNeeds,
      pendingKey,
      pendingKeys,
      selectReviewLeftover
    };
  }
});

// src/core/prompts.js
var require_prompts = __commonJS({
  "src/core/prompts.js"(exports, module) {
    "use strict";
    var { sanitizePath } = require_paths();
    var HEADER = "[SDD-REVIEW: NEEDS-REVIEW]";
    var REVIEW_BLOCK = [
      "\u793A\u4F8B\uFF08\u7167\u6B64\u683C\u5F0F\uFF1A\u5148\u53D6\u8BC1\uFF0C\u518D\u5230\u300C\u5F85\u8BC4\u5BA1\u300D\u533A\u628A [ ] \u6539\u6210 [x] \u5E76\u9644\u4F9D\u636E\uFF09\uFF1A",
      '    - [x] src/greet.ts@ab12 \u2014 design\u8BF4"\u6309\u65F6\u6BB5\u8FD4\u56DE\u95EE\u5019" / code\u505A"\u5DF2\u6309 hour \u5206\u652F\u8FD4\u56DE" \u2192 \u4E00\u81F4',
      '    - [x] sdd/changes/x/tasks.md@cd34 \u2014 \u53E6\u4E00\u7BC7 design\u8BF4"\u9700 marker" / \u672C\u6587\u6863\u5DF2\u5217\u540C\u4E00 marker \u2192 \u4E00\u81F4',
      "REVIEW\uFF08\u4F60\u662F\u552F\u4E00\u8BED\u4E49\u88C1\u5224\uFF1B\u4E0B\u7ED3\u8BBA\u524D\u5FC5\u987B\u5148\u53D6\u8BC1\uFF0C\u4E0D\u63A5\u53D7\u88F8\u5224\u65AD\uFF09:",
      "  \u5BF9\u6BCF\u4E00\u9879\uFF0C\u5148\u8BFB\u5F53\u524D\u5185\u5BB9\uFF0C\u518D\u6309\u6B64\u7ED3\u6784\u7ED9\u51FA\u4E8B\u5B9E\uFF0C\u6700\u540E\u624D\u4E0B\u7ED3\u8BBA\uFF1A",
      "    1. design/tasks \u6B64\u523B\u58F0\u79F0\u4EC0\u4E48\uFF08\u5F15\u7528\u5177\u4F53\u4E00\u53E5/\u4E00\u6BB5\uFF09",
      "    2. code \u6B64\u523B\u5B9E\u73B0\u4EC0\u4E48\uFF08\u5F15\u7528\u5177\u4F53\u51FD\u6570/\u884C\u4E3A\uFF09",
      '    3. \u4E8C\u8005\u662F\u5426\u4E00\u81F4\uFF08\u6307\u51FA\u51B2\u7A81\u70B9\uFF0C\u6216\u5199"\u7ECF\u5BF9\u7167\u65E0\u51B2\u7A81"\uFF09',
      "    4. \u7ED3\u8BBA\uFF1A\u9700\u6539 \u2192 \u76F4\u63A5\u7F16\u8F91\u5BF9\u5E94 design/tasks\uFF08\u8FD9\u672C\u8EAB\u662F\u540C\u6B65\u52A8\u4F5C\uFF09\uFF1B",
      "             \u65E0\u9700\u6539\uFF08\u7EAF\u91CD\u6784/\u683C\u5F0F\u5316/\u65E0\u5173\uFF09\u2192 \u5728 .sdd-review-todo.md \u7684\u300C\u5F85\u8BC4\u5BA1\u300D\u533A\u539F\u5730\u52FE\u6389\uFF0C\u7406\u7531\u987B\u542B\u7B2C 3 \u6B65\u7684\u4F9D\u636E",
      '  \uFF08Layer A \u7EAF\u6587\u6863\u5BF9\u7EAF\u6587\u6863\uFF1A\u7B2C 2 \u6B65\u66FF\u6362\u4E3A"\u53E6\u4E00\u7BC7 doc \u6B64\u523B\u58F0\u79F0\u4EC0\u4E48"\uFF0C\u4E0D\u5F3A\u6C42 importer \u5F0F\u53D6\u8BC1\u3002\uFF09',
      "  \u89C4\u5219\u89C1 sdd-review-rules.md\u3002"
    ].join("\n");
    var ACTION_LINE = [
      '\u6700\u7EC8\u95E8\u69DB\uFF08\u5FC5\u505A\uFF0C\u52FF\u7565\uFF09\uFF1A\u2460 \u82E5\u672C\u8F6E review \u4E2D\u4F60\u7F16\u8F91\u8FC7 code/design/tasks\uFF0C\u7ACB\u523B\u91CD\u8BFB\u6700\u65B0 .sdd-review-todo.md\uFF1B\u2461 \u5176\u4E2D\u65B0\u51FA\u73B0\u7684 path@hash \u4E5F\u8981\u9010\u9879\u8BC4\u5BA1\u5E76\u52FE\u9009\uFF1B\u2462 \u5F85\u8BC4\u5BA1\u533A\u975E\u7A7A\u65F6\uFF0C\u4E0D\u8981\u8BF4"SDD review \u5DF2\u5B8C\u6210"\uFF0C\u8981\u8BF4\u660E\u8FD8\u5269\u54EA\u4E9B\u5F85\u4EBA\u5DE5\u786E\u8BA4\u3002',
      "ACTION: \u56DE\u5230\u7528\u6237\u539F\u59CB\u4EFB\u52A1\u3002\u6E05\u9664\u5F85\u8BC4\u5BA1\u9879\u7684\u552F\u4E00\u65B9\u5F0F\u662F\u5728 .sdd-review-todo.md \u7684\u300C## \u5F85\u8BC4\u5BA1\u300D\u533A\u539F\u5730\u628A\u5DF2\u8BC4\u5BA1\u884C\u4ECE [ ] \u6539\u4E3A [x]\uFF0C\u4FDD\u7559\u539F path@hash \u5E76\u8FFD\u52A0\u4E00\u53E5\u8BC1\u636E\u7406\u7531\uFF1B\u4E0D\u8981\u628A\u6761\u76EE\u79FB\u5230\u300C\u5BA1\u8BA1\u5386\u53F2\u300D\u533A\uFF0C\u4E0D\u8981\u624B\u5199\u65B0\u589E\u5F85\u8BC4\u5BA1\u6761\u76EE\uFF08\u7F16\u8F91\u6587\u4EF6\u4E0D\u81EA\u52A8\u6E05\u9664\uFF09\u3002"
    ].join("\n");
    var changedLine = (item) => {
      const p = sanitizePath(item.path);
      if (item.kind === "code" && Array.isArray(item.candidates) && item.candidates.length) {
        return `  - ${p}  (\u5019\u9009 change-dir: ${item.candidates.map(sanitizePath).join(", ")})`;
      }
      return `  - ${p}`;
    };
    var noteLines = (item) => {
      const notes = item && Array.isArray(item.notes) ? item.notes : [];
      return notes.map((n) => {
        const summary = sanitizePath(n && n.summary || "");
        const task = sanitizePath(n && n.task || "");
        return `      \u21B3 \u53D8\u66F4\u7EBF\u7D22: ${summary}${task ? `  [\u4EFB\u52A1: ${task}]` : ""}`;
      });
    };
    var buildProjectRulesSegment = (rules) => {
      if (!rules || !rules.text) return [];
      const src = sanitizePath(rules.relPath || "");
      const lines = [
        "",
        `\u9879\u76EE\u9644\u52A0\u89C4\u5219\uFF08\u6765\u81EA ${src}\uFF1B\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u6539\u53D8\u6E05\u9664\u5224\u5B9A\uFF0C\u662F\u5426\u504F\u5DEE\u4ECD\u7531\u4F60\u5224\u65AD\uFF09:`,
        ...rules.text.split("\n").map((l) => `  ${l}`)
      ];
      if (rules.truncated) lines.push(`  \uFF08\u89C4\u5219\u6587\u4EF6\u8D85\u957F\uFF0C\u5DF2\u622A\u65AD\uFF1B\u5B8C\u6574\u5185\u5BB9\u89C1 ${src}\uFF09`);
      return lines;
    };
    var buildReminder = (needs, designFirstLineByDir = {}, projectRules = null) => {
      if (!needs || needs.length === 0) return "";
      const items = [...needs].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const lines = ["<system-reminder>", HEADER, "", "CHANGED (\u672A\u8BC4\u5BA1\uFF0C\u672C\u6279):"];
      for (const item of items) {
        lines.push(changedLine(item));
        for (const nl of noteLines(item)) lines.push(nl);
      }
      const dirs = /* @__PURE__ */ new Set();
      for (const item of items) {
        for (const d of item.candidates || []) {
          if (designFirstLineByDir[d]) dirs.add(d);
        }
      }
      const sortedDirs = [...dirs].sort();
      if (sortedDirs.length) {
        lines.push("", "CONTEXT (change-dir design \u9996\u884C):");
        for (const d of sortedDirs) {
          lines.push(`  - ${sanitizePath(d)}: ${sanitizePath(designFirstLineByDir[d])}`);
        }
      }
      for (const line of buildProjectRulesSegment(projectRules)) lines.push(line);
      lines.push("", REVIEW_BLOCK, "", ACTION_LINE, "</system-reminder>");
      return lines.join("\n") + "\n";
    };
    var buildCarryOver = (needs) => {
      if (!needs || needs.length === 0) return "";
      return [
        "<system-reminder>",
        HEADER,
        `\u6709 ${needs.length} \u9879\u53D8\u66F4\u5C1A\u672A\u8BC4\u5BA1\uFF08\u89C1 .sdd-review-todo.md\uFF09\u3002\u9010\u9879\u5148\u53D6\u8BC1\u540E\u4E0B\u7ED3\u8BBA\uFF1B\u8BC4\u5BA1\u8FC7\u7684\u5728\u8BE5\u6587\u4EF6\u52FE\u6389\u3002`,
        "</system-reminder>"
      ].join("\n") + "\n";
    };
    var buildCompactReminder = (needs) => {
      if (!needs || needs.length === 0) return "";
      const items = [...needs].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const lines = [
        "<system-reminder>",
        HEADER,
        `\u672C\u56DE\u5408\u4ECD\u6709 ${items.length} \u9879\u5F85\u8BC4\u5BA1\uFF08\u5B8C\u6574\u8BC4\u5BA1\u7EAA\u5F8B\u89C1\u672C\u56DE\u5408\u9996\u6761\u63D0\u9192 / sdd-review-rules.md\uFF09:`
      ];
      for (const item of items) lines.push(`  - ${sanitizePath(item.path)}`);
      lines.push(
        "\u9010\u9879\u5148\u53D6\u8BC1\u540E\u4E0B\u7ED3\u8BBA\uFF1B\u8BC4\u5BA1\u8FC7\u7684\u5728 .sdd-review-todo.md\u300C\u5F85\u8BC4\u5BA1\u300D\u533A\u539F\u5730\u4ECE [ ] \u6539\u4E3A [x] \u5E76\u9644\u8BC1\u636E\u7406\u7531\u3002",
        "</system-reminder>"
      );
      return lines.join("\n") + "\n";
    };
    var buildStopBlock = (needs) => {
      if (!needs || needs.length === 0) return "";
      const items = [...needs].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const lines = [
        HEADER,
        `\u6536\u5C3E\u524D\u68C0\u6D4B\u5230 ${items.length} \u9879 SDD \u53D8\u66F4\u5C1A\u672A\u8BC4\u5BA1\uFF0C\u8BF7\u5148\u5B8C\u6210\u8BC4\u5BA1\u518D\u7ED3\u675F\u672C\u56DE\u5408\uFF1A`
      ];
      for (const item of items) {
        lines.push(`  - ${sanitizePath(item.path)}`);
        for (const nl of noteLines(item)) lines.push(nl);
      }
      lines.push("", REVIEW_BLOCK, "", ACTION_LINE);
      return lines.join("\n") + "\n";
    };
    var leftoverItemLines = (items) => [...items].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((it) => `  - ${sanitizePath(it.path)}@${it.currentHash}`);
    var buildLeftoverStopBlock = (items) => {
      if (!items || items.length === 0) return "";
      return [
        HEADER,
        "\u4F60\u5728\u672C\u8F6E review \u540E\u53C8\u7F16\u8F91\u4E86\u6587\u4EF6\uFF0C.sdd-review-todo.md \u51FA\u73B0\u65B0\u7684\u5F85\u8BC4\u5BA1\u9879\uFF1B\u6700\u7EC8\u56DE\u590D\u524D\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5E76\u9010\u9879\u52FE\u9009\uFF08\u5148\u53D6\u8BC1\u540E\u4E0B\u7ED3\u8BBA\uFF09\uFF1A",
        ...leftoverItemLines(items)
      ].join("\n") + "\n";
    };
    var buildLeftoverCarryOver = (items) => {
      if (!items || items.length === 0) return "";
      return [
        "<system-reminder>",
        HEADER,
        "\u4E0A\u4E00\u8F6E review \u540E\u53C8\u7F16\u8F91\u4E86\u6587\u4EF6\uFF0C.sdd-review-todo.md \u4ECD\u6709\u65B0\u589E\u7684\u5F85\u8BC4\u5BA1\u9879\uFF0C\u8BF7\u5148\u91CD\u65B0\u8BFB\u53D6\u5E76\u9010\u9879\u52FE\u9009\uFF1A",
        ...leftoverItemLines(items),
        "</system-reminder>"
      ].join("\n") + "\n";
    };
    module.exports = {
      HEADER,
      REVIEW_BLOCK,
      ACTION_LINE,
      changedLine,
      buildProjectRulesSegment,
      buildReminder,
      buildCarryOver,
      buildCompactReminder,
      buildStopBlock,
      buildLeftoverStopBlock,
      buildLeftoverCarryOver
    };
  }
});

// src/core/rules-file.js
var require_rules_file = __commonJS({
  "src/core/rules-file.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var { resolveFile, rel, sanitizePath } = require_paths();
    var RULES_DEFAULT_BASENAME = "sdd-review-rules.md";
    var MAX_RULES_BYTES = 4096;
    var MAX_RULES_LINES = 60;
    var MAX_RULES_LINE_CHARS = 500;
    var existingFile = (abs) => {
      try {
        return fs.statSync(abs).isFile() ? abs : null;
      } catch {
        return null;
      }
    };
    var resolveRulesPath = (repoRoot, cfg) => {
      try {
        const fromEnv = cfg && cfg.rulesFile;
        if (fromEnv) {
          const hit = existingFile(resolveFile(repoRoot, fromEnv));
          if (hit) return hit;
        }
        return existingFile(resolveFile(repoRoot, RULES_DEFAULT_BASENAME));
      } catch {
        return null;
      }
    };
    var sanitizeRulesLine = (line) => {
      const defanged = String(line == null ? "" : line).replace(
        /<\s*\/?\s*system-reminder\b[^>]*>/gi,
        (m) => m.replace(/</g, "\uFF1C").replace(/>/g, "\uFF1E")
      );
      let out = "";
      for (const ch of defanged) {
        const code = ch.codePointAt(0);
        const isAsciiControl = code <= 31 || code === 127;
        const isBidiOverride = code >= 8206 && code <= 8207 || code >= 8234 && code <= 8238 || code >= 8294 && code <= 8297;
        out += isAsciiControl || isBidiOverride ? " " : ch;
      }
      return out.slice(0, MAX_RULES_LINE_CHARS);
    };
    var readCapped = (abs) => {
      let fd = null;
      try {
        fd = fs.openSync(abs, "r");
        const buf = Buffer.alloc(MAX_RULES_BYTES + 1);
        const bytesRead = fs.readSync(fd, buf, 0, MAX_RULES_BYTES + 1, 0);
        return buf.subarray(0, bytesRead);
      } catch {
        return null;
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
          }
        }
      }
    };
    var relPathLabel = (repoRoot, abs) => {
      try {
        const r = rel(repoRoot, abs);
        if (r && !r.startsWith("..")) return sanitizePath(r);
      } catch {
      }
      return sanitizePath(abs);
    };
    var readProjectRules = (repoRoot, cfg) => {
      const abs = resolveRulesPath(repoRoot, cfg);
      if (!abs) return null;
      const raw = readCapped(abs);
      if (!raw) return null;
      const overByBytes = raw.length > MAX_RULES_BYTES;
      const content = raw.subarray(0, Math.min(raw.length, MAX_RULES_BYTES));
      if (content.includes(0)) return null;
      let lines = content.toString("utf8").split("\n").map(sanitizeRulesLine);
      if (overByBytes && lines.length > 1) lines = lines.slice(0, -1);
      const overByLines = lines.length > MAX_RULES_LINES;
      if (overByLines) lines = lines.slice(0, MAX_RULES_LINES);
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      const text = lines.join("\n");
      if (!text.trim()) return null;
      return { relPath: relPathLabel(repoRoot, abs), text, truncated: overByBytes || overByLines };
    };
    module.exports = {
      RULES_DEFAULT_BASENAME,
      MAX_RULES_BYTES,
      MAX_RULES_LINES,
      MAX_RULES_LINE_CHARS,
      resolveRulesPath,
      sanitizeRulesLine,
      readProjectRules
    };
  }
});

// src/core/session-context.js
var require_session_context = __commonJS({
  "src/core/session-context.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var PROMPT_SNIPPET_MAX = 200;
    var lastPromptPath = (stateDir, sessionKey) => path.join(stateDir, `last-prompt-${sessionKey}.json`);
    var snippetOf = (text) => String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, PROMPT_SNIPPET_MAX);
    var saveLastPrompt = (stateDir, sessionKey, text) => {
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(lastPromptPath(stateDir, sessionKey), JSON.stringify({ prompt: snippetOf(text) }));
        return true;
      } catch {
        return false;
      }
    };
    var loadLastPrompt = (stateDir, sessionKey) => {
      try {
        const data = JSON.parse(fs.readFileSync(lastPromptPath(stateDir, sessionKey), "utf8"));
        return typeof data.prompt === "string" ? data.prompt : "";
      } catch {
        return "";
      }
    };
    module.exports = {
      PROMPT_SNIPPET_MAX,
      lastPromptPath,
      snippetOf,
      saveLastPrompt,
      loadLastPrompt
    };
  }
});

// src/core/change-note.js
var require_change_note = __commonJS({
  "src/core/change-note.js"(exports, module) {
    "use strict";
    var { sanitizePath } = require_paths();
    var SUMMARY_MAX = 120;
    var SNIPPET_MAX = 80;
    var TASK_MAX = 120;
    var lineCount = (s) => {
      const str = String(s == null ? "" : s);
      return str === "" ? 0 : str.split(/\r?\n/).length;
    };
    var firstNonEmptyLine = (s) => {
      for (const line of String(s == null ? "" : s).split(/\r?\n/)) {
        const t = line.trim();
        if (t) return t;
      }
      return "";
    };
    var snippet = (s) => firstNonEmptyLine(s).slice(0, SNIPPET_MAX);
    var buildChangeSummary = (toolName, toolInput) => {
      const ti = toolInput && typeof toolInput === "object" ? toolInput : {};
      let raw;
      if (Array.isArray(ti.edits)) {
        let adds = 0;
        let dels = 0;
        for (const e of ti.edits) {
          adds += lineCount(e && e.new_string);
          dels += lineCount(e && e.old_string);
        }
        const snip = ti.edits.length ? snippet(ti.edits[0] && ti.edits[0].new_string) : "";
        raw = `MultiEdit \xD7${ti.edits.length} +${adds}/-${dels}${snip ? `: \xAB${snip}\xBB` : ""}`;
      } else if ("content" in ti && !("new_string" in ti)) {
        const snip = snippet(ti.content);
        raw = `Write (${lineCount(ti.content)} \u884C)${snip ? `: \xAB${snip}\xBB` : ""}`;
      } else {
        const snip = snippet(ti.new_string);
        raw = `Edit +${lineCount(ti.new_string)}/-${lineCount(ti.old_string)}${snip ? `: \xAB${snip}\xBB` : ""}`;
      }
      return sanitizePath(raw).slice(0, SUMMARY_MAX);
    };
    var buildChangeNote = ({ toolName, toolInput, task = "", now } = {}) => ({
      at: now || "",
      summary: buildChangeSummary(toolName, toolInput),
      task: sanitizePath(String(task == null ? "" : task)).slice(0, TASK_MAX)
    });
    module.exports = {
      SUMMARY_MAX,
      SNIPPET_MAX,
      TASK_MAX,
      lineCount,
      firstNonEmptyLine,
      snippet,
      buildChangeSummary,
      buildChangeNote
    };
  }
});

// src/core/todo.js
var require_todo = __commonJS({
  "src/core/todo.js"(exports, module) {
    "use strict";
    var { sanitizePath } = require_paths();
    var TODO_HEADER = "\u53EA\u5728\u300C\u5F85\u8BC4\u5BA1\u300D\u533A\u628A\u5DF2\u5B8C\u6210\u8BC4\u5BA1\u7684\u884C\u539F\u5730\u4ECE [ ] \u6539\u4E3A [x]\uFF1B\u4E0D\u8981\u79FB\u52A8\u3001\u590D\u5236\u6216\u6539\u5199 path@hash\u3002";
    var truncationWarning = (skipped) => `> \u26A0 \u672C\u8F6E\u626B\u63CF\u8D85\u9884\u7B97\uFF0C\u7EA6 ${skipped} \u4E2A\u6587\u4EF6\u672A\u68C0\u67E5\u3001\u5176\u53D8\u66F4\u53EF\u80FD\u5C1A\u672A\u5217\u51FA\uFF1B\u4E0B\u8F6E\u7EE7\u7EED\uFF08\u53EF\u8C03 SDD_REVIEW_SCAN_BUDGET_MS / SCAN_ROOTS / IGNORE\uFF09\u3002`;
    var PENDING_HEADING = "## \u5F85\u8BC4\u5BA1";
    var REVIEWED_HEADING = "## \u5BA1\u8BA1\u5386\u53F2\uFF08\u53EA\u8BFB\uFF0C\u52FF\u7F16\u8F91\uFF09";
    var DEFAULT_REVIEWED_LIMIT = 50;
    var TODO_LINE = /^- \[( |x)\] (\S+)@([0-9a-f]+)(?:\s+\(候选:[^)]*\))?(?: — (.*))?$/;
    var parseTodo = (text) => {
      const entries = [];
      if (typeof text !== "string") return entries;
      let inReviewed = false;
      for (const line of text.split(/\r?\n/)) {
        if (line.trimStart().startsWith("## ")) {
          inReviewed = line.includes("\u5DF2\u8BC4\u5BA1") || line.includes("\u5BA1\u8BA1\u5386\u53F2");
          continue;
        }
        if (inReviewed) continue;
        const m = TODO_LINE.exec(line);
        if (!m) continue;
        entries.push({
          checked: m[1] === "x",
          path: m[2],
          inlineHash: m[3],
          rationale: (m[4] || "").trim()
        });
      }
      return entries;
    };
    var THIN_RATIONALES = /* @__PURE__ */ new Set(["", "\u65E0\u5173", "ok", "n/a", "na", "\u65E0", "skip"]);
    var isThinRationale = (rationale) => THIN_RATIONALES.has(String(rationale || "").trim().toLowerCase());
    var THIN_MARK = "\uFF08\u7406\u7531\u8FC7\u7B80\uFF0C\u5EFA\u8BAE\u8865\u5145\uFF09";
    var HELD_NOTE = "\u21B3 \u4E0A\u6B21\u52FE\u9009\u7406\u7531\u8FC7\u7B80\u672A\u751F\u6548\uFF08\u4ECD\u4E3A\u5F85\u8BC4\u5BA1\uFF09\uFF1A\u8865\u4E00\u53E5\u542B\u7B2C 3 \u6B65\u4F9D\u636E\u7684\u7406\u7531\u540E\u91CD\u65B0\u52FE\u9009";
    var renderTodo = (needs, ledger, opts = {}) => {
      const reviewedLimit = opts.reviewedLimit || DEFAULT_REVIEWED_LIMIT;
      const meta = opts.meta || {};
      const lines = [TODO_HEADER];
      if (meta.scanTruncated) lines.push(truncationWarning(meta.skipped || 0));
      lines.push("");
      lines.push(PENDING_HEADING);
      const heldSet = new Set(Array.isArray(opts.heldPaths) ? opts.heldPaths : []);
      const pending = [...needs].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      for (const item of pending) {
        const candidates = Array.isArray(item.candidates) ? item.candidates.join(", ") : "";
        const tail = candidates ? `  (\u5019\u9009: ${candidates})` : "";
        lines.push(`- [ ] ${sanitizePath(item.path)}@${item.currentHash}${tail}`);
        if (heldSet.has(item.path)) lines.push(`  ${HELD_NOTE}`);
      }
      lines.push("", REVIEWED_HEADING);
      const records = ledger && ledger.records ? ledger.records : {};
      const reviewed = Object.entries(records).filter(([, r]) => r && r.reviewedHash).sort((a, b) => {
        const ta = a[1].reviewedAt || "";
        const tb = b[1].reviewedAt || "";
        if (ta !== tb) return ta < tb ? 1 : -1;
        return a[0] < b[0] ? -1 : 1;
      }).slice(0, reviewedLimit);
      for (const [p, r] of reviewed) {
        const isAutoBaseline = r.verdict === "bootstrap" || r.by === "bootstrap";
        const mark = !isAutoBaseline && isThinRationale(r.rationale) ? ` ${THIN_MARK}` : "";
        const rationale = r.rationale ? ` \u2014 ${r.rationale}` : " \u2014";
        lines.push(`- [x] ${sanitizePath(p)}@${r.reviewedHash}${rationale}${mark}`);
      }
      return lines.join("\n") + "\n";
    };
    module.exports = {
      TODO_HEADER,
      truncationWarning,
      PENDING_HEADING,
      REVIEWED_HEADING,
      DEFAULT_REVIEWED_LIMIT,
      THIN_MARK,
      HELD_NOTE,
      TODO_LINE,
      parseTodo,
      renderTodo,
      isThinRationale
    };
  }
});

// src/core/ingest.js
var require_ingest = __commonJS({
  "src/core/ingest.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var { classifyPath } = require_classify();
    var { withRecord } = require_ledger();
    var { isThinRationale } = require_todo();
    var RATIONALE_MAX = 200;
    var clamp = (s, max) => String(s == null ? "" : s).slice(0, max);
    var labelFromRationale = (rationale) => {
      const r = String(rationale || "").toLowerCase();
      if (/unrelated/.test(r) || /无关/.test(r)) return "unrelated";
      if (/no[- ]?change|gofmt|format|lint/.test(r) || /仅格式|无需改/.test(r)) return "no-change";
      if (/synced?|updated?/.test(r) || /已同步|已更新/.test(r)) return "synced";
      return "reviewed";
    };
    var basenameToken = (p) => {
      try {
        return path.posix.basename(String(p || "")).toLowerCase();
      } catch {
        return "";
      }
    };
    var rationaleStats = (rationale, p) => {
      const text = String(rationale == null ? "" : rationale);
      const token = basenameToken(p);
      return {
        thin: isThinRationale(rationale),
        len: text.trim().length,
        refsPath: token.length >= 2 && text.toLowerCase().includes(token),
        verdict: labelFromRationale(rationale)
      };
    };
    var passesRationaleGate = (rationale, minChars) => {
      try {
        return String(rationale == null ? "" : rationale).trim().length >= (minChars || 0);
      } catch {
        return true;
      }
    };
    var ingestCheckoffs = (ledger, todoEntries, now, actor, opts = {}) => {
      const onCheckoff = typeof opts.onCheckoff === "function" ? opts.onCheckoff : null;
      const gateOn = !!opts.gateOn;
      const minChars = opts.minChars || 0;
      let next = ledger;
      for (const e of todoEntries) {
        if (!e.checked) continue;
        if (classifyPath(e.path) === "other") continue;
        const stats = rationaleStats(e.rationale, e.path);
        const held = gateOn && !passesRationaleGate(e.rationale, minChars);
        if (onCheckoff) {
          try {
            onCheckoff({ path: e.path, held, ...stats });
          } catch {
          }
        }
        if (held) continue;
        next = withRecord(next, e.path, {
          kind: classifyPath(e.path),
          reviewedHash: e.inlineHash,
          // ★ pin to inline hash, not current hash
          verdict: stats.verdict,
          rationale: clamp(e.rationale, RATIONALE_MAX),
          reviewedAt: now,
          by: actor || "agent"
        });
      }
      return next;
    };
    module.exports = {
      RATIONALE_MAX,
      clamp,
      labelFromRationale,
      basenameToken,
      rationaleStats,
      passesRationaleGate,
      ingestCheckoffs
    };
  }
});

// src/core/locks.js
var require_locks = __commonJS({
  "src/core/locks.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var DEFAULT_LOCK_STALE_MS = 3e4;
    var sleepSync = (ms) => {
      if (ms <= 0) return;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    };
    var acquireFileLock = (target, options = {}) => {
      const staleMs = options.staleMs || DEFAULT_LOCK_STALE_MS;
      const waitMs = options.waitMs || 0;
      const retryMs = options.retryMs || 25;
      const lockPath = `${target}.lock`;
      const openLock = () => {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        const fd = fs.openSync(lockPath, "wx");
        fs.writeFileSync(fd, `${process.pid}
${(/* @__PURE__ */ new Date()).toISOString()}
`);
        return { fd, lockPath };
      };
      const deadline = Date.now() + waitMs;
      while (true) {
        try {
          return openLock();
        } catch (err) {
          if (err && err.code !== "EEXIST") return null;
        }
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) fs.unlinkSync(lockPath);
        } catch {
        }
        if (Date.now() >= deadline) return null;
        sleepSync(retryMs);
      }
    };
    var releaseFileLock = (lock) => {
      if (!lock) return;
      try {
        fs.closeSync(lock.fd);
      } catch {
      }
      try {
        fs.unlinkSync(lock.lockPath);
      } catch {
      }
    };
    module.exports = {
      DEFAULT_LOCK_STALE_MS,
      acquireFileLock,
      releaseFileLock,
      sleepSync
    };
  }
});

// src/core/atomic.js
var require_atomic = __commonJS({
  "src/core/atomic.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var crypto = __require("crypto");
    var writeTextAtomic = (filePath, text) => {
      const tmp = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
      try {
        fs.writeFileSync(tmp, text);
        try {
          fs.renameSync(tmp, filePath);
        } catch (err) {
          if (err && (err.code === "EEXIST" || err.code === "EPERM")) {
            try {
              fs.unlinkSync(filePath);
            } catch {
            }
            fs.renameSync(tmp, filePath);
          } else {
            throw err;
          }
        }
        return true;
      } catch {
        try {
          fs.unlinkSync(tmp);
        } catch {
        }
        return false;
      }
    };
    module.exports = { writeTextAtomic };
  }
});

// src/core/diagnostics.js
var require_diagnostics = __commonJS({
  "src/core/diagnostics.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var LOG_FILENAME = "sdd-review.log.jsonl";
    var diag = (stateDir, event) => {
      if (!stateDir || !event) return;
      try {
        const line = JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...event }) + "\n";
        fs.appendFileSync(path.join(stateDir, LOG_FILENAME), line);
      } catch {
      }
    };
    module.exports = { LOG_FILENAME, diag };
  }
});

// src/pipeline.js
var require_pipeline = __commonJS({
  "src/pipeline.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var { readConfig } = require_config();
    var { rel, toPosix, resolveFile } = require_paths();
    var { classifyPath } = require_classify();
    var { hashElement } = require_hash();
    var {
      emptyLedger,
      parseLedger,
      serializeLedger,
      withRecord,
      trackCodePath,
      appendChangeNote
    } = require_ledger();
    var { resolveSessionKey } = require_session_key();
    var { loadLastPrompt } = require_session_context();
    var { buildChangeNote } = require_change_note();
    var { ingestCheckoffs } = require_ingest();
    var { parseTodo, renderTodo } = require_todo();
    var { discoverChangeDirs } = require_change_dirs();
    var { scanWorkTree } = require_scan();
    var { computeNeedsReview } = require_compute();
    var { acquireFileLock, releaseFileLock } = require_locks();
    var { writeTextAtomic } = require_atomic();
    var { resolveStateDir, ledgerPathFor, todoPathFor } = require_state_dir();
    var { diag } = require_diagnostics();
    var isSddProject = (repoRoot) => discoverChangeDirs(repoRoot).length > 0;
    var ledgerEmpty = (ledger) => !ledger || !ledger.records || Object.keys(ledger.records).length === 0;
    var loadLedgerFile = (ledgerPath) => {
      try {
        return parseLedger(fs.readFileSync(ledgerPath, "utf8"));
      } catch {
        return emptyLedger();
      }
    };
    var readTodoFile = (todoPath) => {
      try {
        return fs.readFileSync(todoPath, "utf8");
      } catch {
        return "";
      }
    };
    var fileMeta = (abs) => {
      try {
        const s = fs.statSync(abs);
        return { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return {};
      }
    };
    var keyFor = (repoRoot, fp) => toPosix(rel(repoRoot, resolveFile(repoRoot, fp)));
    var bootstrapIfEmpty = (repoRoot, ledger, cfg, now) => {
      if (!ledgerEmpty(ledger)) return { ledger, bootstrapped: false, count: 0 };
      const files = [];
      for (const d of discoverChangeDirs(repoRoot)) {
        for (const doc of d.docs) files.push(`${d.relDir}/${doc}`);
      }
      for (const c of scanWorkTree(repoRoot, ledger, cfg).codePaths) files.push(c);
      const uniq = [...new Set(files)];
      if (uniq.length < cfg.bootstrapThreshold) return { ledger, bootstrapped: false, count: 0 };
      let next = ledger;
      let count = 0;
      for (const relPath of uniq) {
        const abs = path.join(repoRoot, relPath);
        const h = hashElement(abs, cfg.hashLen);
        if (h === null) continue;
        next = withRecord(next, relPath, {
          kind: classifyPath(relPath),
          reviewedHash: h,
          verdict: "bootstrap",
          rationale: "",
          reviewedAt: now,
          by: "bootstrap",
          ...fileMeta(abs)
        });
        count += 1;
      }
      return { ledger: next, bootstrapped: true, count };
    };
    var runInner = (ctx) => {
      const env = ctx.env || process.env;
      const cfg = readConfig(env);
      if (cfg.disabled) return { action: "silent", reason: "disabled" };
      const repoRoot = ctx.repoRoot;
      const now = ctx.now || (/* @__PURE__ */ new Date()).toISOString();
      const actor = ctx.actor || "agent";
      const stateDir = resolveStateDir(repoRoot);
      const ledgerPath = ledgerPathFor(repoRoot);
      const todoPath = todoPathFor(repoRoot);
      const probe = loadLedgerFile(ledgerPath);
      if (!isSddProject(repoRoot) && ledgerEmpty(probe)) {
        return { action: "silent", reason: "not-sdd" };
      }
      const lock = acquireFileLock(ledgerPath, { waitMs: 500, retryMs: 25, staleMs: 3e4 });
      if (!lock) {
        diag(stateDir, { event: "lock-fail", repoRoot });
        const needs = computeNeedsReview(repoRoot, probe, cfg);
        return { action: "deliver", needs: needs.items, meta: needs.meta, wrote: false, ledger: probe };
      }
      try {
        let ledger = loadLedgerFile(ledgerPath);
        const checkoffStats = { thin: 0, substantive: 0, refsPath: 0, held: 0, total: 0 };
        const heldPaths = [];
        ledger = ingestCheckoffs(ledger, parseTodo(readTodoFile(todoPath)), now, actor, {
          gateOn: cfg.rationaleGate,
          minChars: cfg.rationaleMinChars,
          onCheckoff: (s) => {
            checkoffStats.total += 1;
            checkoffStats[s.thin ? "thin" : "substantive"] += 1;
            if (s.refsPath) checkoffStats.refsPath += 1;
            if (s.held) {
              checkoffStats.held += 1;
              heldPaths.push(s.path);
            }
          }
        });
        if (checkoffStats.total > 0) diag(stateDir, { event: "checkoff-rationale", ...checkoffStats });
        const boot = bootstrapIfEmpty(repoRoot, ledger, cfg, now);
        ledger = boot.ledger;
        if (boot.bootstrapped) diag(stateDir, { event: "auto-baseline", count: boot.count });
        if (ctx.editedPath && classifyPath(ctx.editedPath) === "code") {
          const key = keyFor(repoRoot, ctx.editedPath);
          ledger = trackCodePath(ledger, key, fileMeta(path.join(repoRoot, key)));
          if (cfg.changeNoteCap > 0) {
            const sessionKey = resolveSessionKey(ctx.event || {}, env, repoRoot);
            const note = buildChangeNote({
              toolName: ctx.event && ctx.event.tool_name,
              toolInput: ctx.event && ctx.event.tool_input,
              task: loadLastPrompt(stateDir, sessionKey),
              now
            });
            ledger = appendChangeNote(ledger, key, note, cfg.changeNoteCap);
          }
        }
        const needs = computeNeedsReview(repoRoot, ledger, cfg);
        if (needs.meta && needs.meta.scanTruncated) {
          diag(stateDir, { event: "scan-truncated", skipped: needs.meta.skipped });
        }
        const okLedger = writeTextAtomic(ledgerPath, serializeLedger(ledger));
        const okTodo = writeTextAtomic(todoPath, renderTodo(needs.items, ledger, { meta: needs.meta, heldPaths }));
        if (!okLedger || !okTodo) diag(stateDir, { event: "write-skipped", okLedger, okTodo });
        return {
          action: boot.bootstrapped ? "bootstrap" : "deliver",
          needs: needs.items,
          meta: needs.meta,
          wrote: okLedger && okTodo,
          bootstrapped: boot.bootstrapped,
          bootstrapCount: boot.count,
          ledger,
          ledgerPath,
          todoPath
        };
      } finally {
        releaseFileLock(lock);
      }
    };
    var run = (ctx) => {
      try {
        return runInner(ctx);
      } catch (e) {
        try {
          diag(resolveStateDir(ctx.repoRoot), { event: "error", error: String(e && e.message || e) });
        } catch {
        }
        return { action: "silent", reason: "error", error: String(e && e.message || e) };
      }
    };
    module.exports = {
      run,
      runInner,
      isSddProject,
      ledgerEmpty,
      bootstrapIfEmpty,
      loadLedgerFile,
      keyFor
    };
  }
});

// src/handlers/on-edit.js
var require_on_edit = __commonJS({
  "src/handlers/on-edit.js"(exports, module) {
    "use strict";
    var { readConfig } = require_config();
    var { resolveStateDir } = require_state_dir();
    var { resolveSessionKey } = require_session_key();
    var { loadThrottle, saveThrottle, decideReminder } = require_throttle();
    var { discoverChangeDirs } = require_change_dirs();
    var { selectActiveNeeds, pendingKeys } = require_compute();
    var { classifyPath } = require_classify();
    var { buildReminder, buildCompactReminder } = require_prompts();
    var { readProjectRules } = require_rules_file();
    var { run } = require_pipeline();
    var reminderPathSet = (needs) => [...new Set(needs.map((item) => item.path))].sort();
    var onEdit = (ctx) => {
      const result = run(ctx);
      if (result.action === "silent") return { deliver: false, text: "", result };
      const needs = result.needs || [];
      const activeNeeds = selectActiveNeeds(needs);
      const env = ctx.env || process.env;
      const cfg = readConfig(env);
      if (cfg.disabled) return { deliver: false, text: "", result };
      const stateDir = resolveStateDir(ctx.repoRoot);
      const sessionKey = resolveSessionKey(ctx.event || {}, env, ctx.repoRoot);
      let throttle = loadThrottle(stateDir, sessionKey);
      const pendingPaths = reminderPathSet(activeNeeds);
      const pendingSet = new Set(pendingPaths);
      const reminded = throttle.lastRemindedPathSet || [];
      const prunedReminded = reminded.filter((p) => pendingSet.has(p));
      if (prunedReminded.length !== reminded.length) {
        throttle = { ...throttle, lastRemindedPathSet: prunedReminded };
        saveThrottle(stateDir, sessionKey, throttle);
      }
      if (activeNeeds.length === 0) return { deliver: false, text: "", result };
      if (ctx.editedPath && classifyPath(ctx.editedPath) === "other") {
        return { deliver: false, text: "", result };
      }
      const firstThisTurn = throttle.lastRemindedBatch !== throttle.batch;
      const decision = decideReminder(throttle, {
        hasNeeds: true,
        maxReminders: cfg.sessionMaxReminders,
        pathSet: pendingPaths,
        mode: cfg.reminderMode,
        nowMs: ctx.nowMs || Date.now()
      });
      if (!decision.remind) return { deliver: false, text: "", result };
      const persistedState = firstThisTurn ? { ...decision.state, reviewBaselinePending: pendingKeys(needs) } : decision.state;
      saveThrottle(stateDir, sessionKey, persistedState);
      if (!firstThisTurn) {
        return { deliver: true, text: buildCompactReminder(activeNeeds), result };
      }
      const designFirstLineByDir = {};
      for (const d of discoverChangeDirs(ctx.repoRoot)) {
        if (d.designFirstLine) designFirstLineByDir[d.relDir] = d.designFirstLine;
      }
      const projectRules = readProjectRules(ctx.repoRoot, cfg);
      return { deliver: true, text: buildReminder(activeNeeds, designFirstLineByDir, projectRules), result };
    };
    module.exports = { onEdit, reminderPathSet };
  }
});

// src/handlers/on-prompt.js
var require_on_prompt = __commonJS({
  "src/handlers/on-prompt.js"(exports, module) {
    "use strict";
    var { readConfig } = require_config();
    var { resolveStateDir } = require_state_dir();
    var { resolveSessionKey } = require_session_key();
    var { loadThrottle, saveThrottle, bumpBatch } = require_throttle();
    var { saveLastPrompt } = require_session_context();
    var { buildCarryOver, buildLeftoverCarryOver } = require_prompts();
    var { selectActiveNeeds, selectReviewLeftover } = require_compute();
    var { run } = require_pipeline();
    var onPrompt = (ctx) => {
      const env = ctx.env || process.env;
      const cfg = readConfig(env);
      if (cfg.disabled) return { deliver: false, text: "" };
      const stateDir = resolveStateDir(ctx.repoRoot);
      const sessionKey = resolveSessionKey(ctx.event || {}, env, ctx.repoRoot);
      saveLastPrompt(stateDir, sessionKey, ctx.event && (ctx.event.prompt || ctx.event.promptText) || "");
      const prior = loadThrottle(stateDir, sessionKey);
      const remindedLastTurn = prior.lastRemindedBatch !== null && prior.lastRemindedBatch === prior.batch;
      const next = bumpBatch(prior);
      const result = run(ctx);
      if (result.action === "silent") {
        saveThrottle(stateDir, sessionKey, next);
        return { deliver: false, text: "", result };
      }
      const needs = result.needs || [];
      const activeNeeds = selectActiveNeeds(needs);
      if (activeNeeds.length > 0) {
        saveThrottle(stateDir, sessionKey, next);
        return { deliver: true, text: buildCarryOver(activeNeeds), result };
      }
      if (remindedLastTurn) {
        const leftover = selectReviewLeftover(needs, prior.reviewBaselinePending);
        if (leftover.length > 0) {
          saveThrottle(stateDir, sessionKey, { ...next, reviewBaselinePending: [] });
          return { deliver: true, text: buildLeftoverCarryOver(leftover), result };
        }
      }
      saveThrottle(stateDir, sessionKey, next);
      return { deliver: false, text: "", result };
    };
    module.exports = { onPrompt };
  }
});

// src/handlers/on-stop.js
var require_on_stop = __commonJS({
  "src/handlers/on-stop.js"(exports, module) {
    "use strict";
    var { readConfig } = require_config();
    var { resolveStateDir } = require_state_dir();
    var { resolveSessionKey } = require_session_key();
    var { loadThrottle } = require_throttle();
    var { buildStopBlock, buildLeftoverStopBlock } = require_prompts();
    var { selectActiveNeeds, selectReviewLeftover } = require_compute();
    var { run } = require_pipeline();
    var onStop = (ctx) => {
      const env = ctx.env || process.env;
      const cfg = readConfig(env);
      if (cfg.disabled) return { block: false, text: "" };
      const result = run(ctx);
      if (result.action === "silent") return { block: false, text: "", result };
      const needs = result.needs || [];
      if (needs.length === 0) return { block: false, text: "", result };
      if (ctx.stopHookActive) return { block: false, text: "", result };
      const activeNeeds = selectActiveNeeds(needs);
      if (activeNeeds.length > 0) return { block: true, text: buildStopBlock(activeNeeds), result };
      const throttle = loadThrottle(resolveStateDir(ctx.repoRoot), resolveSessionKey(ctx.event || {}, env, ctx.repoRoot));
      const remindedThisTurn = throttle.lastRemindedBatch !== null && throttle.lastRemindedBatch === throttle.batch;
      if (remindedThisTurn) {
        const leftover = selectReviewLeftover(needs, throttle.reviewBaselinePending);
        if (leftover.length > 0) return { block: true, text: buildLeftoverStopBlock(leftover), result };
      }
      return { block: false, text: "", result };
    };
    module.exports = { onStop };
  }
});

// src/adapters/opencode/native-plugin.js
var require_native_plugin = __commonJS({
  "src/adapters/opencode/native-plugin.js"(exports, module) {
    "use strict";
    var path = __require("node:path");
    var { findRepoRoot } = require_state_dir();
    var { onEdit } = require_on_edit();
    var { onPrompt } = require_on_prompt();
    var { onStop } = require_on_stop();
    var PLUGIN_NAME = "sdd-review-ledger-opencode";
    var TOOL_INPUT_CACHE_TTL_MS = 5 * 60 * 1e3;
    var IDLE_DEDUP_WINDOW_MS = 500;
    var TOOL_ARG_KEYS = ["args", "arguments", "parameters", "params", "input", "tool_input", "toolInput"];
    var WRITE_TOOL_NAMES = /* @__PURE__ */ new Set(["edit", "write", "multiedit", "patch", "apply_patch"]);
    var normalizeCwd = (ctx) => path.resolve(ctx?.worktree || ctx?.directory || process.cwd());
    var getSessionID = (input) => input?.sessionID || input?.sessionId || input?.session_id || "default";
    var getToolCallID = (input) => input?.callID || input?.callId || input?.toolCallID || input?.toolCallId || input?.tool_use_id || input?.id || null;
    var normalizeToolName = (tool) => {
      const name = String(tool || "").trim().toLowerCase().replace(/[-\s.]+/g, "_");
      if (name === "multi_edit" || name === "multi-edit") return "multiedit";
      return name;
    };
    var normalizeToolArgs = (args) => {
      const copy = { ...args || {} };
      const fp = getToolFilePath(copy);
      if (fp && !copy.file_path) copy.file_path = fp;
      return copy;
    };
    var getToolFilePath = (args) => {
      if (!args || typeof args !== "object") return null;
      if (args.file_path || args.filePath || args.path || args.file) {
        return args.file_path || args.filePath || args.path || args.file;
      }
      if (Array.isArray(args.edits)) {
        for (const edit of args.edits) {
          const fp = getToolFilePath(edit);
          if (fp) return fp;
        }
      }
      return null;
    };
    var hasToolArgs = (value) => {
      if (!value || typeof value !== "object") return false;
      if (getToolFilePath(value)) return true;
      return ["old_string", "new_string", "content", "edits", "patch"].some((key) => key in value);
    };
    var extractToolArgs = (...sources) => {
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of TOOL_ARG_KEYS) {
          if (hasToolArgs(source[key])) return normalizeToolArgs(source[key]);
        }
        if (hasToolArgs(source)) return normalizeToolArgs(source);
      }
      return {};
    };
    var toolCacheKey = (input) => {
      const callID = getToolCallID(input);
      if (!callID) return null;
      return `${getSessionID(input)}:${normalizeToolName(input?.tool)}:${callID}`;
    };
    var pruneToolInputCache = (cache, now = Date.now()) => {
      for (const [key, item] of cache.entries()) {
        if (now - item.updatedAtMs > TOOL_INPUT_CACHE_TTL_MS) cache.delete(key);
      }
    };
    var cacheToolInput = (cache, input, args, now = Date.now()) => {
      const key = toolCacheKey(input);
      if (!key) return false;
      pruneToolInputCache(cache, now);
      cache.set(key, { args: normalizeToolArgs(args), updatedAtMs: now });
      return true;
    };
    var takeCachedToolInput = (cache, input, now = Date.now()) => {
      const key = toolCacheKey(input);
      if (!key) return null;
      pruneToolInputCache(cache, now);
      const item = cache.get(key);
      if (!item) return null;
      cache.delete(key);
      return normalizeToolArgs(item.args);
    };
    var compactText = (value, max = 1e3) => {
      const text = String(value || "");
      return text.length > max ? `${text.slice(0, max)}...` : text;
    };
    var logPluginIssue = async (client, level, message, extra = {}) => {
      try {
        await client?.app?.log?.({
          body: {
            service: PLUGIN_NAME,
            level,
            message,
            extra
          }
        });
      } catch {
      }
    };
    var baseCtx = (ctx, input) => {
      const cwd = normalizeCwd(ctx);
      const repoRoot = findRepoRoot(cwd);
      return {
        repoRoot,
        env: process.env,
        actor: "agent",
        event: {
          hook_source: "opencode-plugin",
          session_id: getSessionID(input),
          tool_use_id: getToolCallID(input),
          cwd
        }
      };
    };
    var isWriteTool = (tool) => WRITE_TOOL_NAMES.has(normalizeToolName(tool));
    var appendToolOutput = (output, message) => {
      const text = String(message || "").trim();
      if (!text || !output || typeof output !== "object") return false;
      const current = String(output.output || "");
      output.output = current ? `${current}

${text}` : text;
      output.metadata = {
        ...output.metadata || {},
        sddReviewLedger: {
          injected: true,
          channel: "tool.execute.after"
        }
      };
      return true;
    };
    var contentText = (value) => {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
      if (!value || typeof value !== "object") return "";
      return contentText(value.text || value.content || value.value || value.message?.content);
    };
    var isUserChatMessage = (input, output) => {
      const role = output?.message?.role || input?.message?.role || input?.role;
      if (role && String(role).toLowerCase() !== "user") return false;
      const text = contentText(output?.parts || output?.message?.content || input?.parts || input?.message?.content);
      return Boolean(text.trim()) || String(role || "").toLowerCase() === "user";
    };
    var normalizeIdleEvent = (event) => {
      if (event?.type === "session.idle") {
        return {
          sessionID: event?.properties?.sessionID || "default",
          rawType: event.type
        };
      }
      if (event?.type === "session.status") {
        const status = event?.properties?.status;
        if (status !== "idle" && status?.type !== "idle") return null;
        return {
          sessionID: event?.properties?.sessionID || "default",
          rawType: event.type
        };
      }
      return null;
    };
    var shouldHandleIdle = (recentIdleBySession, sessionID, now = Date.now()) => {
      const id = sessionID || "default";
      for (const [key, lastAt2] of recentIdleBySession.entries()) {
        if (now - lastAt2 > IDLE_DEDUP_WINDOW_MS * 10) recentIdleBySession.delete(key);
      }
      const lastAt = recentIdleBySession.get(id);
      if (lastAt && now - lastAt < IDLE_DEDUP_WINDOW_MS) return false;
      recentIdleBySession.set(id, now);
      return true;
    };
    var SddReviewLedgerOpenCode2 = async (ctx) => {
      const toolInputCache = /* @__PURE__ */ new Map();
      const recentIdleBySession = /* @__PURE__ */ new Map();
      return {
        "chat.message": async (input = {}, output = {}) => {
          if (!isUserChatMessage(input, output)) return;
          const c = baseCtx(ctx, input);
          c.event.hook_event_name = "UserPromptSubmit";
          c.event.prompt = contentText(output?.parts || output?.message?.content || input?.parts || input?.message?.content);
          try {
            const res = onPrompt(c);
            if (res?.deliver) {
              await logPluginIssue(ctx.client, "info", "observed SDD review carry-over", {
                sessionID: getSessionID(input),
                pending: res.result?.needs?.length || 0
              });
            }
          } catch (error) {
            await logPluginIssue(ctx.client, "warn", "chat message carry-over did not complete", {
              sessionID: getSessionID(input),
              error: compactText(error?.message || String(error))
            });
          }
        },
        "tool.execute.before": async (input = {}, output = {}) => {
          const args = extractToolArgs(output, input);
          cacheToolInput(toolInputCache, input, args);
        },
        "tool.execute.after": async (input = {}, output = {}) => {
          if (!isWriteTool(input.tool)) return;
          const args = takeCachedToolInput(toolInputCache, input) || extractToolArgs(input, output);
          const c = baseCtx(ctx, input);
          c.event.hook_event_name = "PostToolUse";
          c.event.tool_name = normalizeToolName(input.tool);
          c.event.tool_input = args;
          try {
            const res = onEdit({ ...c, editedPath: getToolFilePath(args) || void 0 });
            if (res?.deliver && appendToolOutput(output, res.text)) {
              await logPluginIssue(ctx.client, "info", "injected SDD review reminder", {
                tool: normalizeToolName(input.tool),
                sessionID: getSessionID(input),
                callID: getToolCallID(input)
              });
            }
          } catch (error) {
            await logPluginIssue(ctx.client, "warn", "tool review did not complete", {
              tool: normalizeToolName(input.tool),
              sessionID: getSessionID(input),
              error: compactText(error?.message || String(error))
            });
          }
        },
        event: async ({ event } = {}) => {
          const idle = normalizeIdleEvent(event);
          if (!idle || !shouldHandleIdle(recentIdleBySession, idle.sessionID)) return;
          const c = baseCtx(ctx, { sessionID: idle.sessionID });
          c.event.hook_event_name = "Stop";
          c.event.rawType = idle.rawType;
          try {
            const sres = onStop({ ...c, stopHookActive: false });
            if (sres && sres.block) {
              await logPluginIssue(ctx.client, "info", "SDD review pending at idle; will resurface on next message", {
                sessionID: idle.sessionID,
                rawType: idle.rawType,
                pending: sres.result?.needs?.length || 0
              });
            }
          } catch (error) {
            await logPluginIssue(ctx.client, "warn", "idle stop sweep did not complete", {
              sessionID: idle.sessionID,
              rawType: idle.rawType,
              error: compactText(error?.message || String(error))
            });
          }
        }
      };
    };
    if (process.env.SDD_REVIEW_LEDGER_EXPOSE_PRIVATE === "1") {
      Object.defineProperty(SddReviewLedgerOpenCode2, "_private", {
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
          takeCachedToolInput
        }
      });
    }
    module.exports = SddReviewLedgerOpenCode2;
  }
});

// src/adapters/opencode/native-plugin-entry.js
var import_native_plugin = __toESM(require_native_plugin());
var SddReviewLedgerOpenCode = import_native_plugin.default;
export {
  SddReviewLedgerOpenCode
};
