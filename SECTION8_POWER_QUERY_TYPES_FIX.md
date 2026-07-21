# Section 8 Power Query Data-Type Fix

This release changes `src/lib/migration/enterprise-parser.ts` so data types selected in the UI are the final, authoritative Power Query schema.

## Conversion pipeline

Every generated table now finishes with these operations:

1. `QLIK2PBI_EnsureReviewedTypeColumns`
2. `QLIK2PBI_SanitiseReviewedTypeValues = Table.TransformColumns(...)`
3. `ReviewedTypeConversions = Table.TransformColumnTypes(...)`
4. `in ReviewedTypeConversions`

The sanitising step handles invalid source values without failing the entire refresh. The final `Table.TransformColumnTypes` step commits the selected types in Power Query Editor.

## Additional corrections

- Reviewed types are applied after joins, projections, calculations, and composite keys.
- Existing reviewed-type wrappers are replaced rather than duplicated.
- Type names are normalised for common aliases such as `integer`, `int64`, `decimal number`, `currency`, `datetime`, and `boolean`.
- `Any` is supported as an explicit Power Query type.
- Table and column type lookup is case-insensitive.
- Static tables, composite keys, and the Qlik variable host participate in the same type map.
- PBIP validation is blocked when the final M query does not contain the exact reviewed type signature.

## Validation

- TypeScript: passed
- Automated tests: 59 passed
- Client production build: passed
- SSR production build: passed
