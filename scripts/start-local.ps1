$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'runtime\local-ai'
$installationFile = Join-Path $runtimeRoot 'installed.json'
if (-not (Test-Path -LiteralPath $installationFile)) { throw 'The local model is not installed. Run python scripts/setup-local-ai.py first.' }
$installation = Get-Content -LiteralPath $installationFile -Raw | ConvertFrom-Json
$modelBinary = [IO.Path]::GetFullPath((Join-Path $projectRoot $installation.executable))
$modelFile = [IO.Path]::GetFullPath((Join-Path $projectRoot $installation.model))
$checkedRuntime = [IO.Path]::GetFullPath($runtimeRoot) + [IO.Path]::DirectorySeparatorChar
if (-not $modelBinary.StartsWith($checkedRuntime, [StringComparison]::OrdinalIgnoreCase) -or -not $modelFile.StartsWith($checkedRuntime, [StringComparison]::OrdinalIgnoreCase)) { throw 'The configured model files must remain inside the project runtime directory.' }

$modelReady = $false
try { $catalog = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/v1/models' -TimeoutSec 2; $modelReady = @($catalog.data.id) -contains 'proofcsv-local' } catch { }
if (-not $modelReady) {
    $modelLog = Join-Path $runtimeRoot 'model.stdout.log'
    $errorLog = Join-Path $runtimeRoot 'model.stderr.log'
    $modelArguments = @('-m', ('"' + $modelFile + '"'), '--host', '127.0.0.1', '--port', '11434', '--alias', 'proofcsv-local', '--ctx-size', '8192', '--threads', '6', '--batch-size', '512', '--ubatch-size', '128', '--n-gpu-layers', '0', '--parallel', '1', '--jinja', '--cors-origins', 'http://localhost:3000', '--no-webui')
    $modelProcess = Start-Process -FilePath $modelBinary -ArgumentList $modelArguments -WorkingDirectory (Split-Path -Parent $modelBinary) -WindowStyle Hidden -RedirectStandardOutput $modelLog -RedirectStandardError $errorLog -PassThru
    $modelProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'model.pid')
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Seconds 1
        if ($modelProcess.HasExited) { throw "The local AI service stopped. Inspect $errorLog." }
        try { $catalog = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/v1/models' -TimeoutSec 1; if (@($catalog.data.id) -contains 'proofcsv-local') { $modelReady = $true; break } } catch { }
    }
    if (-not $modelReady) { throw 'The local AI service is still starting. Try the launcher again shortly.' }
}

& wsl.exe -d Ubuntu -u root -- docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker in Ubuntu WSL is unavailable.' }
try {
    $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/status' -TimeoutSec 15
    if ($existing.provider -ne 'local') { throw 'A different app configuration is already running on port 3000. Stop its terminal first.' }
    if (-not $existing.ready) { throw ('Local app is running but execution is unavailable: ' + $existing.reason) }
    Write-Output 'ProofCSV is already running at http://localhost:3000'
    exit 0
} catch {
    if ($_.Exception.Message -like 'A different app configuration*' -or $_.Exception.Message -like 'Local app is running*') { throw }
}
$nodeBinary = (Get-Command node -ErrorAction Stop).Source
$envFile = Join-Path $projectRoot '.env'
$appFile = Join-Path $projectRoot 'server\index.js'
$appArguments = @(('--env-file="' + $envFile + '"'), ('"' + $appFile + '"'))
$appProcess = Start-Process -FilePath $nodeBinary -ArgumentList $appArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'app.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'app.stderr.log') -PassThru
$appProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'app.pid')
for ($attempt = 0; $attempt -lt 3; $attempt++) {
    Start-Sleep -Seconds 1
    if ($appProcess.HasExited) { throw 'The app stopped. Inspect runtime/local-ai/app.stderr.log.' }
    try { $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/status' -TimeoutSec 15; if ($status.ready) { Write-Output 'ProofCSV is ready at http://localhost:3000'; exit 0 } } catch { }
}
throw 'The app started but is not ready. Check http://localhost:3000/api/status and the runtime/local-ai logs.'
