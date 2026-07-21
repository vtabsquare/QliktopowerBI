import { describe, expect, it } from "vitest";
import {
  autoMapSourceRows,
  collectRepairIssues,
  repairPowerBiModel,
} from "../src/lib/migration/autofix";
import type { PowerBiModelState, PowerBiTable } from "../src/lib/migration/model";

const dimension: PowerBiTable = {
  id: "customers", name: "Customers", sourceName: "Customers", kind: "dimension", hidden: false,
  columns: [{ id: "customers-id", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: false }],
  measures: [], hierarchies: [], sourceLineage: [], warnings: [],
};

const fact: PowerBiTable = {
  id: "sales", name: "Sales", sourceName: "Sales", kind: "fact", hidden: false,
  columns: [
    { id: "sales-customer", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: true },
    { id: "sales-employee", name: "EmployeeID", sourceName: "EmployeeID", dataType: "int64", hidden: false, isKey: true },
    { id: "sales-salary", name: "Salary", sourceName: "Salary", dataType: "double", hidden: false, isKey: false },
  ],
  measures: [
    { id: "m1", name: "Salary", expression: "SUM('Sales'[Salary])", homeTable: "Sales", hidden: false, approved: true, status: "converted" },
    { id: "m2", name: "Salary Copy", expression: "SUM('Sales'[Salary])", homeTable: "Sales", hidden: false, approved: true, status: "converted" },
  ],
  hierarchies: [], sourceLineage: [], warnings: [],
};

function model(): PowerBiModelState {
  return {
    id: "model", projectName: "Auto Fix", generatedAt: new Date().toISOString(), version: "3", viewMode: "powerbi",
    tables: [dimension, fact],
    relationships: [
      { id: "r1", fromTableId: "customers", fromColumnId: "customers-id", toTableId: "sales", toColumnId: "sales-customer", cardinality: "one-to-many", crossFilterDirection: "single", active: false, source: "inferred", confidence: 98, evidence: ["test"], riskLevel: "low", userApproved: false, validationMessages: [] },
      { id: "r2", fromTableId: "customers", fromColumnId: "customers-id", toTableId: "sales", toColumnId: "sales-customer", cardinality: "one-to-many", crossFilterDirection: "single", active: false, source: "inferred", confidence: 70, evidence: ["duplicate"], riskLevel: "medium", userApproved: false, validationMessages: [] },
    ],
    originalQlikAssociations: [], layout: {}, diagnostics: [], visualBindings: [], readiness: "not-ready", blockingErrorCount: 0, warningCount: 0, expressionArtifactIds: [],
  };
}

describe("AI auto-fix engine", () => {
  it("maps an unresolved QVD reference to the one matching uploaded physical source", () => {
    const result = autoMapSourceRows([
      { originalRef: "lib://Data/Sales.qvd", mappedRef: "lib://Data/Sales.qvd", connectorType: "QVD - map to supported source", status: "Needs review", notes: "", table: "Sales", sourceRole: "source", bypassQvd: false, effectiveRef: "", qvdProducerTable: "" },
    ], [{ name: "Sales.csv", path: "data/Sales.csv", extension: ".csv" }]);
    expect(result.rows[0].status).toBe("Mapped");
    expect(result.rows[0].mappedRef).toBe("data/Sales.csv");
    expect(result.actions[0].status).toBe("fixed");
  });

  it("normalizes table keys, duplicate relationships and duplicate/colliding measures", () => {
    const result = repairPowerBiModel(model());
    const sales = result.model.tables.find((table) => table.name === "Sales")!;
    expect(sales.columns.filter((column) => column.isKey)).toHaveLength(0);
    expect(result.model.relationships.filter((relationship) => !relationship.deleted)).toHaveLength(1);
    expect(sales.measures).toHaveLength(1);
    expect(sales.measures[0].name).toBe("Total Salary");
    expect(sales.measures[0].displayFolder).toContain("Qlik Measures\\Sales");
    expect(result.model.blockingErrorCount).toBe(0);
  });

  it("routes source, DAX and relationship issues to their exact editors", () => {
    const issues = collectRepairIssues({
      validation: { issues: [
        { severity: "Error", area: "Source Mapping", objectName: "Sales.qvd", message: "Mapping missing", recommendation: "Map source" },
        { severity: "Error", area: "DAX", objectName: "Budget Variance", message: "Missing dependency", recommendation: "Map column" },
      ] },
    } as any, {
      ...model(),
      diagnostics: [{ id: "rel-error", severity: "blocking-error", area: "relationship", objectId: "r1", objectName: "Customers to Sales", code: "RELATIONSHIP_TYPE_MISMATCH", message: "Types differ", recommendation: "Align types" }],
    });
    expect(issues.find((issue) => issue.objectName === "Sales.qvd")?.target.route).toBe("/app/analysis");
    expect(issues.find((issue) => issue.objectName === "Budget Variance")?.target.route).toBe("/app/dax-measures");
    expect(issues.find((issue) => issue.objectName === "Customers to Sales")?.target.tab).toBe("relationships");
  });
});
