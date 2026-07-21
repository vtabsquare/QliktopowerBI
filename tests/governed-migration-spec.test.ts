import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  runEnterpriseAnalysis,
  revalidateEnterpriseAnalysis,
  applyModelBuildMode,
  type ProjectFile,
} from "@/lib/migration/enterprise-parser";
import { deterministicIssueKey } from "@/lib/migration/autofix/AutoFixEngine";
import { buildPowerBiModel } from "@/lib/migration/model";
import { generatePbipZip } from "@/lib/migration/pbip-generator";

function qvs(content: string): ProjectFile {
  return {
    path: "Model.qvs",
    ext: ".qvs",
    size: content.length,
    isText: true,
    content,
    note: "",
  };
}

const sharedFieldsWithoutJoin = `
Orders:
LOAD CustomerID, RegionCode, OrderID, Amount
FROM [orders.csv];

Customers:
LOAD CustomerID, RegionCode, CustomerName
FROM [customers.csv];
`;

const explicitCompositeJoin = `
Orders:
LOAD CustomerID, RegionCode, OrderID, Amount
FROM [orders.csv];

Customers:
LOAD CustomerID, RegionCode, CustomerName, CustomerGroup, CustomerCategory
FROM [customers.csv];

LEFT JOIN (Orders)
LOAD CustomerID, RegionCode, CustomerName, CustomerGroup
RESIDENT Customers;

LEFT JOIN (Orders)
LOAD CustomerID, RegionCode, CustomerName, CustomerGroup
RESIDENT Customers;
`;

describe("governed backend-first migration specification", () => {
  it("does not create a composite key merely because tables share column names", () => {
    const analysis = runEnterpriseAnalysis([qvs(sharedFieldsWithoutJoin)]);
    expect(analysis.reconstruction?.joinReconstructions).toHaveLength(0);
    expect(analysis.reconstruction?.compositeKeys).toHaveLength(0);
  });

  it("creates one explicit multi-column key and de-duplicates repeated JOIN statements", () => {
    const analysis = runEnterpriseAnalysis([qvs(explicitCompositeJoin)]);
    const plan = analysis.reconstruction!;

    expect(plan.joinReconstructions).toHaveLength(1);
    expect(plan.joinReconstructions[0].keyColumns).toEqual(["CustomerID", "RegionCode"]);
    expect(plan.compositeKeys).toHaveLength(1);

    const key = plan.compositeKeys[0];
    expect(analysis.mQueries.Orders).toContain("Table.NestedJoin");
    expect(analysis.mQueries.Orders).toContain(key.keyColumn);
    expect(analysis.mQueries.Customers).toContain(key.keyColumn);
    expect((analysis.mQueries.Orders.match(/Table\.NestedJoin/g) || [])).toHaveLength(1);
    expect(analysis.mQueries.Orders).toContain("<NULL>");
    expect(analysis.mQueries.Orders).toContain("Text.Replace");
  });

  it("uses deterministic validation issue identity and replacement-friendly revalidation", () => {
    const first = deterministicIssueKey({
      category: "DAX",
      objectType: "measure",
      objectId: "rolling-sales",
      property: "expression",
      dependencyId: "Calendar.Currency",
    });
    const second = deterministicIssueKey({
      category: "DAX",
      objectType: "measure",
      objectId: "rolling-sales",
      property: "expression",
      dependencyId: "Calendar.Currency",
    });
    expect(first).toBe(second);

    const analysis = runEnterpriseAnalysis([qvs(sharedFieldsWithoutJoin)]);
    const refreshed = revalidateEnterpriseAnalysis(analysis);
    expect(refreshed.validation.issues).not.toBe(analysis.validation.issues);
    expect(refreshed.validation.errorCount).toBe(
      refreshed.validation.issues.filter((issue) => /error|fail/i.test(issue.severity)).length,
    );
  });

  it("re-plans the backend when the user changes the model-design mode", () => {
    const analysis = runEnterpriseAnalysis([qvs(explicitCompositeJoin)]);
    const equivalent = applyModelBuildMode(analysis, "qlik-equivalent");
    const optimized = applyModelBuildMode(analysis, "powerbi-optimized");
    const review = applyModelBuildMode(analysis, "desktop-review");

    expect(equivalent.reconstruction?.modelBuildMode).toBe("qlik-equivalent");
    expect(optimized.reconstruction?.modelBuildMode).toBe("powerbi-optimized");
    expect(review.reconstruction?.modelBuildMode).toBe("desktop-review");
    expect(optimized.relationships.some((relationship) => relationship.active)).toBe(true);
    expect(review.relationships.every((relationship) => relationship.active === false)).toBe(true);
  });

  it("exports the complete governed audit trail in the PBIP migration folder", async () => {
    const analysis = runEnterpriseAnalysis([qvs(explicitCompositeJoin)]);
    const model = buildPowerBiModel(analysis, null, null, "Governed Migration");
    const blob = await generatePbipZip(analysis, "GovernedMigration", {
      powerBiModel: model,
      preferMicrosoftTom: false,
    });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const required = [
      "table-dependency-graph.json",
      "field-lineage.json",
      "join-reconstruction.json",
      "composite-key-decisions.json",
      "table-classification.json",
      "dax-conversion-decisions.json",
      "validation-results.json",
      "migration-debug.log",
    ];
    for (const name of required) {
      expect(archive.file(`GovernedMigration/Migration/${name}`), name).toBeTruthy();
    }
  });
});
