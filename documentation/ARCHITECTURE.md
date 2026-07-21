# Architecture

## End-to-end flow

```text
Uploaded QVW/QVS/PRJ package
  -> existing file extraction and QVW/QVS parsers
  -> QVW expression inventory builder
  -> expression tokenizer and AST parser
  -> deterministic DAX translator
  -> artifact classifier and variable converter
  -> editable expression review workspace
  -> Power BI model builder
  -> relationship inference and validation
  -> interactive model and relationship editor
  -> canonical TOM model specification
  -> strict TMDL validation
  -> Microsoft TOM serializer (preferred) or portable TMDL serializer
  -> PBIP definition folder and migration manifest
```

## Layer responsibilities

### Existing ingestion layer

The existing upload, QVS parser, QVW PRJ metadata parser, source mapping and enterprise ETL analysis remain the source of truth for extracted files, tables, operations and QVW UI metadata.

### Expression layer

`src/lib/migration/expression` normalizes and parses Qlik expressions. Identical logic can be deduplicated into one reusable artifact while every original sheet/object usage remains attached through `sourceExpressionIds` and `usages`.

### DAX layer

`src/lib/migration/dax` performs deterministic translation from the AST. Each translation returns DAX, artifact type, dependencies, confidence, diagnostics and an explanation. Unsupported contextual operations are retained as manual-review artifacts instead of being dropped.

### Model layer

`src/lib/migration/model` combines enterprise tables, approved expression artifacts, variables and QVW visual bindings into a stable-ID semantic model. Model edits do not change the stable IDs used by relationships and visual bindings.

### TOM/TMDL layer

`src/lib/migration/tmdl` converts the reviewed model into a strongly typed `TomDatabaseSpec`. Source columns, calculated columns, measures, calculated tables, partitions, hierarchies and relationships are distinct object types. `TmdlValidator` blocks structurally invalid exports.

The local server endpoint `/api/tom/serialize` invokes the .NET bridge in `tools/TomTmdlBridge`. The bridge uses Microsoft `TmdlSerializer` and performs a deserialize roundtrip. When .NET is unavailable, a deterministic TypeScript serializer emits the same folder contract and records that fallback in the migration manifest.

### Persistence layer

The Zustand workspace persists expression edits, model edits, table locations, relationships and approvals. A newly uploaded package creates a new workspace and clears incompatible prior analysis.

### Export layer

`pbip-generator.ts` writes the semantic model into `<Project>.SemanticModel/definition/` as TMDL and emits `definition.pbism` version `4.0`. It intentionally emits neither `model.bim` nor `.pbi/cache.abf`. Migration manifests, the canonical TOM spec, diagnostics and traceability are stored under `Migration/`.

## Traceability keys

- Expression artifact ID
- Source QVW expression ID
- Sheet and object ID
- Stable table, column and measure IDs
- Relationship ID
- Visual binding ID
- TOM lineage tag

These IDs connect original QVW metadata to DAX, TOM objects, TMDL files, relationships and PBIP export records.
