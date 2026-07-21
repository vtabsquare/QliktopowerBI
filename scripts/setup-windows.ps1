param(
  [switch]$SkipTomBridge,
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

function Assert-NativeSuccess {
  param(
    [Parameter(Mandatory = $true)][string]$Step
  )
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE. Review the error output above."
  }
}

npm config set registry https://registry.npmjs.org/
Assert-NativeSuccess "Configuring the npm registry"

Write-Host "Installing Node dependencies from registry.npmjs.org..." -ForegroundColor Cyan
npm ci --no-audit --no-fund
Assert-NativeSuccess "npm ci"

if (-not $SkipTomBridge) {
  & (Join-Path $PSScriptRoot "build-tom-bridge.ps1")
  & (Join-Path $PSScriptRoot "test-tom-bridge.ps1")
}

Write-Host "Running strict TypeScript validation..." -ForegroundColor Cyan
npx tsc --noEmit
Assert-NativeSuccess "TypeScript validation"

if (-not $SkipTests) {
  Write-Host "Running regression tests..." -ForegroundColor Cyan
  npm test
  Assert-NativeSuccess "Regression tests"
}

Write-Host "Setup complete. Start the application with: npm run dev" -ForegroundColor Green
