# Final Single-Upload Pipeline Integration Fix

## Scope

This release preserves the existing application and adds four production fixes:

1. User-reviewed data types are authoritative in Power Query, the semantic model and PBIP/TMDL export.
2. A ZIP is extracted and persisted once; ETL, QVW metadata, expressions and export reuse the same workspace.
3. Direct QVW upload can invoke a local Windows QlikView Desktop COM extraction bridge and merge the generated PRJ files automatically.
4. Every QVW variable is represented as a DAX measure in the hidden `Qlik Variables` table.

## Data-type propagation

Selecting a type in the Power Query page now immediately rebuilds:

- `columnTypes`
- `columnTypeMeta`
- Power Query M
- M diagnostics
- semantic-model column types
- PBIP/TMDL export metadata
- readiness validation

Every final query ends with a defensive `Table.TransformColumns` step using `try ... otherwise null` and `MissingField.Ignore`. Optional AI-generated M receives an additional authoritative `ReviewedTypeConversions` step, so AI output cannot bypass UI decisions.

## Single-upload workspace

The upload page now performs the deterministic ETL pass and QVW project pass from the same extracted file collection. It stores the package once in the project workspace. Navigation to Analysis, QVW Analysis, Expressions, Power Query, Data Model and Export no longer requires uploading the package again.

Only real script candidates are assigned to Source/ETL. XML object files and CSV sample data are not incorrectly treated as QVS scripts. `LoadScript.txt` is recognized as a script candidate.

## Direct QVW extraction

When a `.qvw` is uploaded without PRJ files, the browser sends the binary to:

`POST /api/qvw/extract?fileName=<name>.qvw`

On Windows, the local server runs `public/tools/qvw-extract-prj.ps1`, which uses QlikView Desktop COM automation to generate `<name>-prj`. The returned XML/TXT files are merged into the same workspace and parsed for:

- sheets and objects
- expressions and dimensions
- variables and parameters
- actions and triggers
- bookmarks
- macros and extensions
- document properties and layout
- load script

Direct binary extraction requires Windows and QlikView Desktop. On other platforms, upload the QVW with its generated `-prj` folder. The UI records a clear diagnostic rather than silently returning zero objects.

## QVW variables to DAX

All extracted variables are converted to measures in the hidden disconnected table `Qlik Variables`:

- static numeric/text/date variables become scalar DAX measures
- calculated variables are translated through the DAX translator
- missing definitions remain visible as traceable `BLANK()` measures with diagnostics
- variables are grouped in display folders under `Qlik Measures\\Qlik Variables`

Different variable names are retained even when their scalar values are identical. Ordinary duplicate visualization measures remain consolidated.

## Validation

Validated with:

- strict TypeScript compilation
- 9 Vitest files / 31 tests
- QVW regression fixture
- type-override-to-M test
- AI-M reviewed-type test
- single-upload script assignment test
- QVW variable-to-measure test
- PBIP/TMDL export regression tests
- client and SSR production builds
