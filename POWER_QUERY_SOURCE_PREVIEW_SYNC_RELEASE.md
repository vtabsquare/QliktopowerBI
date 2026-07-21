# Power Query Source/Preview Synchronization Release

This release fixes a divergence where the browser preview read uploaded source files directly while exported Power Query reopened unresolved relative paths and silently returned empty tables.

## Implemented

- Uploaded CSV, TSV, text, JSON and XML sources up to 25 MB are embedded into deterministic load-disabled `Source_*` M queries.
- Final M queries and the UI preview now use the same uploaded source bytes.
- Source read and source mapping failures raise explicit `Error.Record` errors; they no longer fall back to `#table({}, {})`.
- Resident and JOIN logic is reconstructed from raw lineage rather than referencing a pruned semantic-model table.
- JOIN generation uses direct `Table.NestedJoin` and `Table.ExpandTableColumn` steps.
- Required join keys and payload columns are validated with clear missing-column errors instead of being added as null columns.
- Deep validation blocks PBIP export when uploaded preview data is not bound to the generated M source or an empty placeholder is used.
- Preview cards identify whether the final query is bound to embedded uploaded data or an external connector.

## External sources

Large files and live database/web sources remain external connectors. Their source query fails clearly until a valid executable path, credential and privacy configuration is supplied.
