# Power Query M Literal Safety Release

## Root cause fixed

Qlik single-quoted text values such as `'Enterprise'`, `'Strategic'`, and `'Technology'` were previously retained inside generated Power Query conditions. Power Query M accepts text values only as double-quoted literals, so Power BI Desktop failed to open the PBIP with `Token Literal expected`.

ApplyMap defaults such as `'Other'` could also be emitted as the valid-but-wrong M value `"'Other'"`, retaining apostrophes in the data.

## Implemented changes

- Convert Qlik single-quoted values to escaped Power Query M double-quoted values.
- Preserve Qlik doubled-apostrophe escaping, for example `'Director''s Office'` becomes `"Director's Office"`.
- Unwrap ApplyMap defaults and INLINE values before emitting M.
- Prevent logical operators such as `OR` and `AND` from being inferred as source columns.
- Block PBIP generation when a generated M query contains a single quote outside strings/comments.
- Block PBIP generation when an M value still contains wrapped Qlik quote marks such as `"'Other'"`.
- Report the failing table, line, column, and expression evidence in AI Power Query Review.

## Validation

- TypeScript compilation passed.
- 22 test files passed.
- 74 automated tests passed.
- Client and SSR production builds passed.
