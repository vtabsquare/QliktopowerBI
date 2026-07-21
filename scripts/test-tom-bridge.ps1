param(
  [string]$InputJson = "",
  [string]$OutputFolder = ""
)
$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Project = Join-Path $ProjectRoot "tools\TomTmdlBridge\TomTmdlBridge.csproj"

if ([string]::IsNullOrWhiteSpace($InputJson)) {
  $InputJson = Join-Path $ProjectRoot "tools\TomTmdlBridge\fixtures\smoke-model.json"
}
if ([string]::IsNullOrWhiteSpace($OutputFolder)) {
  $OutputFolder = Join-Path $ProjectRoot "tom-validation-output"
}

if (-not (Test-Path $InputJson)) {
  throw "TOM smoke-test input does not exist: $InputJson"
}
if (Test-Path $OutputFolder) {
  Remove-Item $OutputFolder -Recurse -Force
}

dotnet run --project $Project -c Release --no-build -- --input $InputJson --output $OutputFolder --roundtrip
if ($LASTEXITCODE -ne 0) {
  throw "Microsoft TOM/TMDL roundtrip test failed with exit code $LASTEXITCODE."
}

$requiredFiles = @(
  (Join-Path $OutputFolder "database.tmdl"),
  (Join-Path $OutputFolder "model.tmdl")
)
foreach ($requiredFile in $requiredFiles) {
  if (-not (Test-Path $requiredFile)) {
    throw "TOM/TMDL roundtrip did not create the expected file: $requiredFile"
  }
}

Write-Host "TMDL written and Microsoft TOM roundtrip validation passed: $OutputFolder" -ForegroundColor Green
