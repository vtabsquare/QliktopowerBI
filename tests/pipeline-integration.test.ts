import { describe, expect, it } from "vitest";
import {
  applyDataTypeOverrides,
  applyReviewedTypesToMQuery,
  runEnterpriseAnalysis,
  type ProjectFile,
} from "../src/lib/migration/enterprise-parser";
import { autoAssignSourceAndEtl, type ExtractedFile } from "../src/components/migration/MultiFileDropzone";

function qvsFile(content: string): ProjectFile {
  return {
    path: "scripts/Sales.qvs",
    ext: ".qvs",
    size: content.length,
    isText: true,
    content,
    note: "",
  };
}

describe("single-upload migration pipeline", () => {
  it("persists reviewed data types into the generated Power Query and semantic model", () => {
    const analysis = runEnterpriseAnalysis([
      qvsFile(`
Sales:
LOAD ProductID, EmployeeID, OrderDate, Quantity
FROM [lib://Data/Sales.csv]
(txt, utf8, embedded labels, delimiter is ',');
`),
    ]);

    const updated = applyDataTypeOverrides(analysis, {
      "Sales.ProductID": "Whole Number",
      "Sales.EmployeeID": "Whole Number",
      "Sales.OrderDate": "Date",
      "Sales.Quantity": "Decimal Number",
    });

    expect(updated.columnTypes.Sales.ProductID).toBe("Whole Number");
    expect(updated.columnTypes.Sales.OrderDate).toBe("Date");
    expect(updated.mQueries.Sales).toContain("Table.TransformColumns");
    expect(updated.mQueries.Sales).toContain("Table.TransformColumnTypes");
    expect(updated.mQueries.Sales).toContain('"ProductID", each try (if _ = null then null else Int64.From(_))');
    expect(updated.mQueries.Sales).toContain('{"ProductID", Int64.Type}');
    expect(updated.mQueries.Sales).toContain('"OrderDate", each try (if _ = null then null else Date.From(_))');
    expect(updated.mQueries.Sales).toContain('{"OrderDate", type date}');
    expect(updated.mQueries.Sales).toMatch(/in\s+ReviewedTypeConversions\s*$/i);

    const sales = updated.semanticModel.tables.find((table: any) => table.name === "Sales") as any;
    expect(sales.columns.find((column: any) => column.name === "ProductID").data_type).toBe("int64");
    expect(sales.columns.find((column: any) => column.name === "OrderDate").data_type).toBe("dateTime");
  });

  it("appends reviewed data types to optional AI-generated M", () => {
    const result = applyReviewedTypesToMQuery(
      "let\n    Source = #table({\"OrderDate\"}, {{\"2026-01-10\"}})\nin\n    Source",
      { OrderDate: "Date" },
    );
    expect(result).toContain("QLIK2PBI REVIEWED TYPES BEGIN");
    expect(result).toContain("Table.TransformColumns(");
    expect(result).not.toContain("QLIK2PBI_ExistingReviewedColumns");
    expect(result).toContain("ReviewedTypeConversions = Table.TransformColumnTypes");
    expect(result).toContain("Date.From(_)");
    expect(result).toContain('{"OrderDate", type date}');
    expect(result.trim().endsWith("ReviewedTypeConversions")).toBe(true);
  });

  it("assigns extracted LoadScript content without treating XML and CSV data as ETL scripts", () => {
    const files: ExtractedFile[] = [
      { path: "Dashboard-prj/LoadScript.txt", name: "LoadScript.txt", extension: ".txt", sizeKb: 1, text: "Sales: LOAD * FROM [Sales.csv];", parsedAsText: true },
      { path: "Dashboard-prj/CH01.xml", name: "CH01.xml", extension: ".xml", sizeKb: 1, text: "<Chart />", parsedAsText: true },
      { path: "data/Sales.csv", name: "Sales.csv", extension: ".csv", sizeKb: 1, text: "ID,Amount\n1,10", parsedAsText: true },
    ];
    const assigned = autoAssignSourceAndEtl(files);
    expect(assigned.sources.map((file) => file.name)).toEqual(["LoadScript.txt"]);
    expect(assigned.etls.map((file) => file.name)).toEqual(["LoadScript.txt"]);
  });
});
