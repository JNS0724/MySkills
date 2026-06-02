"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  saveLastPrompt,
  loadLastPrompt,
  snippetOf,
  PROMPT_SNIPPET_MAX,
} = require("../../src/core/session-context")

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "sdd-sc-"))
const rm = (d) => fs.rmSync(d, { recursive: true, force: true })

test("saveLastPrompt/loadLastPrompt: roundtrip a prompt snippet", () => {
  const d = mkdir()
  try {
    saveLastPrompt(d, "sess-1", "实现问候功能")
    assert.equal(loadLastPrompt(d, "sess-1"), "实现问候功能")
  } finally {
    rm(d)
  }
})

test("loadLastPrompt: missing file → empty string (benign)", () => {
  const d = mkdir()
  try {
    assert.equal(loadLastPrompt(d, "never-saved"), "")
  } finally {
    rm(d)
  }
})

test("snippetOf: collapses whitespace and bounds length", () => {
  assert.equal(snippetOf("  a\n\n  b  "), "a b")
  assert.equal(snippetOf("x".repeat(1000)).length, PROMPT_SNIPPET_MAX)
  assert.equal(snippetOf(null), "")
})

test("saveLastPrompt: per-session isolation", () => {
  const d = mkdir()
  try {
    saveLastPrompt(d, "A", "task A")
    saveLastPrompt(d, "B", "task B")
    assert.equal(loadLastPrompt(d, "A"), "task A")
    assert.equal(loadLastPrompt(d, "B"), "task B")
  } finally {
    rm(d)
  }
})
