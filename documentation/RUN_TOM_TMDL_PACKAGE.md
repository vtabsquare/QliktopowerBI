# Run the TOM/TMDL package on Windows

## Prerequisites

- Node.js 20.19 or later
- npm
- .NET 8 SDK
- Current Power BI Desktop

## One-command setup

From the application folder containing `package.json`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

This command:

1. Forces the public npm registry.
2. Runs `npm ci`.
3. Restores and builds the Microsoft TOM bridge.
4. Runs strict TypeScript validation.
5. Runs the regression tests.

Then copy/create `.env` and start:

```powershell
npm run dev
```

Open the Vite URL, usually `http://localhost:8080/`.

## Faster setup without tests

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -SkipTests
```

## Export behavior

On the PBIP Export page, **Require Microsoft TOM roundtrip validation** is enabled by default. With that option enabled, the export must pass the .NET TOM serializer and TMDL deserialize roundtrip. If .NET/TOM is unavailable, the UI displays a clear export error instead of silently producing an unverified package.

For constrained hosted environments, uncheck that option to use the strict portable TMDL fallback. The selected engine is always recorded in `Migration/tmdl-engine.txt`.

## Open in Power BI Desktop

1. In Power BI Desktop, enable **File > Options and settings > Options > Preview features > Store semantic model using TMDL format** when required by your installed version.
2. Download the PBIP ZIP.
3. Extract the complete ZIP to a normal folder.
4. Open the `.pbip` file from the extracted folder.
5. Refresh data after source credentials are configured.
