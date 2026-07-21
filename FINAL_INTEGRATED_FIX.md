# Final Integrated TOM/TMDL + Optional Gemini Fix

This release combines the production TOM/TMDL semantic-model generator with deterministic QVS analysis.

## Included fixes

- Microsoft TOM bridge uses concrete `ICollection<Annotation>` collections.
- The System.Text.Json serializer is explicitly aliased to avoid the TOM `JsonSerializer` name collision.
- QVS parsing, validation, lineage and final-table analysis run without a Gemini API key.
- Gemini remains optional semantic enrichment when `VITE_GEMINI_API_KEY` is configured.
- Gemini failures, timeouts and rate limits fall back to deterministic analysis instead of blocking the workflow.
- Existing TOM/TMDL export, Power BI model view and relationship editor remain intact.

## Required local configuration

Only Supabase variables are mandatory for authentication. Gemini is optional. Never place real secrets in source control or ZIP files.

## Windows validation

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\build-tom-bridge.ps1"
powershell -ExecutionPolicy Bypass -File ".\scripts\test-tom-bridge.ps1"
npx tsc --noEmit
npm test
npm run build
```
