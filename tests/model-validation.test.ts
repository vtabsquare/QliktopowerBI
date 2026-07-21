import { describe, expect, it } from "vitest";
import { validatePowerBiModel, validateRelationship, type PowerBiModelState, type PowerBiTable } from "../src/lib/migration/model";

const tables: PowerBiTable[] = [
  {
    id: "TBL-dim", name: "DimCustomer", sourceName: "DimCustomer", kind: "dimension", hidden: false,
    columns: [{ id: "COL-dim-id", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: true }],
    measures: [], hierarchies: [], sourceLineage: [], warnings: [],
  },
  {
    id: "TBL-fact", name: "FactSales", sourceName: "FactSales", kind: "fact", hidden: false,
    columns: [{ id: "COL-fact-id", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: false }],
    measures: [], hierarchies: [], sourceLineage: [], warnings: [],
  },
];

const relationship = {
  id: "REL-1", fromTableId: "TBL-dim", fromColumnId: "COL-dim-id", toTableId: "TBL-fact", toColumnId: "COL-fact-id",
  cardinality: "one-to-many" as const, crossFilterDirection: "single" as const, active: true,
  source: "manual" as const, confidence: 100, evidence: ["test"], riskLevel: "low" as const, userApproved: true, validationMessages: [],
};

describe("relationship validation", () => {
  it("accepts compatible one-to-many relationships", () => {
    expect(validateRelationship(relationship, tables, []).filter((item) => item.severity === "blocking-error")).toHaveLength(0);
  });

  it("blocks missing columns", () => {
    const invalid = { ...relationship, toColumnId: "missing" };
    expect(validateRelationship(invalid, tables, []).some((item) => item.code === "RELATIONSHIP_COLUMN_MISSING")).toBe(true);
  });

  it("calculates model readiness", () => {
    const model: PowerBiModelState = {
      id: "MODEL", projectName: "Test", generatedAt: new Date().toISOString(), version: "2", viewMode: "powerbi",
      tables, relationships: [relationship], originalQlikAssociations: [], layout: {}, diagnostics: [], visualBindings: [],
      readiness: "not-ready", blockingErrorCount: 0, warningCount: 0, expressionArtifactIds: [],
    };
    expect(validatePowerBiModel(model).readiness).not.toBe("not-ready");
  });
});
