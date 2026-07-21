import {
  applyDataTypeOverrides,
  TYPE_OPTIONS,
  type EnterpriseAnalysis,
  type Operation,
  type TableProfile,
} from "../enterprise-parser";
import type { PowerBiModelState } from "../model";
import type { AutoFixAction } from "./AutoFixEngine";

export interface EnterpriseLineageRepairResult {
  analysis: EnterpriseAnalysis;
  actions: AutoFixAction[];
  changed: boolean;
}

function normalized(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function displayType(value: string): string {
  const key = normalized(value);
  if (["int", "integer", "int64", "whole", "wholenumber", "long"].includes(key)) return "Whole Number";
  if (["decimal", "decimalnumber", "double", "float", "number", "numeric"].includes(key)) return "Decimal Number";
  if (["currency", "fixeddecimal", "currencyfixeddecimal", "money"].includes(key)) return "Currency / Fixed Decimal";
  if (["date"].includes(key)) return "Date";
  if (["datetime", "dateandtime", "timestamp"].includes(key)) return "Date/Time";
  if (["bool", "boolean", "logical", "truefalse"].includes(key)) return "True/False";
  if (["any", "variant", "object"].includes(key)) return "Any";
  if (["text", "string", "varchar", "nvarchar", "char"].includes(key)) return "Text";
  return TYPE_OPTIONS.includes(value) ? value : "Text";
}

function parseMissing(message: string): { tableName?: string; fieldName?: string } {
  const match = message.match(/(?:missing object|references?)\s+["']?([^"'\[]+)["']?\[([^\]]+)\]/i)
    || message.match(/["']([^"']+)["']\[([^\]]+)\]/);
  return match ? { tableName: match[1].trim(), fieldName: match[2].trim() } : {};
}

function deepCloneProfiles(source: Record<string, TableProfile>): Record<string, TableProfile> {
  return Object.fromEntries(Object.entries(source).map(([name, profile]) => [name, {
    ...profile,
    fields: [...profile.fields],
    sourceRefs: [...profile.sourceRefs],
    qvdInputs: [...profile.qvdInputs],
    qvdOutputs: [...profile.qvdOutputs],
    dependencies: [...profile.dependencies],
    mappingDependencies: [...profile.mappingDependencies],
    inlineDependencies: [...profile.inlineDependencies],
    droppedIntermediates: [...profile.droppedIntermediates],
    joinLogic: [...profile.joinLogic],
    concatLogic: [...profile.concatLogic],
    filters: [...profile.filters],
    calculatedColumns: [...profile.calculatedColumns],
    lineageIds: [...profile.lineageIds],
    flowSteps: profile.flowSteps.map((row) => ({ ...row })),
    reviewNotes: [...profile.reviewNotes],
  }]));
}

function operationClosure(analysis: EnterpriseAnalysis, tableName: string): Operation[] {
  const tableKey = normalized(tableName);
  const profile = Object.values(analysis.profiles).find((item) => normalized(item.table) === tableKey);
  const operationById = new Map(analysis.operations.map((operation) => [operation.id, operation]));
  const tables = new Set<string>([tableKey]);
  const operationIds = new Set(profile?.lineageIds || []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of analysis.operations) {
      const isDirect = tables.has(normalized(operation.table))
        || tables.has(normalized(operation.joinTarget))
        || tables.has(normalized(operation.concatTarget))
        || operationIds.has(operation.id);
      if (!isDirect) continue;
      if (!operationIds.has(operation.id)) { operationIds.add(operation.id); changed = true; }
      for (const dependency of [...operation.resident, operation.joinTarget, operation.concatTarget]) {
        const key = normalized(dependency);
        if (key && !tables.has(key)) { tables.add(key); changed = true; }
      }
    }
    for (const dependency of profile?.dependencies || []) {
      const key = normalized(dependency);
      if (key && !tables.has(key)) { tables.add(key); changed = true; }
    }
  }
  return [...operationIds].map((id) => operationById.get(id)).filter((item): item is Operation => Boolean(item));
}

function fieldBase(value: string): string {
  let key = normalized(value);
  const prefixes = ["actual", "budget", "forecast", "planned", "current", "prior", "previous", "total", "net", "gross", "selected"];
  const suffixes = ["code", "id", "key", "name", "value", "amount", "number", "no"];
  for (const prefix of prefixes) if (key.startsWith(prefix) && key.length > prefix.length + 2) key = key.slice(prefix.length);
  for (const suffix of suffixes) if (key.endsWith(suffix) && key.length > suffix.length + 2) key = key.slice(0, -suffix.length);
  return key;
}

function fieldScore(requested: string, candidate: string): number {
  const wanted = normalized(requested);
  const actual = normalized(candidate);
  if (!wanted || !actual) return 0;
  if (wanted === actual) return 100;
  if (fieldBase(wanted) && fieldBase(wanted) === fieldBase(actual)) return 92;
  if (actual.startsWith(wanted) || wanted.startsWith(actual)) return 86;
  return 0;
}

function operationHasField(operation: Operation, requestedField: string): { field: string; score: number; reason: string } | null {
  const candidates = new Set<string>([
    ...operation.fields,
    ...operation.calculatedFields,
    ...Object.keys(operation.fieldExpressions || {}),
  ]);
  let best: { field: string; score: number; reason: string } | null = null;
  for (const candidate of candidates) {
    const score = fieldScore(requestedField, candidate);
    if (!score) continue;
    const reason = normalized(candidate) === normalized(requestedField)
      ? "The Qlik lineage explicitly loads this field into the requested table."
      : `The Qlik lineage contains the semantically equivalent field '${candidate}'.`;
    if (!best || score > best.score) best = { field: candidate, score, reason };
  }
  return best;
}

function inferredType(analysis: EnterpriseAnalysis, tableName: string, fieldName: string): string {
  const table = Object.keys(analysis.columnTypes).find((name) => normalized(name) === normalized(tableName));
  if (table) {
    const field = Object.keys(analysis.columnTypes[table]).find((name) => normalized(name) === normalized(fieldName));
    if (field) return displayType(analysis.columnTypes[table][field]);
  }
  for (const [candidateTable, columns] of Object.entries(analysis.columnTypes)) {
    const candidate = Object.keys(columns).find((name) => fieldScore(fieldName, name) >= 92);
    if (candidate) return displayType(columns[candidate]);
  }
  return "Text";
}

function normalizeTypeEdits(
  analysis: EnterpriseAnalysis,
  edits: Record<string, string>,
): { edits: Record<string, string>; actions: AutoFixAction[] } {
  const next = { ...edits };
  const actions: AutoFixAction[] = [];
  for (const [table, columns] of Object.entries(analysis.columnTypes || {})) {
    for (const [column, current] of Object.entries(columns)) {
      const key = `${table}.${column}`;
      const requested = next[key] || current;
      const normalizedType = displayType(requested);
      next[key] = normalizedType;
      if (requested !== normalizedType) {
        actions.push({
          id: `normalize-type-${normalized(table)}-${normalized(column)}`,
          area: "data-types",
          objectName: key,
          action: "Normalized unsupported data type",
          status: "fixed",
          confidence: 100,
          detail: `${requested} → ${normalizedType}`,
        });
      }
    }
  }
  if (analysis.mQueries?.["Qlik Variables"] || analysis.reconstruction?.variableMeasures.length) {
    const key = "Qlik Variables._MeasureHost";
    if (next[key] !== "Whole Number") {
      next[key] = "Whole Number";
      actions.push({
        id: "normalize-type-qlik-variables-measure-host",
        area: "data-types",
        objectName: key,
        action: "Set the variable host to a supported whole-number type",
        status: "fixed",
        confidence: 100,
        detail: "Qlik Variables[_MeasureHost] → Whole Number",
      });
    }
  }
  return { edits: next, actions };
}

/**
 * Rebuilds enterprise artifacts after deterministic type normalization and
 * restores fields that Qlik lineage proves belong to a requested final table.
 * No new join is invented: a field is only added when it is present in the
 * direct/resident/join/concatenate closure for the requested table.
 */
export function repairEnterpriseLineage(
  source: EnterpriseAnalysis,
  model: PowerBiModelState | null | undefined,
  currentEdits: Record<string, string>,
): EnterpriseLineageRepairResult {
  const typeResult = normalizeTypeEdits(source, currentEdits);
  let analysis: EnterpriseAnalysis = {
    ...source,
    profiles: deepCloneProfiles(source.profiles),
    columnTypes: Object.fromEntries(Object.entries(source.columnTypes).map(([table, columns]) => [table, { ...columns }])),
    columnTypeMeta: Object.fromEntries(Object.entries(source.columnTypeMeta).map(([table, columns]) => [table, Object.fromEntries(Object.entries(columns).map(([column, meta]) => [column, { ...meta, sampleValues: [...(meta.sampleValues || [])] }]))])),
  };
  const actions = [...typeResult.actions];
  const restoredMetadata: Array<{ table: string; field: string; meta: { source: string; confidence: number; reason: string; sampleValues: string[] } }> = [];
  let changed = actions.length > 0;

  for (const diagnostic of model?.diagnostics || []) {
    if (diagnostic.code !== "DAX_DEPENDENCY_MISSING") continue;
    const missing = parseMissing(diagnostic.message);
    if (!missing.tableName || !missing.fieldName) continue;
    const requestedTableName = missing.tableName;
    const requestedFieldName = missing.fieldName;
    const profileEntry = Object.entries(analysis.profiles).find(([, profile]) => normalized(profile.table) === normalized(requestedTableName));
    if (!profileEntry) continue;
    const [profileKey, profile] = profileEntry;
    if (profile.fields.some((field) => normalized(field) === normalized(requestedFieldName))) continue;
    const evidence = operationClosure(analysis, profile.table)
      .map((operation) => ({ operation, match: operationHasField(operation, requestedFieldName) }))
      .filter((item) => item.match)
      .sort((left, right) => (right.match?.score || 0) - (left.match?.score || 0));
    const best = evidence[0];
    const runnerUp = evidence[1];
    if (!best?.match || best.match.score < 92 || (runnerUp?.match && best.match.score === runnerUp.match.score && normalized(best.match.field) !== normalized(runnerUp.match.field))) continue;

    const restoredField = best.match.field;
    profile.fields = [...new Set([...profile.fields, restoredField])];
    profile.reviewNotes = [...profile.reviewNotes, `AI lineage repair restored '${restoredField}' because measure '${diagnostic.objectName}' requires ${requestedTableName}[${requestedFieldName}].`];
    analysis.profiles[profileKey] = profile;
    const type = inferredType(analysis, best.operation.table, restoredField);
    analysis.columnTypes[profile.table] = { ...(analysis.columnTypes[profile.table] || {}), [restoredField]: type };
    const lineageMeta = {
      source: "AI lineage backtracking",
      confidence: best.match.score,
      reason: `${best.match.reason} Source operation: ${best.operation.file}:${best.operation.startLine}-${best.operation.endLine}.`,
      sampleValues: [],
    };
    analysis.columnTypeMeta[profile.table] = {
      ...(analysis.columnTypeMeta[profile.table] || {}),
      [restoredField]: lineageMeta,
    };
    restoredMetadata.push({ table: profile.table, field: restoredField, meta: lineageMeta });
    typeResult.edits[`${profile.table}.${restoredField}`] = type;
    actions.push({
      id: `restore-column-${normalized(profile.table)}-${normalized(restoredField)}`,
      area: "data-types",
      objectName: `${profile.table}.${restoredField}`,
      action: "Restored a missing final-table column from Qlik lineage",
      status: "fixed",
      confidence: best.match.score,
      detail: `${profile.table}[${restoredField}] was recovered from ${best.operation.table} (${best.operation.file}:${best.operation.startLine}).`,
    });
    changed = true;
  }

  if (changed) {
    analysis.finalTables = Object.values(analysis.profiles).filter((profile) => profile.status === "generated");
    analysis.excludedTables = Object.values(analysis.profiles).filter((profile) => profile.status !== "generated");
    analysis = applyDataTypeOverrides(analysis, typeResult.edits);
    for (const restored of restoredMetadata) {
      analysis.columnTypeMeta[restored.table] = {
        ...(analysis.columnTypeMeta[restored.table] || {}),
        [restored.field]: restored.meta,
      };
    }
  }
  return { analysis, actions, changed };
}

export function normalizedEnterpriseTypeEdits(
  analysis: EnterpriseAnalysis,
  edits: Record<string, string>,
): Record<string, string> {
  return normalizeTypeEdits(analysis, edits).edits;
}
