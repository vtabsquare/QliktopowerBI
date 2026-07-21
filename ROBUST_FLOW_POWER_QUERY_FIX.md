# Robust Flow and Power Query Safety Fix

- UI-selected data types are authoritative in generated M and TMDL.
- Calculated columns use add-or-replace semantics.
- Renames and joins are collision-safe.
- Duplicate join/concatenate operations are removed by semantic signature.
- Qlik-only constructs are classified as translate, preserve metadata, ignore runtime, or manual review.
- Persistent Go to top and migration menu controls are available on every authenticated page.
