# Optional Gemini / Deterministic QVS Analysis Fix

## Root cause

The upload page invoked `validateQvsScriptsViaAi` and `analyzeQvsScriptsViaAi` before the deterministic parser results were committed. Both functions threw when `VITE_GEMINI_API_KEY` was empty, even though local QVS parsing was already available.

## Resolution

- Added a deterministic local analysis service in `src/lib/migration/local-analysis.ts`.
- QVS validation now runs locally first.
- Missing Gemini configuration no longer blocks analysis.
- Gemini failures, timeouts and rate limits fall back to deterministic analysis.
- Existing Gemini enrichment remains available when a key is configured.
- Updated UI copy so Gemini is described as optional enrichment.
- Added regression tests for local metadata generation and syntax validation.
- Replaced internal npm registry URLs in `package-lock.json` with `registry.npmjs.org`.

## Behaviour

With only Supabase configured, users can upload QVS files and complete lineage analysis. The result includes source tables, final tables, operations, relationships, variables, lineage, filters and validation metadata from the deterministic parser.

When `VITE_GEMINI_API_KEY` is present, the application attempts semantic enrichment. If the request fails, local analysis completes instead of showing a blocking error.
