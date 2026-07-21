# DAX Autocomplete, Exact Repair Navigation and Single-QVS Release

## Scope

This release preserves the existing Qlik reconstruction, Power Query, Data Model, TOM/TMDL and PBIP functionality while improving three user workflows.

## DAX editor autocomplete

The DAX Measures page now includes an editable DAX code editor. Suggestions are generated from the current proposed Power BI semantic model and the enterprise analysis.

Supported completion contexts:

- Plain prefixes, for example `S`, show matching tables, columns, measures and Qlik variables.
- A bracket prefix, for example `[v`, shows measures and reusable Qlik variable measures.
- A qualified prefix, for example `'Sales'[S`, shows only matching columns and measures from the Sales table.

Suggestions show the object name, object type and owning table. Arrow keys, Enter and Tab are supported.

Saving a measure updates the enterprise DAX inventory and, when present, the corresponding Power BI semantic-model measure. Model validation is rerun through the existing store logic.

## Exact Go to fix

Repair targets now carry the semantic object ID, object kind, missing table and missing field where available. A DAX dependency error such as:

`The measure 'Sales' references missing object 'Calendar[Currency]'.`

opens the DAX Measures page, expands the exact `Sales` measure, focuses its editor and displays `Calendar[Currency]` beside the editor.

The Auto-Fix Center also displays the exact destination path and uses specific button labels such as `Open Sales measure`.

## Single-QVS conversion mode

One `.qvs` file is sufficient for script-only migration. It is assigned to both source and ETL roles and is processed for:

- Sources and connections
- Variables
- LOAD and SQL logic
- Resident loads
- Joins and concatenations
- Mapping and ApplyMap
- Final tables
- Power Query
- DAX candidates
- Relationships
- PBIP generation

QVW and PRJ files remain additional inputs only for visual objects, sheets, bookmarks, actions, triggers and layout extraction.
