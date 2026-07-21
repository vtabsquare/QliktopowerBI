import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  MigrationMetadata,
  SourceTable,
  FinalTable,
  Relationship,
  EtlOperation,
  Requirement,
  SetAnalysisRow,
  BusinessMetadata,
  TechnicalMetadata,
  MigrationValidationReport,
} from "./types";
import { applyModelBuildMode, revalidateEnterpriseAnalysis, runEnterpriseAnalysis, type EnterpriseAnalysis } from "./enterprise-parser";
import type { QvwAnalysis } from "./qvw";
import type { ExtractedFile } from "@/components/migration/MultiFileDropzone";
import {
  buildExpressionInventory,
  calculateExpressionMetrics,
  mergeExpressionInventory,
  type ExpressionArtifact,
  type ExpressionInventory,
} from "./expression";
import {
  buildPowerBiModel,
  mergePowerBiModel,
  validatePowerBiModel,
  validateRelationship,
  applySmartModelRecommendations,
  normalizeModelMeasures,
  type ModelLayoutPosition,
  type PowerBiColumn,
  type PowerBiMeasure,
  type PowerBiModelState,
  type PowerBiRelationship,
  type PowerBiTable,
} from "./model";
import {
  autoMapSourceRows,
  collectRepairIssues,
  repairPowerBiModel,
  repairEnterpriseLineage,
  normalizedEnterpriseTypeEdits,
  type AutoFixAction,
  type AutoFixReport,
  type RepairFocus,
  type RepairIssue,
} from "./autofix";
import { translateBulkMeasuresViaAi } from "./gemini";

interface MappingRow {
  originalRef: string;
  mappedRef: string;
  connectorType: string;
  status: string;
  notes: string;
  table: string;
  sourceRole: string;
  bypassQvd: boolean;
  effectiveRef: string;
  qvdProducerTable: string;
}

export interface ProjectWorkspace {
  id: string;
  name: string;
  sourcePackageName: string;
  createdAt: string;
  lastModifiedAt: string;
  parserVersion: string;
  modelVersion: string;
  exportVersion: string;
}

export interface ValidationState {
  workspaceRevision: number;
  validationRevision: number;
  status: "idle" | "validating" | "valid" | "invalid" | "stale";
  issues: RepairIssue[];
  lastValidatedAt?: string;
}

interface MeasureValidationResult {
  resolvedCount: number;
  remainingCount: number;
  isValid: boolean;
  issues: RepairIssue[];
}

interface MigrationStore extends MigrationMetadata {
  sourceQvsText?: string;
  etlQvsText?: string;
  enterpriseFiles: ExtractedFile[];
  enterpriseAnalysis: EnterpriseAnalysis | null;
  enterpriseMappingRows: MappingRow[];
  enterpriseMappingUpdates: Record<string, { mappedRef?: string; connectorType?: string; status?: string; notes?: string }>;
  enterpriseColumnTypeEdits: Record<string, string>;
  qvwAnalysis: QvwAnalysis | null;
  expressionInventory: ExpressionInventory | null;
  powerBiModel: PowerBiModelState | null;
  projectWorkspace: ProjectWorkspace | null;
  pipelineLogs: string[];
  repairFocus: RepairFocus | null;
  autoFixReport: AutoFixReport | null;
  autoFixRunning: boolean;
  validationState: ValidationState;
  reset: () => void;
  setRepairFocus: (focus: RepairFocus | null) => void;
  runAutoFix: () => Promise<AutoFixReport>;
  setRequirement: (r: Requirement) => void;
  setRuleBook: (md: string) => void;
  setAiMetadata: (data: { finalTables: FinalTable[]; relationships: Relationship[]; sourceTables?: SourceTable[] }) => void;
  setSourceAnalysis: (data: { sourceTables: SourceTable[]; sourceFileName: string; text?: string }) => void;
  updateSourceTable: (id: string, patch: Partial<SourceTable>) => void;
  setEtlAnalysis: (data: { etlOperations: EtlOperation[]; allTables?: FinalTable[]; finalTables: FinalTable[]; relationships: Relationship[]; droppedTables: string[]; intermediateTables: string[]; variables: Record<string, string>; etlFileName: string; text?: string }) => void;
  setMergedMetadata: (data: { businessMetadata: BusinessMetadata; technicalMetadata: TechnicalMetadata; finalTables: FinalTable[]; relationships: Relationship[]; validationReport: MigrationValidationReport }) => void;
  setSetAnalysis: (data: { rows: SetAnalysisRow[]; fileName: string }) => void;
  setVariableLogic: (data: { variables: Record<string, string>; fileName: string }) => void;
  setStageStatus: (stage: number, status: "pending" | "in-progress" | "complete", accuracy?: number) => void;
  setVariables: (vars: Record<string, string>) => void;
  setEnterpriseFiles: (files: ExtractedFile[]) => void;
  setEnterpriseAnalysis: (analysis: EnterpriseAnalysis | null) => void;
  setEnterpriseMappingRows: (rows: MappingRow[]) => void;
  setEnterpriseMappingUpdates: (updates: Record<string, { mappedRef?: string; connectorType?: string; status?: string; notes?: string }>) => void;
  setEnterpriseColumnTypeEdits: (edits: Record<string, string>) => void;
  setQvwAnalysis: (analysis: QvwAnalysis | null) => void;
  initializeExpressionConversion: () => void;
  updateExpressionArtifact: (id: string, patch: Partial<ExpressionArtifact>) => void;
  approveExpressionArtifact: (id: string, approved: boolean) => void;
  excludeExpressionArtifact: (id: string, reason: string) => void;
  resetExpressionArtifact: (id: string) => void;
  initializePowerBiModel: () => void;
  setModelViewMode: (mode: PowerBiModelState["viewMode"]) => void;
  setModelBuildMode: (mode: PowerBiModelState["buildMode"]) => void;
  setTablePosition: (tableId: string, position: ModelLayoutPosition) => void;
  updateModelTable: (tableId: string, patch: Partial<PowerBiTable>) => void;
  updateModelColumn: (tableId: string, columnId: string, patch: Partial<PowerBiColumn>) => void;
  setModelTableKey: (tableId: string, columnId: string | null) => void;
  updateModelMeasure: (tableId: string, measureId: string, patch: Partial<PowerBiMeasure>) => void;
  saveAndValidateMeasure: (tableId: string, measureId: string, expression: string) => MeasureValidationResult;
  addRelationship: (relationship: Omit<PowerBiRelationship, "id" | "validationMessages">) => { ok: boolean; messages: string[] };
  updateRelationship: (id: string, patch: Partial<PowerBiRelationship>) => { ok: boolean; messages: string[] };
  deleteRelationship: (id: string) => void;
  restoreRelationship: (id: string) => void;
  acceptHighConfidenceRelationships: (threshold?: number) => void;
  applySmartModel: () => void;
  validateModel: () => void;
  approveModelDiagnostic: (id: string, approved: boolean) => void;
}

const initial: MigrationMetadata & {
  sourceQvsText?: string;
  etlQvsText?: string;
  enterpriseFiles: ExtractedFile[];
  enterpriseAnalysis: EnterpriseAnalysis | null;
  enterpriseMappingRows: MappingRow[];
  enterpriseMappingUpdates: Record<string, { mappedRef?: string; connectorType?: string; status?: string; notes?: string }>;
  enterpriseColumnTypeEdits: Record<string, string>;
  qvwAnalysis: QvwAnalysis | null;
  expressionInventory: ExpressionInventory | null;
  powerBiModel: PowerBiModelState | null;
  projectWorkspace: ProjectWorkspace | null;
  pipelineLogs: string[];
  repairFocus: RepairFocus | null;
  autoFixReport: AutoFixReport | null;
  autoFixRunning: boolean;
  validationState: ValidationState;
} = {
  sourceTables: [], etlOperations: [], allTables: [], finalTables: [], relationships: [], variables: {}, droppedTables: [], intermediateTables: [], setAnalysisRows: [],
  businessMetadata: undefined, technicalMetadata: undefined, validationReport: undefined, sourceQvsText: undefined, etlQvsText: undefined,
  stageStatus: { 1: "pending", 2: "pending", 3: "pending", 4: "pending", 5: "pending", 6: "pending" },
  stageAccuracy: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
  enterpriseFiles: [], enterpriseAnalysis: null, enterpriseMappingRows: [], enterpriseMappingUpdates: {}, enterpriseColumnTypeEdits: {}, qvwAnalysis: null,
  expressionInventory: null, powerBiModel: null, projectWorkspace: null, pipelineLogs: [], repairFocus: null, autoFixReport: null, autoFixRunning: false,
  validationState: { workspaceRevision: 0, validationRevision: 0, status: "idle", issues: [] },
};


export function dedupePipelineLogs(lines: string[], maxEntries = 2000): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] || "").trim();
    if (!line) continue;
    const normalized = line.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.unshift(line);
    if (result.length >= maxEntries) break;
  }
  return result;
}

function appendPipelineLogs(existing: string[], ...entries: string[]): string[] {
  return dedupePipelineLogs([...existing, ...entries]);
}

function workspace(files: ExtractedFile[]): ProjectWorkspace | null {
  if (!files.length) return null;
  const now = new Date().toISOString();
  const packageFile = files.find((file) => file.extension.toLowerCase() === ".zip") ?? files[0];
  const name = (packageFile?.name || "Qlik Migration Project").replace(/\.[^.]+$/, "");
  return { id: `PRJ-${Date.now().toString(36)}`, name, sourcePackageName: packageFile?.name || name, createdAt: now, lastModifiedAt: now, parserVersion: "2.0.0", modelVersion: "2.0.0", exportVersion: "2.0.0" };
}

function refreshEnhancedState(state: MigrationStore, qvw = state.qvwAnalysis, enterprise = state.enterpriseAnalysis) {
  if (!qvw && !enterprise) return { expressionInventory: null, powerBiModel: null };
  const expressionInventory = qvw
    ? mergeExpressionInventory(buildExpressionInventory(qvw, enterprise), state.expressionInventory)
    : state.expressionInventory;
  const generatedModel = buildPowerBiModel(
    enterprise,
    expressionInventory,
    qvw,
    state.projectWorkspace?.name || qvw?.document.title || "Qlik Migration",
  );
  const powerBiModel = mergePowerBiModel(generatedModel, state.powerBiModel, enterprise);
  return { expressionInventory, powerBiModel };
}

function relationshipId(rel: Omit<PowerBiRelationship, "id" | "validationMessages">): string {
  return `REL-MAN-${[rel.fromTableId, rel.fromColumnId, rel.toTableId, rel.toColumnId, Date.now()].join("-").replace(/[^A-Za-z0-9-]/g, "")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteDaxName(value: string): string {
  return value.replace(/'/g, "''");
}

function replaceTableReference(expression: string | undefined, oldName: string, newName: string): string | undefined {
  if (!expression || oldName === newName) return expression;
  let result = expression.split(`'${quoteDaxName(oldName)}'`).join(`'${quoteDaxName(newName)}'`);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(oldName)) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(oldName)}(?=\\s*\\[)`, "g"), newName);
  }
  return result;
}

function replaceColumnReference(expression: string | undefined, tableName: string, oldName: string, newName: string): string | undefined {
  if (!expression || oldName === newName) return expression;
  const quotedTable = `'${quoteDaxName(tableName)}'`;
  let result = expression
    .split(`${quotedTable}[${oldName.replace(/]/g, "]]" )}]`)
    .join(`${quotedTable}[${newName.replace(/]/g, "]]" )}]`);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    result = result.replace(
      new RegExp(`${escapeRegExp(tableName)}\\s*\\[${escapeRegExp(oldName)}\\]`, "g"),
      `${tableName}[${newName}]`,
    );
  }
  return result;
}

function replaceMeasureReference(expression: string | undefined, oldName: string, newName: string): string | undefined {
  if (!expression || oldName === newName) return expression;
  return expression.replace(new RegExp(`\\[${escapeRegExp(oldName)}\\]`, "g"), (match, offset: number, source: string) => {
    const previous = offset > 0 ? source[offset - 1] : "";
    return previous && /[A-Za-z0-9_']/u.test(previous) ? match : `[${newName}]`;
  });
}

function touchWorkspace(projectWorkspace: ProjectWorkspace | null): ProjectWorkspace | null {
  return projectWorkspace ? { ...projectWorkspace, lastModifiedAt: new Date().toISOString() } : null;
}

function toEnterpriseProjectFiles(files: ExtractedFile[]) {
  return files
    .filter((file) => file.parsedAsText)
    .map((file) => ({
      path: file.path || file.name,
      ext: file.extension || "",
      size: Math.round((file.sizeKb || 0) * 1024),
      isText: true,
      content: file.text || "",
      note: "",
    }));
}

function mappingRowsFromAnalysis(analysis: EnterpriseAnalysis): MappingRow[] {
  return analysis.sourceMappings.map((mapping) => ({
    originalRef: mapping.originalRef,
    mappedRef: mapping.mappedRef,
    connectorType: mapping.connectorType,
    status: mapping.status,
    notes: mapping.notes,
    table: mapping.table,
    sourceRole: mapping.sourceRole,
    bypassQvd: mapping.bypassQvd,
    effectiveRef: mapping.effectiveRef,
    qvdProducerTable: mapping.qvdProducerTable,
  }));
}

function synchronizeAnalysisDaxFromModel(
  analysis: EnterpriseAnalysis | null,
  model: PowerBiModelState | null,
): EnterpriseAnalysis | null {
  if (!analysis || !model) return analysis;
  const measures = model.tables.flatMap((table) => table.measures.map((measure) => ({ table: table.name, measure })));
  const daxMeasures = analysis.daxMeasures.map((item) => {
    const match = measures.find(({ table, measure }) =>
      measure.name.toLowerCase() === item.measureName.toLowerCase()
      && (!item.table || table.toLowerCase() === item.table.toLowerCase()),
    );
    return match ? { ...item, dax: match.measure.expression, table: match.table, warning: match.measure.status === "missing-dependency" ? item.warning : "" } : item;
  });
  return { ...analysis, daxMeasures };
}

function synchronizeInventoryDaxFromModel(
  inventory: ExpressionInventory | null,
  model: PowerBiModelState | null,
): ExpressionInventory | null {
  if (!inventory || !model) return inventory;
  const bySourceId = new Map(model.tables.flatMap((table) => table.measures.flatMap((measure) =>
    (measure.sourceExpressionIds?.length ? measure.sourceExpressionIds : [measure.sourceExpressionId]).filter(Boolean).map((id) => [id as string, measure] as const),
  )));
  const allowedStatuses = new Set(["automatic", "warning", "manual", "unsupported", "missing-dependency", "approved", "excluded"]);
  const artifacts: ExpressionArtifact[] = inventory.artifacts.map((artifact) => {
    const measure = bySourceId.get(artifact.id);
    if (!measure) return artifact;
    const status = allowedStatuses.has(measure.status) ? measure.status as ExpressionArtifact["status"] : measure.approved ? "approved" : "warning";
    return { ...artifact, generatedDax: measure.expression, editedDax: measure.expression, homeTable: measure.homeTable, status, approved: measure.approved, updatedAt: new Date().toISOString() };
  });
  return { ...inventory, artifacts, metrics: calculateExpressionMetrics(artifacts) };
}

function issueIds(issues: RepairIssue[]): Set<string> {
  return new Set(issues.map((issue) => issue.id));
}

function validatedState(
  enterpriseAnalysis: EnterpriseAnalysis | null,
  powerBiModel: PowerBiModelState | null,
  workspaceRevision: number,
  validationRevision: number,
): ValidationState {
  const issues = collectRepairIssues(enterpriseAnalysis, powerBiModel);
  const blocking = issues.some((issue) => issue.severity === "blocking-error" || issue.severity === "error");
  return {
    workspaceRevision,
    validationRevision,
    status: blocking ? "invalid" : "valid",
    issues,
    lastValidatedAt: new Date().toISOString(),
  };
}

function staleValidation(state: MigrationStore): ValidationState {
  return {
    ...state.validationState,
    workspaceRevision: state.validationState.workspaceRevision + 1,
    status: "stale",
  };
}

export const useMigration = create<MigrationStore>()(persist((set, get) => ({
  ...initial,
  reset: () => set({ ...initial }),
  setRepairFocus: (repairFocus) => set({ repairFocus }),
  runAutoFix: async () => {
    const before = get();
    const beforeIssues = collectRepairIssues(before.enterpriseAnalysis, before.powerBiModel);
    set((state) => ({
      autoFixRunning: true,
      validationState: { ...state.validationState, status: "validating" },
    }));
    const actions: AutoFixAction[] = [];
    try {
      const mapped = autoMapSourceRows(before.enterpriseMappingRows, before.enterpriseFiles);
      actions.push(...mapped.actions);
      const enterpriseMappingUpdates = { ...before.enterpriseMappingUpdates };
      for (const row of mapped.rows) {
        if (row.bypassQvd) continue;
        enterpriseMappingUpdates[row.originalRef] = {
          mappedRef: row.mappedRef,
          connectorType: row.connectorType,
          status: row.status,
          notes: row.notes,
        };
      }

      let enterpriseColumnTypeEdits = { ...before.enterpriseColumnTypeEdits };
      for (const [table, columns] of Object.entries(before.enterpriseAnalysis?.columnTypes || {})) {
        for (const [column, dataType] of Object.entries(columns)) {
          const key = `${table}.${column}`;
          if (!enterpriseColumnTypeEdits[key]) enterpriseColumnTypeEdits[key] = dataType;
        }
      }
      if (before.enterpriseAnalysis) {
        const rawTypeEdits = { ...enterpriseColumnTypeEdits };
        enterpriseColumnTypeEdits = normalizedEnterpriseTypeEdits(before.enterpriseAnalysis, enterpriseColumnTypeEdits);
        for (const [key, normalizedType] of Object.entries(enterpriseColumnTypeEdits)) {
          const previousType = rawTypeEdits[key] || before.enterpriseAnalysis.columnTypes?.[key.split(".")[0]]?.[key.split(".").slice(1).join(".")];
          if (previousType !== normalizedType) actions.push({
            id: `type-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            area: "data-types",
            objectName: key,
            action: "Normalized and reapplied the Power BI data type",
            status: "fixed",
            confidence: 100,
            detail: `${previousType || "Missing"} → ${normalizedType}`,
          });
        }
      }

      let enterpriseAnalysis = before.enterpriseAnalysis;
      const projectFiles = toEnterpriseProjectFiles(before.enterpriseFiles);
      if (projectFiles.length) {
        enterpriseAnalysis = runEnterpriseAnalysis(projectFiles, enterpriseMappingUpdates, enterpriseColumnTypeEdits);
        const repairedMappings = enterpriseAnalysis.sourceMappings.filter((item) => item.status === "Mapped").length - (before.enterpriseAnalysis?.sourceMappings.filter((item) => item.status === "Mapped").length || 0);
        if (repairedMappings > 0) actions.push({ id: "pipeline-rerun", area: "source-mapping", objectName: "Enterprise pipeline", action: "Re-ran conversion with repaired mappings", status: "fixed", confidence: 100, detail: `${repairedMappings} additional source mapping(s) passed validation.` });
      }

      let expressionInventory = before.qvwAnalysis
        ? mergeExpressionInventory(buildExpressionInventory(before.qvwAnalysis, enterpriseAnalysis), before.expressionInventory)
        : before.expressionInventory;
      let powerBiModel = enterpriseAnalysis || before.qvwAnalysis
        ? mergePowerBiModel(
            buildPowerBiModel(enterpriseAnalysis, expressionInventory, before.qvwAnalysis, before.projectWorkspace?.name || before.qvwAnalysis?.document.title || "Qlik Migration"),
            before.powerBiModel,
            enterpriseAnalysis,
          )
        : before.powerBiModel;

      if (enterpriseAnalysis) {
        const lineageRepair = repairEnterpriseLineage(enterpriseAnalysis, powerBiModel, enterpriseColumnTypeEdits);
        enterpriseAnalysis = lineageRepair.analysis;
        actions.push(...lineageRepair.actions);
        if (lineageRepair.changed) {
          enterpriseColumnTypeEdits = normalizedEnterpriseTypeEdits(enterpriseAnalysis, enterpriseColumnTypeEdits);
          expressionInventory = before.qvwAnalysis
            ? mergeExpressionInventory(buildExpressionInventory(before.qvwAnalysis, enterpriseAnalysis), expressionInventory)
            : expressionInventory;
          powerBiModel = mergePowerBiModel(
            buildPowerBiModel(enterpriseAnalysis, expressionInventory, before.qvwAnalysis, before.projectWorkspace?.name || before.qvwAnalysis?.document.title || "Qlik Migration"),
            powerBiModel,
            enterpriseAnalysis,
          );
        }
      }
      if (powerBiModel) {
        const repairedModel = repairPowerBiModel(powerBiModel, enterpriseAnalysis);
        powerBiModel = repairedModel.model;
        actions.push(...repairedModel.actions);

        if (before.ruleBookMd) {
          // Build a lookup: artifact.id → original Qlik expression
          // NOTE: m.sourceExpressionId == artifact.id (set in PowerBiModelBuilder line 150)
          const originalExprByArtifactId = new Map<string, string>(
            (expressionInventory?.artifacts || [])
              .filter((a) => a.originalExpression?.trim())
              .map((a) => [a.id, a.originalExpression] as const)
          );
          // Also build name→originalExpression fallback (case-insensitive)
          const originalExprByNameLower = new Map<string, string>(
            (expressionInventory?.artifacts || [])
              .filter((a) => a.originalExpression?.trim())
              .map((a) => [a.name.toLowerCase().trim(), a.originalExpression] as const)
          );

          const BROKEN_DAX_PATTERN = /Manual conversion required|FUNCTION_NOT_MAPPED|\bPLACEHOLDER\b|The end of the input/i;

          const brokenMeasures = powerBiModel.tables.flatMap((t) =>
            t.measures
              .filter((m) => BROKEN_DAX_PATTERN.test(m.expression))
              .map((m) => {
                // 1. Look up by artifact.id (preferred)
                const qlikSource =
                  (m.sourceExpressionId ? originalExprByArtifactId.get(m.sourceExpressionId) : undefined)
                  // 2. Fallback: look up by measure name
                  ?? originalExprByNameLower.get(m.name.toLowerCase().trim())
                  // 3. Last resort: originalExpression already on the measure
                  ?? m.originalExpression
                  ?? undefined;
                return { measure: m, qlikSource };
              })
              // Only send measures where we have an actual Qlik source (not broken DAX)
              .filter(({ qlikSource }) => !!qlikSource && !BROKEN_DAX_PATTERN.test(qlikSource ?? ""))
          );

          if (brokenMeasures.length > 0) {
            try {
              const translated = await translateBulkMeasuresViaAi(
                brokenMeasures.map(({ measure, qlikSource }) => ({ name: measure.name, expression: qlikSource! })),
                before.ruleBookMd
              );

              // Case-insensitive lookup so minor casing differences don't break matching
              const fixByNameLower = new Map<string, typeof translated[0]>(
                translated
                  .filter((t) => t.status === "SUCCESS" && t.generatedDax?.trim())
                  .map((t) => [t.measureName.toLowerCase().trim(), t] as const)
              );

              let aiFixCount = 0;
              const patchedTables = powerBiModel.tables.map((table) => ({
                ...table,
                measures: table.measures.map((measure) => {
                  if (!BROKEN_DAX_PATTERN.test(measure.expression)) return measure;
                  const fix = fixByNameLower.get(measure.name.toLowerCase().trim());
                  if (!fix) return measure;
                  aiFixCount++;
                  actions.push({
                    id: `gemini-dax-${measure.id}`,
                    area: "dax",
                    objectName: measure.name,
                    action: "Translated DAX via Gemini AI",
                    status: "fixed",
                    confidence: fix.confidence ?? 85,
                    detail: `AI translated original Qlik expression (confidence: ${fix.confidence ?? 85}%).`,
                  });
                  // Patch expression; keep as "warning" so the user can review it before export
                  return {
                    ...measure,
                    expression: fix.generatedDax,
                    status: "warning" as const,
                    approved: false,
                  };
                }),
              }));

              if (aiFixCount > 0) {
                // Re-run model validation so INVALID_DAX_MARKER / MANUAL_DAX_REVIEW diagnostics clear
                powerBiModel = validatePowerBiModel({ ...powerBiModel, tables: patchedTables });
              }
            } catch (e) {
              console.error("[Gemini DAX auto-fix] Translation failed:", e);
            }
          }
        }

        enterpriseAnalysis = synchronizeAnalysisDaxFromModel(enterpriseAnalysis, powerBiModel);
        expressionInventory = synchronizeInventoryDaxFromModel(expressionInventory, powerBiModel);
      }

      const afterIssues = collectRepairIssues(enterpriseAnalysis, powerBiModel);
      const report: AutoFixReport = {
        runAt: new Date().toISOString(),
        beforeBlocking: beforeIssues.filter((issue) => issue.severity === "blocking-error" || issue.severity === "error").length,
        afterBlocking: afterIssues.filter((issue) => issue.severity === "blocking-error" || issue.severity === "error").length,
        fixedCount: actions.filter((action) => action.status === "fixed").length,
        reviewCount: actions.filter((action) => action.status === "review").length,
        actions,
        inputIssueIds: beforeIssues.map((issue) => issue.id),
        remainingIssueIds: afterIssues.map((issue) => issue.id),
      };
      set((state) => ({
        enterpriseAnalysis,
        enterpriseMappingRows: enterpriseAnalysis ? mappingRowsFromAnalysis(enterpriseAnalysis) : mapped.rows,
        enterpriseMappingUpdates,
        enterpriseColumnTypeEdits,
        expressionInventory,
        powerBiModel,
        autoFixReport: report,
        autoFixRunning: false,
        validationState: validatedState(
          enterpriseAnalysis,
          powerBiModel,
          state.validationState.workspaceRevision,
          state.validationState.validationRevision + 1,
        ),
        repairFocus: state.repairFocus && afterIssues.some((issue) => issue.target.objectId === state.repairFocus?.objectId || issue.target.objectName === state.repairFocus?.objectName) ? state.repairFocus : null,
        projectWorkspace: touchWorkspace(state.projectWorkspace),
        pipelineLogs: appendPipelineLogs(
          state.pipelineLogs,
          `AI Auto-Fix: ${report.fixedCount} safe fix(es) applied`,
          `AI Auto-Fix: ${report.afterBlocking} blocking issue(s) remain`,
        ),
      }));
      return report;
    } catch (error) {
      set({ autoFixRunning: false });
      throw error;
    }
  },
  setRequirement: (requirement) => set((s) => ({ requirement, stageStatus: { ...s.stageStatus, 1: "complete" } })),
  setRuleBook: (ruleBookMd) => set((s) => ({ ruleBookMd, stageStatus: { ...s.stageStatus, 2: "complete" } })),
  setAiMetadata: ({ finalTables, relationships, sourceTables }) => set((s) => ({ finalTables, relationships, sourceTables: sourceTables ?? s.sourceTables, stageStatus: { ...s.stageStatus, 3: "complete" } })),
  setSourceAnalysis: ({ sourceTables, sourceFileName }) => set(() => ({ sourceTables, sourceFileName })),
  updateSourceTable: (id, patch) => set((s) => ({ sourceTables: s.sourceTables.map((table) => table.id === id ? { ...table, ...patch } : table) })),
  setEtlAnalysis: (data) => set(() => ({ ...data })),
  setMergedMetadata: (data) => set(() => ({ ...data })),
  setSetAnalysis: ({ rows, fileName }) => set(() => ({ setAnalysisRows: rows, setAnalysisFileName: fileName })),
  setVariableLogic: ({ variables, fileName }) => set((s) => ({ variables: { ...s.variables, ...variables }, variableLogicFileName: fileName })),
  setStageStatus: (stage, status, accuracy) => set((s) => ({ stageStatus: { ...s.stageStatus, [stage]: status }, stageAccuracy: accuracy !== undefined ? { ...s.stageAccuracy, [stage]: accuracy } : s.stageAccuracy })),
  setVariables: (variables) => set({ variables }),
  setEnterpriseFiles: (enterpriseFiles) => set((s) => {
    const changed = enterpriseFiles.length > 0 && enterpriseFiles.map((file) => file.path).join("|") !== s.enterpriseFiles.map((file) => file.path).join("|");
    return {
      enterpriseFiles,
      ...(changed
        ? {
            projectWorkspace: workspace(enterpriseFiles),
            expressionInventory: null,
            powerBiModel: null,
            qvwAnalysis: null,
            enterpriseAnalysis: null,
            enterpriseMappingRows: [],
            enterpriseMappingUpdates: {},
            enterpriseColumnTypeEdits: {},
            pipelineLogs: appendPipelineLogs(
              s.pipelineLogs,
              `=== Project upload ${new Date().toISOString()} · ${enterpriseFiles[0]?.name || "Qlik package"} ===`,
              `Upload/extraction: ${enterpriseFiles.length} files`,
            ),
            repairFocus: null,
            autoFixReport: null,
          }
        : {}),
    };
  }),
  setEnterpriseAnalysis: (enterpriseAnalysis) => set((s) => {
    const enhanced = refreshEnhancedState(s, s.qvwAnalysis, enterpriseAnalysis);
    const logs = enterpriseAnalysis ? [
      ...s.pipelineLogs.filter((line) => !line.startsWith("QVS operations:")),
      `QVS operations: ${enterpriseAnalysis.operations.length}`,
      `Final tables: ${enterpriseAnalysis.finalTables.length}`,
    ] : s.pipelineLogs;
    const nextRevision = s.validationState.workspaceRevision + 1;
    return {
      enterpriseAnalysis,
      ...enhanced,
      autoFixReport: null,
      validationState: validatedState(enterpriseAnalysis, enhanced.powerBiModel, nextRevision, s.validationState.validationRevision + 1),
      pipelineLogs: dedupePipelineLogs(logs),
      projectWorkspace: s.projectWorkspace ? { ...s.projectWorkspace, lastModifiedAt: new Date().toISOString() } : s.projectWorkspace,
    };
  }),
  setEnterpriseMappingRows: (enterpriseMappingRows) => set({ enterpriseMappingRows }),
  setEnterpriseMappingUpdates: (enterpriseMappingUpdates) => set((s) => ({ enterpriseMappingUpdates, autoFixReport: null, validationState: staleValidation(s) })),
  setEnterpriseColumnTypeEdits: (enterpriseColumnTypeEdits) => set((s) => ({ enterpriseColumnTypeEdits, autoFixReport: null, validationState: staleValidation(s) })),
  setQvwAnalysis: (qvwAnalysis) => set((s) => {
    if (!qvwAnalysis) return { qvwAnalysis: null, expressionInventory: null, powerBiModel: null };
    const generatedInventory = buildExpressionInventory(qvwAnalysis, s.enterpriseAnalysis);
    const expressionInventory = mergeExpressionInventory(generatedInventory, s.expressionInventory);
    const generatedModel = buildPowerBiModel(s.enterpriseAnalysis, expressionInventory, qvwAnalysis, s.projectWorkspace?.name || qvwAnalysis.document.title || "Qlik Migration");
    const powerBiModel = mergePowerBiModel(generatedModel, s.powerBiModel, s.enterpriseAnalysis);
    const logs = [
      ...s.pipelineLogs.filter((line) => !/^QVW |^Expressions |^Measures generated|^Relationships inferred|^Visuals mapped/.test(line)),
      `QVW sheets: ${qvwAnalysis.metrics.sheetCount}`,
      `QVW objects: ${qvwAnalysis.metrics.objectCount}`,
      `Expressions detected: ${qvwAnalysis.metrics.expressionCount}`,
      `Expressions normalized: ${expressionInventory.metrics.total}`,
      `Measures generated: ${expressionInventory.metrics.measures}`,
      `Relationships inferred: ${powerBiModel.relationships.length}`,
      `Visuals mapped: ${powerBiModel.visualBindings.length}`,
    ];
    return { qvwAnalysis, expressionInventory, powerBiModel, pipelineLogs: dedupePipelineLogs(logs) };
  }),
  initializeExpressionConversion: () => set((s) => {
    if (!s.qvwAnalysis) return {};
    const expressionInventory = mergeExpressionInventory(buildExpressionInventory(s.qvwAnalysis, s.enterpriseAnalysis), s.expressionInventory);
    return { expressionInventory };
  }),
  updateExpressionArtifact: (id, patch) => set((s) => {
    if (!s.expressionInventory) return {};
    const artifacts = s.expressionInventory.artifacts.map((artifact) => artifact.id === id ? { ...artifact, ...patch, userEdited: true, updatedAt: new Date().toISOString() } : artifact);
    const expressionInventory = { ...s.expressionInventory, artifacts, metrics: calculateExpressionMetrics(artifacts) };
    const powerBiModel = s.qvwAnalysis ? mergePowerBiModel(buildPowerBiModel(s.enterpriseAnalysis, expressionInventory, s.qvwAnalysis, s.projectWorkspace?.name), s.powerBiModel, s.enterpriseAnalysis) : s.powerBiModel;
    return { expressionInventory, powerBiModel, projectWorkspace: s.projectWorkspace ? { ...s.projectWorkspace, lastModifiedAt: new Date().toISOString() } : s.projectWorkspace };
  }),
  approveExpressionArtifact: (id, approved) => get().updateExpressionArtifact(id, { approved, status: approved ? "approved" : "warning" }),
  excludeExpressionArtifact: (id, reason) => get().updateExpressionArtifact(id, { status: "excluded", approved: false, excludedReason: reason }),
  resetExpressionArtifact: (id) => set((s) => {
    if (!s.qvwAnalysis || !s.expressionInventory) return {};
    const generated = buildExpressionInventory(s.qvwAnalysis, s.enterpriseAnalysis).artifacts.find((artifact) => artifact.id === id);
    if (!generated) return {};
    const artifacts = s.expressionInventory.artifacts.map((artifact) => artifact.id === id ? generated : artifact);
    const expressionInventory = { ...s.expressionInventory, artifacts, metrics: calculateExpressionMetrics(artifacts) };
    return { expressionInventory, powerBiModel: mergePowerBiModel(buildPowerBiModel(s.enterpriseAnalysis, expressionInventory, s.qvwAnalysis, s.projectWorkspace?.name), s.powerBiModel, s.enterpriseAnalysis) };
  }),
  initializePowerBiModel: () => set((s) => ({ powerBiModel: buildPowerBiModel(s.enterpriseAnalysis, s.expressionInventory, s.qvwAnalysis, s.projectWorkspace?.name) })),
  setModelViewMode: (viewMode) => set((s) => ({ powerBiModel: s.powerBiModel ? { ...s.powerBiModel, viewMode } : null })),
  setModelBuildMode: (buildMode) => set((s) => {
    const enterpriseAnalysis = s.enterpriseAnalysis
      ? applyModelBuildMode(s.enterpriseAnalysis, buildMode)
      : null;
    const generatedModel = enterpriseAnalysis
      ? buildPowerBiModel(enterpriseAnalysis, s.expressionInventory, s.qvwAnalysis, s.projectWorkspace?.name)
      : s.powerBiModel;
    const mergedModel = generatedModel
      ? mergePowerBiModel(generatedModel, s.powerBiModel, enterpriseAnalysis)
      : null;
    const activateValidated = buildMode === "automatic"
      || buildMode === "qlik-equivalent"
      || buildMode === "powerbi-optimized";
    const powerBiModel = mergedModel ? {
      ...mergedModel,
      buildMode,
      relationships: mergedModel.relationships.map((relationship) => ({
        ...relationship,
        active: activateValidated ? relationship.active : false,
      })),
    } : null;
    return {
      enterpriseAnalysis,
      powerBiModel,
      validationState: enterpriseAnalysis
        ? validatedState(
            enterpriseAnalysis,
            powerBiModel,
            s.validationState.workspaceRevision + 1,
            s.validationState.validationRevision + 1,
          )
        : s.validationState,
      projectWorkspace: touchWorkspace(s.projectWorkspace),
    };
  }),
  setTablePosition: (tableId, position) => set((s) => ({ powerBiModel: s.powerBiModel ? { ...s.powerBiModel, layout: { ...s.powerBiModel.layout, [tableId]: position } } : null })),
  updateModelTable: (tableId, patch) => set((s) => {
    if (!s.powerBiModel) return {};
    const current = s.powerBiModel.tables.find((table) => table.id === tableId);
    if (!current) return {};
    const oldName = current.name;
    const newName = patch.name?.trim() || oldName;
    const tables = s.powerBiModel.tables.map((table) => {
      const renamed = table.id === tableId ? { ...table, ...patch, name: newName } : table;
      return {
        ...renamed,
        calculatedExpression: replaceTableReference(renamed.calculatedExpression, oldName, newName),
        columns: renamed.columns.map((column) => ({ ...column, expression: replaceTableReference(column.expression, oldName, newName) })),
        measures: renamed.measures.map((measure) => ({
          ...measure,
          expression: replaceTableReference(measure.expression, oldName, newName) ?? measure.expression,
          homeTable: measure.homeTable === oldName ? newName : measure.homeTable,
        })),
      };
    });
    const artifacts = s.expressionInventory?.artifacts.map((artifact) => ({
      ...artifact,
      generatedDax: replaceTableReference(artifact.generatedDax, oldName, newName) ?? artifact.generatedDax,
      editedDax: replaceTableReference(artifact.editedDax, oldName, newName),
      homeTable: artifact.homeTable === oldName ? newName : artifact.homeTable,
      referencedTables: artifact.referencedTables.map((name) => name === oldName ? newName : name),
    }));
    return {
      powerBiModel: validatePowerBiModel({ ...s.powerBiModel, tables }),
      expressionInventory: artifacts && s.expressionInventory ? { ...s.expressionInventory, artifacts } : s.expressionInventory,
      projectWorkspace: touchWorkspace(s.projectWorkspace),
      autoFixReport: null,
      pipelineLogs: appendPipelineLogs(s.pipelineLogs, `Model table renamed: ${oldName} → ${newName}`),
    };
  }),
  updateModelColumn: (tableId, columnId, patch) => set((s) => {
    if (!s.powerBiModel) return {};
    const targetTable = s.powerBiModel.tables.find((table) => table.id === tableId);
    const targetColumn = targetTable?.columns.find((column) => column.id === columnId);
    if (!targetTable || !targetColumn) return {};
    const oldName = targetColumn.name;
    const newName = patch.name?.trim() || oldName;
    const tables = s.powerBiModel.tables.map((table) => ({
      ...table,
      calculatedExpression: replaceColumnReference(table.calculatedExpression, targetTable.name, oldName, newName),
      columns: table.columns.map((column) => {
        const isTarget = table.id === tableId && column.id === columnId;
        const enforceSingleKey = table.id === tableId && patch.isKey === true;
        const updated = isTarget ? { ...column, ...patch, name: newName } : enforceSingleKey ? { ...column, isKey: false } : column;
        return {
          ...updated,
          expression: replaceColumnReference(column.expression, targetTable.name, oldName, newName),
          sortByColumn: table.id === tableId && column.sortByColumn === oldName ? newName : column.sortByColumn,
        };
      }),
      measures: table.measures.map((measure) => ({
        ...measure,
        expression: replaceColumnReference(measure.expression, targetTable.name, oldName, newName) ?? measure.expression,
      })),
      hierarchies: table.id === tableId ? table.hierarchies.map((hierarchy) => ({ ...hierarchy, levels: hierarchy.levels.map((level) => level === oldName ? newName : level) })) : table.hierarchies,
    }));
    const artifacts = s.expressionInventory?.artifacts.map((artifact) => ({
      ...artifact,
      generatedDax: replaceColumnReference(artifact.generatedDax, targetTable.name, oldName, newName) ?? artifact.generatedDax,
      editedDax: replaceColumnReference(artifact.editedDax, targetTable.name, oldName, newName),
      referencedFields: artifact.referencedFields.map((name) => name === oldName ? newName : name),
    }));
    return {
      powerBiModel: validatePowerBiModel({ ...s.powerBiModel, tables }),
      expressionInventory: artifacts && s.expressionInventory ? { ...s.expressionInventory, artifacts } : s.expressionInventory,
      projectWorkspace: touchWorkspace(s.projectWorkspace),
      autoFixReport: null,
      pipelineLogs: appendPipelineLogs(s.pipelineLogs, `Model column renamed: ${targetTable.name}[${oldName}] → [${newName}]`),
    };
  }),
  setModelTableKey: (tableId, columnId) => set((s) => {
    if (!s.powerBiModel) return {};
    const tables = s.powerBiModel.tables.map((table) => table.id === tableId
      ? { ...table, columns: table.columns.map((column) => ({ ...column, isKey: columnId !== null && column.id === columnId })) }
      : table);
    const selectedTable = tables.find((table) => table.id === tableId);
    const selectedColumn = selectedTable?.columns.find((column) => column.isKey);
    return {
      powerBiModel: validatePowerBiModel({ ...s.powerBiModel, tables }),
      projectWorkspace: touchWorkspace(s.projectWorkspace),
      pipelineLogs: appendPipelineLogs(s.pipelineLogs, `Model row identifier: ${selectedTable?.name || tableId} → ${selectedColumn?.name || "None"}`),
    };
  }),
  updateModelMeasure: (tableId, measureId, patch) => set((s) => {
    if (!s.powerBiModel) return {};
    const targetTable = s.powerBiModel.tables.find((table) => table.id === tableId);
    const targetMeasure = targetTable?.measures.find((measure) => measure.id === measureId);
    if (!targetTable || !targetMeasure) return {};
    const oldName = targetMeasure.name;
    const newName = patch.name?.trim() || oldName;
    const tables = s.powerBiModel.tables.map((table) => ({
      ...table,
      calculatedExpression: replaceMeasureReference(table.calculatedExpression, oldName, newName),
      columns: table.columns.map((column) => ({ ...column, expression: replaceMeasureReference(column.expression, oldName, newName) })),
      measures: table.measures.map((measure) => {
        const updated = table.id === tableId && measure.id === measureId ? { ...measure, ...patch, name: newName } : measure;
        return { ...updated, expression: updated.id === measureId ? updated.expression : (replaceMeasureReference(updated.expression, oldName, newName) ?? updated.expression) };
      }),
    }));
    const artifacts = s.expressionInventory?.artifacts.map((artifact) => ({
      ...artifact,
      name: artifact.id === targetMeasure.sourceExpressionId ? newName : artifact.name,
      generatedDax: replaceMeasureReference(artifact.generatedDax, oldName, newName) ?? artifact.generatedDax,
      editedDax: replaceMeasureReference(artifact.editedDax, oldName, newName),
      referencedMeasures: artifact.referencedMeasures.map((name) => name === oldName ? newName : name),
    }));
    const normalizedMeasures = normalizeModelMeasures(tables);
    const visualBindings = s.powerBiModel.visualBindings.map((binding) => ({
      ...binding,
      measureIds: [...new Set(binding.measureIds.map((id) => normalizedMeasures.idAliases[id] || id))],
    }));
    return {
      powerBiModel: validatePowerBiModel({ ...s.powerBiModel, tables: normalizedMeasures.tables, visualBindings }),
      expressionInventory: artifacts && s.expressionInventory ? { ...s.expressionInventory, artifacts } : s.expressionInventory,
      projectWorkspace: touchWorkspace(s.projectWorkspace),
      autoFixReport: null,
      validationState: staleValidation(s),
      pipelineLogs: appendPipelineLogs(s.pipelineLogs, `Measure renamed: [${oldName}] → [${newName}]`, `Measure normalization: ${normalizedMeasures.removedDuplicateCount} duplicate(s) consolidated; ${normalizedMeasures.renamedCount} collision(s) renamed.`),
    };
  }),
  saveAndValidateMeasure: (tableId, measureId, expression) => {
    const before = get();
    const beforeIssues = before.validationState.status === "stale"
      ? collectRepairIssues(before.enterpriseAnalysis, before.powerBiModel)
      : before.validationState.issues;
    get().updateModelMeasure(tableId, measureId, {
      expression,
      approved: true,
      status: "approved",
    });
    const updated = get();
    const validatedModel = updated.powerBiModel ? validatePowerBiModel(updated.powerBiModel) : null;
    let enterpriseAnalysis = synchronizeAnalysisDaxFromModel(updated.enterpriseAnalysis, validatedModel);
    if (enterpriseAnalysis) enterpriseAnalysis = revalidateEnterpriseAnalysis(enterpriseAnalysis);
    const issues = collectRepairIssues(enterpriseAnalysis, validatedModel);
    const beforeIds = issueIds(beforeIssues);
    const afterIds = issueIds(issues);
    const resolvedCount = [...beforeIds].filter((id) => !afterIds.has(id)).length;
    const nextValidation = validatedState(
      enterpriseAnalysis,
      validatedModel,
      updated.validationState.workspaceRevision,
      updated.validationState.validationRevision + 1,
    );
    set((state) => ({
      enterpriseAnalysis,
      powerBiModel: validatedModel,
      expressionInventory: synchronizeInventoryDaxFromModel(state.expressionInventory, validatedModel),
      validationState: nextValidation,
      autoFixReport: null,
      repairFocus: null,
      projectWorkspace: touchWorkspace(state.projectWorkspace),
      pipelineLogs: appendPipelineLogs(
        state.pipelineLogs,
        `Measure validated: ${tableId}/${measureId}`,
        `Validation refresh: ${resolvedCount} issue(s) resolved; ${issues.length} current issue(s)`,
      ),
    }));
    return {
      resolvedCount,
      remainingCount: issues.length,
      isValid: !issues.some((issue) => issue.severity === "blocking-error" || issue.severity === "error"),
      issues,
    };
  },
  addRelationship: (relationship) => {
    const model = get().powerBiModel;
    if (!model) return { ok: false, messages: ["Power BI model is not initialized."] };
    const candidate: PowerBiRelationship = { ...relationship, id: relationshipId(relationship), validationMessages: [] };
    const diagnostics = validateRelationship(candidate, model.tables, model.relationships);
    const blocking = diagnostics.filter((item) => item.severity === "blocking-error");
    if (blocking.length) return { ok: false, messages: blocking.map((item) => item.message) };
    candidate.validationMessages = diagnostics.map((item) => item.message);
    set((state) => ({ powerBiModel: validatePowerBiModel({ ...model, relationships: [...model.relationships, candidate] }), validationState: staleValidation(state), autoFixReport: null }));
    return { ok: true, messages: diagnostics.map((item) => item.message) };
  },
  updateRelationship: (id, patch) => {
    const model = get().powerBiModel;
    if (!model) return { ok: false, messages: ["Power BI model is not initialized."] };
    const current = model.relationships.find((relationship) => relationship.id === id);
    if (!current) return { ok: false, messages: ["Relationship was not found."] };
    const candidate = { ...current, ...patch };
    const diagnostics = validateRelationship(candidate, model.tables, model.relationships);
    const blocking = diagnostics.filter((item) => item.severity === "blocking-error");
    if (blocking.length) return { ok: false, messages: blocking.map((item) => item.message) };
    candidate.validationMessages = diagnostics.map((item) => item.message);
    set((state) => ({ powerBiModel: validatePowerBiModel({ ...model, relationships: model.relationships.map((relationship) => relationship.id === id ? candidate : relationship) }), validationState: staleValidation(state), autoFixReport: null }));
    return { ok: true, messages: diagnostics.map((item) => item.message) };
  },
  deleteRelationship: (id) => set((s) => ({ powerBiModel: s.powerBiModel ? validatePowerBiModel({ ...s.powerBiModel, relationships: s.powerBiModel.relationships.map((relationship) => relationship.id === id ? { ...relationship, deleted: true, active: false } : relationship) }) : null, validationState: staleValidation(s), autoFixReport: null })),
  restoreRelationship: (id) => set((s) => ({ powerBiModel: s.powerBiModel ? validatePowerBiModel({ ...s.powerBiModel, relationships: s.powerBiModel.relationships.map((relationship) => relationship.id === id ? { ...relationship, deleted: false } : relationship) }) : null })),
  acceptHighConfidenceRelationships: (threshold = 85) => set((s) => {
    if (!s.powerBiModel) return {};
    const relationships = s.powerBiModel.relationships.map((relationship) => relationship.confidence >= threshold && relationship.riskLevel !== "high" && relationship.recommendationStatus !== "exclude"
      ? { ...relationship, active: true, userApproved: true }
      : relationship);
    return { powerBiModel: validatePowerBiModel({ ...s.powerBiModel, relationships }) };
  }),
  applySmartModel: () => set((s) => {
    if (!s.powerBiModel) return {};
    const result = applySmartModelRecommendations(s.powerBiModel);
    return {
      powerBiModel: result.model,
      projectWorkspace: touchWorkspace(s.projectWorkspace),
      pipelineLogs: appendPipelineLogs(
        s.pipelineLogs,
        `Smart model: ${result.summary.appliedRelationships} relationships applied`,
        `Smart model: ${result.summary.reviewRelationships} relationships require review`,
        `Smart model: ${result.summary.excludedRelationships} weak relationships excluded`,
      ),
    };
  }),
  validateModel: () => set((s) => ({ powerBiModel: s.powerBiModel ? validatePowerBiModel(s.powerBiModel) : null })),
  approveModelDiagnostic: (id, approved) => set((s) => ({ powerBiModel: s.powerBiModel ? { ...s.powerBiModel, diagnostics: s.powerBiModel.diagnostics.map((diagnostic) => diagnostic.id === id ? { ...diagnostic, approved } : diagnostic) } : null })),
}), {
  name: "qlik2pbi-enhanced-workspace-v3",
  partialize: (state) => ({ expressionInventory: state.expressionInventory, powerBiModel: state.powerBiModel, projectWorkspace: state.projectWorkspace, autoFixReport: state.autoFixReport, pipelineLogs: dedupePipelineLogs(state.pipelineLogs), validationState: state.validationState }),
}));
