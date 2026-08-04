[CmdletBinding()]
param(
    [ValidateRange(60, 3600)] [int]$PollSeconds = 300,
    [switch]$Once,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
$StatePath = Join-Path $Root '.agent_state.json'
$LogPath = Join-Path $Root 'agent-orchestrator.log'
$LockPath = Join-Path $Root '.agent-orchestrator.lock'
$TerminalStates = @('DONE', 'COMPLETE', 'BLOCKED')

function Write-CoordinatorLog([string]$Message) {
    $line = '{0:o} [COORDINATOR] {1}' -f (Get-Date).ToUniversalTime(), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
    Write-Host $line
}

function Get-AgentState {
    if (-not (Test-Path -LiteralPath $StatePath)) { throw "Missing state: $StatePath" }
    try { $state = Get-Content -LiteralPath $StatePath -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw "Invalid state JSON: $($_.Exception.Message)" }
    foreach ($name in 'status', 'target_file', 'objective') {
        if ([string]::IsNullOrWhiteSpace([string]$state.control.$name)) { throw "Missing control.$name" }
    }
    return $state
}

function Get-RolePrompt($State) {
    $c = $State.control
    $common = "Read ARCHITECT_DIRECTIVE.md, AGENT_PROTOCOL.md, AGENT_RUNBOOK.md, and .agent_state.json. Act only for your named phase. Keep LIVE_TRADING disabled; never call !resume or place orders. Preserve atomic state writes, append-only ledger, frozen paths, and scoped commits. Current target: $($c.target_file). Objective: $($c.objective)."
    switch ($c.status) {
        'ARCHITECT_PENDING' { return "$common You are Architect: specify and route the highest-severity eligible bounded task." }
        'EXECUTOR_PENDING' { return "$common You are Executor: implement only this item, add focused tests, run npm.cmd test, commit, then set VERIFIER_PENDING." }
        'VERIFIER_PENDING' { return "$common You are independent Verifier: inspect diff and every acceptance criterion; green tests alone are insufficient. On pass mark done and route the next dependency-satisfied item to EXECUTOR_PENDING in this run; on failure return a minimal reproduction to Executor." }
        default { return $null }
    }
}

function Invoke-AgentPhase([string]$Prompt, [string]$Status) {
    if ($DryRun) { Write-CoordinatorLog "DRY RUN: would wake $Status."; return }
    $parts = if ($env:SWARM_AGENT_CMD) { $env:SWARM_AGENT_CMD -split '\s+' } else { @('claude', '-p') }
    if (-not (Get-Command $parts[0] -ErrorAction SilentlyContinue)) { throw "Agent command unavailable: $($parts[0])" }
    Write-CoordinatorLog "Handoff: waking $Status."
    Push-Location $Root
    try {
        $Prompt | & $parts[0] @($parts | Select-Object -Skip 1)
        if ($LASTEXITCODE -ne 0) { throw "Agent command exited $LASTEXITCODE" }
    } finally { Pop-Location }
}

# This coordinator, not any agent session, owns the five-minute wait loop.
$lock = $null
$ownsLock = $false
try {
    $lock = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $ownsLock = $true
    Write-CoordinatorLog "Started; polling every $PollSeconds seconds."
    do {
        $state = Get-AgentState
        $status = [string]$state.control.status
        Write-CoordinatorLog "Poll: status=$status target=$($state.control.target_file)"
        if ($TerminalStates -contains $status) { Write-CoordinatorLog "Terminal $status; stopping."; break }
        $prompt = Get-RolePrompt $state
        if ($prompt) { Invoke-AgentPhase $prompt $status }
        else { Write-CoordinatorLog "No agent wake for status=$status; state preserved." }
        if (-not $Once) { Start-Sleep -Seconds $PollSeconds }
    } while (-not $Once)
} catch {
    Write-CoordinatorLog "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
    if ($ownsLock) { Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue }
}
