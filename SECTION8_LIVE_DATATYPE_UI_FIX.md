# Section 8 Live Datatype UI Fix

## Fixed issues

1. The M Query generator previously allowed `executionPlans[table].reviewedTypes` to take precedence over the current `columnTypes` map. Because execution plans can be snapshots created before an in-UI edit, a saved datatype could be replaced by an older inferred datatype.
2. After saving datatypes, an existing AI-generated query snapshot could remain selected in the UI through `aiQueries || analysis.mQueries`, making the editor display the previous M query even though the deterministic analysis had regenerated it.

## Implemented behavior

- `columnTypesForTable(columnTypes, table)` is now the only authoritative source used for the final `ReviewedTypeConversions` step.
- Execution-plan datatype metadata is synchronized from the latest UI map after M generation, but cannot override the M query.
- Saving datatype changes clears the stale AI query snapshot so the newly regenerated typed M query is immediately displayed and exported.
- Saved and current edits are merged before regeneration.
- A regression test covers stale execution-plan datatype snapshots.

## Verification

- Section 8 datatype tests: 5 passed.
- Production client and SSR build: passed.
