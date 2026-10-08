param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'runtime\local-ai'
$installationFile = Join-Path $runtimeRoot 'installed.json'
if (-not (Test-Path -LiteralPath $installationFile)) { Write-Output 'No local AI installation was found.'; exit 0 }
$installation = Get-Content -LiteralPath $installationFile -Raw | ConvertFrom-Json
$expectedApp = [IO.Path]::GetFullPath((Join-Path $projectRoot 'server\index.js'))
$expectedModel = [IO.Path]::GetFullPath((Join-Path $projectRoot $installation.executable))
$expectedWeights = [IO.Path]::GetFullPath((Join-Path $projectRoot $installation.model))
$checkedRuntime = [IO.Path]::GetFullPath($runtimeRoot) + [IO.Path]::DirectorySeparatorChar
if (-not $expectedModel.StartsWith($checkedRuntime, [StringComparison]::OrdinalIgnoreCase) -or -not $expectedWeights.StartsWith($checkedRuntime, [StringComparison]::OrdinalIgnoreCase)) { throw 'Model paths must remain inside this project runtime.' }
$verified = @()
foreach ($kind in @('app', 'model')) {
    $pidFile = Join-Path $runtimeRoot ($kind + '.pid')
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $processId = [int](Get-Content -LiteralPath $pidFile)
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
    if (-not $candidate) { continue }
    if ($kind -eq 'app') {
        if (-not $candidate.CommandLine.Contains($expectedApp) -or [IO.Path]::GetFileName($candidate.ExecutablePath) -ne 'node.exe') { throw 'The app PID belongs to a different process. Nothing was stopped.' }
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/status' -TimeoutSec 15
        if ($status.provider -ne 'local' -or $status.running -ne 0) { throw 'Wait for all analyses to finish before stopping the local app.' }
    } elseif ($candidate.ExecutablePath -ne $expectedModel -or -not $candidate.CommandLine.Contains($expectedWeights)) {
        throw 'The model PID belongs to a different process. Nothing was stopped.'
    }
    $verified += $processId
}
if ($CheckOnly) { Write-Output ('Verified ' + $verified.Count + ' idle ProofCSV processes. No processes stopped.'); exit 0 }
foreach ($processId in $verified) { Stop-Process -Id $processId -ErrorAction Stop }
Write-Output 'ProofCSV app and local AI are stopped.'
