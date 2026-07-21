param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$QvwPath,

    [switch]$CreateZip
)

$ErrorActionPreference = "Stop"
$resolvedQvw = (Resolve-Path $QvwPath).Path
if ([System.IO.Path]::GetExtension($resolvedQvw).ToLowerInvariant() -ne ".qvw") {
    throw "QvwPath must point to a .qvw file."
}

$directory = Split-Path $resolvedQvw -Parent
$name = [System.IO.Path]::GetFileNameWithoutExtension($resolvedQvw)
$projectFolder = Join-Path $directory ($name + "-prj")

Write-Host "QVW: $resolvedQvw" -ForegroundColor Cyan
Write-Host "PRJ: $projectFolder" -ForegroundColor Cyan

if (-not (Test-Path $projectFolder)) {
    New-Item -ItemType Directory -Path $projectFolder | Out-Null
}

$qv = $null
$doc = $null
try {
    Write-Host "Starting QlikView Desktop COM automation..." -ForegroundColor Yellow
    $qv = New-Object -ComObject QlikTech.QlikView
    $doc = $qv.OpenDoc($resolvedQvw)
    if ($null -eq $doc) {
        throw "QlikView could not open the document. Confirm that QlikView Desktop is installed and the QVW can be opened interactively."
    }

    Write-Host "Saving document to generate/update PRJ files..." -ForegroundColor Yellow
    $doc.Save()
    Start-Sleep -Seconds 2

    $projectFiles = Get-ChildItem -Path $projectFolder -File -ErrorAction SilentlyContinue
    if (-not $projectFiles -or $projectFiles.Count -eq 0) {
        throw "No PRJ files were generated. Open the QVW manually, confirm the -prj folder is next to it, save the document, then rerun this script."
    }

    Write-Host "Generated $($projectFiles.Count) project files." -ForegroundColor Green

    if ($CreateZip) {
        $stage = Join-Path $env:TEMP ("qvw-migration-" + [guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $stage | Out-Null
        Copy-Item $resolvedQvw -Destination $stage
        Copy-Item $projectFolder -Destination $stage -Recurse
        $zipPath = Join-Path $directory ($name + "_migration_package.zip")
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
        Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath
        Remove-Item $stage -Recurse -Force
        Write-Host "Created upload package: $zipPath" -ForegroundColor Green
    }
}
finally {
    if ($null -ne $doc) {
        try { $doc.CloseDoc() } catch { }
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) } catch { }
    }
    if ($null -ne $qv) {
        try { $qv.Quit() } catch { }
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($qv) } catch { }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
