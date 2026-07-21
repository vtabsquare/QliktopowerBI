# Known limitations

- A proprietary binary `.qvw` cannot be fully inspected in the browser. Complete UI metadata still requires the accompanying QlikView PRJ folder or a Windows QlikView extraction worker.
- Context-dependent Qlik chart functions require grain/visual-context review before equivalent DAX can be approved.
- The deterministic translator covers common functions and Set Analysis patterns, not every Qlik expression grammar variant.
- Culture-sensitive date/timestamp parsing is safer in Power Query with an explicit locale than in DAX.
- Complex alternate states, element functions and advanced set operators may require manual redesign.
- Qlik macros and custom extensions are inventoried but not executed or automatically converted.
- The export creates safe report pages and a visual-binding manifest; it does not yet generate every low-level Power BI visual-container definition.
- Microsoft TOM serialization requires a local .NET 8 SDK and package restore. When unavailable, the application falls back to its strict TypeScript TMDL serializer and records the fallback in the package.
- TMDL-backed PBIP is a Power BI Desktop preview capability in current Microsoft documentation. Some Desktop versions require enabling **Store semantic model using TMDL format** under Preview features before opening the generated project.
- Power BI Desktop remains the final authority for DAX calculation-engine compatibility. The application performs structural TOM/TMDL pre-flight checks but does not embed the Power BI calculation engine.
- Relationship uniqueness/null statistics are used only when source profiling supplies them; otherwise the UI presents a review warning rather than inventing statistics.
- The package intentionally omits `.pbi/cache.abf`; therefore, the PBIP opens with model metadata but without cached imported data until refresh.
- `npm audit` may report an existing high-severity transitive dependency. Do not use `npm audit fix --force` without reviewing compatibility.
