import { describe, expect, it } from "vitest";
import { serializeTmdlFolder, validateTomModelSpec, type TomDatabaseSpec } from "../src/lib/migration/tmdl";

function validSpec(): TomDatabaseSpec {
  return {
    id: "db", name: "Test", compatibilityLevel: 1604,
    model: {
      id: "model", name: "Model", culture: "en-US", sourceQueryCulture: "en-US", defaultPowerBIDataSourceVersion: "powerBI_V3",
      annotations: [], expressions: [], relationships: [],
      tables: [{
        id: "table", name: "Sales", columns: [{ id: "column", kind: "data", name: "Amount", dataType: "double", sourceColumn: "Amount", summarizeBy: "sum" }],
        measures: [{ id: "measure", name: "Total Sales", expression: "SUM('Sales'[Amount])", displayFolder: "Qlik Measures\\Sales\\Converted Measures" }], hierarchies: [],
        partitions: [{ id: "partition", name: "Sales-partition", mode: "import", sourceType: "m", expression: "let Source = #table({\"Amount\"}, {{1}}) in Source" }],
      }],
    },
  };
}

describe("TMDL validation and serialization", () => {
  it("serializes data columns and measures as distinct TOM object types", () => {
    const result = serializeTmdlFolder(validSpec());
    expect(result.diagnostics.some((item) => item.severity === "blocking-error")).toBe(false);
    const table = result.files["tables/Sales.tmdl"];
    expect(table).toContain("column Amount");
    expect(table).toContain("sourceColumn: \"Amount\"");
    expect(table).toContain("measure 'Total Sales'");
  });

  it("blocks an empty calculated-column expression", () => {
    const spec = validSpec();
    spec.model.tables[0].columns.push({ id: "calc", kind: "calculated", name: "Margin", dataType: "double", expression: "" });
    expect(validateTomModelSpec(spec).some((item) => item.code === "TMDL_CALCULATED_COLUMN_EXPRESSION_MISSING")).toBe(true);
  });
  it("blocks multiple IsKey columns in one table", () => {
    const spec = validSpec();
    spec.model.tables[0].columns[0].isKey = true;
    spec.model.tables[0].columns.push({ id: "second-key", kind: "data", name: "CustomerID", dataType: "int64", sourceColumn: "CustomerID", isKey: true });
    expect(validateTomModelSpec(spec).some((item) => item.code === "TMDL_MULTIPLE_TABLE_KEYS")).toBe(true);
  });

});
