param (
    [string]$TargetFile,
    [string]$TestCommand
)

if (-not $TargetFile -or -not $TestCommand) {
    Write-Host "❌ Usage: .\agent-orchestrator.ps1 -TargetFile <path> -TestCommand '<command>'" -ForegroundColor Red
    Exit
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "🤖 Starting 3-Agent Automation Loop (Windows)" -ForegroundColor Cyan
Write-Host "Target File: $TargetFile" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Phase 1
Write-Host "`n[1/4] 🏗️ Phase 1: Contacting Agent 1 (The Architect)..." -ForegroundColor Yellow
Write-Host "👉 TASK: Ask Agent 1 to open '$TargetFile' and write the stub skeleton structure."
Read-Host "Press [Enter] once Agent 1 has completed the skeleton and saved the file..."

# Phase 2
Write-Host "`n[2/4] 🔨 Phase 2: Handing over to Agent 2 (The Executor)..." -ForegroundColor Yellow
Write-Host "👉 TASK: Direct Agent 2 to look at the new stubs in '$TargetFile' and implement functionality."
Read-Host "Press [Enter] once Agent 2 has finished writing the inner logic..."

# Phase 3
Write-Host "`n[3/4] 🛡️ Phase 3: Executing Agent 3 Automation Gate (The Verifier)..." -ForegroundColor Yellow
Write-Host "Running validation command: $TestCommand"

Invoke-Expression $TestCommand 2>&1 | Out-File -FilePath verifier_report.log

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ SUCCESS: All tests, lints, and types are GREEN." -ForegroundColor Green
    Remove-Item -Path verifier_report.log -ErrorAction SilentlyContinue
    
    # Phase 4
    Write-Host "`n[4/4] 🚀 Phase 4: Final Sign-off" -ForegroundColor Yellow
    Write-Host "👉 TASK: Signal Agent 1 that validation passed. It can now merge or commit changes."
} else {
    Write-Host "❌ FAILURE: The Verifier detected errors, bugs, or broken types!" -ForegroundColor Red
    Write-Host "=================== VERIFIER ERROR LOG ===================" -ForegroundColor DarkRed
    Get-Content verifier_report.log
    Write-Host "==========================================================" -ForegroundColor DarkRed
    
    Write-Host "`n🔄 RECOVERY ROUTE ACTIVATED:" -ForegroundColor Yellow
    Write-Host "👉 TASK: Copy the error log above and feed it straight back to Agent 2 (The Executor)."
}
