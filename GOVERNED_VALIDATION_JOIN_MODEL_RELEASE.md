# Governed Validation, Join Reconstruction and Model Design Release

## Scope

This release implements the backend-first enhancement specification supplied for the QlikView-to-Power BI migration application. It focuses on authoritative validation state, explicit Qlik JOIN/KEEP reconstruction, evidence-based composite keys, semantic-model pruning, exact repair navigation, and auditable PBIP generation.

## Backend execution order

1. Parse Qlik scripts in execution order.
2. Build the table dependency graph.
3. Build field lineage.
4. Analyse table grain.
5. Reconstruct explicit JOIN/KEEP operations.
6. Create only evidence-backed composite keys.
7. Classify model, staging, static and excluded tables.
8. Generate collision-safe Power Query M.
9. Generate reusable DAX measures and variables.
10. Build and validate the semantic model.
11. Present the same backend decisions in the UI.

## Key changes

- Validation issues use deterministic identities and fresh validation replaces stale results.
- Saving a measure updates the canonical semantic-model measure, performs targeted and model-level validation, refreshes counters, and removes resolved cards.
- Composite keys are created only for explicit multi-column Qlik joins/associations. Shared field names alone never create a key.
- Repeated identical JOIN/KEEP statements are consolidated before model field-state changes can create false extra keys.
- Composite keys are null-safe and separator-safe.
- Power Query JOINs use the explicit key order, Qlik join kind and script order.
- Join keys and existing semantic attributes are not expanded twice. Genuine name collisions are qualified and flagged.
- Full staging queries remain available with loading disabled while the semantic model uses governed projections.
- Every table receives a model disposition and explanation.
- Changing Qlik-equivalent, Power BI optimized, Desktop review or Tables-only mode re-plans the backend model and refreshes validation.
- PBIP exports include dependency, lineage, join, composite-key, table-classification, DAX-decision, validation and debug audit files.

## Validation

- TypeScript compilation passed.
- 19 test files passed.
- 64 automated tests passed.
- Client production build passed.
- Server production build passed.

## Packaging

The complete package excludes node_modules, generated build output, local environment files, caches and TOM build artifacts. Build the Microsoft TOM bridge on Windows using the included script.
