# Deep Power Query Validation and Robust M Engine Release

## Root causes corrected

The earlier generator produced invalid Power Query in four distinct ways:

1. Qlik row functions such as `Abs()` were copied into M instead of being translated to native functions such as `Number.Abs()`.
2. Bare Qlik field names such as `Quantity` were emitted inside `each` expressions, so Power Query treated them as unresolved identifiers instead of row fields.
3. Aggregate-only, dropped, join-payload, anonymous and temporary Qlik tables were emitted as Power Query staging expressions even when they were not valid standalone tables. This produced function-valued queries, self-references and missing-query references.
4. Validation relied mainly on pattern checks and therefore did not prove that every generated query was accepted by a real Power Query lexer/parser.

## New backend pipeline

The engine now uses this sequence before PBIP export:

1. Parse Qlik script and execution order.
2. Build the table and field dependency graph.
3. Classify model, staging, static, mapping, aggregate, dropped, temporary and security objects.
4. Compile Qlik row expressions into native M through a recursive expression compiler.
5. Generate only required physical-source and canonical static/mapping staging queries.
6. Generate final model queries with joins, calculations, filters and authoritative reviewed types.
7. Parse every emitted M query with `@microsoft/powerquery-parser`.
8. Run QLIK2PBI semantic checks for raw Qlik functions, bare row fields, missing named queries and manual-review markers.
9. Build and validate a local output sample of up to 10 rows when uploaded CSV, TSV, JSON or INLINE data is available.
10. Block PBIP export when any generated query fails deep validation.

## Expression conversion examples

```qlik
Abs(ActualAmount - BudgetAmount)
```

becomes:

```powerquery
try Number.Abs(Number.From(
    Record.FieldOrDefault(_, "ActualAmount", null)
    - Record.FieldOrDefault(_, "BudgetAmount", null)
)) otherwise null
```

```qlik
Quantity > 0
```

becomes:

```powerquery
Record.FieldOrDefault(_, "Quantity", null) > 0
```

Nested `ApplyMap`, arithmetic, `If`, date functions, text functions and Qlik variables are compiled as one recursive expression so outer logic is not lost.

## Query pruning

The PBIP no longer emits standalone staging expressions for:

- aggregate-only report tables converted to DAX;
- dropped temporary tables;
- join payload tables;
- SECTION ACCESS tables;
- unused anonymous aliases;
- duplicate resident/transformation aliases;
- helper functions accidentally treated as tables.

Their lineage remains available in the migration audit metadata.

## Validation and preview UI

The Power Query page now shows, for every query:

- Microsoft M parser status;
- semantic validation status;
- dependency status;
- local output preview status;
- exact blocking issue, line and column when available;
- up to 10 locally reconstructed output rows when suitable uploaded samples exist.

The local preview validates the reconstructed transformations against uploaded samples. A live refresh of external databases, gateways or cloud connectors still requires the applicable credentials and privacy settings in the execution environment or Power BI Desktop.

## Historical logs and cache

Pipeline logs and validation state are persisted in the workspace cache. Log entries are normalized and deduplicated, the latest unique event is retained, and the cache is capped to avoid uncontrolled growth.

## Export safety

PBIP generation is blocked for:

- M lexer/parser errors;
- unresolved row fields;
- unconverted Qlik functions;
- missing named queries;
- unresolved manual conversions;
- invalid or empty local previews when source samples exist;
- invalid DAX or semantic-model blockers already covered by model validation.
