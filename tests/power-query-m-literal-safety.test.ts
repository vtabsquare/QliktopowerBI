import { describe, expect, it } from "vitest";
import {
  buildPowerQueryReviews,
  runEnterpriseAnalysis,
  type ProjectFile,
} from "../src/lib/migration/enterprise-parser";

function qvs(content: string): ProjectFile {
  return {
    path: "LoadScript.qvs",
    ext: ".qvs",
    size: content.length,
    isText: true,
    content,
    note: "",
  };
}

describe("Power Query M literal safety", () => {
  it("converts Qlik single-quoted condition values to valid M text literals", () => {
    const analysis = runEnterpriseAnalysis([qvs(`
Customers:
LOAD
  CustomerID,
  Segment,
  If(Segment='Enterprise' OR Segment='Strategic', 1, 0) AS IsEnterprise
FROM [Customers.csv];
`) ]);

    const m = analysis.mQueries.Customers;
    expect(m).toMatch(/=\s*"Enterprise"/);
    expect(m).toMatch(/=\s*"Strategic"/);
    expect(m).not.toMatch(/=\s*'Enterprise'|=\s*'Strategic'/);
    expect(analysis.powerQueryReviews.Customers.status).not.toBe("blocked");
  });

  it("unwraps ApplyMap default Qlik strings before emitting M", () => {
    const analysis = runEnterpriseAnalysis([qvs(`
StatusMap:
MAPPING LOAD * INLINE [
Code, Label
A, Active
];
Sales:
LOAD
  OrderID,
  StatusCode,
  ApplyMap('StatusMap', StatusCode, 'Other') AS StatusLabel
FROM [Sales.csv];
`) ]);

    const m = analysis.mQueries.Sales;
    expect(m).toContain('then "Other"');
    expect(m).not.toContain('"\'Other\'"');
  });

  it("blocks PBIP review when invalid single-quoted M text remains", () => {
    const reports = buildPowerQueryReviews(
      {
        Broken: `let\n    Source = #table({"Segment"}, {{"Enterprise"}}),\n    Added = Table.AddColumn(Source, "Flag", each if [Segment]='Enterprise' then 1 else 0)\nin\n    Added`,
      },
      {},
      {},
    );

    expect(reports.Broken.status).toBe("blocked");
    expect(reports.Broken.issues.some((issue) =>
      issue.category === "syntax" && /single-quoted/i.test(issue.message),
    )).toBe(true);
  });

  it("blocks M values that preserve Qlik apostrophes inside a valid M string", () => {
    const reports = buildPowerQueryReviews(
      {
        Broken: `let\n    Source = #table({"Code"}, {{"A"}}),\n    Added = Table.AddColumn(Source, "Label", each "'Other'")\nin\n    Added`,
      },
      {},
      {},
    );

    expect(reports.Broken.status).toBe("blocked");
    expect(reports.Broken.issues.some((issue) =>
      /double-wrapped/i.test(issue.message),
    )).toBe(true);
  });
});
