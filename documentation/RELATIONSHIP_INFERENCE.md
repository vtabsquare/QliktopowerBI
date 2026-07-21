# Relationship inference and editing

## Inference signals

The model builder scores candidate relationships using multiple signals rather than field-name equality alone:

- Normalized field-name match
- Key suffix/prefix conventions (`ID`, `Key`, `_ID`)
- Candidate key designation
- Data-type compatibility
- Table-name alignment with a key field
- Existing Qlik/enterprise relationship metadata
- Fact/dimension/date classification

Candidates below the confidence threshold are not generated. Inferred relationships remain inactive until explicitly approved or accepted through **Accept high-confidence relationships**.

## Relationship state

Each relationship contains:

- Stable relationship ID
- From/to stable table and column IDs
- Cardinality
- Cross-filter direction
- Active status
- Source (`qlik-association`, `join`, `inferred`, `manual`)
- Confidence
- Evidence
- Risk level
- Approval state
- Notes
- Validation messages

## Validation rules

Blocking checks:

- Missing table
- Missing column
- Incompatible data type
- Exact duplicate relationship

Warnings:

- Many-to-many cardinality
- Bidirectional filtering
- Multiple active paths between the same table pair
- Missing model key recommendations

Deleted inferred relationships remain recoverable through **Restore**. Manual relationships persist across model rebuilds.

## PBIP effect

Every non-deleted relationship is converted to a TOM `SingleColumnRelationship` and serialized into `SemanticModel/definition/relationships.tmdl`. Active/inactive state, cardinality and cross-filter direction are native TOM properties. Confidence, evidence, source, notes and user approval are retained as annotations and in the migration manifest.
