# Proactive Power Query Type, Colour and DAX Dependency Fix

This release addresses three Power BI Desktop failures reported during PBIP validation.

## 1. Authoritative UI data types

- The type selected in the UI is now the final source of truth.
- Every generated M query ends in `ReviewedTypeConversions[_n]`.
- `Table.TransformColumns` performs null-safe value conversion and explicitly supplies the target M type.
- PBIP/TMDL export re-applies the reviewed type map if an older or AI-generated query does not already contain an authoritative final type step.
- TOM columns prefer the reviewed `analysis.columnTypes` map over stale saved model metadata.
- Existing model merges can no longer restore an older column type over the reviewed type.

## 2. Qlik colour conversion

- `RGB(r,g,b)` converts to a Power BI hexadecimal colour measure.
- `ARGB(a,r,g,b)` converts to RGB hexadecimal text and records an alpha-channel review warning.
- Common named Qlik colour functions such as `Green()`, `Red()`, `Blue()`, `LightGreen()` and `DarkRed()` convert to hexadecimal text.
- Older saved expressions containing Qlik RGB/ARGB calls are repaired again immediately before TOM/TMDL export.
- Export is blocked if an unsupported Qlik colour function remains.

## 3. Missing DAX dependency repair

- Qualified references such as `'Finance'[ActualAmount]` are checked against the final exported model.
- Qlik LOAD aliases are used when available.
- High-confidence semantic aliases are repaired, including `ActualAmount` to a unique `Amount` column.
- Ambiguous or unresolved references are not guessed. The measure is marked `missing-dependency`, approval is removed, and export is blocked.
- Both UI model validation and TMDL validation check every qualified DAX reference.

## Validation

- Strict TypeScript compilation passed.
- 11 Vitest files passed.
- 38 automated tests passed.
- Client production build passed.
- SSR production build passed.
