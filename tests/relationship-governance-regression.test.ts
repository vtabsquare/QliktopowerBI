import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import {
  runEnterpriseAnalysis,
  type ProjectFile,
} from "@/lib/migration/enterprise-parser";
import { parseQvwProject } from "@/lib/migration/qvw/project-parser";
import { buildExpressionInventory } from "@/lib/migration/expression";
import { buildPowerBiModel } from "@/lib/migration/model";
import { buildTomDatabaseSpec } from "@/lib/migration/tmdl/TomModelBuilder";
import type { ExtractedFile } from "@/components/migration/MultiFileDropzone";

beforeAll(() => {
  const window = new JSDOM("<!doctype html><html><body></body></html>").window;
  Object.assign(globalThis, {
    DOMParser: window.DOMParser,
    Document: window.Document,
    Element: window.Element,
  });
});

async function fixture(): Promise<{ extracted: ExtractedFile[]; project: ProjectFile[] }> {
  const data = readFileSync(
    new URL("./fixtures/EnterpriseComplexQlikProject_With_QVW_PRJ_Visuals_Updated.zip", import.meta.url),
  );
  const archive = await JSZip.loadAsync(data);
  const extracted: ExtractedFile[] = [];
  const project: ProjectFile[] = [];
  for (const [path, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const extension = path.includes(".") ? `.${path.split(".").pop()!.toLowerCase()}` : "";
    const parsedAsText = [".xml", ".txt", ".qvs", ".csv", ".json", ".md"].includes(extension);
    const text = parsedAsText ? await entry.async("text") : null;
    const bytes = await entry.async("uint8array");
    extracted.push({
      path,
      name: path.split("/").pop() || path,
      extension,
      sizeKb: bytes.byteLength / 1024,
      text,
      parsedAsText,
    });
    if (parsedAsText) project.push({
      path,
      ext: extension,
      size: bytes.byteLength,
      isText: true,
      content: text || "",
      note: "",
    });
  }
  return { extracted, project };
}

function names(values: Array<{ name: string }>): string[] {
  return values.map((item) => item.name);
}

describe("relationship and post-join model governance regression", () => {
  it("uses the exact materialized JOIN schema and removes moved attributes from child model tables", async () => {
    const { extracted, project } = await fixture();
    const analysis = runEnterpriseAnalysis(project);
    const qvw = parseQvwProject(extracted);
    const inventory = buildExpressionInventory(qvw, null);
    const model = buildPowerBiModel(analysis, inventory, qvw, "Relationship Governance");

    const sales = model.tables.find((table) => table.name === "Sales")!;
    const customers = model.tables.find((table) => table.name === "Customers")!;
    const products = model.tables.find((table) => table.name === "Products")!;

    expect(names(sales.columns)).toEqual(expect.arrayContaining([
      "CustomerID", "CustomerName", "Segment", "Region", "CountryName", "City",
      "ProductID", "ProductName", "Category", "SubCategory", "Brand", "MarginBand",
    ]));
    expect(names(sales.columns)).not.toEqual(expect.arrayContaining([
      "CustomerType", "CountryCode", "Latitude", "Longitude", "CreatedDate",
      "UnitCost", "ListPrice", "StandardMargin", "IsTechnology",
    ]));

    expect(names(customers.columns)).toEqual(expect.arrayContaining([
      "CustomerID", "CountryCode", "Latitude", "Longitude", "CreatedDate", "IsEnterprise",
    ]));
    expect(names(customers.columns)).not.toEqual(expect.arrayContaining([
      "CustomerName", "Segment", "Region", "CountryName", "City",
    ]));

    expect(names(products.columns)).toEqual(expect.arrayContaining([
      "ProductID", "UnitCost", "ListPrice", "StandardMargin", "IsTechnology",
    ]));
    expect(names(products.columns)).not.toEqual(expect.arrayContaining([
      "ProductName", "Category", "SubCategory", "Brand", "MarginBand",
    ]));

    expect(model.tables.some((table) => /^Anonymous_/i.test(table.name))).toBe(false);
    expect(analysis.mQueries.Customers).toContain("RelationshipKey");
    expect(analysis.mQueries.Products).toContain("RelationshipKey");
  });

  it("creates only key relationships and never relates descriptive attributes", async () => {
    const { extracted, project } = await fixture();
    const analysis = runEnterpriseAnalysis(project);
    const qvw = parseQvwProject(extracted);
    const model = buildPowerBiModel(analysis, buildExpressionInventory(qvw, null), qvw, "Key Governance");
    const forbidden = /region|countryname|customername|productname|brand|category|subcategory|department|role/i;

    for (const relationship of model.relationships) {
      const fromTable = model.tables.find((table) => table.id === relationship.fromTableId)!;
      const toTable = model.tables.find((table) => table.id === relationship.toTableId)!;
      const fromColumn = fromTable.columns.find((column) => column.id === relationship.fromColumnId)!;
      const toColumn = toTable.columns.find((column) => column.id === relationship.toColumnId)!;
      expect(`${fromColumn.name} ${toColumn.name}`).not.toMatch(forbidden);
      expect(fromColumn.dataType).toBe(toColumn.dataType);
      if (relationship.active) {
        expect(relationship.crossFilterDirection).toBe("single");
        expect(relationship.cardinality).not.toBe("many-to-many");
      }
    }

    const activePairs = model.relationships.filter((relationship) => relationship.active)
      .map((relationship) => [relationship.fromTableId, relationship.toTableId].sort().join("|"));
    expect(new Set(activePairs).size).toBe(activePairs.length);
  });

  it("converts supported row expressions, previews final joined values and exports no known-invalid DAX", async () => {
    const { extracted, project } = await fixture();
    const analysis = runEnterpriseAnalysis(project);
    const qvw = parseQvwProject(extracted);
    const inventory = buildExpressionInventory(qvw, null);
    const model = buildPowerBiModel(analysis, inventory, qvw, "DAX and M Governance");

    expect(analysis.mQueries.Calendar).toContain("Date.Year");
    expect(analysis.mQueries.Calendar).toContain("Date.Month");
    expect(analysis.mQueries.Calendar).not.toContain("Added_CalendarDate_1 = QLIK2PBI_AddOrReplaceColumn");
    expect(analysis.tablePreviews.Calendar.outputRows[0]).toMatchObject({ Year: 2026, Month: 1 });
    expect(analysis.tablePreviews.Sales.outputRows[0]).toMatchObject({
      CustomerName: "Acme Corp",
      ProductName: "Laptop Pro",
      NetSales: 2300,
      GrossProfit: 900,
    });

    expect(model.diagnostics.filter((diagnostic) => [
      "MEASURE_NAKED_COLUMN_REFERENCE",
      "DAX_DEPENDENCY_MISSING",
      "ONE_SIDE_KEY_HAS_BLANKS",
      "ONE_SIDE_KEY_NOT_UNIQUE",
      "RELATIONSHIP_TYPE_MISMATCH",
    ].includes(diagnostic.code))).toHaveLength(0);

    const spec = buildTomDatabaseSpec(analysis, "RelationshipGovernance", { powerBiModel: model });
    const measureNames = spec.model.tables.flatMap((table) => table.measures?.map((measure) => measure.name) || []);
    expect(measureNames).not.toContain("Rolling Sales");
    const expressions = spec.model.tables.flatMap((table) => table.measures?.map((measure) => measure.expression) || []).join("\n");
    expect(expressions).not.toMatch(/PLACEHOLDER|Manual conversion required|FUNCTION_NOT_MAPPED/i);
  });
});
