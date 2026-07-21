import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generatePbipZip } from "../src/lib/migration/pbip-generator";
import type { EnterpriseAnalysis } from "../src/lib/migration/enterprise-parser";
import type { PowerBiModelState } from "../src/lib/migration/model";

const analysis: EnterpriseAnalysis = {
  inventory: { totalFiles: 1, textFiles: 1, files: [] }, operations: [], variables: {}, connections: [], profiles: {
    DimCustomer: { table: "DimCustomer", classification: "dimension", status: "final", confidence: 100, reason: "test", fields: ["CustomerID"], sourceRefs: [], qvdInputs: [], qvdOutputs: [], dependencies: [], mappingDependencies: [], inlineDependencies: [], droppedIntermediates: [], joinLogic: [], concatLogic: [], filters: [], calculatedColumns: [], lineageIds: [], lineageScript: "", flowSteps: [], etlStory: "", reviewNotes: [] },
    FactSales: { table: "FactSales", classification: "fact", status: "final", confidence: 100, reason: "test", fields: ["CustomerID", "Sales"], sourceRefs: [], qvdInputs: [], qvdOutputs: [], dependencies: [], mappingDependencies: [], inlineDependencies: [], droppedIntermediates: [], joinLogic: [], concatLogic: [], filters: [], calculatedColumns: [], lineageIds: [], lineageScript: "", flowSteps: [], etlStory: "", reviewNotes: [] },
  },
  finalTables: [], excludedTables: [], sourceMappings: [], sourceCatalog: [],
  columnTypes: { DimCustomer: { CustomerID: "int64" }, FactSales: { CustomerID: "int64", Sales: "double" } }, columnTypeMeta: {}, daxMeasures: [],
  mQueries: { DimCustomer: "let Source = #table({\"CustomerID\"}, {{1}}) in Source", FactSales: "let Source = #table({\"CustomerID\",\"Sales\"}, {{1,100}}) in Source" },
  mQueryDiagnostics: [], relationships: [], semanticModel: { name: "Model", tables: [], relationships: [] },
  validation: { isReadyForPbipExport: true, errorCount: 0, warningCount: 0, issues: [], desktopDiagnostics: [] }, migrationReport: "", logs: [],
};

const model: PowerBiModelState = {
  id: "MODEL", projectName: "Test", generatedAt: new Date().toISOString(), version: "3", viewMode: "powerbi",
  tables: [
    { id: "TBL-dim", name: "DimCustomer", sourceName: "DimCustomer", queryName: "DimCustomer", kind: "dimension", hidden: false, columns: [{ id: "COL-dim-id", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: true }], measures: [], hierarchies: [], sourceLineage: [], warnings: [] },
    { id: "TBL-fact", name: "FactSales", sourceName: "FactSales", queryName: "FactSales", kind: "fact", hidden: false, columns: [{ id: "COL-fact-id", name: "CustomerID", sourceName: "CustomerID", dataType: "int64", hidden: false, isKey: false }, { id: "COL-sales", name: "Sales", sourceName: "Sales", dataType: "double", hidden: false, isKey: false }, { id: "COL-margin", name: "Margin", sourceName: "Margin", dataType: "double", hidden: false, isKey: false, expression: "'FactSales'[Sales] * 0.1" }], measures: [{ id: "MEA-total", name: "Total Sales", expression: "SUM('FactSales'[Sales])", originalExpression: "Sum(Sales)", sourceExpressionId: "EXP-1", homeTable: "FactSales", displayFolder: "Qlik Measures\\FactSales\\QVW\\Sales", hidden: false, approved: true, status: "approved" }], hierarchies: [], sourceLineage: [], warnings: [] },
  ],
  relationships: [{ id: "REL-1", fromTableId: "TBL-dim", fromColumnId: "COL-dim-id", toTableId: "TBL-fact", toColumnId: "COL-fact-id", cardinality: "one-to-many", crossFilterDirection: "single", active: true, source: "manual", confidence: 100, evidence: ["test"], riskLevel: "low", userApproved: true, validationMessages: [] }],
  originalQlikAssociations: [], layout: {}, diagnostics: [], visualBindings: [], readiness: "ready", blockingErrorCount: 0, warningCount: 0, expressionArtifactIds: ["EXP-1"],
};

describe("PBIP TMDL export", () => {
  it("writes measures, calculated columns and relationships into the TMDL definition folder", async () => {
    const blob = await generatePbipZip(analysis, "TestProject", { powerBiModel: model, preferMicrosoftTom: false });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(archive.file("TestProject/TestProject.SemanticModel/model.bim")).toBeNull();
    const definition = archive.file("TestProject/TestProject.SemanticModel/definition.pbism");
    expect(definition).toBeTruthy();
    expect(JSON.parse(await definition!.async("text")).version).toBe("4.0");

    const pbir = archive.file("TestProject/TestProject.Report/definition.pbir");
    expect(pbir).toBeTruthy();
    expect(JSON.parse(await pbir!.async("text")).version).toBe("4.0");
    expect(archive.file("TestProject/TestProject.Report/report.json")).toBeNull();
    expect(archive.file("TestProject/TestProject.Report/definition/version.json")).toBeTruthy();
    expect(archive.file("TestProject/TestProject.Report/definition/report.json")).toBeTruthy();
    expect(archive.file("TestProject/TestProject.Report/definition/pages/pages.json")).toBeTruthy();
    expect(archive.file("TestProject/TestProject.Report/definition/pages/ReportSection/page.json")).toBeTruthy();

    const fact = archive.file("TestProject/TestProject.SemanticModel/definition/tables/FactSales.tmdl");
    expect(fact).toBeTruthy();
    const factText = await fact!.async("text");
    expect(factText).toContain("source = \n\t\t\t```");
    expect(factText).not.toContain("'''");
    expect(factText).toContain("column Sales");
    expect(factText).toContain("calculatedColumn Margin");
    expect(factText).toContain("measure 'Total Sales'");
    expect(factText).toContain('displayFolder: "Qlik Measures\\FactSales\\QVW\\Sales"');
    expect(factText).not.toMatch(/column Sales[\s\S]*?expression:/);

    const relationships = archive.file("TestProject/TestProject.SemanticModel/definition/relationships.tmdl");
    expect(relationships).toBeTruthy();
    const relationshipText = await relationships!.async("text");
    expect(relationshipText).toContain("fromColumn: DimCustomer.CustomerID");
    expect(relationshipText).toContain("toColumn: FactSales.CustomerID");
  });

  it("omits calendar staging expressions and writes non-calendar source helpers as plain TMDL expressions", async () => {
    const blob = await generatePbipZip({
      ...analysis,
      stagingQueries: {
        Source_Calendar: "let\n    Source = #table({\"Date\"}, {{#date(2026, 1, 1)}})\nin\n    Source",
        Source_Customers_Raw: "let\n    Source = #table({\"CustomerID\", \"CustomerName\"}, {{1, \"Acme\"}})\nin\n    Source",
      },
    }, "SourceProject", { powerBiModel: model, preferMicrosoftTom: false });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const expressions = archive.file("SourceProject/SourceProject.SemanticModel/definition/expressions.tmdl");
    expect(expressions).toBeTruthy();
    const text = await expressions!.async("text");
    expect(text).not.toContain("Source_Calendar");
    expect(text).not.toContain("expression Source_Calendar");
    expect(text).toContain("expression Source_Customers_Raw =\n\tlet");
    expect(text).not.toContain("```");
    expect(text).not.toContain("annotation Qlik.QueryRole");
  });
});

describe("PBIP measure collision protection", () => {
  it("removes duplicate measures, renames column collisions and groups every measure", async () => {
    const collisionModel: PowerBiModelState = {
      ...model,
      tables: model.tables.map((table) => table.name !== "FactSales" ? table : {
        ...table,
        columns: [...table.columns, { id: "COL-salary", name: "Salary", sourceName: "Salary", dataType: "double", hidden: false, isKey: false }],
        measures: [
          { id: "M-salary-1", name: "Salary", expression: "SUM('FactSales'[Salary])", sourceExpressionId: "EXP-S1", homeTable: "FactSales", hidden: false, approved: true, status: "approved" },
          { id: "M-salary-2", name: "Salary Total", expression: " SUM ( 'FactSales'[Salary] ) ", sourceExpressionId: "EXP-S2", homeTable: "FactSales", hidden: false, approved: true, status: "approved" },
        ],
      }),
    };
    const blob = await generatePbipZip(analysis, "CollisionProject", { powerBiModel: collisionModel, preferMicrosoftTom: false });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const tableFile = archive.file("CollisionProject/CollisionProject.SemanticModel/definition/tables/FactSales.tmdl");
    expect(tableFile).toBeTruthy();
    const text = await tableFile!.async("text");
    expect((text.match(/\n\tmeasure /g) || []).length).toBe(1);
    expect(text).toContain("measure 'Total Salary'");
    expect(text).toContain("SUM('FactSales'[Salary])");
    expect(text).not.toContain("SUM('FactSales'[Total Salary])");
    expect(text).toContain('displayFolder: "Qlik Measures\\FactSales\\Converted Measures"');
    expect(text).not.toContain("measure Salary =");
  });
});
