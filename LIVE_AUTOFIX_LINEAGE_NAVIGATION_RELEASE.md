# Live Auto-Fix, Lineage Repair and Navigation Release

## Scope

This release improves validation refresh, repair navigation, data-type editing and missing-column repair.

## Live validation refresh

- The Auto-Fix Center derives its cards from the current enterprise analysis and semantic model.
- A resolved issue is removed immediately after a successful repair and revalidation.
- Stale summaries are hidden when their issue identifiers no longer match current validation results.
- Editing a source mapping, data type, table, column, measure or relationship invalidates the previous Auto-Fix report so the next view reflects current state.

## Exact-object navigation

- Validation cards are clickable and keyboard accessible.
- Each issue shows the exact destination before navigation.
- Navigation opens the required page, expands the parent section, scrolls to the exact object, highlights it and focuses its editor.
- Supported destinations include source mappings, Power Query tables and columns, data types, DAX measures, relationships and model objects.

## Dynamic missing-column repair

The repair engine applies a deterministic sequence:

1. Backtrack the selected final table through Qlik resident loads, joins, concatenations, aliases and source fields.
2. Restore the missing field to the requested table when Qlik lineage proves it belongs there.
3. Otherwise locate a unique lineage-equivalent field in another exported table and safely rewrite the DAX reference.
4. Keep ambiguous cases blocked for user confirmation rather than guessing.

Example: a reference to `Calendar[Currency]` can be restored to Calendar when the Qlik script joins Currency into Calendar, or rewritten to a unique `Sales[CurrencyCode]` field when the model and lineage prove that is the correct exported object.

## Data-type improvements

- `Qlik Variables._MeasureHost` is normalized to `Whole Number`.
- Its M query includes a final defensive `ReviewedTypeConversions` step.
- The data-type editor includes disconnected/support tables as well as final tables.
- Table and data-type dropdowns are wider and exact repair targets are automatically selected and focused.

## Validation performed

- TypeScript compilation passed.
- 17 test files and 55 automated tests passed.
- Client production build passed.
- SSR production build passed.
- Dynamic cross-table DAX repair, Qlik-lineage restoration, exact navigation and variable-host typing regression tests passed.

The Microsoft TOM bridge was unchanged and must be built on Windows using the included script.
