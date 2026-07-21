# Full Qlik Load Reconstruction Release

This release adds a steady, multi-pass Qlik-to-Power BI reconstruction engine before Power Query, DAX, TMDL, or PBIP files are generated.

## Reconstruction passes

1. Parse and normalize every Qlik script statement in execution order.
2. Backtrack each surviving final table to its source files, QVD producers, resident loads, joins, concatenations, mappings, inline data, calculated fields, filters, drops, and stores.
3. Consolidate duplicate INLINE and MAPPING INLINE definitions into one canonical static M query.
4. Separate row-level transformations from semantic aggregations. Row-grain logic remains in Power Query; aggregation logic becomes reusable DAX measures.
5. Create one reusable DAX measure for every Qlik variable and preserve variable references in dependent measures.
6. Detect multi-column Qlik associations and create deterministic composite key columns on both Power BI tables.
7. Retain Qlik dropped tables as load-disabled staging M expressions for lineage and debugging, while excluding unwanted helper tables from the semantic model.
8. Omit STORE ... INTO QVD persistence operations while preserving upstream and downstream lineage.
9. Validate the optimized Power BI model, relationships, measures, columns, data types, static queries, and TMDL before export.

## Power BI model modes

- **Build automatically**: applies safe relationships and recommended keys.
- **Review in Desktop**: exports relationship candidates as inactive so the user can complete the model in Power BI Desktop.
- **Tables only**: exports tables, M queries, DAX measures, composite keys, and metadata without relationships.

## Export traceability

Each PBIP package contains:

- `Migration/reconstruction-plan.json`
- `Migration/staging-queries.json`
- `Migration/consolidated-load-scripts/<FinalTable>.qvs`
- `Migration/qlik-logic-decisions.json`
- model, TMDL, expression, and pipeline diagnostics

The generated semantic model contains no unnecessary aggregate/helper tables unless explicitly promoted by the user.
