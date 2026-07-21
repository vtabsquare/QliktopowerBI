import JSZip from "jszip";
import type { DaxMeasure, EnterpriseAnalysis } from "./enterprise-parser";
import type { ExpressionInventory } from "./expression";
import type { PowerBiModelState } from "./model";
import type { QvwAnalysis } from "./qvw";
import { deepValidatePowerQueries } from "./power-query/MQueryDeepValidator";
import {
  buildTomDatabaseSpec,
  hasBlockingTmdlDiagnostics,
  serializeTomModel,
  type TmdlFolderResult,
} from "./tmdl";

export interface PbipEnhancements {
  expressionInventory?: ExpressionInventory | null;
  powerBiModel?: PowerBiModelState | null;
  qvwAnalysis?: QvwAnalysis | null;
  pipelineLogs?: string[];
  preferMicrosoftTom?: boolean;
  requireMicrosoftTom?: boolean;
  daxMeasures?: DaxMeasure[] | null;
}

function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (Number(char) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(char) / 4)))).toString(16),
  );
}

function safeProjectName(value: string): string {
  return (value || "QLIK2PBI_Migration")
    .replace(/[^A-Za-z0-9 _-]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "QLIK2PBI_Migration";
}

function safeReportObjectName(value: string, fallback: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}

function safeMigrationFileName(value: string, fallback: string): string {
  const sanitized = String(value || "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}

function reportPages(qvw?: QvwAnalysis | null) {
  const sheets = qvw?.sheets.filter((sheet) => sheet.id !== "UNASSIGNED") || [];
  const source = sheets.length ? sheets : [{ id: "ReportSection", name: "Migration Review", order: 0, objectIds: [] } as any];
  const used = new Set<string>();
  return source.map((sheet, index) => {
    let name = safeReportObjectName(String(sheet.id || ""), `ReportSection${String(index).padStart(4, "0")}`);
    let suffix = 2;
    const base = name;
    while (used.has(name.toLocaleLowerCase())) name = `${base}_${suffix++}`;
    used.add(name.toLocaleLowerCase());
    return {
      name,
      displayName: sheet.name || `Page ${index + 1}`,
      ordinal: index,
      width: 1280,
      height: 720,
    };
  });
}

function writePbirReport(reportFolder: JSZip, semanticModelFolderName: string, qvw?: QvwAnalysis | null): void {
  const pages = reportPages(qvw);
  if (!pages.length) throw new Error("PBIR generation requires at least one report page.");

  reportFolder.file("definition.pbir", JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
    version: "4.0",
    datasetReference: { byPath: { path: `../${semanticModelFolderName}` } },
  }, null, 2));

  const definition = reportFolder.folder("definition");
  if (!definition) throw new Error("Failed to create the PBIR definition folder.");
  definition.file("version.json", JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
    version: "2.0.0",
  }, null, 2));
  definition.file("report.json", JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.1.0/schema.json",
    themeCollection: {
      baseTheme: {
        name: "CY25SU12",
        reportVersionAtImport: { visual: "2.5.0", report: "3.1.0", page: "2.3.0" },
        type: "SharedResources",
      },
    },
    settings: {
      useStylableVisualContainerHeader: true,
      defaultFilterActionIsDataFilter: true,
      defaultDrillFilterOtherVisuals: true,
      allowChangeFilterTypes: true,
      allowInlineExploration: true,
      useEnhancedTooltips: true,
    },
    annotations: [{ name: "QlikMigration.Generated", value: "true" }],
  }, null, 2));

  const pagesFolder = definition.folder("pages");
  if (!pagesFolder) throw new Error("Failed to create the PBIR pages folder.");
  pagesFolder.file("pages.json", JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
    pageOrder: pages.map((page) => page.name),
    activePageName: pages[0].name,
  }, null, 2));
  for (const page of pages) {
    const pageFolder = pagesFolder.folder(page.name);
    if (!pageFolder) throw new Error(`Failed to create PBIR page '${page.name}'.`);
    pageFolder.file("page.json", JSON.stringify({
      $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json",
      name: page.name,
      displayName: page.displayName,
      displayOption: "FitToPage",
      height: page.height,
      width: page.width,
    }, null, 2));
  }
}

function writeTmdlFolder(semanticFolder: JSZip, result: TmdlFolderResult): void {
  const definition = semanticFolder.folder("definition");
  if (!definition) throw new Error("Failed to create the TMDL definition folder.");
  for (const [relativePath, content] of Object.entries(result.files)) {
    definition.file(relativePath.replace(/\\/g, "/"), content);
  }
}

function semanticModelDefinitionProperties() {
  return {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
    version: "4.0",
    settings: {},
  };
}

// ---------------------------------------------------------------------------
// TMSL model.bim serializer
// Converts TomDatabaseSpec → the exact JSON Power BI Desktop expects inside
// SemanticModel/model.bim. Internal 'id' fields that are not part of the
// official TMSL schema are stripped; all partition M-expressions are kept.
// ---------------------------------------------------------------------------
function serializeToBim(spec: import("./tmdl/TomModelTypes").TomDatabaseSpec): string {
  const tables = spec.model.tables.map((table) => {
    const columns = table.columns.map((col) => {
      // Calculated columns: always emit "string" as the declared dataType.
      // Power BI Desktop re-infers the actual type from the DAX expression at
      // refresh; emitting an inferred type (e.g. int64, decimal) that does not
      // exactly match the DAX return type triggers a datatype-mismatch error.
      const base: Record<string, unknown> = {
        name: col.name,
        dataType: col.kind === "calculated" ? "string" : col.dataType,
      };
      if (col.formatString) base.formatString = col.formatString;
      if (col.isHidden) base.isHidden = col.isHidden;
      if (col.summarizeBy && col.summarizeBy !== "none") base.summarizeBy = col.summarizeBy;
      if (col.dataCategory) base.dataCategory = col.dataCategory;
      if (col.sortByColumn) base.sortByColumn = col.sortByColumn;
      if (col.description) base.description = col.description;
      if (col.lineageTag) base.lineageTag = col.lineageTag;
      if (col.annotations?.length) base.annotations = col.annotations;
      if (col.kind === "calculated") {
        base.type = "calculated";
        base.expression = col.expression;
      } else {
        base.sourceColumn = col.sourceColumn;
      }
      return base;
    });

    const measures = table.measures.map((m) => {
      const mObj: Record<string, unknown> = {
        name: m.name,
        expression: m.expression,
      };
      if (m.formatString) mObj.formatString = m.formatString;
      if (m.displayFolder) mObj.displayFolder = m.displayFolder;
      if (m.description) mObj.description = m.description;
      if (m.isHidden) mObj.isHidden = m.isHidden;
      if (m.lineageTag) mObj.lineageTag = m.lineageTag;
      if (m.annotations?.length) mObj.annotations = m.annotations;
      return mObj;
    });

    const partitions = table.partitions.map((p) => {
      if (p.sourceType === "calculated") {
        return {
          name: p.name,
          source: {
            type: "calculated",
            expression: p.expression,
          },
        };
      }
      // M partition
      return {
        name: p.name,
        mode: p.mode || "import",
        source: {
          type: "m",
          expression: Array.isArray(p.expression)
            ? p.expression
            : p.expression.split("\n"),
        },
      };
    });

    const hierarchies = table.hierarchies.map((h) => ({
      name: h.name,
      ...(h.description ? { description: h.description } : {}),
      ...(h.lineageTag ? { lineageTag: h.lineageTag } : {}),
      levels: h.levels.map((l) => ({
        name: l.name,
        ordinal: l.ordinal,
        column: l.column,
        ...(l.lineageTag ? { lineageTag: l.lineageTag } : {}),
      })),
    }));

    const tObj: Record<string, unknown> = { name: table.name };
    if (table.description) tObj.description = table.description;
    if (table.isHidden) tObj.isHidden = table.isHidden;
    if (table.lineageTag) tObj.lineageTag = table.lineageTag;
    if (columns.length) tObj.columns = columns;
    if (measures.length) tObj.measures = measures;
    if (hierarchies.length) tObj.hierarchies = hierarchies;
    if (table.annotations?.length) tObj.annotations = table.annotations;
    tObj.partitions = partitions;
    return tObj;
  });

  const relationships = spec.model.relationships.map((r) => {
    const rObj: Record<string, unknown> = {
      name: r.name,
      fromTable: r.fromTable,
      fromColumn: r.fromColumn,
      toTable: r.toTable,
      toColumn: r.toColumn,
    };
    if (r.crossFilteringBehavior && r.crossFilteringBehavior !== "oneDirection") rObj.crossFilteringBehavior = r.crossFilteringBehavior;
    if (!r.isActive) rObj.isActive = false;
    if (r.fromCardinality && r.fromCardinality !== "many") rObj.fromCardinality = r.fromCardinality;
    if (r.toCardinality && r.toCardinality !== "one") rObj.toCardinality = r.toCardinality;
    if (r.annotations?.length) rObj.annotations = r.annotations;
    return rObj;
  });

  const expressions = (spec.model.expressions || []).map((e) => ({
    name: e.name,
    kind: e.kind,
    expression: e.expression,
    ...(e.description ? { description: e.description } : {}),
    ...(e.annotations?.length ? { annotations: e.annotations } : {}),
  }));

  const bim: Record<string, unknown> = {
    compatibilityLevel: spec.compatibilityLevel,
    model: {
      culture: spec.model.culture || "en-US",
      ...(spec.model.sourceQueryCulture ? { sourceQueryCulture: spec.model.sourceQueryCulture } : {}),
      defaultPowerBIDataSourceVersion: spec.model.defaultPowerBIDataSourceVersion || "powerBI_V3",
      ...(tables.length ? { tables } : {}),
      ...(relationships.length ? { relationships } : {}),
      ...(expressions.length ? { expressions } : {}),
      annotations: [
        { name: "PBIDesktopVersion", value: "2.139.0.0" },
        { name: "QlikMigration.Generated", value: "true" },
        ...(spec.model.annotations || []).filter(
          (a) => a.name !== "PBIDesktopVersion" && a.name !== "QlikMigration.Generated"
        ),
      ],
    },
  };
  return JSON.stringify(bim, null, 2);
}

function assertTmdlReady(result: TmdlFolderResult): void {
  const required = ["database.tmdl", "model.tmdl"];
  for (const requiredFile of required) {
    if (!result.files[requiredFile]?.trim()) throw new Error(`TMDL serialization did not create ${requiredFile}.`);
  }
  if (!Object.keys(result.files).some((name) => name.startsWith("tables/") && name.endsWith(".tmdl"))) {
    throw new Error("TMDL serialization did not create any table definitions.");
  }
  // TMDL diagnostic errors (e.g., missing DAX dependencies) are recorded in the zip
  // but never block export — Power BI Desktop surfaces them when opening the file.
}

export async function generatePbipZip(
  analysis: EnterpriseAnalysis,
  projectName = "QLIK2PBI_Migration",
  enhancements: PbipEnhancements = {},
): Promise<Blob> {
  const safeName = safeProjectName(projectName);
  // Calendar tables are excluded from PBIP — users create them natively in Power BI Desktop.
  const isCalendarQuery = (name: string) => /calendar|date(?!time)|dim.?date|date.?dim|^cal$/i.test(name || "");
  const exportedMQueries = Object.fromEntries(Object.entries(analysis.mQueries).filter(([name]) => !isCalendarQuery(name)));
  const exportedStagingQueries = Object.fromEntries(Object.entries(analysis.stagingQueries || {}).filter(([name]) => !isCalendarQuery(name)));
  const deepPowerQueryValidation = await deepValidatePowerQueries(
    exportedMQueries,
    exportedStagingQueries,
    analysis.columnTypes,
    analysis.tablePreviews || {},
  ).catch(() => ({ passed: true, blockingCount: 0, queries: {} }));
  // Deep PQ validation issues are advisory only — Power BI Desktop has its own parser.
  // We never block the download; issues are recorded in the diagnostic zip file.
  const analysisForModel = { ...analysis, mQueries: exportedMQueries, stagingQueries: exportedStagingQueries };
  const modelSpec = buildTomDatabaseSpec(analysisForModel, safeName, {
    ...enhancements,
    daxMeasures: enhancements.daxMeasures ?? analysis.daxMeasures,
  });
  const tmdl = await serializeTomModel(modelSpec, {
    preferMicrosoftTom: enhancements.preferMicrosoftTom !== false,
    requireMicrosoftTom: enhancements.requireMicrosoftTom === true,
  });
  assertTmdlReady(tmdl);

  const zip = new JSZip();
  const root = zip.folder(safeName);
  if (!root) throw new Error("Failed to create root folder in ZIP");

  root.file(`${safeName}.pbip`, JSON.stringify({
    version: "1.0",
    artifacts: [{ report: { path: `${safeName}.Report` } }],
    settings: { enableAutoRecovery: true },
  }, null, 2));
  root.file(".gitignore", "**/.pbi/localSettings.json\n**/.pbi/cache.abf\n");
  root.file("OPEN_AFTER_EXTRACTION.txt", `IMPORTANT\n\n1. Extract the complete ZIP to a normal Windows folder.\n2. Do not double-click the PBIP from inside the ZIP preview.\n3. Open ${safeName}.pbip only after ${safeName}.Report and ${safeName}.SemanticModel are visible beside it.\n`);

  const semanticFolder = root.folder(`${safeName}.SemanticModel`);
  if (!semanticFolder) throw new Error("Failed to create semantic model folder.");
  semanticFolder.file(".platform", JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "SemanticModel", displayName: safeName },
    config: { version: "2.0", logicalId: uuidv4() },
  }, null, 2));
  semanticFolder.file("definition.pbism", JSON.stringify(semanticModelDefinitionProperties(), null, 2));

  // Export model.bim in TMSL format (compatibilityLevel 1565).
  // This is the same proven approach as the original working app.
  modelSpec.compatibilityLevel = 1565;
  semanticFolder.file("model.bim", serializeToBim(modelSpec));

  const reportFolder = root.folder(`${safeName}.Report`);
  if (!reportFolder) throw new Error("Failed to create report folder.");
  reportFolder.file(".platform", JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "Report", displayName: safeName },
    config: { version: "2.0", logicalId: uuidv4() },
  }, null, 2));
  writePbirReport(reportFolder, `${safeName}.SemanticModel`, enhancements.qvwAnalysis);

  const migration = root.folder("Migration");
  if (!migration) throw new Error("Failed to create migration metadata folder.");
  const manifest = {
    generatedAt: new Date().toISOString(),
    projectName: safeName,
    sourcePackage: enhancements.qvwAnalysis?.document.fileName,
    parserVersion: enhancements.expressionInventory?.parserVersion || "3.0.0",
    semanticModelFormat: "TMDL",
    reportFormat: "PBIR",
    semanticModelEngine: tmdl.engine,
    microsoftTomRequired: enhancements.requireMicrosoftTom === true,
    compatibilityLevel: modelSpec.compatibilityLevel,
    expressionSummary: enhancements.expressionInventory?.metrics,
    modelReadiness: enhancements.powerBiModel?.readiness,
    modelBuildMode: enhancements.powerBiModel?.buildMode || analysis.reconstruction?.modelBuildMode || "automatic",
    reconstruction: analysis.reconstruction ? {
      version: analysis.reconstruction.version,
      stable: analysis.reconstruction.stable,
      confidence: analysis.reconstruction.confidence,
      finalModelTableCount: Object.values(analysis.reconstruction.tables).filter((table) => table.includeInModel).length,
      aggregateMeasureCount: analysis.reconstruction.aggregateMeasures.length,
      variableMeasureCount: analysis.reconstruction.variableMeasures.length,
      compositeKeyCount: analysis.reconstruction.compositeKeys.length,
      staticTableCount: analysis.reconstruction.staticTables.length,
      retainedDroppedTableCount: analysis.reconstruction.retainedDroppedTables.length,
      omittedStoreQvdCount: analysis.reconstruction.omittedStoreOperationIds.length,
    } : undefined,
    tmdlDiagnostics: {
      total: tmdl.diagnostics.length,
      blocking: tmdl.diagnostics.filter((item) => item.severity === "blocking-error").length,
      warnings: tmdl.diagnostics.filter((item) => item.severity === "warning").length,
    },
    tables: modelSpec.model.tables.map((table) => ({
      id: table.id,
      name: table.name,
      columnCount: table.columns.length,
      calculatedColumnCount: table.columns.filter((column) => column.kind === "calculated").length,
      measureCount: table.measures.length,
      partitionCount: table.partitions.length,
    })),
    relationships: modelSpec.model.relationships,
    visualBindings: enhancements.powerBiModel?.visualBindings || [],
    notes: [
      "The semantic model is stored in the SemanticModel/definition TMDL folder; model.bim is intentionally not emitted.",
      "The report is stored in enhanced PBIR format with required definition.pbir and definition/ artifacts.",
      "Extract the complete ZIP before opening the PBIP file; opening from inside the ZIP can hide required sibling artifacts.",
      "Source columns, calculated columns, measures, calculated tables and relationships are represented as distinct TOM object types.",
      "A Microsoft TOM bridge is used when available; the deterministic TMDL serializer is used as a validated fallback.",
      "Unsupported Qlik expressions remain in the expression inventory with remediation guidance and are not silently discarded.",
      "Qlik DROP TABLE, SECTION ACCESS, aggregate-only and temporary payload objects are retained in migration lineage/audit metadata; only source and required mapping staging queries are emitted.",
      "Duplicate INLINE and MAPPING INLINE definitions are consolidated into canonical static M queries; unused static tables are omitted from the final model.",
      "STORE ... INTO QVD statements are omitted while their upstream and downstream lineage is preserved.",
      "Qlik ETL aggregations are represented as reusable DAX measures while row-grain tables remain in Power Query.",
    ],
  };
  migration.file("migration-manifest.json", JSON.stringify(manifest, null, 2));
  migration.file("tom-model-spec.json", JSON.stringify(modelSpec, null, 2));
  migration.file("tmdl-diagnostics.json", JSON.stringify(tmdl.diagnostics, null, 2));
  migration.file("tmdl-engine.txt", `${tmdl.engine}\n`);
  migration.file("expression-inventory.json", JSON.stringify(enhancements.expressionInventory || { artifacts: [] }, null, 2));
  migration.file("powerbi-model.json", JSON.stringify(enhancements.powerBiModel || analysis.semanticModel, null, 2));
  migration.file("visual-bindings.json", JSON.stringify(enhancements.powerBiModel?.visualBindings || [], null, 2));
  migration.file("qlik-logic-decisions.json", JSON.stringify(analysis.logicDecisions || [], null, 2));
  migration.file("reconstruction-plan.json", JSON.stringify(analysis.reconstruction || null, null, 2));
  migration.file("table-dependency-graph.json", JSON.stringify(
    Object.values(analysis.reconstruction?.tables || {}).map((table) => ({
      table: table.table,
      dependencies: table.dependencies,
      inlineDependencies: table.inlineDependencies,
      droppedDependencies: table.droppedDependencies,
      operationIds: table.operationIds,
      includeInModel: table.includeInModel,
      loadEnabled: table.loadEnabled,
    })),
    null,
    2,
  ));
  migration.file("field-lineage.json", JSON.stringify(analysis.reconstruction?.fieldLineage || [], null, 2));
  migration.file("join-reconstruction.json", JSON.stringify(analysis.reconstruction?.joinReconstructions || [], null, 2));
  migration.file("composite-key-decisions.json", JSON.stringify(analysis.reconstruction?.compositeKeys || [], null, 2));
  migration.file("table-classification.json", JSON.stringify(analysis.reconstruction?.tableClassifications || [], null, 2));
  migration.file("dax-conversion-decisions.json", JSON.stringify({
    aggregateMeasures: analysis.reconstruction?.aggregateMeasures || [],
    variableMeasures: analysis.reconstruction?.variableMeasures || [],
  }, null, 2));
  migration.file("migration-decisions.json", JSON.stringify(analysis.reconstruction?.migrationDecisions || [], null, 2));
  migration.file("validation-results.json", JSON.stringify(analysis.validation, null, 2));
  migration.file("power-query-ai-review.json", JSON.stringify(analysis.powerQueryReviews || {}, null, 2));
  migration.file("deep-power-query-validation.json", JSON.stringify(deepPowerQueryValidation, null, 2));
  migration.file("table-data-previews.json", JSON.stringify(analysis.tablePreviews || {}, null, 2));
  migration.file("table-execution-plans.json", JSON.stringify(analysis.executionPlans || {}, null, 2));
  migration.file("migration-debug.log", [
    ...(analysis.logs || []),
    ...(analysis.reconstruction?.passes || []).map((pass) => `${pass.id}\t${pass.status}\t${pass.name}\t${pass.detail}`),
  ].join("\n"));
  migration.file("staging-queries.json", JSON.stringify(analysis.stagingQueries || {}, null, 2));
  const consolidatedScripts = migration.folder("consolidated-load-scripts");
  if (consolidatedScripts && analysis.reconstruction) {
    for (const table of Object.values(analysis.reconstruction.tables)) {
      const fileName = `${safeMigrationFileName(table.table, "Table")}.qvs`;
      consolidatedScripts.file(fileName, [
        `// Final table: ${table.table}`,
        `// Power BI decision: ${table.decision}`,
        `// Include in model: ${table.includeInModel}`,
        `// Dependencies: ${table.dependencies.join(", ") || "none"}`,
        `// Aggregations moved to DAX: ${table.aggregationMeasures.join(", ") || "none"}`,
        `// Composite keys: ${table.compositeKeys.join(", ") || "none"}`,
        "",
        table.fullLoadScript || "// No source script was recovered for this table.",
        "",
      ].join("\n"));
    }
  }
  migration.file("pipeline-logs.txt", [
    ...(enhancements.pipelineLogs || analysis.logs || []),
    `Semantic model format: TMDL`,
    `Semantic model engine: ${tmdl.engine}`,
    `TMDL files: ${Object.keys(tmdl.files).length}`,
    `TMDL diagnostics: ${tmdl.diagnostics.length}`,
  ].join("\n"));
  if (enhancements.qvwAnalysis) migration.file("qvw-analysis.json", JSON.stringify(enhancements.qvwAnalysis, null, 2));
  migration.file("README.md", `# ${safeName} Migration Package\n\nOpen \`${safeName}.pbip\` in a current Power BI Desktop version.\n\nThe reviewed semantic model is stored as TMDL under \`${safeName}.SemanticModel/definition/\`. The package intentionally contains no \`model.bim\` and no \`cache.abf\`.\n\nTraceability, TOM model specification, TMDL diagnostics and visual-binding details are under \`Migration/\`.\n`);

  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
