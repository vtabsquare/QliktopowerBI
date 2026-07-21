# TOM/TMDL release validation

## Completed in packaging environment

- Strict TypeScript: `tsc --noEmit` — passed.
- Portable TMDL serializer smoke test — passed.
- Generated smoke model contained:
  - source columns
  - calculated column
  - measure
  - M partitions
  - relationship file
  - database and model files
- `package-lock.json` parses as valid JSON.
- All package URLs use `https://registry.npmjs.org/`.
- No Supabase or other user secrets are included.

## Must run on Windows

The packaging environment did not include .NET 8 and could not compile the Microsoft TOM bridge. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

This restores `Microsoft.AnalysisServices`, builds the TOM bridge, runs TypeScript validation and runs the test suite.

## Power BI verification

1. Enable **Store semantic model using TMDL format** in Power BI Desktop Preview features when required.
2. Export from the application with **Require Microsoft TOM roundtrip validation** enabled.
3. Extract the downloaded ZIP.
4. Confirm there is a `SemanticModel\definition` folder and no `model.bim`.
5. Open the `.pbip` file.
6. Configure credentials and refresh.

## Version 3.0.1 source validation

- Removed all references to the non-existent `AnnotatedMetadataObject` type.
- Confirmed every annotation call targets the concrete TOM object's `Annotations` collection.
- Confirmed all PowerShell native invocations check `$LASTEXITCODE`.
- Added `tools/TomTmdlBridge/fixtures/smoke-model.json`.
- Added no-argument Microsoft TOM/TMDL roundtrip test execution.

The packaging container still does not contain the .NET SDK, so the final Microsoft assembly compile must run on Windows with `scripts/build-tom-bridge.ps1`. The corrected script now reports success only when `TomTmdlBridge.dll` exists.
