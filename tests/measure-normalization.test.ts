import { describe, expect, it } from "vitest";
import { normalizeModelMeasures } from "../src/lib/migration/model/MeasureNormalization";
import type { PowerBiTable } from "../src/lib/migration/model";

function table(name: string, columns: string[], measures: Array<{ id: string; name: string; expression: string; sourceExpressionId?: string }>): PowerBiTable {
  return {
    id: `TBL-${name}`,
    name,
    sourceName: name,
    queryName: name,
    kind: "fact",
    hidden: false,
    columns: columns.map((column) => ({ id: `COL-${name}-${column}`, name: column, sourceName: column, dataType: "double", hidden: false, isKey: false })),
    measures: measures.map((measure) => ({ ...measure, homeTable: name, hidden: false, approved: true, status: "approved" })),
    hierarchies: [],
    sourceLineage: [],
    warnings: [],
  };
}

describe("measure normalization", () => {
  it("renames a measure that conflicts with a column and assigns a display folder", () => {
    const result = normalizeModelMeasures([table("Employees", ["Salary"], [{ id: "M1", name: "Salary", expression: "SUM('Employees'[Salary])" }])]);
    const measure = result.tables[0].measures[0];
    expect(measure.name).toBe("Total Salary");
    expect(measure.displayFolder).toBe("Qlik Measures\\Employees\\Converted Measures");
  });

  it("consolidates exact DAX duplicates and retains every source expression id", () => {
    const result = normalizeModelMeasures([
      table("Sales", ["Amount"], [
        { id: "M1", name: "Revenue", expression: "SUM('Sales'[Amount])", sourceExpressionId: "EXP-1" },
        { id: "M2", name: "Total Revenue", expression: " SUM ( 'Sales'[Amount] ) ", sourceExpressionId: "EXP-2" },
      ]),
    ]);
    expect(result.tables[0].measures).toHaveLength(1);
    expect(result.removedDuplicateCount).toBe(1);
    expect(result.tables[0].measures[0].sourceExpressionIds).toEqual(expect.arrayContaining(["EXP-1", "EXP-2"]));
  });

  it("makes different measures with the same name model-wide unique", () => {
    const result = normalizeModelMeasures([
      table("Sales", ["Amount"], [{ id: "M1", name: "Value", expression: "SUM('Sales'[Amount])" }]),
      table("Budget", ["Amount"], [{ id: "M2", name: "Value", expression: "AVERAGE('Budget'[Amount])" }]),
    ]);
    const names = result.tables.flatMap((item) => item.measures.map((measure) => measure.name));
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names).toContain("Value");
    expect(names.some((name) => name.includes("Budget"))).toBe(true);
  });
  it("keeps every custom category under the standard Qlik Measures folder hierarchy", () => {
    const source = table("Sales", ["Amount"], [{ id: "M1", name: "Revenue", expression: "SUM('Sales'[Amount])" }]);
    source.measures[0].displayFolder = "QVW/Executive Overview";
    const measure = normalizeModelMeasures([source]).tables[0].measures[0];
    expect(measure.displayFolder).toBe("Qlik Measures\\Sales\\QVW\\Executive Overview");
  });

  it("avoids a second column collision when the aggregate-friendly name is also a column", () => {
    const result = normalizeModelMeasures([table("Employees", ["Salary", "Total Salary"], [{ id: "M1", name: "Salary", expression: "SUM('Employees'[Salary])" }])]);
    const measure = result.tables[0].measures[0];
    expect(["salary", "total salary"]).not.toContain(measure.name.toLowerCase());
    expect(measure.expression).toBe("SUM('Employees'[Salary])");
  });

});
