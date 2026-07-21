# Table Execution Plan Compiler Release

This release changes the Qlik-to-Power BI pipeline from statement-by-statement M generation to an authoritative table execution plan.

## Compiler pipeline

1. Parse Qlik scripts and source files.
2. Build table and field lineage.
3. Determine final-table grain and classification.
4. Build one `TableExecutionPlan` per final table.
5. Use that same plan for local ten-row preview, Power Query generation, data types, semantic-model schema, validation and PBIP audit output.

## Power Query design

- One load-disabled `Source_<Table>` staging query per unique physical source.
- One readable table-producing model query per final table.
- Visible Applied Steps return tables only.
- Technical lists and type-operation records are nested inside the final table step.
- Direct `Table.NestedJoin` and `Table.ExpandTableColumn` steps.
- Pre-join and post-join calculations are placed using field dependencies.
- Explicit final projection with `MissingField.Error`.
- One final `ReviewedTypeConversions` step.
- No silent null-column fabrication for missing join or final fields.

## Model governance

- Joined attributes are removed from secondary semantic tables when they have no remaining analytical purpose.
- Full source staging queries remain available with load disabled.
- Relationships are created only from governed keys.
- Composite keys are generated only from explicit multi-column Qlik associations or joins.
- Aggregate-only reporting tables can be moved to DAX when not reused by later ETL.

## Validation and audit

- Microsoft Power Query parser validation before export.
- Named-query and field-dependency validation.
- Ten-row source/output comparison from the same execution plan.
- PBIP audit includes `Migration/table-execution-plans.json`.
