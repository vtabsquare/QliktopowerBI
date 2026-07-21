# PBIP generation flow

## Readiness gate

PBIP download is enabled when:

- At least one final/imported table exists.
- Enterprise source/M-query validation passes.
- A QVW expression inventory exists when QVW metadata is present.
- The proposed Power BI model has no blocking diagnostics.
- Relationship endpoints and data types are valid.
- Visual bindings do not contain invalid object references.
- The canonical TOM specification has no blocking TMDL diagnostics.
- Every exported table has an M or calculated partition.

## Package structure

```text
<Project>/
  <Project>.pbip
  <Project>.SemanticModel/
    .platform
    definition.pbism
    definition/
      database.tmdl
      model.tmdl
      relationships.tmdl
      expressions.tmdl
      tables/
        <Table>.tmdl
  <Project>.Report/
    .platform
    definition.pbir
    report.json
  Migration/
    migration-manifest.json
    tom-model-spec.json
    tmdl-diagnostics.json
    tmdl-engine.txt
    expression-inventory.json
    powerbi-model.json
    visual-bindings.json
    pipeline-logs.txt
    qvw-analysis.json
    README.md
```

Optional files such as `relationships.tmdl`, `expressions.tmdl` and `qvw-analysis.json` are generated only when applicable.

## TMDL contents

- Imported tables and M partitions
- Calculated, parameter and disconnected tables
- Physical source columns
- Calculated columns as `calculatedColumn` objects
- Reviewed measures and dependency measures
- Descriptions, formats, display folders and hidden state
- Hierarchies where available
- Active and inactive relationships
- Qlik source-expression and relationship annotations

## TOM serialization

The exporter first builds a canonical `TomDatabaseSpec` and validates it. It then prefers the local Microsoft TOM bridge:

```text
Database/Model/Table objects
  -> TmdlSerializer.SerializeDatabaseToFolder
  -> TmdlSerializer.DeserializeDatabaseFromFolder
  -> roundtrip validation
```

When that bridge is unavailable, export uses the strict portable TMDL serializer. The selected engine is written to `Migration/tmdl-engine.txt`.

## Traceability

Each generated measure can carry:

- Qlik source expression ID
- Original expression
- QVW sheet/object source
- Conversion status
- Approval state

The migration manifest adds a portable audit record even when a Power BI artifact does not support a specific annotation.
