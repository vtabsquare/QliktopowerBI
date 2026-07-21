# PBIP Report and Measure Safety Fix

## Scope

This release keeps the simplified Power BI Data Model workflow and all existing Qlik analysis features. It corrects PBIP report packaging and adds model-wide measure safety before TOM/TMDL serialization.

## PBIR report package

Every export now contains:

- `<Project>.Report/definition.pbir`
- `<Project>.Report/definition/version.json`
- `<Project>.Report/definition/report.json`
- `<Project>.Report/definition/pages/pages.json`
- one `page.json` for every generated report page

The export also includes an `OPEN_AFTER_EXTRACTION.txt` instruction file. The PBIP must be opened only after the full ZIP has been extracted.

## Measure normalization rules

Before semantic-model validation and export, the application:

1. Consolidates measures with the same normalized DAX expression.
2. Retains all source QVW expression IDs on the canonical measure.
3. Enforces model-wide, case-insensitive measure-name uniqueness.
4. Prevents a measure from having the same name as a column in its home table.
5. Uses deterministic aggregate-aware names. Example: a `Salary` column and `SUM('Employees'[Salary])` measure produce `Total Salary`.
6. Protects table-qualified column references when a measure is renamed.
7. Rewrites valid dependent measure references when a rename is unambiguous.
8. Remaps visual bindings from removed duplicate measure IDs to the retained measure.

## Display-folder policy

Every exported measure is placed under this hierarchy:

`Qlik Measures\<Home Table>\<Category>`

Examples:

- `Qlik Measures\Sales\Converted Measures`
- `Qlik Measures\Sales\QVW\Executive Overview`
- `Qlik Measures\Sales\Review Required`

Existing categories are retained beneath the standard table folder.

## Export gates

PBIP export is blocked when the model still contains:

- duplicate measure names;
- duplicate DAX measure expressions;
- a measure/column name collision;
- a measure without a display folder;
- multiple `IsKey` columns in one table;
- an invalid relationship or missing object dependency.

The TypeScript model validator, portable TMDL validator, and Microsoft TOM bridge all enforce the measure rules.
