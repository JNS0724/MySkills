param(
  [ValidateSet("deepseek", "minimax")]
  [string]$Provider = "deepseek"
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$root = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $root)
$runId = [guid]::NewGuid().ToString("N")
$marker = $runId.Substring(0, 8)
$workRoot = Join-Path $root ".real-workspaces\doc-sync-workflow-$Provider-$runId"
$opencodeHome = Join-Path $root ".real-homes\doc-sync-workflow-$Provider-$runId"
$opencodeBin = Join-Path $root "node_modules\.bin\opencode.cmd"
$opencodeEntry = Join-Path $root "node_modules\opencode-ai\bin\opencode"
$phaseRunner = Join-Path $root "scripts\run-opencode-phase.mjs"
$configTemplate = Join-Path $root ".opencode\opencode.$Provider.jsonc.example"
$pluginSource = Join-Path $repoRoot "plugins\sdd-doc-sync\sdd-doc-sync-opencode.js"
$pluginTarget = Join-Path $workRoot ".opencode\plugins\sdd-doc-sync-opencode.js"
$todoPath = Join-Path $workRoot ".sdd-doc-sync.md"
$statePath = Join-Path $workRoot ".sdd-doc-sync-state.json"
$summaryJson = Join-Path $workRoot "doc-sync-workflow-summary.json"
$summaryMd = Join-Path $workRoot "doc-sync-workflow-report.md"

if (!(Test-Path -LiteralPath $opencodeBin)) {
  throw "missing opencode binary; run npm install in $root"
}
if (!(Test-Path -LiteralPath $opencodeEntry)) {
  throw "missing opencode node entrypoint; run npm install in $root"
}
if (!(Test-Path -LiteralPath $phaseRunner)) {
  throw "missing OpenCode phase runner: $phaseRunner"
}
if (!(Test-Path -LiteralPath $configTemplate)) {
  throw "missing provider config template: $configTemplate"
}
if (!(Test-Path -LiteralPath $pluginSource)) {
  throw "missing OpenCode plugin entry: $pluginSource"
}

$keyName = if ($Provider -eq "deepseek") { "DEEPSEEK_API_KEY" } else { "MINIMAX_API_KEY" }
if (!(Test-Path "Env:\$keyName")) {
  $envValue = [Environment]::GetEnvironmentVariable($keyName, "User")
  if (!$envValue) {
    $envValue = [Environment]::GetEnvironmentVariable($keyName, "Machine")
  }
  if ($envValue) {
    Set-Item "Env:\$keyName" $envValue
  }
}
$keyValue = [Environment]::GetEnvironmentVariable($keyName, "Process")
if (!$keyValue -or !$keyValue.Trim()) {
  throw "$keyName is not set in process or User environment"
}
if ($keyValue.Trim() -match "your|replace|placeholder|example|dummy|test-key|api-key|apikey") {
  throw "$keyName still looks like a placeholder"
}

function Set-ContentWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath,

    [AllowNull()]
    [string]$Value,

    [switch]$NoNewline,

    [int]$Retries = 20
  )

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $text = if ($null -eq $Value) { "" } else { [string]$Value }
  if (!$NoNewline) {
    $text = $text + [Environment]::NewLine
  }

  for ($attempt = 0; $attempt -le $Retries; $attempt++) {
    try {
      [System.IO.File]::WriteAllText($LiteralPath, $text, $utf8NoBom)
      return
    } catch [System.IO.IOException] {
      if ($attempt -eq $Retries) {
        throw
      }
      Start-Sleep -Milliseconds 250
    }
  }
}

function Read-Text {
  param([string]$LiteralPath)
  if (!(Test-Path -LiteralPath $LiteralPath)) {
    return ""
  }
  $bytes = [System.IO.File]::ReadAllBytes($LiteralPath)
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xff -and $bytes[1] -eq 0xfe) {
    return [System.Text.Encoding]::Unicode.GetString($bytes)
  }
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xef -and $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf) {
    return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Count-Matches {
  param([string]$Text, [string]$Pattern)
  return ([regex]::Matches([string]$Text, $Pattern)).Count
}

function Invoke-OpenCodeRun {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$OutLog,

    [Parameter(Mandatory = $true)]
    [string]$ErrLog,

    [Parameter(Mandatory = $true)]
    [string]$RequestPath,

    [int]$TimeoutMs = 240000
  )

  $envMap = [ordered]@{
    HOME = $env:HOME
    USERPROFILE = $env:USERPROFILE
  }
  $request = [ordered]@{
    executable = "node"
    args = @($opencodeEntry) + @($Arguments)
    cwd = $workRoot
    stdout = $OutLog
    stderr = $ErrLog
    timeoutMs = $TimeoutMs
    env = $envMap
  }
  Set-ContentWithRetry -LiteralPath $RequestPath -Value ($request | ConvertTo-Json -Depth 8) -NoNewline

  $runnerOutput = & node $phaseRunner $RequestPath
  if ($LASTEXITCODE -ne 0) {
    throw "OpenCode phase runner failed with exit code $LASTEXITCODE for $RequestPath"
  }
  $line = @($runnerOutput | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1)[0]
  if (!$line) {
    throw "OpenCode phase runner produced no JSON result for $RequestPath"
  }
  return ($line | ConvertFrom-Json)
}

function Get-TodoEntries {
  param([string]$Text)
  $entries = @()
  foreach ($line in (([string]$Text) -split "`r?`n")) {
    $m = [regex]::Match($line, "^- \[([ x])\] ([^\s]+)(.*)$")
    if ($m.Success) {
      $entries += [pscustomobject]@{
        checked = ($m.Groups[1].Value -eq "x")
        path = $m.Groups[2].Value
        reason = $m.Groups[3].Value.Trim()
        line = $line
      }
    }
  }
  return $entries
}

function Get-PendingPaths {
  param([string]$Text)
  return @((Get-TodoEntries $Text) | Where-Object { !$_.checked } | ForEach-Object { $_.path })
}

function Get-CheckedPaths {
  param([string]$Text)
  return @((Get-TodoEntries $Text) | Where-Object { $_.checked } | ForEach-Object { $_.path })
}

function Compare-StringSets {
  param([string[]]$Before, [string[]]$After)
  $beforeSet = @{}
  foreach ($item in @($Before)) {
    if ($item) { $beforeSet[$item] = $true }
  }
  $afterSet = @{}
  foreach ($item in @($After)) {
    if ($item) { $afterSet[$item] = $true }
  }
  $added = @()
  foreach ($item in $afterSet.Keys) {
    if (!$beforeSet.ContainsKey($item)) { $added += $item }
  }
  $cleared = @()
  foreach ($item in $beforeSet.Keys) {
    if (!$afterSet.ContainsKey($item)) { $cleared += $item }
  }
  return [pscustomobject]@{
    added = @($added | Sort-Object)
    cleared = @($cleared | Sort-Object)
  }
}

function Extract-SessionId {
  param([string]$Text)
  $m = [regex]::Match([string]$Text, '"sessionID"\s*:\s*"([^"]+)"')
  if ($m.Success) {
    return $m.Groups[1].Value
  }
  return $null
}

function Convert-ToRelativePath {
  param([string]$Root, [string]$PathValue)
  if (!$PathValue) {
    return ""
  }
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
  $fullPath = [System.IO.Path]::GetFullPath($PathValue)
  if ($fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return ($fullPath.Substring($fullRoot.Length).TrimStart("\", "/") -replace "\\", "/")
  }
  return ($PathValue -replace "\\", "/")
}

function Get-ReadEvidence {
  param([string]$Text, [string]$Root)
  $sawInjection = $false
  $paths = @()
  foreach ($line in (([string]$Text) -split "`r?`n")) {
    if ($line -match "\[SDD-DOC-SYNC") {
      $sawInjection = $true
    }
    if ($line -match '"tool"\s*:\s*"read"') {
      $m = [regex]::Match($line, '"filePath"\s*:\s*"((?:\\.|[^"\\])*)"')
      if ($m.Success) {
        $fp = $m.Groups[1].Value
        try {
          $fp = [regex]::Unescape($fp)
        } catch {
          $fp = $fp -replace "\\\\", "\"
        }
        $paths += (Convert-ToRelativePath $Root $fp)
      }
    }
  }

  $unique = @($paths | Where-Object { $_ } | Select-Object -Unique)
  return [pscustomobject]@{
    paths = $unique
    sddPromptSeen = $sawInjection
    design = [bool](@($unique | Where-Object { $_ -match "(^|/)design\.md$" }).Count)
    tasks = [bool](@($unique | Where-Object { $_ -match "(^|/)tasks\.md$" }).Count)
    code = [bool](@($unique | Where-Object { $_ -match "^src/.+\.ts$" }).Count)
    todo = [bool](@($unique | Where-Object { $_ -eq ".sdd-doc-sync.md" }).Count)
  }
}

function Snapshot-Tree {
  param([string]$Root)
  $paths = @(
    "sdd\changes\checkout-badge\design.md",
    "sdd\changes\checkout-badge\tasks.md",
    "src\checkoutBadge.ts",
    "src\badgeText.ts",
    "src\index.ts",
    ".sdd-doc-sync-rules.md",
    ".sdd-doc-sync.md",
    ".sdd-doc-sync-state.json"
  )
  $items = @()
  foreach ($p in $paths) {
    $abs = Join-Path $Root $p
    if (Test-Path -LiteralPath $abs) {
      $items += [pscustomobject]@{
        path = ($p -replace "\\", "/")
        size = (Get-Item -LiteralPath $abs).Length
        content = (Read-Text $abs)
      }
    }
  }
  return $items
}

$minimaxBaseUrl = $null
if ($Provider -eq "minimax") {
  $minimaxBaseUrl = [Environment]::GetEnvironmentVariable("MINIMAX_BASE_URL", "Process")
  if (!$minimaxBaseUrl) {
    $minimaxBaseUrl = [Environment]::GetEnvironmentVariable("MINIMAX_BASE_URL", "User")
  }
  if (!$minimaxBaseUrl) {
    $minimaxBaseUrl = [Environment]::GetEnvironmentVariable("MINIMAX_BASE_URL", "Machine")
  }
  if (!$minimaxBaseUrl) {
    $minimaxBaseUrl = "https://api.minimaxi.com/v1"
  }
}

New-Item -ItemType Directory -Force (Split-Path -Parent $pluginTarget) | Out-Null
New-Item -ItemType Directory -Force (Join-Path $workRoot "src") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $workRoot "scripts") | Out-Null
New-Item -ItemType Directory -Force $opencodeHome | Out-Null
Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget -Force

$packageJson = @"
{
  "type": "module",
  "scripts": {
    "check": "node ./scripts/check.mjs"
  }
}
"@
Set-ContentWithRetry -LiteralPath (Join-Path $workRoot "package.json") -Value $packageJson -NoNewline

$rulesText = @'
- 公共 API 或导出函数签名变化时，必须同步 design.md。
- 新增用户可见行为或业务规则时，必须同步 tasks.md。
- 纯重构无需改文档，但要在 .sdd-doc-sync.md 写清“行为不变”的依据。
'@
Set-ContentWithRetry -LiteralPath (Join-Path $workRoot ".sdd-doc-sync-rules.md") -Value $rulesText -NoNewline

$checkScript = @'
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = join(root, "src");
if (!existsSync(src)) {
  throw new Error("missing src directory");
}

const files = readdirSync(src).filter((name) => name.endsWith(".ts"));
if (files.length === 0) {
  throw new Error("no TypeScript files under src");
}

for (const file of files) {
  const text = readFileSync(join(src, file), "utf8");
  if (!text.trim()) {
    throw new Error(`${file} is empty`);
  }
  if (text.includes("SYNTAX_ERROR_SENTINEL")) {
    throw new Error(`${file} contains synthetic failure marker`);
  }
}

console.log(`checked ${files.length} TypeScript files`);
'@
Set-ContentWithRetry -LiteralPath (Join-Path $workRoot "scripts\check.mjs") -Value $checkScript -NoNewline

Push-Location $workRoot
try {
  & git init | Out-Null
} finally {
  Pop-Location
}

$config = Get-Content -LiteralPath $configTemplate -Raw -Encoding UTF8
if ($Provider -eq "minimax") {
  $config = $config -replace "https://api\.minimax(?:i)?\.com/v1", $minimaxBaseUrl.TrimEnd("/")
}
$modelName = if ($Provider -eq "deepseek") { "deepseek/deepseek-chat" } else { "minimax/MiniMax-M2.7" }
$agentConfig = @"
  "agent": {
    "docsync": {
      "model": "$modelName",
      "mode": "primary",
      "permission": "allow",
      "steps": 50,
      "temperature": 0,
      "prompt": "You are running a real OpenCode behavior validation for sdd-doc-sync. Execute the user's local file edits directly. Do not inspect .opencode, .git, provider config, environment variables, or plugin implementation files. If a system or user message contains [SDD-DOC-SYNC, continue the same assistant turn: read .sdd-doc-sync.md, read each pending code file, read the corresponding sdd/changes/*/design.md and tasks.md, decide whether documents need synchronization, then either update design/tasks or mark the exact pending .sdd-doc-sync.md line as [x] with a short evidence-based reason. Do not claim completion while .sdd-doc-sync.md still has [ ] lines."
    },
    "build": {
      "model": "$modelName",
      "permission": "allow",
      "steps": 4
    },
    "title": {
      "model": "$modelName",
      "permission": "allow",
      "steps": 1
    }
  }
"@
$config = $config -replace '"default_agent"\s*:\s*"[^"]+"', '"default_agent": "docsync"'
$config = $config -replace '"agent"\s*:\s*\{[\s\S]*\}\s*\n\}', ($agentConfig + "`n}")
Set-ContentWithRetry -LiteralPath (Join-Path $workRoot ".opencode\opencode.jsonc") -Value $config -NoNewline

$phases = @(
  [pscustomobject]@{
    id = "P01-design"
    title = "write design.md first"
    prompt = "Create only sdd/changes/checkout-badge/design.md with heading '# Design'. Design a TypeScript checkout badge feature with exported buildCheckoutBadge(orderTotal, customerTier). The output must include marker '$marker'. Mention base tier labels but do not create tasks or code yet."
  },
  [pscustomobject]@{
    id = "P02-tasks"
    title = "write tasks.md second"
    prompt = "Read sdd/changes/checkout-badge/design.md and create only sdd/changes/checkout-badge/tasks.md with heading '# Tasks'. Add an implementation checklist for the checkout badge feature. Do not create or edit code yet."
  },
  [pscustomobject]@{
    id = "P03-initial-code"
    title = "implement first code"
    prompt = "Read sdd/changes/checkout-badge/design.md and tasks.md, then implement src/checkoutBadge.ts and src/index.ts. Keep marker '$marker' in returned badge strings. If sdd-doc-sync asks for review at the end, complete that review before final response."
  },
  [pscustomobject]@{
    id = "P04-code-leading-discount"
    title = "code leads docs"
    prompt = "Modify src/checkoutBadge.ts directly so totals >= 200 get a high-value badge segment. Do not edit SDD docs before the code change. If sdd-doc-sync asks for review, decide whether design.md or tasks.md must be synchronized to this new behavior and do it if needed."
  },
  [pscustomobject]@{
    id = "P05-doc-only-vip"
    title = "docs lead code"
    prompt = "Revise only sdd/changes/checkout-badge/design.md and tasks.md to add VIP customer tier wording. This phase is docs only; do not edit code unless sdd-doc-sync explicitly requests it."
  },
  [pscustomobject]@{
    id = "P06-code-from-docs"
    title = "code catches up to docs"
    prompt = "Read the updated design.md and tasks.md, then modify src/checkoutBadge.ts so VIP tier behavior matches the docs. Keep marker '$marker'. If sdd-doc-sync asks for review, read code/design/tasks and mark or synchronize every pending item."
  },
  [pscustomobject]@{
    id = "P07-benign-refactor"
    title = "benign refactor"
    prompt = "Create src/badgeText.ts and refactor src/checkoutBadge.ts to use it without changing visible behavior, marker '$marker', high-value behavior, or VIP behavior. If sdd-doc-sync asks for review, record an evidence-based no-doc-change rationale."
  },
  [pscustomobject]@{
    id = "P08-final-check"
    title = "final review and report"
    prompt = "Make one final small code cleanup in src/index.ts, then handle any sdd-doc-sync review. Before final response, read .sdd-doc-sync.md and report whether any [ ] pending lines remain, naming exact paths if present."
  }
)

$previousHome = $env:HOME
$previousUserProfile = $env:USERPROFILE
$env:HOME = $opencodeHome
$env:USERPROFILE = $opencodeHome

$activeSessionId = $null
$phaseResults = @()
$phaseTimeoutMs = if ($Provider -eq "minimax") { 240000 } else { 180000 }
$phaseMaxAttempts = if ($Provider -eq "minimax") { 2 } else { 1 }
try {
  for ($phaseIndex = 0; $phaseIndex -lt $phases.Count; $phaseIndex++) {
    $phase = $phases[$phaseIndex]
    $beforeTodoText = Read-Text $todoPath
    $beforePending = Get-PendingPaths $beforeTodoText
    $beforeChecked = Get-CheckedPaths $beforeTodoText
    $args = @("run", "--print-logs", "--log-level", "DEBUG", "--agent", "docsync", "--format", "json", "--dir", $workRoot)
    if ($activeSessionId) {
      $args += @("--session", $activeSessionId)
    }
    $args += $phase.prompt

    $attempts = @()
    $outLog = $null
    $errLog = $null
    $exitCode = 1
    $effectiveExitCode = 1
    $timedOut = $false
    $noOutput = $true
    for ($attempt = 1; $attempt -le $phaseMaxAttempts; $attempt++) {
      $suffix = if ($attempt -eq 1) { "" } else { ".retry$attempt" }
      $outLog = Join-Path $workRoot "$($phase.id)$suffix.out.jsonl"
      $errLog = Join-Path $workRoot "$($phase.id)$suffix.err.log"
      $requestPath = Join-Path $workRoot "$($phase.id)$suffix.request.json"

      $runResult = Invoke-OpenCodeRun -Arguments $args -OutLog $outLog -ErrLog $errLog -RequestPath $requestPath -TimeoutMs $phaseTimeoutMs
      $outLength = if (Test-Path -LiteralPath $outLog) { (Get-Item -LiteralPath $outLog).Length } else { 0 }
      $errLength = if (Test-Path -LiteralPath $errLog) { (Get-Item -LiteralPath $errLog).Length } else { 0 }
      $exitCode = if ($null -eq $runResult.exitCode) { 1 } else { [int]$runResult.exitCode }
      $timedOut = [bool]$runResult.timedOut
      $noOutput = ($outLength -eq 0)
      $effectiveExitCode = if ($timedOut) { 124 } elseif ($noOutput) { 125 } else { $exitCode }
      $attempts += [pscustomobject]@{
        attempt = $attempt
        exitCode = $exitCode
        effectiveExitCode = $effectiveExitCode
        timedOut = $timedOut
        noOutput = $noOutput
        durationMs = [int]$runResult.durationMs
        stdoutBytes = $outLength
        stderrBytes = $errLength
        stdout = $outLog
        stderr = $errLog
      }

      if ($effectiveExitCode -eq 0) {
        break
      }
    }

    $outText = Read-Text $outLog
    $errText = Read-Text $errLog
    if (!$activeSessionId) {
      $activeSessionId = Extract-SessionId $outText
    }

    $todoText = Read-Text $todoPath
    $afterPending = Get-PendingPaths $todoText
    $afterChecked = Get-CheckedPaths $todoText
    $pendingDelta = Compare-StringSets $beforePending $afterPending
    $checkedDelta = Compare-StringSets $beforeChecked $afterChecked
    $readEvidence = Get-ReadEvidence -Text $outText -Root $workRoot
    $stateText = Read-Text $statePath
    $phaseResults += [pscustomobject]@{
      id = $phase.id
      title = $phase.title
      exitCode = $effectiveExitCode
      processExitCode = $exitCode
      attemptCount = @($attempts).Count
      attempts = $attempts
      timedOut = $timedOut
      noOutput = $noOutput
      sessionId = $activeSessionId
      docSyncPromptCount = (Count-Matches $outText "\[SDD-DOC-SYNC") + (Count-Matches $errText "service=sdd-doc-sync-opencode.*(processed Stop continuation|sent automatic Stop review continuation)")
      pendingTodoCount = @($afterPending).Count
      checkedTodoCount = @($afterChecked).Count
      pendingAdded = @($pendingDelta.added)
      pendingCleared = @($pendingDelta.cleared)
      checkedAdded = @($checkedDelta.added)
      readEvidence = $readEvidence
      lastPromptStateBytes = $stateText.Length
      opencodeErrorCount = Count-Matches $errText "(?i)\b(error|exception|failed)\b"
      stdout = $outLog
      stderr = $errLog
    }

    if ($effectiveExitCode -ne 0) {
      break
    }
  }
} finally {
  $env:HOME = $previousHome
  $env:USERPROFILE = $previousUserProfile
}

$summary = [pscustomobject]@{
  provider = $Provider
  model = $modelName
  runId = $runId
  marker = $marker
  workRoot = $workRoot
  phaseTimeoutMs = $phaseTimeoutMs
  phaseMaxAttempts = $phaseMaxAttempts
  sessionIds = @($phaseResults | Select-Object -ExpandProperty sessionId -Unique)
  phases = $phaseResults
  finalTodo = Read-Text $todoPath
  files = Snapshot-Tree $workRoot
}
Set-ContentWithRetry -LiteralPath $summaryJson -Value ($summary | ConvertTo-Json -Depth 12) -NoNewline

$report = @()
$report += "# sdd-doc-sync OpenCode Real Workflow"
$report += ""
$report += "- Provider: $Provider"
$report += "- Model: $modelName"
$report += "- RunId: $runId"
$report += "- Marker: $marker"
$report += "- WorkRoot: $workRoot"
$report += "- SessionIds: $((@($phaseResults | Select-Object -ExpandProperty sessionId -Unique) -join ', '))"
$report += "- PhaseTimeoutMs: $phaseTimeoutMs"
$report += "- PhaseMaxAttempts: $phaseMaxAttempts"
$report += ""
$report += "## Phase Summary"
$report += ""
$report += "| Phase | Session | Attempts | Exit | Timed Out | Empty Output | SDD Prompt Count | Pending Todo | Checked Todo | Pending Added | Pending Cleared | Checked Added | Read Evidence | Error Words |"
$report += "| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | ---: |"
foreach ($r in $phaseResults) {
  $readSummary = "design=$($r.readEvidence.design); tasks=$($r.readEvidence.tasks); code=$($r.readEvidence.code); todo=$($r.readEvidence.todo)"
  $report += "| $($r.id) $($r.title) | $($r.sessionId) | $($r.attemptCount) | $($r.exitCode) | $($r.timedOut) | $($r.noOutput) | $($r.docSyncPromptCount) | $($r.pendingTodoCount) | $($r.checkedTodoCount) | $((@($r.pendingAdded) -join '<br>')) | $((@($r.pendingCleared) -join '<br>')) | $((@($r.checkedAdded) -join '<br>')) | $readSummary | $($r.opencodeErrorCount) |"
}
$report += ""
$report += "## Read Evidence Details"
$report += ""
foreach ($r in $phaseResults) {
  $report += "### $($r.id)"
  $report += ""
  if (@($r.readEvidence.paths).Count -eq 0) {
    $report += "- No read tool calls were captured for this phase."
  } else {
    foreach ($p in @($r.readEvidence.paths)) {
      $report += "- $p"
    }
  }
  $report += ""
}
$report += "## Final Todo"
$report += ""
$report += '```markdown'
$report += (Read-Text $todoPath)
$report += '```'
$report += ""
$report += "## Final Files"
foreach ($file in (Snapshot-Tree $workRoot)) {
  if ($file.path -eq ".sdd-doc-sync.md" -or $file.path -eq ".sdd-doc-sync-state.json") {
    continue
  }
  $report += ""
  $report += "### $($file.path)"
  $report += ""
  $report += '```'
  $report += $file.content
  $report += '```'
}
Set-ContentWithRetry -LiteralPath $summaryMd -Value ($report -join "`n") -NoNewline

Write-Output "PROVIDER=$Provider"
Write-Output "MODEL=$modelName"
Write-Output "RUN_ID=$runId"
Write-Output "MARKER=$marker"
Write-Output "WORKROOT=$workRoot"
Write-Output "SESSION_IDS=$((@($phaseResults | Select-Object -ExpandProperty sessionId -Unique) -join ', '))"
Write-Output "SUMMARY_JSON=$summaryJson"
Write-Output "SUMMARY_MD=$summaryMd"
Write-Output "--- Phase Summary ---"
$phaseResults | Select-Object id,title,sessionId,attemptCount,exitCode,timedOut,noOutput,docSyncPromptCount,pendingTodoCount,checkedTodoCount,opencodeErrorCount | Format-Table -AutoSize
Write-Output "--- Final Todo ---"
if (Test-Path -LiteralPath $todoPath) {
  Get-Content -LiteralPath $todoPath -Encoding UTF8
} else {
  Write-Output "<missing>"
}
