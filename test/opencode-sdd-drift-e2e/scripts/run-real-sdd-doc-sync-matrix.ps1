param(
  [ValidateSet("deepseek", "minimax")]
  [string[]]$Providers = @("deepseek", "minimax")
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$runner = Join-Path $PSScriptRoot "run-real-sdd-doc-sync-workflow.ps1"
if (!(Test-Path -LiteralPath $runner)) {
  throw "missing runner: $runner"
}

$results = @()
foreach ($provider in $Providers) {
  Write-Output "=== sdd-doc-sync real workflow: $provider ==="
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $runner -Provider $provider
  $exitCode = $LASTEXITCODE
  $output | ForEach-Object { Write-Output $_ }

  $summaryJson = ""
  $summaryMd = ""
  $workRoot = ""
  foreach ($line in $output) {
    if ($line -match "^SUMMARY_JSON=(.+)$") { $summaryJson = $Matches[1] }
    if ($line -match "^SUMMARY_MD=(.+)$") { $summaryMd = $Matches[1] }
    if ($line -match "^WORKROOT=(.+)$") { $workRoot = $Matches[1] }
  }

  $results += [pscustomobject]@{
    provider = $provider
    exitCode = $exitCode
    workRoot = $workRoot
    summaryJson = $summaryJson
    summaryMd = $summaryMd
  }

  if ($exitCode -ne 0) {
    break
  }
}

Write-Output "=== sdd-doc-sync matrix summary ==="
$results | Format-Table -AutoSize

if (@($results | Where-Object { $_.exitCode -ne 0 }).Count -gt 0) {
  exit 1
}
