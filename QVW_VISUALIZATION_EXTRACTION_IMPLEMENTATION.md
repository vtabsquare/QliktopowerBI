# QVW Visualization Extraction Implementation

## What was added

The application now supports a complete QVW project-intake and visualization-metadata review workflow.

### New routes

- `/app/instructions` — first page after login. Explains mandatory, recommended and optional upload files.
- `/app/qvw-analysis` — displays QlikView document metadata, sheets, visualization objects, expressions, variables, actions, triggers, bookmarks, macros, extensions and package readiness.

### New parser modules

- `src/lib/migration/qvw/types.ts`
- `src/lib/migration/qvw/intake.ts`
- `src/lib/migration/qvw/project-parser.ts`
- `src/lib/migration/qvw/index.ts`

The parser reads the text/XML files generated in a QlikView project (`-prj`) folder. The original QVW is treated as a binary audit artifact. A browser cannot reliably decode proprietary QVW internals by itself.

### Upload package handling

The existing upload component now accepts QVW, QVS, QVD/QVX, PRJ XML/TXT, data files, screenshots and ZIP/folder uploads. When QVW/PRJ content is detected, analysis is generated immediately and stored in the migration state.

### Windows helper

`public/tools/qvw-extract-prj.ps1` is included for Windows computers with QlikView Desktop installed. It creates the `<QVW name>-prj` folder next to the QVW, opens and saves the document using COM automation, validates the generated project files and can create a ZIP package.

Example:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\public\tools\qvw-extract-prj.ps1 `
  -QvwPath "C:\Qlik\SalesDashboard.qvw" `
  -CreateZip
```

QlikView COM signatures can vary by installed version and local security policy. If the helper cannot open the document, create the matching `-prj` folder manually next to the QVW, open the document in QlikView Desktop and save it.

## Displayed metadata

- Document title, ID, author, version, reload metadata and alternate states
- Sheets, object IDs, object positions and dimensions
- Chart/list box/button/input/container/extension classification
- Dimensions, measures, conditional expressions, variables, fields and functions
- Basic DAX candidates for simple aggregate expressions
- Set Analysis, Aggr and inter-record-function warnings
- Action and trigger chains with proposed Power BI mappings
- Bookmarks and selections where available in project XML
- Module.txt macro procedures, risk classification and replacement suggestions
- Extension objects and manual-remediation flags
- Mandatory/recommended/optional upload readiness
- Downloadable normalized analysis JSON

## Important limitations

- A QVW-only upload cannot expose complete visualization metadata in a browser. PRJ files or a Windows extraction worker are required.
- Personal/server bookmarks may require a QlikView Server-side export and user context.
- Macro execution is not reproduced. Macros are inventoried and classified for redesign.
- Custom extension rendering cannot be reproduced from metadata alone. Include screenshots and extension assets for review.
- DAX candidates are initial translations only. Complex Set Analysis, alternate states, Aggr and chart inter-record functions require model-aware validation.

## Validation completed

- `npx tsc --noEmit`
- `npm run build`
- Route generation for the two new pages
- ZIP integrity test
- Sample QVW PRJ package included at `public/templates/sample-qvw-prj-package.zip`
