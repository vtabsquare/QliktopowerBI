import { describe, expect, it } from "vitest";
import { collectRepairIssues } from "../src/lib/migration/autofix";
import type { PowerBiModelState } from "../src/lib/migration/model";

function model(): PowerBiModelState {
  return {
    projectName: "Test",
    tables: [],
    relationships: [],
    originalRelationships: [],
    visualBindings: [],
    diagnostics: [{
      id: "M1-MISSING-Calendar-Currency",
      severity: "blocking-error",
      area: "measure",
      objectId: "M1",
      objectName: "Sales",
      code: "DAX_DEPENDENCY_MISSING",
      message: "The measure 'Sales' references missing object 'Calendar[Currency]'.",
      recommendation: "Map the missing field.",
    }],
    layout: {},
    viewMode: "powerbi",
    buildMode: "automatic",
    readiness: "not-ready",
    blockingErrorCount: 1,
    warningCount: 0,
  };
}

describe("exact repair navigation", () => {
  it("routes a missing DAX dependency to the exact measure editor and dependency", () => {
    const issue = collectRepairIssues(null, model())[0];
    expect(issue.target.route).toBe("/app/dax-measures");
    expect(issue.target.objectId).toBe("M1");
    expect(issue.target.objectName).toBe("Sales");
    expect(issue.target.tableName).toBe("Calendar");
    expect(issue.target.fieldName).toBe("Currency");
    expect(issue.target.editor).toBe("dax");
  });
});
