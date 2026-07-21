import { describe, expect, it } from "vitest";
import {
  applySmartModelRecommendations,
  recommendTableKey,
  validatePowerBiModel,
  type PowerBiModelState,
  type PowerBiRelationship,
  type PowerBiTable,
} from "../src/lib/migration/model";

const customers: PowerBiTable = {
  id: "customers",
  name: "Customers",
  sourceName: "Customers",
  kind: "dimension",
  hidden: false,
  columns: [
    { id: "customer-id", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: false },
    { id: "customer-name", name: "CustomerName", sourceName: "CustomerName", dataType: "string", hidden: false, isKey: false },
  ],
  measures: [], hierarchies: [], sourceLineage: [], warnings: [], sampleRowCount: 2,
};
customers.columns[0].distinctCount = 2;
customers.columns[0].nullPercentage = 0;

const sales: PowerBiTable = {
  id: "sales",
  name: "Sales",
  sourceName: "Sales",
  kind: "fact",
  hidden: false,
  columns: [
    { id: "sales-customer", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: true },
    { id: "sales-employee", name: "EmployeeID", sourceName: "EmployeeID", dataType: "int64", hidden: false, isKey: true },
    { id: "sales-amount", name: "SalesAmount", sourceName: "SalesAmount", dataType: "double", hidden: false, isKey: false },
  ],
  measures: [], hierarchies: [], sourceLineage: [], warnings: [],
};

const relationship: PowerBiRelationship = {
  id: "rel-customer-sales",
  fromTableId: customers.id,
  fromColumnId: "customer-id",
  toTableId: sales.id,
  toColumnId: "sales-customer",
  cardinality: "one-to-many",
  crossFilterDirection: "single",
  active: false,
  source: "inferred",
  confidence: 95,
  evidence: ["Matching key names", "Compatible data types"],
  riskLevel: "low",
  userApproved: false,
  validationMessages: [],
};

function model(): PowerBiModelState {
  return {
    id: "model",
    projectName: "Test",
    generatedAt: new Date().toISOString(),
    version: "2.1",
    viewMode: "powerbi",
    tables: [customers, sales],
    relationships: [relationship],
    originalQlikAssociations: [],
    layout: {},
    diagnostics: [],
    visualBindings: [],
    readiness: "not-ready",
    blockingErrorCount: 0,
    warningCount: 0,
    expressionArtifactIds: [],
  };
}

describe("smart Power BI model engine", () => {
  it("does not treat fact foreign keys as the fact row identifier", () => {
    expect(recommendTableKey(sales, [relationship]).columnId).toBeNull();
  });

  it("recommends the one-side dimension key", () => {
    expect(recommendTableKey(customers, [relationship]).columnId).toBe("customer-id");
  });

  it("normalizes duplicate fact keys and activates a safe high-confidence relationship", () => {
    const result = applySmartModelRecommendations(model()).model;
    expect(result.tables.find((table) => table.id === "sales")?.columns.filter((column) => column.isKey)).toHaveLength(0);
    expect(result.tables.find((table) => table.id === "customers")?.columns.find((column) => column.id === "customer-id")?.isKey).toBe(true);
    expect(result.relationships[0].active).toBe(true);
    expect(result.relationships[0].userApproved).toBe(true);
  });

  it("blocks any model that still contains multiple keys in one table", () => {
    const checked = validatePowerBiModel(model());
    expect(checked.diagnostics.some((item) => item.code === "MULTIPLE_TABLE_KEYS")).toBe(true);
  });
});
