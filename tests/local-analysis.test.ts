import { describe, expect, it } from "vitest";
import {
  analyzeQvsScriptsLocally,
  validateQvsScriptsLocally,
} from "../src/lib/migration/local-analysis";

describe("deterministic QVS analysis fallback", () => {
  it("builds technical and business metadata without an AI key", () => {
    const source = `
Customers:
LOAD CustomerID, CustomerName
FROM [lib://Data/Customers.csv] (txt, utf8, embedded labels, delimiter is ',');
`;
    const etl = `
FactSales:
LOAD SaleID, CustomerID, Amount
FROM [lib://Data/Sales.csv] (txt, utf8, embedded labels, delimiter is ',');

DimCustomer:
LOAD CustomerID, CustomerName
RESIDENT Customers;
`;

    const result = analyzeQvsScriptsLocally(
      {
        reportName: "Sales Migration",
        businessRequirement: "Migrate the sales model",
        expectedOutput: "Power BI model",
      },
      "# Rules\n- Preserve final tables",
      source,
      etl,
    );

    expect(result.executionMetrics.activeEngineTier).toBe("local-deterministic");
    expect(result.businessMetadata.reportName).toBe("Sales Migration");
    expect(result.technicalMetadata.sourceTables.length).toBeGreaterThan(0);
    expect(result.technicalMetadata.finalTables.map((table) => table.name)).toContain(
      "FactSales",
    );
  });

  it("reports clear local syntax errors", () => {
    const issues = validateQvsScriptsLocally([
      {
        name: "broken.qvs",
        text: "Broken: LOAD If(Amount > 0, Amount FROM [lib://Data/file.csv];",
      },
    ]);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("Syntax error");
  });
});
