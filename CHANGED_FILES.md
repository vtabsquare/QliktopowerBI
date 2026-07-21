# Changed-file inventory

## New expression framework

- `src/lib/migration/expression/core/ExpressionTypes.ts`
- `src/lib/migration/expression/core/ExpressionTokenizer.ts`
- `src/lib/migration/expression/core/ExpressionParser.ts`
- `src/lib/migration/expression/analyzers/ExpressionInventoryBuilder.ts`
- `src/lib/migration/expression/index.ts`

## New DAX framework

- `src/lib/migration/dax/DaxTypes.ts`
- `src/lib/migration/dax/DaxNameResolver.ts`
- `src/lib/migration/dax/DaxTranslator.ts`
- `src/lib/migration/dax/index.ts`

## New model and relationship framework

- `src/lib/migration/model/PowerBiModelTypes.ts`
- `src/lib/migration/model/PowerBiModelBuilder.ts`
- `src/lib/migration/model/ModelValidationEngine.ts`
- `src/lib/migration/model/index.ts`

## New UI routes

- `src/routes/app/expression-conversion.tsx`
- `src/routes/app/powerbi-model.tsx`
- `src/routes/app/relationships.tsx`
- `src/routes/app/logs.tsx`

## Updated integration files

- `src/lib/migration/store.ts`
- `src/lib/migration/pbip-generator.ts`
- `src/components/migration/EnterpriseAnalysisPanel.tsx`
- `src/components/migration/StageNav.tsx`
- `src/components/migration/AppHeader.tsx`
- `src/routes/app/qvw-analysis.tsx`
- `src/routeTree.gen.ts`
- `package.json`
- `package-lock.json`

## Tests and fixtures

- `tests/expression-conversion.test.ts`
- `tests/model-validation.test.ts`
- `tests/pbip-export.test.ts`
- `tests/qvw-regression.test.ts`
- `tests/fixtures/EnterpriseComplexQlikProject_With_QVW_PRJ_Visuals_Updated.zip`

## Documentation

- `ENHANCEMENT_IMPLEMENTATION.md`
- `CHANGED_FILES.md`
- `documentation/ARCHITECTURE.md`
- `documentation/EXPRESSION_SUPPORT_MATRIX.md`
- `documentation/UNSUPPORTED_FEATURES.md`
- `documentation/RELATIONSHIP_INFERENCE.md`
- `documentation/PBIP_GENERATION_FLOW.md`
- `documentation/TEST_REPORT.md`
- `documentation/KNOWN_LIMITATIONS.md`
- `documentation/MIGRATION_MANIFEST_EXAMPLE.json`
- `documentation/ENHANCEMENT_REQUIREMENTS.txt`

## Microsoft TOM and TMDL production export

- `src/lib/migration/tmdl/TomModelTypes.ts`
- `src/lib/migration/tmdl/TomModelBuilder.ts`
- `src/lib/migration/tmdl/TmdlValidator.ts`
- `src/lib/migration/tmdl/TmdlSerializer.ts`
- `src/lib/migration/tmdl/TmdlUtils.ts`
- `src/lib/migration/tmdl/TomService.ts`
- `src/lib/migration/tmdl/index.ts`
- `tools/TomTmdlBridge/TomTmdlBridge.csproj`
- `tools/TomTmdlBridge/Program.cs`
- `tools/TomTmdlBridge/README.md`
- `scripts/build-tom-bridge.ps1`
- `scripts/test-tom-bridge.ps1`
- `tests/tmdl-validation.test.ts`
- `documentation/TOM_TMDL_IMPLEMENTATION.md`

Updated for TOM/TMDL:

- `src/server.ts`
- `src/lib/migration/pbip-generator.ts`
- `src/lib/migration/enterprise-parser.ts`
- `src/components/migration/EnterpriseAnalysisPanel.tsx`
- `tests/pbip-export.test.ts`
- `documentation/ARCHITECTURE.md`
- `documentation/PBIP_GENERATION_FLOW.md`
- `documentation/RELATIONSHIP_INFERENCE.md`
- `documentation/TEST_REPORT.md`
- `documentation/KNOWN_LIMITATIONS.md`
- `documentation/MIGRATION_MANIFEST_EXAMPLE.json`
- `RELEASE_NOTES.md`
- `package-lock.json`
## Final integration

- `src/lib/migration/local-analysis.ts` — deterministic QVS metadata and validation.
- `src/lib/migration/gemini.ts` — optional enrichment with local fallback.
- `tools/TomTmdlBridge/Program.cs` — explicit System.Text.Json alias.
- `tests/local-analysis.test.ts` — fallback regression coverage.
- Upload and Stage 3 UI copy now describes Gemini as optional.

## PBIP report and measure safety final fix

Added:

- `src/lib/migration/model/MeasureNormalization.ts`
- `tests/measure-normalization.test.ts`
- `PBIP_REPORT_MEASURE_SAFETY_FIX.md`

Updated:

- `src/lib/migration/model/PowerBiModelTypes.ts`
- `src/lib/migration/model/PowerBiModelBuilder.ts`
- `src/lib/migration/model/ModelValidationEngine.ts`
- `src/lib/migration/model/index.ts`
- `src/lib/migration/store.ts`
- `src/lib/migration/tmdl/TomModelBuilder.ts`
- `src/lib/migration/tmdl/TmdlValidator.ts`
- `src/lib/migration/pbip-generator.ts`
- `tools/TomTmdlBridge/Program.cs`
- `tests/tmdl-validation.test.ts`
- `tests/pbip-export.test.ts`

## Final single-upload/QVW/type integration

- `src/components/migration/MultiFileDropzone.tsx`
  - robust QVW binary capture
  - script-only Source/ETL assignment
  - async upload pipeline
- `src/routes/app/index.tsx`
  - one-time ZIP workspace persistence
  - automatic deterministic ETL analysis
  - automatic QVW/PRJ analysis
  - local direct-QVW extraction integration
- `src/routes/app/power-query.tsx`
  - immediate reviewed-type propagation to the enterprise analysis
- `src/components/migration/EnterpriseAnalysisPanel.tsx`
  - saved and AI-generated M queries retain reviewed types
- `src/lib/migration/enterprise-parser.ts`
  - downstream rebuild for reviewed types
  - reviewed type application to arbitrary M
- `src/lib/migration/expression/analyzers/ExpressionInventoryBuilder.ts`
  - all QVW variables become DAX measures
- `src/lib/migration/model/PowerBiModelBuilder.ts`
  - hidden disconnected Qlik Variables measure host
- `src/lib/migration/model/MeasureNormalization.ts`
  - preserve distinct Qlik variable names while consolidating ordinary duplicate measures
- `src/lib/migration/tmdl/TomModelBuilder.ts`
  - valid one-row M partition for measure-host tables
- `src/lib/migration/store.ts`
  - clean project-specific state on a new upload
- `src/server.ts`
  - Windows QVW Desktop COM extraction endpoint
- `tests/pipeline-integration.test.ts`
  - type and single-upload integration coverage
- `tests/qvw-regression.test.ts`
  - all-variable DAX measure coverage

## DAX autocomplete, exact repair navigation and single-QVS support

- `src/components/migration/DaxCodeEditor.tsx`
- `src/lib/migration/dax/DaxAutocomplete.ts`
- `src/components/migration/EnterpriseAnalysisPanel.tsx`
- `src/components/migration/AutoFixCenter.tsx`
- `src/components/migration/RepairFocusNotice.tsx`
- `src/lib/migration/autofix/AutoFixEngine.ts`
- `src/components/migration/MultiFileDropzone.tsx`
- `src/routes/app/index.tsx`
- `src/routes/app/instructions.tsx`
- `tests/dax-autocomplete.test.ts`
- `tests/exact-repair-navigation.test.ts`
- `tests/single-qvs-mode.test.ts`

## Enterprise parser Section 8 authoritative Power Query types

Updated:

- `src/lib/migration/enterprise-parser.ts`
  - safe value sanitisation followed by final `Table.TransformColumnTypes`
  - UI-reviewed types applied after all structural M operations
  - idempotent reviewed-type wrapper for AI-generated M
  - case-insensitive table and column type lookup
  - explicit `Any` support and expanded type aliases
  - export-blocking validation for missing/stale type metadata
- `tests/pipeline-integration.test.ts`
  - updated integration expectations for the authoritative final type pipeline

Added:

- `tests/enterprise-parser-section8-types.test.ts`
- `SECTION8_POWER_QUERY_TYPES_FIX.md`
