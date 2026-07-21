# AI Auto-Fix and Direct Error Navigation

This release adds a deterministic, confidence-based repair layer before PBIP export.

## Behaviour

- Validation errors are normalized across source mapping, Power Query, data types, DAX, model tables, relationships, visuals and PBIP validation.
- Safe repairs run proactively when validation is blocked.
- The user can run **Fix and revalidate** at any time.
- Every unresolved item has **Go to fix**, which opens the correct migration page and highlights the relevant table, column, measure, relationship or source mapping.
- Automatic repairs are logged with confidence and before/after blocking-error counts.

## Safe repairs

- Exact uploaded-file source mapping by basename or source stem.
- Full enterprise pipeline re-run after mapping or reviewed-type changes.
- Smart table-key normalization.
- Invalid, duplicate or type-incompatible relationship exclusion.
- Qlik colour-function conversion.
- High-confidence DAX dependency repair.
- Duplicate/colliding measure normalization and display-folder assignment.
- Invalid visual-binding cleanup.

## Manual review policy

The engine does not guess when multiple source files or DAX columns are plausible. Those items stay blocked and open directly in the required editor.
