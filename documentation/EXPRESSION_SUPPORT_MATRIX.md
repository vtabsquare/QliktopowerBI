# Expression conversion support matrix

Legend: **Automatic** = deterministic output; **Review** = DAX generated with a warning; **Manual** = original retained with remediation.

| Qlik construct | Current handling | Power BI target |
|---|---|---|
| `Sum`, `Avg`, `Min`, `Max`, `Median` | Automatic | Measure aggregation |
| `Count`, `Count(DISTINCT ...)` | Automatic | `COUNT`, `DISTINCTCOUNT` |
| `Only` | Automatic/Review | `SELECTEDVALUE` |
| `If`, `Alt`, `IsNull`, `Null`, `Len` | Automatic | DAX scalar logic |
| `Match`, `MixMatch`, `Pick` | Automatic/Review | `SWITCH` |
| `WildMatch` | Review | `SWITCH(TRUE())` + string matching approximation |
| `Left`, `Right`, `Mid`, `Trim`, `Upper`, `Lower`, `Replace`, `Index` | Automatic | DAX text functions |
| `SubField` | Review | `PATHITEM`/delimiter transformation |
| `Chr`, `Ord` | Automatic | `UNICHAR`, `UNICODE` |
| `Year`, `Month`, `MonthName`, `Week`, `WeekName`, `QuarterName`, `Day`, `WeekDay` | Automatic/Review | Date extraction/formatting |
| `Date`, `Timestamp` | Review when formatting | DAX `FORMAT` or underlying date value |
| `Date#`, `Timestamp#` | Review | `DATEVALUE`/`VALUE`; Power Query recommended for explicit locale |
| `Today`, `Now`, `AddMonths`, `MonthStart`, `MonthEnd`, `YearStart`, `YearEnd` | Automatic | DAX date functions |
| `Age`, `InMonth`, `InYear`, `Interval` | Automatic/Review | `DATEDIFF`, date predicates, formatted duration |
| `Round`, `Ceil`, `Floor`, `Fabs`, `Sign`, `Mod`, `Div`, `Exp`, `Log`, `Sqrt` | Automatic | DAX numeric functions |
| `RangeSum`, `RangeAvg` with scalar arguments | Automatic/Review | iterator over inline scalar table |
| `Fractile` | Review | `PERCENTILEX.INC` over inferred home table |
| `Aggr` | Review | `SUMX(SUMMARIZE(...))` pattern |
| `Rank` | Review | `RANKX` over inferred home table |
| `GetSelectedCount`, `GetFieldSelections`, `NoOfRows` | Automatic/Review | `VALUES`, `CONCATENATEX`, `COUNTROWS` |
| Set identifier `$` | Automatic | Current filter context |
| Set identifier `1` | Automatic/Review | `REMOVEFILTERS` |
| Set field inclusion/exclusion | Automatic/Review | `CALCULATE`, `KEEPFILTERS`, `IN` |
| Numeric/date range searches in Set Analysis | Automatic/Review | `FILTER(ALL(...), predicate)` |
| Variable expansion | Automatic when definition is known | Inline constant, parameter or measure reference |
| `TOTAL` | Review | `REMOVEFILTERS`; dimensional exceptions require confirmation |
| Calculated dimensions | Classified and editable | Calculated column or parameter candidate |
| Colour/format expressions | Classified and editable | Conditional-formatting measure |
| Dynamic title expressions | Classified and editable | Dynamic-title measure |

All translation results retain the original expression, AST, dependencies, confidence, warnings and manual remediation guidance.
