import { describe, expect, it } from "vitest";
import { runEnterpriseAnalysis, type ProjectFile } from "@/lib/migration/enterprise-parser";
import { buildTomDatabaseSpec } from "@/lib/migration/tmdl/TomModelBuilder";
import { buildPowerBiModel } from "@/lib/migration/model";
import { generatePbipZip } from "@/lib/migration/pbip-generator";
import JSZip from "jszip";

function projectFile(path: string, content: string): ProjectFile {
  return { path, ext: ".qvs", size: content.length, isText: true, content, note: "" };
}

const script = `
SET vTaxRate = 0.18;
SET vTaxRateCopy = 0.18;
LET vGrossAmount = Sum(Amount);

StatusMap:
MAPPING LOAD * INLINE [
StatusCode, StatusName
A, Active
I, Inactive
];

StatusMapDuplicate:
MAPPING LOAD * INLINE [
StatusCode, StatusName
A, Active
I, Inactive
];

SalesRaw:
LOAD CustomerID, RegionCode, OrderID, StatusCode, Amount
FROM [sales.csv];

Sales:
LOAD CustomerID,
     RegionCode,
     OrderID,
     Amount,
     ApplyMap('StatusMap', StatusCode, 'Unknown') AS StatusName
RESIDENT SalesRaw;

Customers:
LOAD CustomerID, RegionCode, CustomerName, CustomerCategory
FROM [customers.csv];

LEFT JOIN (Sales)
LOAD CustomerID, RegionCode, CustomerName
RESIDENT Customers;

SalesSummary:
LOAD CustomerID, Sum(Amount) * $(vTaxRate) AS TotalAmount
RESIDENT Sales
GROUP BY CustomerID;

STORE Sales INTO [sales.qvd] (qvd);
DROP TABLE SalesRaw;
`;

describe("full Qlik reconstruction engine", () => {
  it("backtracks tables and separates Power Query, DAX, staging and model decisions", () => {
    const analysis = runEnterpriseAnalysis([projectFile("Model.qvs", script)]);
    const plan = analysis.reconstruction!;

    expect(plan.stable).toBe(true);
    expect(plan.staticTables).toHaveLength(1);
    expect(plan.staticTables[0].aliases).toEqual(expect.arrayContaining(["StatusMap", "StatusMapDuplicate"]));
    expect(plan.omittedStoreOperationIds.length).toBe(1);
    expect(plan.retainedDroppedTables.some((item) => item.table === "SalesRaw")).toBe(true);
    expect(Object.keys(analysis.stagingQueries || {})).toEqual(expect.arrayContaining(["StatusMap"]));
    expect(Object.keys(analysis.stagingQueries || {})).not.toContain("Staging_SalesRaw");

    const totalAmount = plan.aggregateMeasures.find((measure) => measure.name === "TotalAmount");
    expect(totalAmount).toBeTruthy();
    expect(totalAmount!.dax).toContain("[vTaxRate]");
    expect(analysis.daxMeasures.some((measure) => measure.measureName === "vTaxRate" && measure.table === "Qlik Variables")).toBe(true);
    expect(analysis.daxMeasures.some((measure) => measure.measureName === "vTaxRateCopy" && measure.table === "Qlik Variables")).toBe(true);
    const grossVariable = analysis.daxMeasures.find((measure) => measure.measureName === "vGrossAmount" && measure.table === "Qlik Variables");
    expect(grossVariable).toBeTruthy();
    expect(grossVariable!.dax).toMatch(/SUM\('(?:Sales|SalesRaw)'\[Amount\]\)/);
    expect(grossVariable!.dax).not.toContain("'Qlik Variables'[Amount]");

    const composite = plan.compositeKeys.find((key) => new Set([key.leftTable, key.rightTable]).has("Sales") && new Set([key.leftTable, key.rightTable]).has("Customers"));
    expect(composite).toBeTruthy();
    expect(analysis.mQueries.Sales).toContain(composite!.keyColumn);
    expect(analysis.mQueries.Customers).toContain(composite!.keyColumn);
    expect(analysis.relationships.some((relationship) => relationship.fromColumn === composite!.keyColumn && relationship.toColumn === composite!.keyColumn)).toBe(true);

    expect(analysis.profiles.SalesSummary.status).not.toBe("generated");
    expect(analysis.mQueries["Qlik Variables"]).toContain("_MeasureHost");
  });

  it("writes only required source and static helper queries as TMDL named expressions", () => {
    const analysis = runEnterpriseAnalysis([projectFile("Model.qvs", script)]);
    const spec = buildTomDatabaseSpec(analysis, "Reconstruction Test");
    const names = spec.model.expressions.map((expression) => expression.name);
    expect(names).toEqual(expect.arrayContaining(["StatusMap"]));
    expect(names).not.toContain("Staging_SalesRaw");
    expect(spec.model.tables.some((table) => table.name === "StatusMap")).toBe(false);
    const variableTable = spec.model.tables.find((table) => table.name === "Qlik Variables");
    expect(variableTable?.measures.map((measure) => measure.name)).toEqual(expect.arrayContaining(["vTaxRate", "vTaxRateCopy", "vGrossAmount"]));
  });

  it("honors automatic, desktop-review and queries-only model build modes", () => {
    const analysis = runEnterpriseAnalysis([projectFile("Model.qvs", script)]);
    const automatic = buildPowerBiModel(analysis, null, null, "Reconstruction Test");
    const automaticSpec = buildTomDatabaseSpec(analysis, "Automatic", { powerBiModel: automatic });
    // With only a QVS script and no source samples, the relationship remains a
    // review candidate instead of being auto-activated on unproven uniqueness.
    expect(automaticSpec.model.relationships).toHaveLength(0);

    const desktopReview = { ...automatic, buildMode: "desktop-review" as const };
    const reviewSpec = buildTomDatabaseSpec(analysis, "Desktop Review", { powerBiModel: desktopReview });
    expect(reviewSpec.model.relationships.length).toBeGreaterThan(0);
    expect(reviewSpec.model.relationships.every((relationship) => relationship.isActive === false)).toBe(true);

    const queriesOnly = { ...automatic, buildMode: "queries-only" as const };
    const querySpec = buildTomDatabaseSpec(analysis, "Queries Only", { powerBiModel: queriesOnly });
    expect(querySpec.model.relationships).toHaveLength(0);
  });


  it("exports reconstruction metadata and consolidated table scripts into PBIP", async () => {
    const analysis = runEnterpriseAnalysis([projectFile("Model.qvs", script)]);
    const model = buildPowerBiModel(analysis, null, null, "Reconstruction Export");
    const blob = await generatePbipZip(analysis, "ReconstructionExport", { powerBiModel: model, preferMicrosoftTom: false });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(archive.file("ReconstructionExport/Migration/reconstruction-plan.json")).toBeTruthy();
    expect(archive.file("ReconstructionExport/Migration/staging-queries.json")).toBeTruthy();
    expect(archive.file("ReconstructionExport/Migration/consolidated-load-scripts/Sales.qvs")).toBeTruthy();
    const manifestFile = archive.file("ReconstructionExport/Migration/migration-manifest.json");
    const manifest = JSON.parse(await manifestFile!.async("text"));
    expect(manifest.modelBuildMode).toBe("automatic");
    expect(manifest.reconstruction.stable).toBe(true);
    expect(manifest.reconstruction.compositeKeyCount).toBeGreaterThan(0);
  });

});
