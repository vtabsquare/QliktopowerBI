# Final Table Detection Fix

## Root cause

Some uploaded QVS files are flattened into a single physical line. Standard Qlik `//` comments normally end at a newline. When the flattened script was parsed, the first `//` marker caused the remaining ETL script to be treated as one comment. The application therefore parsed the staging section but never reached the final tables.

A second classifier rule incorrectly treated any surviving table that was also written with `STORE ... INTO ...qvd` as a QVD-generator-only table. Final model tables can legitimately be stored to QVD and must not be excluded only for that reason.

## Fixes included

- Added a shared quote-aware, bracket-aware, semicolon-aware Qlik script normalizer.
- Added recovery for valid statements after flattened comment banners.
- Reused the normalizer in the enterprise parser, legacy QVS parser, and modular parser framework.
- Changed QVD-generator classification to require staging/generator evidence.
- Correctly targets `CONCATENATE(TargetTable) LOAD ...` at the target table in the modular parser.

## Verified result for `Sales_ETL.qvs`

- Parser operations: 42
- Generated final tables: 4
  - `FactSales_Final`
  - `Products`
  - `Regions`
  - `MasterCalendar`
- Relationship candidates: 8
- TypeScript validation: passed with `tsc --noEmit`

## Run after applying the patch

```powershell
npm run dev
```

Then upload `Sales_ETL.qvs` again. Use a new upload or refresh the page so the previous analysis result is not reused from application state.
