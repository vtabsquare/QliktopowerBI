# Simplified Power BI Data Model Experience

## Scope

This release redesigns only the Power BI Data Model and Relationship experience. Authentication, upload, QVS parsing, QVW analysis, expression conversion, ETL analysis, TOM/TMDL generation, PBIP export, logs and all other routes remain in place.

## Guided workflow

1. **Model summary** — shows fact, lookup and supporting tables with a concise star-schema summary.
2. **Tables & keys** — provides exactly one `Row Identifier / Key` dropdown per table. Fact tables may use `None` when no verified unique row ID exists.
3. **Relationships** — groups candidates into `Ready for Power BI`, `Needs your review`, and `Excluded or unsafe`.
4. **Validation** — explains blocking issues and links directly to the screen that fixes them.

## Automatic relationship rules

A relationship can be applied automatically only when:

- both tables and columns exist;
- data types are compatible;
- no duplicate relationship exists;
- the relationship is not many-to-many;
- filtering is single direction;
- the confidence and source evidence are sufficient;
- it does not become a competing active relationship for the same table pair.

High-confidence Qlik associations and inferred low-risk matches become active. Medium-confidence relationships remain inactive for review. Weak, invalid or risky candidates are excluded from active Power BI export.

## Key handling

- A table can have a maximum of one `IsKey` column.
- Fact-table foreign keys such as `CustomerID`, `EmployeeID`, `ProductID` and `DateKey` are not automatically treated as fact row identifiers.
- A fact table can have no `IsKey` column.
- Dimension/date/parameter tables receive a recommended one-side key when reliable evidence exists.
- Model validation and TMDL validation both block export when a table still has multiple keys.

## PBIP/TMDL export

Only relationships that are active or explicitly approved are written to the TOM/TMDL semantic model. Suggested relationships remain visible in the UI and project state but are not exported as active model paths.

## Changed files

- `src/components/migration/SimplePowerBiModelPage.tsx`
- `src/routes/app/powerbi-model.tsx`
- `src/routes/app/relationships.tsx`
- `src/lib/migration/model/SmartModelEngine.ts`
- `src/lib/migration/model/PowerBiModelTypes.ts`
- `src/lib/migration/model/PowerBiModelBuilder.ts`
- `src/lib/migration/model/ModelValidationEngine.ts`
- `src/lib/migration/model/index.ts`
- `src/lib/migration/store.ts`
- `src/lib/migration/tmdl/TmdlValidator.ts`
- `src/lib/migration/tmdl/TomModelBuilder.ts`
- `tests/smart-model-engine.test.ts`
- `tests/tmdl-validation.test.ts`

## Validation result

- TypeScript strict validation: passed
- Vitest: 7 test files, 22 tests passed
- Vite client build: passed
- Vite SSR build: passed
