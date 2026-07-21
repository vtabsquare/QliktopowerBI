import { describe, expect, it } from "vitest";
import {
  applyDataTypeOverrides,
  applyReviewedTypesToMQuery,
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

describe("enterprise-parser section 8 authoritative Power Query types", () => {
  it("keeps Table.TransformColumnTypes as the final Power Query operation", () => {
    const analysis = runEnterpriseAnalysis([
      qvs(`
Sales:
LOAD ProductID, OrderDate, Quantity, Amount, IsActive
FROM [Sales.csv];
`),
    ]);
    const updated = applyDataTypeOverrides(analysis, {
      "Sales.ProductID": "Integer",
      "Sales.OrderDate": "Date",
      "Sales.Quantity": "Decimal Number",
      "Sales.Amount": "Currency / Fixed Decimal",
      "Sales.IsActive": "True/False",
    });

    const m = updated.mQueries.Sales;
    expect(m).toContain("QLIK2PBI REVIEWED TYPES BEGIN");
    expect(m).toContain("ReviewedTypeConversions = Table.TransformColumnTypes");
    expect(m).toContain("Table.TransformColumns(");
    expect(m).not.toContain("QLIK2PBI_ExistingReviewedColumns");
    expect(m).toContain("ReviewedTypeConversions = Table.TransformColumnTypes");
    expect(m).toContain('{"ProductID", Int64.Type}');
    expect(m).toContain('{"OrderDate", type date}');
    expect(m).toContain('{"Quantity", type number}');
    expect(m).toContain('{"Amount", Currency.Type}');
    expect(m).toContain('{"IsActive", type logical}');
    expect(m).toMatch(/in\s+ReviewedTypeConversions\s*$/i);
    expect(updated.validation.issues.some((issue) => issue.area === "Data Types" && issue.objectName === "Sales")).toBe(false);
  });

  it("replaces an existing reviewed-type wrapper instead of nesting duplicates", () => {
    const base = `let\n    Source = #table({"Amount"}, {{"12.50"}})\nin\n    Source`;
    const first = applyReviewedTypesToMQuery(base, { Amount: "Decimal Number" });
    const second = applyReviewedTypesToMQuery(first, { Amount: "Whole Number" });

    expect((second.match(/QLIK2PBI REVIEWED TYPES BEGIN/g) || []).length).toBe(1);
    expect(second).toContain("amount:Whole Number");
    expect(second).toContain('{"Amount", Int64.Type}');
    expect(second).not.toContain("amount:Decimal Number");
  });

  it("supports Any as an explicit final Power Query type", () => {
    const result = applyReviewedTypesToMQuery(
      `let\n    Source = #table({"Flexible"}, {{1}})\nin\n    Source`,
      { Flexible: "Any" },
    );
    expect(result).toContain('{"Flexible", each _, type any}');
    expect(result).toContain('{"Flexible", type any}');
  });

  it("applies reviewed types after composite-key construction", () => {
    const analysis = runEnterpriseAnalysis([
      qvs(`
Orders:
LOAD CustomerID, RegionCode, Amount
FROM [Orders.csv];

Customers:
LOAD CustomerID, RegionCode, CustomerName
FROM [Customers.csv];

LEFT JOIN (Orders)
LOAD CustomerID, RegionCode, CustomerName
RESIDENT Customers;
`),
    ]);
    const updated = applyDataTypeOverrides(analysis, {
      "Orders.Amount": "Currency",
    });
    const orders = updated.mQueries.Orders;
    expect(orders).toContain("__Key_CustomerID_RegionCode");
    expect(orders.indexOf("__Key_CustomerID_RegionCode")).toBeLessThan(orders.lastIndexOf("ReviewedTypeConversions"));
    expect(orders).toMatch(/in\s+ReviewedTypeConversions\s*$/i);
  });
});

describe("section 8 live UI type precedence", () => {
  it("uses the latest columnTypes map instead of a stale execution-plan snapshot", () => {
    const analysis = runEnterpriseAnalysis([
      qvs(`
Sales:
LOAD ProductID, Amount
FROM [Sales.csv];
`),
    ]);

    // Simulate an execution plan retained by the UI before the user changes
    // the datatype. applyDataTypeOverrides must regenerate M from the live UI
    // map, not from this older plan snapshot.
    analysis.executionPlans.Sales.reviewedTypes.Amount = "Text";

    const updated = applyDataTypeOverrides(analysis, {
      "Sales.Amount": "Currency / Fixed Decimal",
    });

    expect(updated.columnTypes.Sales.Amount).toBe("Currency / Fixed Decimal");
    expect(updated.executionPlans.Sales.reviewedTypes.Amount).toBe("Currency / Fixed Decimal");
    expect(updated.mQueries.Sales).toContain('{"Amount", Currency.Type}');
    expect(updated.mQueries.Sales).toContain("amount:Currency / Fixed Decimal");
    expect(updated.mQueries.Sales).not.toContain("amount:Text");
    expect(updated.mQueries.Sales).toMatch(/in\s+ReviewedTypeConversions\s*$/i);
  });
});
