# Test report

## Validation performed for the TOM/TMDL release

- Strict TypeScript compilation with `tsc --noEmit`: **Passed** in the packaging environment.
- Portable TMDL serializer smoke test: **Passed** for source columns, calculated columns, measures, M partitions and folder generation.
- PBIP export test coverage added for:
  - `definition.pbism` version `4.0`
  - absence of `model.bim`
  - source column serialization
  - calculated-column serialization
  - measure serialization
  - relationship serialization
- Blocking TMDL validation test added for empty calculated-column expressions.
- Package registry URLs were normalized to `https://registry.npmjs.org/`.

## Environment-limited validation

The packaging container does not include the .NET SDK, so the Microsoft TOM bridge could not be compiled or roundtrip-executed there. The bridge source, project file and build/test scripts are included for Windows validation.

The available validation dependencies were copied from a Windows-origin package; consequently, a Linux Vite production bundle could not load the Linux Rolldown native binding. This does not represent a TypeScript source failure. Run the commands below on the target Windows machine.

## Required Windows release validation

```powershell
npm ci --no-audit --no-fund
npx tsc --noEmit
npm test
powershell -ExecutionPolicy Bypass -File .\scripts\build-tom-bridge.ps1
npm run build
```

After creating a project in the UI, export it and verify:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-tom-bridge.ps1 `
  -InputJson .\tom-model-spec.json `
  -OutputFolder .\test_out\definition
```

Finally, enable the Power BI Desktop TMDL preview feature when required, extract the PBIP ZIP and open the `.pbip` file.

## Regression fixture expectations

The included QVW/PRJ fixture should continue to meet or exceed:

- 8 sheets
- 64 objects
- 40 expressions
- 15 variables
- 5 bookmarks
- 12 actions
- 10 triggers
- 3 macros
- 3 extensions

The parser uses actual metadata and does not hardcode these counts.

## PBIP report and measure safety regression — 17 July 2026

Validated commands:

- `npm ci --no-audit --no-fund`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`

Results:

- TypeScript compilation: passed
- Vitest files: 8 passed
- Vitest tests: 28 passed
- Enhanced PBIR required-file test: passed
- `definition.pbir` version and semantic-model path test: passed
- duplicate DAX consolidation test: passed
- model-wide measure-name uniqueness test: passed
- measure/column collision test: passed
- safe `Salary` to `Total Salary` rename test: passed
- table-qualified column-reference preservation test: passed
- display-folder hierarchy test: passed
- portable TMDL validation test: passed
- client production build: passed
- SSR production build: passed

The Microsoft TOM bridge source contains the same duplicate-name, duplicate-expression, column-collision, and display-folder validation gates. It must be rebuilt on Windows with the included `.NET 8` script after extraction.
