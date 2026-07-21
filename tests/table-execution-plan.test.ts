import { describe, expect, it } from "vitest";
import {
  runEnterpriseAnalysis,
  type ProjectFile,
} from "@/lib/migration/enterprise-parser";
import { deepValidatePowerQueries } from "@/lib/migration/power-query/MQueryDeepValidator";

function project(): ProjectFile[] {
  const qvs = `
Customers:
LOAD
    CustomerID,
    CustomerName,
    Segment,
    CountryCode
FROM [Customers.csv]
(txt, utf8, embedded labels, delimiter is ',');

Sales:
LOAD
    OrderID,
    CustomerID,
    SalesAmount,
    DiscountAmount,
    SalesAmount - DiscountAmount AS NetSales
FROM [Sales.csv]
(txt, utf8, embedded labels, delimiter is ',')
WHERE SalesAmount > 0;

LEFT JOIN (Sales)
LOAD
    CustomerID,
    CustomerName,
    Segment
RESIDENT Customers;
`;

  return [
    { path: "model.qvs", ext: ".qvs", size: qvs.length, isText: true, content: qvs, note: "" },
    {
      path: "Customers.csv",
      ext: ".csv",
      size: 100,
      isText: true,
      content: "CustomerID,CustomerName,Segment,CountryCode\n1,Acme,Enterprise,US\n2,Beta,SMB,IN\n",
      note: "",
    },
    {
      path: "Sales.csv",
      ext: ".csv",
      size: 100,
      isText: true,
      content: "OrderID,CustomerID,SalesAmount,DiscountAmount\n100,1,1000,100\n101,2,500,20\n",
      note: "",
    },
  ];
}

describe("authoritative table execution plan", () => {
  it("drives preview and simple table-producing M steps from one plan", async () => {
    const analysis = runEnterpriseAnalysis(project());
    const plan = analysis.executionPlans?.Sales;

    expect(plan).toBeDefined();
    expect(plan?.sourceQuery).toBe("Source_Sales");
    expect(plan?.selectedColumns).toEqual(expect.arrayContaining([
      "OrderID", "CustomerID", "SalesAmount", "DiscountAmount",
    ]));
    expect(plan?.selectedColumns).not.toContain("SalesAmount-DiscountAmount");
    expect(plan?.calculations.find((calculation) => calculation.name === "NetSales")?.dependencies)
      .toEqual(["SalesAmount", "DiscountAmount"]);
    expect(plan?.steps.every((step) => step.returns === "table")).toBe(true);

    const query = analysis.mQueries.Sales;
    expect(query).toContain('#"Source_Sales"');
    expect(query).toContain("Joined_Customers");
    expect(query).toContain("Expanded_Customers_Fields");
    expect(query).toContain("FinalSalesColumns");
    expect(query).toContain("MissingField.Error");
    expect(query).toContain("ReviewedTypeConversions");
    expect(query).not.toContain("QLIK2PBI_ExistingReviewedColumns");
    expect(query).not.toContain("QLIK2PBI_ReviewedValueOperations");
    expect(query).not.toContain("QLIK2PBI_ReviewedMetadataOperations");

    expect(analysis.tablePreviews.Sales.outputRows[0]).toMatchObject({
      NetSales: 900,
      CustomerName: "Acme",
      Segment: "Enterprise",
    });

    const validation = await deepValidatePowerQueries(
      analysis.mQueries,
      analysis.stagingQueries || {},
      analysis.columnTypes,
      analysis.tablePreviews,
    );
    const blockers = Object.values(validation.queries)
      .flatMap((result) => result.issues)
      .filter((issue) => issue.severity === "blocking-error");
    expect(blockers).toEqual([]);
  });
});
