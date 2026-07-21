# Power Query AI Review, Preview and Firewall Release

## Scope

This release addresses Power Query Formula.Firewall risks, validates every generated final M query before PBIP export, exposes source and expected-output samples in the UI, and prunes attributes copied by Qlik joins from secondary semantic-model tables while retaining complete load-disabled staging queries.

## Key changes

### Firewall-safe query architecture

- Physical data access is isolated in named load-disabled `Source_*` staging queries.
- Final model queries reference those staging queries and no longer mix a direct connector with references to other queries in the same expression.
- The review engine reports and blocks direct-source-plus-query-reference patterns that can trigger Formula.Firewall.
- Privacy-level settings remain a Power BI Desktop/environment concern; the application does not silently disable privacy checks.

### AI Power Query review

Every generated final M expression is reviewed for:

- balanced `let` / `in` structure and delimiters;
- Qlik-only tokens or manual-conversion markers;
- unresolved named-query references;
- Formula.Firewall-risk patterns;
- collision-safe join expansion;
- presence of the authoritative reviewed data-type step;
- consistency between UI-reviewed data types and final M types.

Blocking review findings prevent PBIP export and provide the affected query and recommended action.

### Source and output previews

When uploaded CSV, TSV, JSON or INLINE data is available, the UI displays:

- source sample rows;
- distinct sample values per field in the data-type editor;
- sample-informed type recommendations;
- an expected output preview for each converted table after local projection and join enrichment.

The local expected-output preview is intended for conversion review. Power BI Desktop refresh remains the authoritative connector, credential and privacy validation.

### Post-join model cleanup

- Complete source tables are retained as load-disabled staging queries for lineage.
- Model projections remove attributes moved into a main table by a Qlik join in Power BI optimized/automatic mode.
- Required join keys, unique attributes and referenced fields remain available.
- Qlik-equivalent and Desktop-review modes retain the corresponding model shape.
- Final Power Query projections now return only governed semantic columns after joins and composite-key generation.

### PBIP audit output

The generated migration folder now includes:

- `power-query-ai-review.json`
- `table-data-previews.json`

## Validation

- TypeScript compilation passed.
- 20 test files passed.
- 67 automated tests passed.
- Client production build passed.
- SSR production build passed.

The Microsoft TOM bridge is included as source and must be compiled on a Windows machine with .NET 8 using the included build script.
