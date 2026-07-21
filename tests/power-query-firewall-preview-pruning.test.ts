import { describe, expect, it } from "vitest";
import { runEnterpriseAnalysis, type ProjectFile } from "@/lib/migration/enterprise-parser";

function file(path: string, ext: string, content: string): ProjectFile {
  return { path, ext, size: content.length, isText: true, content, note: "" };
}

const script = `
Customers:
LOAD CustomerID, CustomerName, Country, CustomerCategory
FROM [customers.csv];

Sales:
LOAD SaleID, CustomerID, Amount
FROM [sales.csv];

LEFT JOIN (Sales)
LOAD CustomerID, CustomerName, Country
RESIDENT Customers;
`;

describe("firewall-safe Power Query, previews and joined-column pruning", () => {
  it("separates physical source access into Source_* staging queries", () => {
    const analysis = runEnterpriseAnalysis([
      file("Model.qvs", ".qvs", script),
      file("customers.csv", ".csv", "CustomerID,CustomerName,Country,CustomerCategory\n1,Asha,IN,Retail\n2,Bala,US,Enterprise\n"),
      file("sales.csv", ".csv", "SaleID,CustomerID,Amount\n10,1,100.25\n11,2,200.50\n"),
    ]);

    const salesSourceName = Object.keys(analysis.stagingQueries || {}).find((name) => name.toLowerCase().startsWith("source_sales"));
    const customerSourceName = Object.keys(analysis.stagingQueries || {}).find((name) => name.toLowerCase().startsWith("source_customers"));
    expect(salesSourceName).toBeTruthy();
    expect(customerSourceName).toBeTruthy();
    expect(analysis.stagingQueries?.[salesSourceName!]).toContain("QLIK2PBI SOURCE MODE: embedded-upload");
    expect(analysis.stagingQueries?.[salesSourceName!]).toContain("Binary.FromText");
    expect(analysis.stagingQueries?.[salesSourceName!]).not.toContain("#table({}, {})");
    expect(analysis.mQueries.Sales).toContain(`#"${salesSourceName}"`);
    expect(analysis.mQueries.Sales).toContain(`#"${customerSourceName}"`);
    expect(analysis.mQueries.Sales).not.toContain('#"Customers"');
    expect(analysis.mQueries.Sales).not.toMatch(/File\.Contents|Web\.Contents|Sql\.Database/);
    expect(analysis.powerQueryReviews.Sales.status).not.toBe("blocked");
    expect(analysis.powerQueryReviews.Sales.issues.some((issue) => issue.category === "formula-firewall")).toBe(false);
  });

  it("uses uploaded values for type inference and output preview", () => {
    const analysis = runEnterpriseAnalysis([
      file("Model.qvs", ".qvs", script),
      file("customers.csv", ".csv", "CustomerID,CustomerName,Country,CustomerCategory\n1,Asha,IN,Retail\n2,Bala,US,Enterprise\n"),
      file("sales.csv", ".csv", "SaleID,CustomerID,Amount\n10,1,100.25\n11,2,200.50\n"),
    ]);

    expect(analysis.columnTypeMeta.Sales.Amount.source).toBe("Uploaded data sample");
    expect(analysis.columnTypes.Sales.Amount).toBe("Decimal Number");
    expect(analysis.tablePreviews.Sales.sourceRows).toHaveLength(2);
    expect(analysis.tablePreviews.Sales.outputRows[0]).toMatchObject({ CustomerName: "Asha", Country: "IN" });
  });

  it("removes attributes copied into the main joined table from the secondary model table", () => {
    const analysis = runEnterpriseAnalysis([
      file("Model.qvs", ".qvs", script),
      file("customers.csv", ".csv", "CustomerID,CustomerName,Country,CustomerCategory\n1,Asha,IN,Retail\n"),
      file("sales.csv", ".csv", "SaleID,CustomerID,Amount\n10,1,100.25\n"),
    ]);

    expect(analysis.profiles.Customers.fields).toEqual(expect.arrayContaining(["CustomerID", "CustomerCategory"]));
    expect(analysis.profiles.Customers.fields).not.toContain("CustomerName");
    expect(analysis.profiles.Customers.fields).not.toContain("Country");
    expect(analysis.profiles.Sales.fields).toEqual(expect.arrayContaining(["CustomerName", "Country"]));
  });
});
