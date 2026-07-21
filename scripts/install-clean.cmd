@echo off
setlocal
cd /d "%~dp0\.."

echo [install] Project: %CD%

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [install] ERROR: Node.js was not found. Install Node.js 22 LTS or later.
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [install] ERROR: npm.cmd was not found. Repair or reinstall Node.js 22 LTS.
  exit /b 1
)

if exist node_modules (
  echo [install] Removing previous node_modules...
  rmdir /s /q node_modules
)

set npm_config_registry=https://registry.npmjs.org/
set npm_config_audit=false
set npm_config_fund=false
set npm_config_update_notifier=false

echo [install] Installing dependencies from the public npm registry...
call npm.cmd ci --no-audit --no-fund --registry=https://registry.npmjs.org/
if errorlevel 1 (
  echo [install] ERROR: npm ci failed.
  exit /b 1
)

echo [install] Installation completed successfully.
exit /b 0
