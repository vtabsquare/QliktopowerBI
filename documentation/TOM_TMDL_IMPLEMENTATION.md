# Microsoft TOM and TMDL implementation

## Purpose

The PBIP exporter now builds one strongly typed, canonical semantic-model specification and serializes it to Power BI's TMDL folder format. It no longer assembles a `model.bim` JSON document.

This directly prevents the previous failure in which an aggregate QVW expression was written as an ordinary source column with an unsupported `expression` property.

## Serialization path

```text
Approved migration workspace
  -> TomModelBuilder
  -> TomDatabaseSpec
  -> TmdlValidator (blocking pre-flight)
  -> POST /api/tom/serialize
       -> .NET 8 Microsoft.AnalysisServices TOM bridge
       -> TmdlSerializer.SerializeDatabaseToFolder
       -> TmdlSerializer.DeserializeDatabaseFromFolder roundtrip
  -> if the bridge is unavailable only:
       -> strict deterministic TypeScript TMDL serializer
  -> SemanticModel/definition/*.tmdl
  -> PBIP ZIP
```

The Windows/local application automatically prefers the Microsoft bridge. The fallback exists so browser-only and hosted deployments can still export a structurally validated TMDL project; the selected engine is recorded in `Migration/tmdl-engine.txt`.

## Object separation

The canonical model uses discriminated TypeScript types:

- `TomDataColumn`: physical source column with `sourceColumn`; never has DAX.
- `TomCalculatedColumn`: row-context DAX expression; never has `sourceColumn`.
- `TomMeasure`: aggregate or context-dependent DAX expression under the table measure collection.
- `TomPartition`: M or calculated-table partition.
- `TomRelationship`: single-column relationship with explicit cardinality, direction and active state.
- `TomHierarchy`: hierarchy levels referencing existing columns.
- `TomNamedExpression`: shared M expression/parameter.

QVW visualization expressions are classified as measures by default. They are not inserted into the column collection.

## Generated PBIP semantic-model structure

```text
<Project>.SemanticModel/
  .platform
  definition.pbism
  definition/
    database.tmdl
    model.tmdl
    relationships.tmdl        # when relationships exist
    expressions.tmdl          # when shared expressions exist
    tables/
      <Table>.tmdl
```

`definition.pbism` uses version `4.0`. The package intentionally omits both `model.bim` and `.pbi/cache.abf`.

## Microsoft TOM bridge

Location:

```text
tools/TomTmdlBridge/
```

Build on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-tom-bridge.ps1
```

The bridge targets .NET 8 and references `Microsoft.AnalysisServices`. It builds actual TOM objects, serializes them through `TmdlSerializer.SerializeDatabaseToFolder`, then deserializes the folder and checks table, relationship, column and measure counts.

Test manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-tom-bridge.ps1 `
  -InputJson .\path\to\tom-model-spec.json `
  -OutputFolder .\test_out\definition
```

## Pre-export blocking rules

Export is blocked for:

- Missing table partitions
- Duplicate table, column, measure or relationship names
- Source columns carrying an expression
- Calculated columns carrying `sourceColumn`
- Empty calculated-column or measure expressions
- Missing relationship tables or columns
- Invalid hierarchy column references
- Self-relationships

The diagnostics are included in `Migration/tmdl-diagnostics.json`.

## Traceability

TOM annotations and migration files preserve:

- Original Qlik expression
- QVW sheet/object and source expression ID
- Conversion status and approval
- Source table lineage
- Relationship confidence, evidence and notes
- Serializer used for the export
