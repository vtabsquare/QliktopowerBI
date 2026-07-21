import type { EnterpriseAnalysis, ValidationIssue } from "../enterprise-parser";
import { connector } from "../enterprise-parser";
import {
  applySmartModelRecommendations,
  normalizeModelMeasures,
  validatePowerBiModel,
  type ModelDiagnostic,
  type PowerBiModelState,
  type PowerBiRelationship,
} from "../model";
import { repairDaxDependencies } from "../dax/DaxDependencyRepair";

export type RepairArea =
  | "source-mapping"
  | "power-query"
  | "data-types"
  | "dax"
  | "model-tables"
  | "relationships"
  | "visuals"
  | "validation";

export interface RepairFocus {
  area: RepairArea;
  route: "/app/analysis" | "/app/power-query" | "/app/dax-measures" | "/app/powerbi-model" | "/app/qvw-analysis" | "/app/semantic-model";
  objectName?: string;
  objectId?: string;
  code?: string;
  message?: string;
  tab?: "overview" | "tables" | "relationships" | "checks";
  objectKind?: "measure" | "column" | "table" | "relationship" | "source" | "visual";
  tableName?: string;
  fieldName?: string;
  editor?: "dax" | "mapping" | "data-type" | "relationship" | "visual";
}

export interface RepairIssue {
  id: string;
  source: "enterprise" | "model";
  severity: "blocking-error" | "error" | "warning" | "information";
  area: RepairArea;
  objectName: string;
  code: string;
  message: string;
  recommendation: string;
  target: RepairFocus;
  safeAutoFix: boolean;
}

export interface AutoFixAction {
  id: string;
  area: RepairArea;
  objectName: string;
  action: string;
  status: "fixed" | "review" | "unchanged";
  confidence: number;
  detail: string;
}

export interface AutoFixReport {
  runAt: string;
  beforeBlocking: number;
  afterBlocking: number;
  fixedCount: number;
  reviewCount: number;
  actions: AutoFixAction[];
  inputIssueIds: string[];
  remainingIssueIds: string[];
}

export interface AutoFixMappingRow {
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

export interface AutoFixFile {
  name: string;
  path?: string;
  extension?: string;
  parsedAsText?: boolean;
  text?: string | null;
  sizeKb?: number;
}

function normalized(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function slug(value: string): string {
  return String(value || "object")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "object";
}

export function repairDomId(area: RepairArea, objectName?: string, objectId?: string): string {
  return `repair-${area}-${slug(objectId || objectName || "general")}`;
}

function enterpriseTarget(issue: ValidationIssue): RepairFocus {
  const area = normalized(issue.area);
  const message = normalized(`${issue.message} ${issue.recommendation}`);
  if (area.includes("source") || message.includes("source mapping") || message.includes("mapped path")) {
    return { area: "source-mapping", route: "/app/analysis", objectName: issue.objectName, message: issue.message };
  }
  if (area.includes("power query") || area.includes("m query") || message.includes("power query") || message.includes("let/in")) {
    return { area: "power-query", route: "/app/power-query", objectName: issue.objectName, message: issue.message };
  }
  if (area.includes("type") || message.includes("data type")) {
    const objectName = issue.objectName || "Data type";
    const separator = objectName.lastIndexOf(".");
    const tableName = separator > 0 ? objectName.slice(0, separator) : objectName;
    const fieldName = separator > 0 ? objectName.slice(separator + 1) : undefined;
    return {
      area: "data-types",
      route: "/app/power-query",
      objectName,
      objectKind: "column",
      editor: "data-type",
      tableName,
      fieldName,
      message: issue.message,
    };
  }
  if (area.includes("dax") || area.includes("measure") || message.includes("dax") || message.includes("measure")) {
    const missing = missingQualifiedObject(issue.message);
    return { area: "dax", route: "/app/dax-measures", objectName: issue.objectName, objectKind: "measure", editor: "dax", tableName: missing.tableName, fieldName: missing.fieldName, message: issue.message };
  }
  if (area.includes("relationship")) {
    return { area: "relationships", route: "/app/powerbi-model", tab: "relationships", objectName: issue.objectName, message: issue.message };
  }
  if (area.includes("visual") || area.includes("qvw")) {
    return { area: "visuals", route: "/app/qvw-analysis", objectName: issue.objectName, message: issue.message };
  }
  if (area.includes("model") || area.includes("table") || area.includes("column")) {
    return { area: "model-tables", route: "/app/powerbi-model", tab: "tables", objectName: issue.objectName, message: issue.message };
  }
  return { area: "validation", route: "/app/semantic-model", objectName: issue.objectName, message: issue.message };
}


function missingQualifiedObject(message: string): { tableName?: string; fieldName?: string } {
  const match = message.match(/(?:missing object|references?)\s+["']?([^"'\[]+)["']?\[([^\]]+)\]/i)
    || message.match(/["']([^"']+)["']\[([^\]]+)\]/);
  return match ? { tableName: match[1].trim(), fieldName: match[2].trim() } : {};
}

function modelTarget(diagnostic: ModelDiagnostic): RepairFocus {
  if (diagnostic.area === "relationship") {
    return { area: "relationships", route: "/app/powerbi-model", tab: "relationships", objectName: diagnostic.objectName, objectId: diagnostic.objectId, code: diagnostic.code, message: diagnostic.message };
  }
  if (["table", "column", "measure", "model"].includes(diagnostic.area)) {
    const isMeasure = diagnostic.area === "measure" || /DAX|MEASURE|DISPLAY_FOLDER|DEPENDENCY|COLOR/i.test(diagnostic.code);
    const missing = missingQualifiedObject(diagnostic.message);
    return {
      area: isMeasure ? "dax" : "model-tables",
      route: isMeasure ? "/app/dax-measures" : "/app/powerbi-model",
      tab: isMeasure ? undefined : "tables",
      objectName: diagnostic.objectName,
      objectId: diagnostic.objectId,
      objectKind: isMeasure ? "measure" : diagnostic.area === "column" ? "column" : "table",
      editor: isMeasure ? "dax" : undefined,
      tableName: missing.tableName,
      fieldName: missing.fieldName,
      code: diagnostic.code,
      message: diagnostic.message,
    };
  }
  if (diagnostic.area === "visual") {
    return { area: "visuals", route: "/app/qvw-analysis", objectName: diagnostic.objectName, objectId: diagnostic.objectId, code: diagnostic.code, message: diagnostic.message };
  }
  return { area: "validation", route: "/app/semantic-model", tab: "checks", objectName: diagnostic.objectName, objectId: diagnostic.objectId, code: diagnostic.code, message: diagnostic.message };
}

const SAFE_MODEL_CODES = new Set([
  "MULTIPLE_TABLE_KEYS",
  "DUPLICATE_RELATIONSHIP",
  "RELATIONSHIP_TABLE_MISSING",
  "RELATIONSHIP_COLUMN_MISSING",
  "RELATIONSHIP_TYPE_MISMATCH",
  "DUPLICATE_MEASURE_NAME",
  "DUPLICATE_MEASURE_EXPRESSION",
  "MEASURE_COLUMN_NAME_COLLISION",
  "MEASURE_DISPLAY_FOLDER_MISSING",
  "QLIK_COLOR_FUNCTION_NOT_CONVERTED",
  "DAX_DEPENDENCY_MISSING",
]);

export function deterministicIssueKey(input: {
  category: string;
  objectType: string;
  objectId?: string;
  property?: string;
  dependencyId?: string;
}): string {
  return [
    input.category,
    input.objectType,
    input.objectId || "",
    input.property || "",
    input.dependencyId || "",
  ].map((value) => slug(value)).join("::");
}

export function collectRepairIssues(
  analysis: EnterpriseAnalysis | null | undefined,
  model: PowerBiModelState | null | undefined,
): RepairIssue[] {
  const issues: RepairIssue[] = [];
  for (const issue of (analysis?.validation.issues || [])) {
    const target = enterpriseTarget(issue);
    const severityText = normalized(issue.severity);
    const severity: RepairIssue["severity"] = severityText.includes("error") || severityText.includes("fail")
      ? "blocking-error"
      : severityText.includes("warn") ? "warning" : "information";
    issues.push({
      id: `enterprise-${deterministicIssueKey({
        category: issue.area,
        objectType: target.objectKind || target.area,
        objectId: target.objectId || issue.objectName,
        property: target.fieldName || issue.message,
        dependencyId: target.tableName,
      })}`,
      source: "enterprise",
      severity,
      area: target.area,
      objectName: issue.objectName || issue.area || "Migration",
      code: `ENTERPRISE_${slug(issue.area).replace(/-/g, "_").toUpperCase()}`,
      message: issue.message,
      recommendation: issue.recommendation,
      target,
      safeAutoFix: target.area === "source-mapping" || target.area === "data-types" || target.area === "power-query",
    });
  }
  for (const diagnostic of model?.diagnostics || []) {
    const target = modelTarget(diagnostic);
    issues.push({
      id: `model-${diagnostic.id}`,
      source: "model",
      severity: diagnostic.severity,
      area: target.area,
      objectName: diagnostic.objectName || "Semantic model",
      code: diagnostic.code,
      message: diagnostic.message,
      recommendation: diagnostic.recommendation,
      target,
      safeAutoFix: SAFE_MODEL_CODES.has(diagnostic.code),
    });
  }
  const order: Record<RepairIssue["severity"], number> = { "blocking-error": 0, error: 1, warning: 2, information: 3 };
  return issues.sort((left, right) => order[left.severity] - order[right.severity] || left.area.localeCompare(right.area) || left.objectName.localeCompare(right.objectName));
}

export function issueFingerprint(issues: RepairIssue[]): string {
  return issues.map((issue) => issue.id).sort().join("|");
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop()?.split("?")[0] || path;
}

function stem(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "").toLowerCase();
}

const DATA_EXTENSIONS = new Set([".csv", ".txt", ".xlsx", ".xls", ".parquet", ".json", ".xml"]);

export function autoMapSourceRows(
  rows: AutoFixMappingRow[],
  files: AutoFixFile[],
): { rows: AutoFixMappingRow[]; actions: AutoFixAction[] } {
  const actions: AutoFixAction[] = [];
  const candidates = files.filter((file) => DATA_EXTENSIONS.has(normalized(file.extension || `.${basename(file.name).split(".").pop() || ""}`)));
  const next = rows.map((row) => {
    if (row.bypassQvd || row.status === "Mapped") return row;
    const sourceStem = stem(row.originalRef);
    const sourceBase = basename(row.originalRef).toLowerCase();
    const exact = candidates.filter((file) => basename(file.path || file.name).toLowerCase() === sourceBase);
    const sameStem = candidates.filter((file) => stem(file.path || file.name) === sourceStem);
    const matches = exact.length ? exact : sameStem;
    if (matches.length === 1) {
      const match = matches[0];
      const mappedRef = match.path || match.name;
      const connectorType = connector(mappedRef);
      actions.push({
        id: `map-${slug(row.originalRef)}`,
        area: "source-mapping",
        objectName: row.originalRef,
        action: "Mapped uploaded source automatically",
        status: "fixed",
        confidence: exact.length ? 100 : 96,
        detail: `${row.originalRef} → ${mappedRef}`,
      });
      return { ...row, mappedRef, effectiveRef: mappedRef, connectorType, status: "Mapped", notes: [row.notes, "Auto-fixed from uploaded package inventory."].filter(Boolean).join(" ") };
    }
    actions.push({
      id: `map-review-${slug(row.originalRef)}`,
      area: "source-mapping",
      objectName: row.originalRef,
      action: "Source mapping requires confirmation",
      status: "review",
      confidence: matches.length > 1 ? 45 : 0,
      detail: matches.length > 1 ? `${matches.length} uploaded files have the same source stem.` : "No matching uploaded physical source was found.",
    });
    return row;
  });
  return { rows: next, actions };
}

function typeKey(value: string): string {
  const v = normalized(value).replace(/[^a-z0-9]/g, "");
  if (["int", "integer", "int64", "wholenumber"].includes(v)) return "number";
  if (["double", "decimal", "number", "currencyfixeddecimal"].includes(v)) return "number";
  if (["date", "datetime"].includes(v)) return "date";
  if (["bool", "boolean", "truefalse", "logical"].includes(v)) return "boolean";
  return v || "string";
}

function relationshipSignature(relationship: PowerBiRelationship): string {
  return [relationship.fromTableId, relationship.fromColumnId, relationship.toTableId, relationship.toColumnId]
    .map(normalized)
    .join("|");
}

export function repairPowerBiModel(
  sourceModel: PowerBiModelState,
  analysis?: EnterpriseAnalysis | null,
): { model: PowerBiModelState; actions: AutoFixAction[] } {
  const actions: AutoFixAction[] = [];
  let model = applySmartModelRecommendations(sourceModel).model;

  const tableById = new Map(model.tables.map((table) => [table.id, table]));
  const relationshipGroups = new Map<string, PowerBiRelationship[]>();
  for (const relationship of model.relationships) {
    const key = relationshipSignature(relationship);
    relationshipGroups.set(key, [...(relationshipGroups.get(key) || []), relationship]);
  }
  const canonicalRelationshipIds = new Set<string>();
  for (const group of relationshipGroups.values()) {
    const winner = [...group].sort((a, b) => Number(b.userApproved) - Number(a.userApproved) || b.confidence - a.confidence)[0];
    if (winner) canonicalRelationshipIds.add(winner.id);
  }

  const relationships = model.relationships.map((relationship) => {
    const fromTable = tableById.get(relationship.fromTableId);
    const toTable = tableById.get(relationship.toTableId);
    const fromColumn = fromTable?.columns.find((column) => column.id === relationship.fromColumnId);
    const toColumn = toTable?.columns.find((column) => column.id === relationship.toColumnId);
    let reason = "";
    if (!fromTable || !toTable || !fromColumn || !toColumn) reason = "Relationship endpoint is missing from the exported model.";
    else if (typeKey(fromColumn.dataType) !== typeKey(toColumn.dataType)) reason = `Relationship data types do not match (${fromColumn.dataType} vs ${toColumn.dataType}).`;
    else if (!canonicalRelationshipIds.has(relationship.id)) reason = "A stronger duplicate relationship was retained.";
    if (!reason) return relationship;
    actions.push({
      id: `relationship-${relationship.id}`,
      area: "relationships",
      objectName: `${fromTable?.name || relationship.fromTableId} → ${toTable?.name || relationship.toTableId}`,
      action: "Excluded unsafe relationship",
      status: "fixed",
      confidence: 100,
      detail: reason,
    });
    return { ...relationship, active: false, deleted: true, recommendationStatus: "exclude" as const, recommendationReason: reason, validationMessages: [...relationship.validationMessages, reason] };
  });

  const dependencyResult = repairDaxDependencies(model.tables, analysis);
  for (const repair of dependencyResult.repairs) {
    actions.push({
      id: `dax-${slug(repair.measure)}-${slug(repair.requestedColumn)}`,
      area: "dax",
      objectName: repair.measure,
      action: "Repaired DAX dependency",
      status: "fixed",
      confidence: repair.confidence,
      detail: `${repair.table}[${repair.requestedColumn}] → ${repair.resolvedTable || repair.table}[${repair.resolvedColumn}]`,
    });
  }
  for (const unresolved of dependencyResult.unresolved) {
    actions.push({
      id: `dax-review-${slug(unresolved.measure)}-${slug(unresolved.requestedColumn)}`,
      area: "dax",
      objectName: unresolved.measure,
      action: "DAX dependency requires review",
      status: "review",
      confidence: unresolved.confidence,
      detail: `${unresolved.table}[${unresolved.requestedColumn}]: ${unresolved.reason}`,
    });
  }

  const normalizedMeasures = normalizeModelMeasures(dependencyResult.tables);
  if (normalizedMeasures.removedDuplicateCount) {
    actions.push({ id: "measure-dedup", area: "dax", objectName: "Measures", action: "Consolidated duplicate measures", status: "fixed", confidence: 100, detail: `${normalizedMeasures.removedDuplicateCount} duplicate measure(s) were redirected to canonical measures.` });
  }
  if (normalizedMeasures.renamedCount) {
    actions.push({ id: "measure-renames", area: "dax", objectName: "Measures", action: "Resolved measure name collisions", status: "fixed", confidence: 100, detail: `${normalizedMeasures.renamedCount} measure name collision(s) were renamed and references updated.` });
  }

  const validColumnIds = new Set(normalizedMeasures.tables.flatMap((table) => table.columns.map((column) => column.id)));
  const validMeasureIds = new Set(normalizedMeasures.tables.flatMap((table) => table.measures.map((measure) => measure.id)));
  const visualBindings = model.visualBindings.map((binding) => {
    const dimensionIds = [...new Set(binding.dimensionIds.filter((id) => validColumnIds.has(id)))];
    const measureIds = [...new Set(binding.measureIds.map((id) => normalizedMeasures.idAliases[id] || id).filter((id) => validMeasureIds.has(id)))];
    const changed = dimensionIds.length !== binding.dimensionIds.length || measureIds.length !== binding.measureIds.length;
    if (changed) {
      actions.push({ id: `visual-${binding.id}`, area: "visuals", objectName: binding.objectTitle || binding.objectId, action: "Removed invalid visual bindings", status: dimensionIds.length || measureIds.length ? "fixed" : "review", confidence: 100, detail: "References to removed or unavailable semantic-model objects were removed." });
    }
    return { ...binding, dimensionIds, measureIds, status: dimensionIds.length || measureIds.length ? (changed ? "warning" as const : binding.status) : "manual" as const };
  });

  model = validatePowerBiModel({ ...model, tables: normalizedMeasures.tables, relationships, visualBindings });
  return { model, actions };
}
