import { describe, expect, it } from "vitest";
import { runEnterpriseAnalysis, type ProjectFile } from "../src/lib/migration/enterprise-parser";
import { collectRepairIssues, repairEnterpriseLineage } from "../src/lib/migration/autofix";
import { repairDaxDependencies } from "../src/lib/migration/dax/DaxDependencyRepair";
import type { PowerBiModelState, PowerBiTable } from "../src/lib/migration/model";

function qvs(content: string): ProjectFile {
  return { path: "LoadScript.qvs", ext: ".qvs", size: content.length, isText: true, content, note: "" };
}

function model(tables: PowerBiTable[], diagnostics: PowerBiModelState["diagnostics"] = []): PowerBiModelState {
  return {
    id: "model",
    projectName: "Lineage",
    generatedAt: new Date().toISOString(),
    version: "5",
    viewMode: "powerbi",
    buildMode: "automatic",
    tables,
    relationships: [],
    originalQlikAssociations: [],
    layout: {},
    diagnostics,
    visualBindings: [],
    readiness: diagnostics.length ? "not-ready" : "ready",
    blockingErrorCount: diagnostics.length,
    warningCount: 0,
    expressionArtifactIds: [],
  };
}

function table(name: string, fields: string[]): PowerBiTable {
  return {
    id: `T-${name}`,
    name,
    sourceName: name,
    kind: /calendar/i.test(name) ? "date" : /sales/i.test(name) ? "fact" : "unknown",
    hidden: false,
    columns: fields.map((field) => ({ id: `C-${name}-${field}`, name: field, sourceName: field, dataType: "string", hidden: false, isKey: false })),
    measures: [],
    hierarchies: [],
    sourceLineage: [],
    warnings: [],
  };
}

describe("live auto-fix, lineage intelligence and exact navigation", () => {
  it("creates a supported, defensively typed Qlik variable host", () => {
    const analysis = runEnterpriseAnalysis([qvs("SET vTaxRate = 200; Sales: LOAD Amount FROM [Sales.csv];")]);
    expect(analysis.columnTypes["Qlik Variables"]?._MeasureHost).toBe("Whole Number");
    expect(analysis.mQueries["Qlik Variables"]).toContain("ReviewedTypeConversions");
    expect(analysis.mQueries["Qlik Variables"]).toContain("Int64.From(_)");
    expect(analysis.validation.issues.some((issue) => issue.objectName === "Qlik Variables._MeasureHost")).toBe(false);
  });

  it("repairs Calendar[Currency] to the unique lineage-equivalent Sales[CurrencyCode]", () => {
    const calendar = table("Calendar", ["Date"]);
    const sales = table("Sales", ["Date", "CurrencyCode", "Amount"]);
    sales.measures.push({
      id: "M-Sales",
      name: "Sales",
      expression: "CALCULATE(SUM('Sales'[Amount]), 'Calendar'[Currency] = \"USD\")",
      homeTable: "Sales",
      hidden: false,
      approved: true,
      status: "automatic",
      displayFolder: "Qlik Measures\\Sales",
    });
    const result = repairDaxDependencies([calendar, sales]);
    const repaired = result.tables.find((item) => item.name === "Sales")!.measures[0].expression;
    expect(repaired).toContain("'Sales'[CurrencyCode]");
    expect(repaired).not.toContain("'Calendar'[Currency]");
    expect(result.repairs[0].resolvedTable).toBe("Sales");
  });

  it("restores a field into the requested final table when Qlik join lineage proves it belongs there", () => {
    const analysis = runEnterpriseAnalysis([qvs(`
Sales:
LOAD Date, Currency, Amount FROM [Sales.csv];
Calendar:
LOAD Date FROM [Calendar.csv];
LEFT JOIN (Calendar)
LOAD Date, Currency RESIDENT Sales;
`)], {
      "Sales.csv": { mappedRef: "Sales.csv", connectorType: "CSV/Text", status: "Mapped" },
      "Calendar.csv": { mappedRef: "Calendar.csv", connectorType: "CSV/Text", status: "Mapped" },
    });
    analysis.profiles.Calendar.fields = analysis.profiles.Calendar.fields.filter((field) => field !== "Currency");
    delete analysis.columnTypes.Calendar.Currency;
    delete analysis.columnTypeMeta.Calendar.Currency;
    analysis.finalTables = Object.values(analysis.profiles).filter((profile) => profile.status === "generated");
    const result = repairEnterpriseLineage(analysis, model([], [{
      id: "M-MISSING",
      severity: "blocking-error",
      area: "measure",
      objectId: "M1",
      objectName: "Sales by Currency",
      code: "DAX_DEPENDENCY_MISSING",
      message: "The measure 'Sales by Currency' references missing object 'Calendar[Currency]'.",
      recommendation: "Repair lineage.",
    }]), {});
    expect(result.changed).toBe(true);
    expect(result.analysis.profiles.Calendar.fields).toContain("Currency");
    expect(result.analysis.columnTypeMeta.Calendar.Currency.source).toBe("AI lineage backtracking");
    expect(result.analysis.mQueries.Calendar).toContain("Currency");
  });

  it("routes a data-type issue to the exact table and column editor", () => {
    const issue = collectRepairIssues({
      validation: { issues: [{ severity: "Error", area: "Data Types", objectName: "Qlik Variables._MeasureHost", message: "Unsupported Power BI data type: Integer", recommendation: "Choose a supported type." }] },
    } as any, null)[0];
    expect(issue.target.route).toBe("/app/power-query");
    expect(issue.target.tableName).toBe("Qlik Variables");
    expect(issue.target.fieldName).toBe("_MeasureHost");
    expect(issue.target.editor).toBe("data-type");
  });
});
