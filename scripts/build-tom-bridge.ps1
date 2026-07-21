$ErrorActionPreference = "Stop"
$Project = Join-Path $PSScriptRoot "..\tools\TomTmdlBridge\TomTmdlBridge.csproj"

function Assert-NativeSuccess {
  param(
    [Parameter(Mandatory = $true)][string]$Step
  )
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE. Review the error output above."
  }
}

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "The .NET 8 SDK is required for Microsoft TOM serialization. Install it, reopen VS Code, and run this script again."
}

$version = dotnet --version
Assert-NativeSuccess "Reading the .NET SDK version"

$majorText = ($version -split '\.')[0]
$major = 0
if (-not [int]::TryParse($majorText, [ref]$major) -or $major -lt 8) {
  throw "The Microsoft TOM bridge requires .NET SDK 8 or later. Detected SDK version: $version"
}

Write-Host "Using .NET SDK $version" -ForegroundColor Cyan
Write-Host "Restoring Microsoft.AnalysisServices TOM bridge..." -ForegroundColor Cyan
dotnet restore $Project
Assert-NativeSuccess "dotnet restore"

Write-Host "Building Microsoft TOM bridge..." -ForegroundColor Cyan
dotnet build $Project -c Release --no-restore
Assert-NativeSuccess "dotnet build"

$projectDirectory = Split-Path -Parent $Project
$releaseDirectory = Join-Path $projectDirectory "bin\Release\net8.0"
$bridgeDll = Join-Path $releaseDirectory "TomTmdlBridge.dll"
if (-not (Test-Path $bridgeDll)) {
  throw "The TOM bridge build completed without producing the expected file: $bridgeDll"
}

Write-Host "Microsoft TOM bridge ready: $bridgeDll" -ForegroundColor Green
