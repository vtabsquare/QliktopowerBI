# Unsupported and manual-review features

The application never silently removes an unsupported expression. The original Qlik expression, sheet/object location, construct, severity and recommendation remain in the expression inventory and migration manifest.

## Manual or context-sensitive constructs

- `Above`, `Below`, `Before`, `After`
- `RowNo`, `ColumnNo`, `Dimensionality`, `SecondaryDimensionality`
- `FirstSortedValue` where tie/grain semantics are unclear
- `Peek`, `Previous`, `Exists` when used as load-script row context
- `ApplyMap` inside a QVW chart expression when the mapping table cannot be resolved
- `PurgeChar`, `KeepChar` for arbitrary character sets
- Complex `P()` and `E()` element functions
- Set unions, intersections, exclusions or alternate-state expressions not represented by the normalized parser
- Macros, external automation and OS/file-system actions
- Custom extensions whose rendering contract is unavailable
- Pixel-perfect QlikView container/object behaviour
- Personal/server bookmarks not present in the uploaded PRJ metadata

## Generated report visuals

The current export writes reviewed semantic-model artifacts and a complete QVW-to-Power BI visual-binding manifest. It intentionally does not synthesize brittle Power BI visual-container JSON for every visual type. Report pages are created safely, while visual bindings and manual-redesign instructions are retained under `Migration/visual-bindings.json`. This protects PBIP openability while the report visual writer is expanded and validated per Power BI schema/version.

## Recommended remediation workflow

1. Review items marked `manual`, `warning`, `missing-dependency` or `unsupported`.
2. Map missing tables/fields/variables.
3. Enter and validate replacement DAX where necessary.
4. Mark approved or exclude with a mandatory reason.
5. Validate semantic-model relationships and visual bindings.
6. Export only after blocking diagnostics are resolved.
