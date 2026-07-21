# Release notes — Microsoft TOM and TMDL semantic-model export

## Version 3.0.1 compile fix

- Replaces the invalid `AnnotatedMetadataObject` reference with strongly typed concrete TOM annotation collections exposed as `ICollection<Annotation>`.
- Adds a TOM smoke fixture covering source columns, a calculated column, a measure, partitions, annotations, and a many-to-one relationship.
- Makes the Windows build, setup, and TOM test scripts fail immediately on non-zero native command exit codes.
- Prevents the misleading `Microsoft TOM bridge ready` message after a failed `dotnet build`.
- Allows `test-tom-bridge.ps1` to run without arguments by using the included smoke fixture.


## Version

Enhanced workspace version `3.0.0`.

## Highlights

- Replaces hand-built `model.bim` output with a strongly typed TOM-aligned model specification.
- Stores the PBIP semantic model in the `SemanticModel/definition/` TMDL folder.
- Adds a .NET 8 bridge using `Microsoft.AnalysisServices.Tabular.TmdlSerializer`.
- Roundtrip-validates Microsoft TOM output by deserializing the generated TMDL folder.
- Adds a strict TypeScript TMDL fallback for environments without .NET.
- Prevents QVW aggregate expressions from being serialized as source columns.
- Separates physical columns, calculated columns, measures, calculated tables, partitions, hierarchies and relationships.
- Blocks export on invalid TOM/TMDL structure.
- Omits `model.bim` and `.pbi/cache.abf` to avoid stale or conflicting semantic-model metadata.
- Adds TOM/TMDL engine status to the existing export UI without changing the application layout.
- Includes the canonical TOM model specification, TMDL diagnostics and serializer identity in every migration package.
- Normalizes `package-lock.json` to the public npm registry.

## Installation

`node_modules` and build output are intentionally excluded. On Windows, run:

```powershell
npm ci --no-audit --no-fund
powershell -ExecutionPolicy Bypass -File .\scripts\build-tom-bridge.ps1
npx tsc --noEmit
npm test
npm run dev
```

Enable **Store semantic model using TMDL format** in Power BI Desktop Preview features when required by the installed Desktop version.
## Final integrated release

- Added deterministic local QVS analysis when Gemini is not configured.
- Added automatic Gemini failure fallback.
- Resolved the `System.Text.Json.JsonSerializer` / TOM `JsonSerializer` ambiguity.
- Preserved Microsoft TOM/TMDL export and relationship/model editing.

## PBIP report and measure safety release

- Generates the required enhanced PBIR `definition.pbir` and report definition folder.
- Consolidates exact duplicate DAX measures while preserving QVW traceability.
- Enforces unique model-wide measure names.
- Prevents measure names from colliding with columns in the home table.
- Preserves column references while applying aggregate-aware measure renames.
- Places every measure in `Qlik Measures\<Table>\<Category>` display folders.
- Blocks invalid measure definitions in the UI validator, TMDL validator, and Microsoft TOM bridge.
- Remaps visual bindings when duplicate measures are consolidated.

## Full Qlik load reconstruction

- Added a multi-pass backend reconstruction plan grouped by final table.
- Moved Qlik ETL aggregations into reusable DAX measures while retaining row-grain Power Query tables.
- Consolidated duplicate INLINE and MAPPING INLINE definitions into canonical static M queries.
- Retained dropped Qlik tables as load-disabled staging queries and omitted QVD STORE persistence.
- Created reusable DAX measures for all Qlik variables and preserved variable references in dependent expressions.
- Generated deterministic composite keys for multi-column Qlik associations.
- Added automatic, Desktop-review, and tables-only Power BI model build modes.
- Added reconstruction plan, staging-query metadata, and consolidated final-table scripts to PBIP exports.
