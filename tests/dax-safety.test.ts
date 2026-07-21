import { describe, expect, it } from "vitest";
import { DaxTranslator, repairDaxDependencies, rewriteQlikColourFunctions } from "../src/lib/migration/dax";
import type { PowerBiTable } from "../src/lib/migration/model";

const context = {
  homeTable: "Qlik Variables",
  fieldToTable: {},
  variables: {},
};

function table(name: string, columns: string[], measureExpression: string): PowerBiTable {
  return {
    id: `TBL-${name}`,
    name,
    sourceName: name,
    kind: name === "Finance" ? "fact" : "disconnected",
    hidden: false,
    columns: columns.map((column) => ({
      id: `COL-${name}-${column}`,
      name: column,
      sourceName: column,
      dataType: "double",
      hidden: false,
      isKey: false,
    })),
    measures: measureExpression ? [{
      id: `MEA-${name}`,
      name: name === "Finance" ? "Budget Variance" : "vColorPositive",
      expression: measureExpression,
      homeTable: name,
      displayFolder: `Qlik Measures\\${name}\\Converted Measures`,
      hidden: false,
      approved: true,
      status: "automatic",
    }] : [],
    hierarchies: [],
    sourceLineage: [],
    warnings: [],
  };
}

describe("DAX safety and dependency repair", () => {
  it("converts Qlik RGB to a Power BI hexadecimal colour", () => {
    const result = new DaxTranslator().translate("RGB(0, 128, 0)", context);
    expect(result.dax).toBe('"#008000"');
    expect(result.dax).not.toMatch(/\bRGB\s*\(/i);
  });

  it("repairs RGB calls that survived an older saved workspace", () => {
    expect(rewriteQlikColourFunctions("RGB(255, 0, 16)")).toBe('"#FF0010"');
  });

  it("maps a missing ActualAmount reference to the unique Amount column", () => {
    const result = repairDaxDependencies([
      table("Finance", ["Amount", "BudgetAmount"], "SUM('Finance'[ActualAmount]) - SUM('Finance'[BudgetAmount])"),
    ]);
    expect(result.tables[0].measures[0].expression).toContain("'Finance'[Amount]");
    expect(result.unresolved).toHaveLength(0);
    expect(result.repairs[0].resolvedColumn).toBe("Amount");
  });

  it("leaves ambiguous missing dependencies unresolved so export can block", () => {
    const result = repairDaxDependencies([
      table("Finance", ["ActualValue", "ActualTotal"], "SUM('Finance'[Actual])"),
    ]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.tables[0].measures[0].status).toBe("missing-dependency");
    expect(result.tables[0].measures[0].approved).toBe(false);
  });
});
