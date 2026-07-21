$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "[install] Project: $projectRoot" -ForegroundColor Cyan

function Resolve-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }

    return $null
}

$nodeExe = Resolve-NativeCommand -Names @('node.exe', 'node')
if (-not $nodeExe) {
    throw 'Node.js was not found. Install Node.js 22 LTS or later and reopen VS Code.'
}

# On Windows, call npm.cmd explicitly. This avoids aliases/functions or npm.ps1
# shims that can incorrectly pass "pm" as an npm subcommand.
$npmExe = Resolve-NativeCommand -Names @('npm.cmd', 'npm.exe', 'npm')
if (-not $npmExe) {
    throw 'npm was not found. Repair or reinstall Node.js 22 LTS, then reopen VS Code.'
}

$nodeVersionText = (& $nodeExe --version).Trim()
if (-not $nodeVersionText) {
    throw 'Unable to determine the installed Node.js version.'
}

$nodeMajor = [int](($nodeVersionText -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 22) {
    throw "Node.js $nodeVersionText is installed. This application requires Node.js 22 or later."
}

$npmVersionText = (& $npmExe --version).Trim()
if (-not $npmVersionText) {
    throw 'Unable to determine the installed npm version.'
}

Write-Host "[install] Node: $nodeVersionText" -ForegroundColor DarkCyan
Write-Host "[install] npm:  $npmVersionText" -ForegroundColor DarkCyan
Write-Host "[install] npm executable: $npmExe" -ForegroundColor DarkCyan

$lockPath = Join-Path $projectRoot 'package-lock.json'
if (-not (Test-Path $lockPath)) {
    throw 'package-lock.json is missing.'
}

$lockContent = Get-Content -Raw $lockPath
if ($lockContent -match 'artifactory/api/npm/npm-public') {
    throw 'package-lock.json contains a private Artifactory URL. Use the corrected package before running npm ci.'
}

if (Test-Path (Join-Path $projectRoot 'node_modules')) {
    Write-Host '[install] Removing the previous node_modules folder...' -ForegroundColor Yellow
    Remove-Item -Recurse -Force (Join-Path $projectRoot 'node_modules')
}

$env:npm_config_registry = 'https://registry.npmjs.org/'
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_update_notifier = 'false'

# Cache verification is intentionally not mandatory. npm cache verify can fail on
# locked/corrupt user cache folders even when a clean npm ci would succeed.
Write-Host '[install] Installing locked dependencies from the public npm registry...' -ForegroundColor Cyan
$installArgs = @('ci', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/')
& $npmExe @installArgs
$installExitCode = $LASTEXITCODE

if ($installExitCode -ne 0) {
    throw "npm ci failed with exit code $installExitCode. Run 'npm config get registry' and confirm it returns https://registry.npmjs.org/."
}

Write-Host '[install] Installation completed successfully.' -ForegroundColor Green
