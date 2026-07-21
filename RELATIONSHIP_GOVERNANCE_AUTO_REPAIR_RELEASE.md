# Relationship Governance and Auto-Repair Release

## Problem corrected

The previous model generator could use the complete upstream lineage field union as the final schema of a table. That caused fields from `Customers`, `Products`, and other resident tables to leak into `Sales` even when the Qlik JOIN selected only a smaller payload. The leaked fields then became relationship candidates, calculated columns, or invalid DAX dependencies and could create ambiguous paths, cyclic-looking diagrams, blank one-side keys, and Power BI refresh errors.

## Backend correction

The final semantic schema is now reconstructed from:

1. Columns explicitly emitted by the table's own LOAD operations.
2. Columns explicitly emitted by CONCATENATE operations.
3. Only the non-key payload columns explicitly selected by Qlik JOIN operations.
4. Governed composite keys only when the Qlik operation genuinely joins on multiple fields.

The complete upstream schema is retained only in load-disabled staging and lineage metadata. It is no longer used as the final model schema.

## Post-JOIN ownership

In Power BI optimized/automatic mode:

- JOIN payload attributes are materialized in the target/main table.
- The source/child semantic table removes those moved attributes.
- The child table keeps the relationship key and unmoved analytical attributes.
- If no unmoved analytical attributes remain, the child table is retained only as a load-disabled staging query and no relationship is exported.

## Relationship safeguards

- Descriptive attributes such as Region, CountryName, Brand, Category, Department, and Role cannot be inferred as relationships.
- Relationships use explicit Qlik JOIN keys or strong fact/dimension key patterns only.
- One-side queries filter blank keys and enforce a unique key projection before relationship serialization.
- Relationship endpoint types are harmonized before M/TMDL generation.
- Bidirectional and many-to-many relationships are not auto-created.
- Date relationships with weak uploaded-sample coverage remain inactive for review.
- SECTION ACCESS tables are audit metadata and are not exported as analytical tables.

## Power Query row-expression conversion

The M generator now converts common row-level Qlik expressions used by the supplied fixture, including:

- Date / Date#
- Year, Month, MonthName, QuarterName, Week
- If with AND/OR conditions
- Arithmetic and comparison expressions
- Abs, Round, Len, Trim, Upper, Lower
- ApplyMap using canonical static mapping queries

Calculated columns preserve their source value while being replaced, preventing source columns such as CalendarDate, OrderDate, and ShipDate from being overwritten with null.

## Preview engine

The UI output preview now evaluates the resident-load chain, row calculations, ApplyMap logic, filters, and reconstructed joins. It therefore shows the expected final values rather than a table containing artificial null placeholders.

## DAX safeguards

- Direct Qlik dimensions bind to existing model columns instead of being generated as calculated columns.
- Bare column measures are scalarized only when appropriate.
- Missing DAX references are repaired only with unique evidence-based matches.
- Actual/Budget/Forecast amount families and entity keys are resolved dynamically.
- Measures containing manual markers, PLACEHOLDER, incomplete DAX, or unresolved dependencies are excluded from TMDL/PBIP export.

## Validation

The complex Qlik/QVW regression fixture validates:

- Exact post-JOIN target schema.
- Removal of moved attributes from Customers and Products.
- Key-only relationships.
- Compatible relationship endpoint types.
- No blank/nonunique one-side key diagnostics.
- Correct Calendar and Sales output previews.
- Exclusion of known-invalid DAX from TOM/TMDL.
