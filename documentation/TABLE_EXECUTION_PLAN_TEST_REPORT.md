# Table Execution Plan Compiler – Validation Report

## Automated validation

- Vitest files: 24 passed
- Vitest assertions: 79 passed
- New authoritative execution-plan regression: passed
- UI preview / Power Query parity: passed
- Microsoft Power Query parser validation: passed
- Joined-column pruning regression: passed
- Composite-key and relationship governance: passed
- Reviewed data-type final-step validation: passed
- PBIP audit export validation: passed

## Production build

- Vite client production build: passed
- Vite SSR production build: passed

## Fixture validation

A Qlik fixture containing Sales and Customers CSV sources, a calculated NetSales field, a Sales filter, and a left join was compiled through the complete pipeline.

Validated results:

- `Source_Sales` and `Source_Customers` staging queries generated.
- NetSales preview values matched the generated M calculation.
- CustomerName and Segment were joined into Sales.
- Every generated M query parsed successfully with Microsoft's Power Query parser.
- The final query ended with one `ReviewedTypeConversions` table step.
