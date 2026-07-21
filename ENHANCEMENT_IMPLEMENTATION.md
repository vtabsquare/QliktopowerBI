# QVW expression, Power BI model, relationship and TOM/TMDL enhancement

## Purpose

This enhancement extends the existing QlikView-to-Power BI migration application without replacing authentication, upload, QVS parsing, QVW analysis or the established visual design. It adds a traceable path from QVW expression metadata to reviewed Power BI semantic-model artifacts and a production-oriented TMDL PBIP export.

## Existing capabilities retained

- Centralized expression inventory with retained usage locations.
- Tokenized Qlik parsing and deterministic DAX translation.
- Editable DAX and artifact classification.
- Variable/parameter conversion.
- Interactive Power BI model and relationship editor.
- Stable-ID state persistence and model validation.

## TOM/TMDL enhancement

- Canonical, strongly typed `TomDatabaseSpec` generated from the reviewed workspace.
- Physical columns, calculated columns, measures, calculated tables, partitions, hierarchies and relationships represented as separate object types.
- QVW chart/aggregate expressions exported as measures rather than ordinary columns.
- Strict blocking validation before PBIP generation.
- Preferred Microsoft TOM serialization through a local .NET 8 bridge.
- TMDL serialization using `TmdlSerializer.SerializeDatabaseToFolder`.
- TOM/TMDL roundtrip validation using `DeserializeDatabaseFromFolder`.
- Portable deterministic TMDL fallback when the bridge is unavailable.
- PBIP semantic model stored under `SemanticModel/definition/` with `definition.pbism` version `4.0`.
- No `model.bim` and no `.pbi/cache.abf` in generated packages.
- Canonical model, diagnostics, engine identity and traceability included under `Migration/`.
- Export UI shows whether Microsoft TOM or the portable fallback will be used.

## Validation status

Strict TypeScript compilation passed in the packaging environment. The portable serializer was smoke-tested. The .NET SDK was not available in that environment, so compile and roundtrip validation of the included Microsoft TOM bridge must be run on the target Windows machine using the provided scripts.
