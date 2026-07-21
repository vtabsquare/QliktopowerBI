import type { DaxMeasure, Operation, TableProfile } from "../enterprise-parser";

export type ModelBuildMode = "automatic" | "desktop-review" | "queries-only" | "qlik-equivalent" | "powerbi-optimized";
export type ReconstructionDecision = "materialize-m" | "measure-dax" | "static-query" | "staging-query" | "omit" | "manual-review";

export interface ReconstructionPass {
  id: string;
  name: string;
  status: "passed" | "warning" | "failed";
  detail: string;
}

export interface StaticTablePlan {
  canonicalName: string;
  aliases: string[];
  columns: string[];
  rows: string[][];
  signature: string;
  mapping: boolean;
  referencedBy: string[];
  materialize: boolean;
  includeInModel: boolean;
  reason: string;
  sourceOperationIds: string[];
}

export interface CompositeKeyPlan {
  id: string;
  leftTable: string;
  rightTable: string;
  columns: string[];
  keyColumn: string;
  delimiter: string;
  confidence: number;
  reason: string;
}

export interface JoinReconstructionPlan {
  id: string;
  operationId: string;
  targetTable: string;
  sourceTable: string;
  joinKind: "left" | "right" | "inner" | "outer" | "left-keep" | "right-keep" | "inner-keep";
  keyColumns: string[];
  sourceKeyColumns: string[];
  expandColumns: string[];
  qualifiedCollisions: Record<string, string>;
  sourceOperationIds: string[];
  qlikStatement: string;
  confidence: number;
  reason: string;
}

export type TableDisposition =
  | "fact"
  | "dimension"
  | "bridge"
  | "reference/static"
  | "measure host"
  | "load-disabled staging"
  | "excluded"
  | "manual review";

export interface TableClassificationPlan {
  table: string;
  disposition: TableDisposition;
  includeInModel: boolean;
  loadEnabled: boolean;
  retainedColumns: string[];
  prunedColumns: string[];
  movedToTables: Record<string, string[]>;
  reason: string;
  confidence: number;
}

export interface FieldLineageRecord {
  field: string;
  sourceTable: string;
  targetTable: string;
  sourceExpression: string;
  operationId: string;
  role: "key" | "expanded" | "calculated" | "mapped" | "source";
}

export interface MigrationDecision {
  id: string;
  category: string;
  sourceScript?: string;
  sourceStatement?: string;
  sourceTable?: string;
  targetTable?: string;
  sourceFields?: string[];
  targetFields?: string[];
  decision: string;
  reason: string;
  confidence: number;
  requiresReview: boolean;
}

export interface AggregateMeasurePlan {
  id: string;
  name: string;
  homeTable: string;
  sourceTable: string;
  dax: string;
  qlikExpression: string;
  groupBy: string[];
  sourceOperationId: string;
  variablesUsed: string[];
  confidence: number;
}

export interface VariableMeasurePlan {
  id: string;
  name: string;
  dax: string;
  originalValue: string;
  variablesUsed: string[];
  confidence: number;
  category: "static" | "calculated" | "unresolved";
}

export interface RetainedDroppedTablePlan {
  table: string;
  operationIds: string[];
  retainedAsQuery: boolean;
  includeInModel: false;
  loadEnabled: false;
  reason: string;
}

export interface TableReconstructionPlan {
  table: string;
  includeInModel: boolean;
  loadEnabled: boolean;
  hidden: boolean;
  classification: string;
  confidence: number;
  operationIds: string[];
  sourceRefs: string[];
  dependencies: string[];
  inlineDependencies: string[];
  droppedDependencies: string[];
  omittedStoreOperations: string[];
  aggregationMeasures: string[];
  compositeKeys: string[];
  fullLoadScript: string;
  decision: ReconstructionDecision;
  reason: string;
}

export interface ReconstructionDecisionRow {
  id: string;
  operationId?: string;
  table: string;
  qlikConstruct: string;
  decision: ReconstructionDecision;
  powerBiHandling: string;
  reason: string;
  confidence: number;
}

export interface QlikReconstructionPlan {
  version: string;
  generatedAt: string;
  stable: boolean;
  confidence: number;
  modelBuildMode: ModelBuildMode;
  passes: ReconstructionPass[];
  tables: Record<string, TableReconstructionPlan>;
  staticTables: StaticTablePlan[];
  joinReconstructions: JoinReconstructionPlan[];
  compositeKeys: CompositeKeyPlan[];
  tableClassifications: TableClassificationPlan[];
  fieldLineage: FieldLineageRecord[];
  migrationDecisions: MigrationDecision[];
  aggregateMeasures: AggregateMeasurePlan[];
  variableMeasures: VariableMeasurePlan[];
  retainedDroppedTables: RetainedDroppedTablePlan[];
  omittedStoreOperationIds: string[];
  excludedModelTables: string[];
  decisions: ReconstructionDecisionRow[];
  warnings: string[];
}

const KEY_LIKE = /(?:^id$|id$|_id$|key$|_key$|code$|number$|no$|guid$)/i;
const AGGREGATE_RE = /\b(Sum|Count|Avg|Average|Min|Max)\s*\(\s*(DISTINCT\s+)?([^\)]+)\)/i;

function cleanName(value: string, fallback = "Object"): string {
  const result = String(value || "")
    .trim()
    .replace(/^['"\[\]`]+|['"\[\]`]+$/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.$#@-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return result || fallback;
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeCell(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function inlineSignature(operation: Operation): string {
  return JSON.stringify({
    columns: operation.inlineColumns.map(normalizeCell),
    rows: operation.inlineRows.map((row) => row.map(normalizeCell)),
  });
}

function variableReferences(value: string): string[] {
  return uniq([...String(value || "").matchAll(/\$\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)].map((match) => cleanName(match[1])));
}

function replaceVariableReferences(value: string): string {
  return String(value || "").replace(/\$\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, (_match, name) => `[${cleanName(name)}]`);
}

function qlikColorToDax(value: string): string | null {
  const rgb = value.match(/^\s*RGB\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/i);
  if (!rgb) return null;
  const toHex = (input: string) => Math.max(0, Math.min(255, Number(input))).toString(16).padStart(2, "0").toUpperCase();
  return `"#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}"`;
}

function variableToDax(name: string, value: string, profiles: Record<string, TableProfile>): VariableMeasurePlan {
  const trimmed = String(value || "").trim().replace(/;+$/, "").trim();
  const refs = variableReferences(trimmed);
  const colour = qlikColorToDax(trimmed);
  if (colour) {
    return { id: `VAR-${cleanName(name)}`, name: cleanName(name), dax: colour, originalValue: value, variablesUsed: refs, confidence: 99, category: "static" };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { id: `VAR-${cleanName(name)}`, name: cleanName(name), dax: trimmed, originalValue: value, variablesUsed: refs, confidence: 99, category: "static" };
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return { id: `VAR-${cleanName(name)}`, name: cleanName(name), dax: trimmed.toUpperCase(), originalValue: value, variablesUsed: refs, confidence: 99, category: "static" };
  }
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    const inner = trimmed.slice(1, -1).replace(/"/g, '""');
    return { id: `VAR-${cleanName(name)}`, name: cleanName(name), dax: `"${inner}"`, originalValue: value, variablesUsed: refs, confidence: 98, category: "static" };
  }
  const aggregate = convertFullAggregateExpression(trimmed, profiles);
  if (aggregate) {
    return { id: `VAR-${cleanName(name)}`, name: cleanName(name), dax: aggregate.dax, originalValue: value, variablesUsed: refs, confidence: aggregate.confidence, category: "calculated" };
  }
  const replaced = replaceVariableReferences(trimmed)
    .replace(/\bif\s*\(/gi, "IF(")
    .replace(/<>/g, "<>")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||");
  const looksDaxSafe = !/\b(?:LOAD|RESIDENT|ApplyMap|Peek|Previous|NoOfRows|FieldValue)\b/i.test(replaced);
  return {
    id: `VAR-${cleanName(name)}`,
    name: cleanName(name),
    dax: looksDaxSafe ? replaced : "BLANK()",
    originalValue: value,
    variablesUsed: refs,
    confidence: looksDaxSafe ? 70 : 30,
    category: looksDaxSafe ? "calculated" : "unresolved",
  };
}

function quoteTable(table: string): string {
  return `'${String(table || "Table").replace(/'/g, "''")}'`;
}

function cleanField(value: string): string {
  return cleanName(String(value || "").replace(/\[[^\]]+\]/g, (m) => m.slice(1, -1)).replace(/[^A-Za-z0-9_ ]/g, ""));
}

function inferFieldTable(field: string, profiles: Record<string, TableProfile>, preferredTable?: string): string {
  const normalized = cleanField(field).toLowerCase();
  const candidates = Object.values(profiles).filter((profile) =>
    profile.status === "generated" && profile.fields.some((candidate) => cleanField(candidate).toLowerCase() === normalized),
  );
  const preferred = candidates.find((profile) => profile.table === preferredTable);
  if (preferred) return preferred.table;
  if (candidates.length === 1) return candidates[0].table;
  const factLike = candidates.find((profile) => /fact|transaction|sales|finance/i.test(`${profile.classification} ${profile.table}`));
  return factLike?.table || candidates[0]?.table || preferredTable || "Qlik Variables";
}

function convertFullAggregateExpression(
  expression: string,
  profiles: Record<string, TableProfile>,
  preferredTable?: string,
): { dax: string; confidence: number } | null {
  let found = false;
  let confidence = 96;
  let dax = String(expression || "").trim();
  dax = dax.replace(/\b(Sum|Count|Avg|Average|Min|Max)\s*\(\s*(DISTINCT\s+)?([^\)]+)\)/gi, (_all, rawFn, rawDistinct, rawField) => {
    found = true;
    const fn = String(rawFn).toLowerCase();
    const distinct = Boolean(rawDistinct);
    const field = cleanField(rawField);
    const table = inferFieldTable(field, profiles, preferredTable);
    const column = `${quoteTable(table)}[${field}]`;
    if (fn === "sum") return `SUM(${column})`;
    if (fn === "count" && distinct) return `DISTINCTCOUNT(${column})`;
    if (fn === "count") return `COUNT(${column})`;
    if (fn === "avg" || fn === "average") return `AVERAGE(${column})`;
    if (fn === "min") return `MIN(${column})`;
    return `MAX(${column})`;
  });
  if (!found) return null;
  dax = replaceVariableReferences(dax)
    .replace(/\bif\s*\(/gi, "IF(")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||");
  if (/\b(?:Aggr|RangeSum|FirstSortedValue)\s*\(/i.test(dax)) confidence = 65;
  return { dax, confidence };
}

function convertAggregateExpression(expression: string, table: string): { dax: string; name: string; confidence: number } | null {
  const match = String(expression || "").match(AGGREGATE_RE);
  if (!match) return null;
  const fn = match[1].toLowerCase();
  const distinct = Boolean(match[2]);
  const field = cleanField(match[3]);
  if (!field) return null;
  let dax = "";
  let name = "";
  if (fn === "sum") { dax = `SUM(${quoteTable(table)}[${field}])`; name = `Total_${field}`; }
  else if (fn === "count" && distinct) { dax = `DISTINCTCOUNT(${quoteTable(table)}[${field}])`; name = `Distinct_${field}`; }
  else if (fn === "count") { dax = `COUNT(${quoteTable(table)}[${field}])`; name = `Count_${field}`; }
  else if (fn === "avg" || fn === "average") { dax = `AVERAGE(${quoteTable(table)}[${field}])`; name = `Average_${field}`; }
  else if (fn === "min") { dax = `MIN(${quoteTable(table)}[${field}])`; name = `Min_${field}`; }
  else { dax = `MAX(${quoteTable(table)}[${field}])`; name = `Max_${field}`; }
  return { dax, name, confidence: 94 };
}

function splitTopLevelFields(value: string): string[] {
  const fields: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) { if (current.trim()) fields.push(current.trim()); current = ""; }
    else current += char;
  }
  if (current.trim()) fields.push(current.trim());
  return fields;
}

function originalExpressionForAlias(operation: Operation, alias: string): string | null {
  const raw = String(operation.raw || "");
  const loadMatch = raw.match(/\bLOAD\b([\s\S]*?)(?=\b(?:RESIDENT|FROM|INLINE|AUTOGENERATE|GROUP\s+BY)\b|;|$)/i);
  if (!loadMatch) return null;
  const wanted = cleanName(alias).toLowerCase();
  for (const field of splitTopLevelFields(loadMatch[1])) {
    const match = field.match(/^([\s\S]+?)\s+AS\s+[\["'`]?([^\]"'`]+)[\]"'`]?\s*$/i);
    if (match && cleanName(match[2]).toLowerCase() === wanted) return match[1].trim();
  }
  return null;
}

function operationHomeTable(operation: Operation, profiles: Record<string, TableProfile>): string {
  const generated = Object.values(profiles).filter((profile) => profile.status === "generated");
  if (profiles[operation.table]?.status === "generated") return operation.table;
  for (const resident of operation.resident) if (profiles[resident]?.status === "generated") return resident;
  const lineageOwner = generated.find((profile) => profile.lineageIds.includes(operation.id));
  return lineageOwner?.table || generated[0]?.table || operation.table;
}

function buildAggregateMeasures(operations: Operation[], profiles: Record<string, TableProfile>): AggregateMeasurePlan[] {
  const out: AggregateMeasurePlan[] = [];
  const seen = new Set<string>();
  for (const operation of operations) {
    if (!operation.aggregations.length) continue;
    const homeTable = operationHomeTable(operation, profiles);
    const sourceTable = operation.resident[0] || homeTable;
    const expressionEntries = Object.entries(operation.fieldExpressions || {});
    for (const qlikExpression of operation.aggregations) {
      const matchingEntry = expressionEntries.find(([, expr]) => normalizeCell(expr).includes(normalizeCell(qlikExpression)));
      const matchingAlias = matchingEntry?.[0];
      const fullExpression = (matchingAlias ? originalExpressionForAlias(operation, matchingAlias) : null) || matchingEntry?.[1] || qlikExpression;
      const converted = convertFullAggregateExpression(fullExpression, profiles, sourceTable);
      const simple = convertAggregateExpression(qlikExpression, sourceTable);
      if (!converted || !simple) continue;
      const name = cleanName(matchingAlias || simple.name);
      const key = `${homeTable}|${name.toLowerCase()}|${converted.dax.replace(/\s+/g, "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `AGG-${operation.id}-${name}`,
        name,
        homeTable,
        sourceTable,
        dax: converted.dax,
        qlikExpression: fullExpression,
        groupBy: operation.groupBy,
        sourceOperationId: operation.id,
        variablesUsed: variableReferences(fullExpression),
        confidence: converted.confidence,
      });
    }
  }
  return out;
}

function buildStaticTables(operations: Operation[], profiles: Record<string, TableProfile>): StaticTablePlan[] {
  const inline = operations.filter((operation) => operation.inlineColumns.length > 0);
  const grouped = new Map<string, Operation[]>();
  for (const operation of inline) {
    const signature = inlineSignature(operation);
    if (!grouped.has(signature)) grouped.set(signature, []);
    grouped.get(signature)!.push(operation);
  }
  const referenced = new Map<string, Set<string>>();
  for (const operation of operations) {
    for (const dependency of [...operation.resident, ...operation.applymaps]) {
      if (!referenced.has(dependency)) referenced.set(dependency, new Set());
      referenced.get(dependency)!.add(operation.table || operation.joinTarget || operation.concatTarget);
    }
  }
  const plans: StaticTablePlan[] = [];
  for (const [signature, group] of grouped) {
    const canonicalOperation = [...group].sort((left, right) => {
      const leftGenerated = profiles[left.table]?.status === "generated" ? 0 : 1;
      const rightGenerated = profiles[right.table]?.status === "generated" ? 0 : 1;
      const leftMapping = left.opType === "mapping_load" ? 1 : 0;
      const rightMapping = right.opType === "mapping_load" ? 1 : 0;
      return leftGenerated - rightGenerated || leftMapping - rightMapping || left.startLine - right.startLine;
    })[0];
    const aliases = uniq(group.map((operation) => operation.table));
    const referencedBy = uniq(aliases.flatMap((alias) => [...(referenced.get(alias) || [])]));
    const includeInModel = aliases.some((alias) => profiles[alias]?.status === "generated" && profiles[alias]?.classification === "inline/static");
    plans.push({
      canonicalName: canonicalOperation.table,
      aliases,
      columns: canonicalOperation.inlineColumns,
      rows: canonicalOperation.inlineRows,
      signature,
      mapping: group.some((operation) => operation.opType === "mapping_load"),
      referencedBy,
      materialize: referencedBy.length > 0 || includeInModel,
      includeInModel,
      reason: referencedBy.length
        ? `Canonical static query is referenced by ${referencedBy.join(", ")}. ${group.length > 1 ? `${group.length} duplicate INLINE definitions were consolidated.` : ""}`.trim()
        : "INLINE data is not used by any surviving table and is retained only in analysis metadata.",
      sourceOperationIds: group.map((operation) => operation.id),
    });
  }
  return plans;
}

function operationIndexMap(operations: Operation[]): Map<string, number> {
  return new Map(operations.map((operation, index) => [operation.id, index]));
}

function fieldsAvailableBeforeJoin(
  targetTable: string,
  joinOperation: Operation,
  operations: Operation[],
  order: Map<string, number>,
): string[] {
  const joinIndex = order.get(joinOperation.id) ?? Number.MAX_SAFE_INTEGER;
  const fields: string[] = [];
  for (const operation of operations) {
    const index = order.get(operation.id) ?? Number.MAX_SAFE_INTEGER;
    if (index >= joinIndex) continue;
    if (operation.table !== targetTable && operation.joinTarget !== targetTable && operation.concatTarget !== targetTable) continue;
    if (operation.opType === "drop" || operation.opType === "store_qvd") continue;
    for (const field of operation.fields || []) if (field && field !== "*") fields.push(field);
    for (const field of operation.inlineColumns || []) if (field && field !== "*") fields.push(field);
  }
  return uniq(fields);
}

function normalizedFieldMap(fields: string[]): Map<string, string> {
  return new Map(fields.filter(Boolean).map((field) => [cleanName(field).toLowerCase(), field]));
}

function qlikJoinKind(operation: Operation): JoinReconstructionPlan["joinKind"] {
  const raw = String(operation.raw || "").toUpperCase();
  if (raw.includes("LEFT KEEP")) return "left-keep";
  if (raw.includes("RIGHT KEEP")) return "right-keep";
  if (raw.includes("INNER KEEP") || /\bKEEP\b/.test(raw)) return "inner-keep";
  if (raw.includes("RIGHT JOIN")) return "right";
  if (raw.includes("INNER JOIN")) return "inner";
  if (raw.includes("OUTER JOIN")) return "outer";
  return "left";
}

function sourceTableForJoin(operation: Operation): string {
  return operation.resident[0] || operation.sourceRefs[0] || operation.table || `JoinSource_${operation.id}`;
}

function buildJoinReconstructions(
  operations: Operation[],
  profiles: Record<string, TableProfile>,
): JoinReconstructionPlan[] {
  const order = operationIndexMap(operations);
  const plans: JoinReconstructionPlan[] = [];
  const seen = new Set<string>();
  const seenStatements = new Set<string>();

  for (const operation of operations) {
    if (operation.opType !== "join_load" || !operation.joinTarget) continue;
    const targetTable = operation.joinTarget;
    const sourceTable = sourceTableForJoin(operation);
    // Identical JOIN/KEEP statements are often repeated across included QVS files or
    // copied script sections. De-duplicate them before field-state mutation changes
    // which payload columns appear to be join keys on the later occurrence.
    const statementSignature = [
      cleanName(targetTable).toLowerCase(),
      cleanName(sourceTable).toLowerCase(),
      qlikJoinKind(operation),
      operation.raw.replace(/\s+/g, " ").trim().toLowerCase(),
    ].join("::");
    if (seenStatements.has(statementSignature)) continue;
    seenStatements.add(statementSignature);
    const targetFieldsBefore = fieldsAvailableBeforeJoin(targetTable, operation, operations, order);
    const targetMap = normalizedFieldMap(targetFieldsBefore);
    const payloadFields = uniq((operation.fields || []).filter((field) => field && field !== "*"));
    const sourceExpressions = operation.fieldExpressions || {};

    const shared: Array<{ target: string; source: string }> = [];
    for (const outputField of payloadFields) {
      const expression = sourceExpressions[outputField] || outputField;
      const sourceField = cleanName(expression.replace(/[\[\]]/g, ""));
      const targetField = targetMap.get(cleanName(outputField).toLowerCase()) || targetMap.get(sourceField.toLowerCase());
      if (targetField) shared.push({ target: targetField, source: outputField });
    }

    let keyPairs = shared;
    if (!keyPairs.length) {
      keyPairs = payloadFields
        .filter((field) => KEY_LIKE.test(field))
        .map((field) => {
          const targetField = targetMap.get(cleanName(field).toLowerCase());
          return targetField ? { target: targetField, source: field } : null;
        })
        .filter(Boolean) as Array<{ target: string; source: string }>;
    }

    const keyColumns = uniq(keyPairs.map((pair) => pair.target));
    const sourceKeyColumns = keyColumns.map((target, index) => keyPairs[index]?.source || target);
    const keySet = new Set(sourceKeyColumns.map((field) => cleanName(field).toLowerCase()));
    const expandColumns: string[] = [];
    const qualifiedCollisions: Record<string, string> = {};

    for (const field of payloadFields) {
      const normalized = cleanName(field).toLowerCase();
      if (keySet.has(normalized)) continue;
      const existing = targetMap.get(normalized);
      if (!existing) {
        expandColumns.push(field);
        continue;
      }
      const expression = sourceExpressions[field] || field;
      const sameSemanticAttribute = cleanName(expression).toLowerCase() === cleanName(existing).toLowerCase();
      if (!sameSemanticAttribute) {
        qualifiedCollisions[field] = `${cleanName(sourceTable)}_${cleanName(field)}`;
        expandColumns.push(field);
      }
    }

    const signature = [
      targetTable.toLowerCase(),
      sourceTable.toLowerCase(),
      qlikJoinKind(operation),
      keyColumns.map((field) => cleanName(field).toLowerCase()).join("|"),
      expandColumns.map((field) => cleanName(field).toLowerCase()).join("|"),
    ].join("::");
    if (seen.has(signature)) continue;
    seen.add(signature);

    const confidence = keyColumns.length ? 98 : 55;
    plans.push({
      id: `JOIN-${cleanName(targetTable)}-${cleanName(sourceTable)}-${operation.id}`,
      operationId: operation.id,
      targetTable,
      sourceTable,
      joinKind: qlikJoinKind(operation),
      keyColumns,
      sourceKeyColumns,
      expandColumns,
      qualifiedCollisions,
      sourceOperationIds: operation.resident.length
        ? operations.filter((candidate) => candidate.table === operation.resident[0]).map((candidate) => candidate.id)
        : [operation.id],
      qlikStatement: operation.raw,
      confidence,
      reason: keyColumns.length
        ? `The Qlik ${qlikJoinKind(operation).replace("-", " ")} uses the common field set ${keyColumns.join(", ")}. Only non-key, non-duplicate payload fields are expanded.`
        : "No deterministic common join field was found. The join remains a blocking manual-review item instead of guessing a relationship.",
    });
  }
  return plans;
}

function compositeKeySignature(fields: string[]): string {
  return fields.map((field) => cleanName(field).toLowerCase()).sort().join("|");
}

function buildCompositeKeys(
  joins: JoinReconstructionPlan[],
  profiles: Record<string, TableProfile>,
): CompositeKeyPlan[] {
  const plans: CompositeKeyPlan[] = [];
  const seen = new Set<string>();

  for (const join of joins) {
    if (join.keyColumns.length < 2) continue;
    if (join.keyColumns.length !== join.sourceKeyColumns.length) continue;
    const left = profiles[join.targetTable];
    const right = profiles[join.sourceTable];
    if (!left) continue;
    if (!right || right.status !== "generated" || left.status !== "generated") continue;

    const signature = [
      [join.targetTable, join.sourceTable].map((value) => value.toLowerCase()).sort().join("::"),
      compositeKeySignature(join.keyColumns),
    ].join("::");
    if (seen.has(signature)) continue;
    seen.add(signature);

    const keyColumn = `__Key_${cleanName(join.keyColumns.join("_"))}`;
    plans.push({
      id: `CK-${cleanName(join.targetTable)}-${cleanName(join.sourceTable)}-${cleanName(join.keyColumns.join("_"))}`,
      leftTable: join.targetTable,
      rightTable: join.sourceTable,
      columns: [...join.keyColumns],
      keyColumn,
      delimiter: "¦",
      confidence: Math.min(99, join.confidence),
      reason: `Qlik explicitly associates ${join.targetTable} and ${join.sourceTable} through ${join.keyColumns.join(", ")}. A single null-safe composite key replaces competing multi-column relationships.`,
    });
  }
  return plans;
}

function tableDisposition(profile: TableProfile): TableDisposition {
  const value = `${profile.table} ${profile.classification}`.toLowerCase();
  if (profile.status === "manual review") return "manual review";
  if (profile.status !== "generated") return /drop|stage|payload|temporary/.test(value) ? "load-disabled staging" : "excluded";
  if (/measure host/.test(value)) return "measure host";
  if (/inline|static|mapping|reference/.test(value)) return "reference/static";
  if (/bridge|link/.test(value)) return "bridge";
  if (/fact|sales|order|transaction|ledger|claim|payment|movement|event|detail/.test(value)) return "fact";
  return "dimension";
}

function directOperationColumns(operation: Operation): string[] {
  return uniq((operation.inlineColumns.length ? operation.inlineColumns : operation.fields)
    .filter((field) => field && field !== "*"));
}

/**
 * Reconstructs the actual materialized schema of a Qlik table. TableProfile.fields
 * intentionally carries the complete upstream lineage and therefore cannot be
 * used as the final Power BI schema: doing so leaks every field from resident
 * sources and creates synthetic relationships/cycles. The final schema is built
 * only from fields explicitly emitted by the table's own LOAD/CONCATENATE
 * operations plus fields explicitly expanded by JOIN operations.
 */
function materializedOutputColumns(
  table: string,
  profiles: Record<string, TableProfile>,
  joins: JoinReconstructionPlan[],
  operations: Operation[],
  stack = new Set<string>(),
): string[] {
  if (stack.has(table)) return [];
  stack.add(table);
  const output: string[] = [];
  const directOps = operations.filter((operation) =>
    operation.table === table
    && ["load", "mapping_load", "concat_load"].includes(operation.opType)
    && !operation.joinTarget,
  );
  for (const operation of directOps) {
    const explicit = directOperationColumns(operation);
    if (explicit.length) output.push(...explicit);
    else if (/\bLOAD\s+\*/i.test(operation.raw || "")) {
      for (const resident of operation.resident || []) {
        output.push(...materializedOutputColumns(resident, profiles, joins, operations, new Set(stack)));
      }
    }
  }
  for (const operation of operations.filter((candidate) => candidate.concatTarget === table)) {
    const explicit = directOperationColumns(operation);
    if (explicit.length) output.push(...explicit);
    else for (const resident of operation.resident || []) {
      output.push(...materializedOutputColumns(resident, profiles, joins, operations, new Set(stack)));
    }
  }
  for (const join of joins.filter((candidate) => candidate.targetTable === table)) {
    output.push(...join.expandColumns.map((field) => join.qualifiedCollisions[field] || field));
  }
  stack.delete(table);
  const explicitSchema = uniq(output);
  // Fallback only for unusual generated constructs where the parser cannot
  // identify an output LOAD. Normal tables must never fall back to the full
  // upstream lineage union.
  return explicitSchema.length ? explicitSchema : uniq(profiles[table]?.fields || []);
}

function buildTableClassifications(
  profiles: Record<string, TableProfile>,
  joins: JoinReconstructionPlan[],
  operations: Operation[],
  modelBuildMode: ModelBuildMode,
): TableClassificationPlan[] {
  const consumers = new Map<string, Set<string>>();
  for (const operation of operations) {
    for (const dependency of [...operation.resident, ...operation.applymaps]) {
      if (!consumers.has(dependency)) consumers.set(dependency, new Set());
      consumers.get(dependency)!.add(operation.joinTarget || operation.concatTarget || operation.table);
    }
  }
  const joinedFrom = new Map<string, JoinReconstructionPlan[]>();
  for (const join of joins) {
    if (!joinedFrom.has(join.sourceTable)) joinedFrom.set(join.sourceTable, []);
    joinedFrom.get(join.sourceTable)!.push(join);
  }

  return Object.values(profiles).map((profile) => {
    const outputColumns = materializedOutputColumns(profile.table, profiles, joins, operations);
    const moves = joinedFrom.get(profile.table) || [];
    const movedToTables: Record<string, string[]> = {};
    for (const move of moves) movedToTables[move.targetTable] = uniq([...(movedToTables[move.targetTable] || []), ...move.expandColumns]);

    const movedColumns = new Set(Object.values(movedToTables).flat().map((field) => cleanName(field).toLowerCase()));
    const joinKeys = new Set(moves.flatMap((move) => move.sourceKeyColumns).map((field) => cleanName(field).toLowerCase()));
    const uniqueColumns = outputColumns.filter((field) => {
      const normalized = cleanName(field).toLowerCase();
      return !movedColumns.has(normalized) && !joinKeys.has(normalized);
    });

    let disposition = tableDisposition(profile);
    let includeInModel = profile.status === "generated";
    let loadEnabled = includeInModel;
    let reason = profile.reason;
    let confidence = profile.confidence;
    const tableOperations = operations.filter((operation) => operation.table === profile.table);
    const normalizedFields = new Set(profile.fields.map((field) => cleanName(field).toUpperCase()));
    const isSectionAccessTable = normalizedFields.has("ACCESS") && normalizedFields.has("USERID")
      && (normalizedFields.has("REGION") || tableOperations.some((operation) => /section\s+access|04_security|section_access/i.test(`${operation.file} ${operation.raw}`)));
    if (isSectionAccessTable) {
      disposition = "excluded";
      includeInModel = false;
      loadEnabled = false;
      confidence = Math.max(confidence, 99);
      reason = "Qlik SECTION ACCESS rows are security metadata, not analytical model tables. They are retained only in migration audit metadata for later Power BI RLS design.";
    }
    const isLikelyDimension = disposition === "dimension";
    const downstream = [...(consumers.get(profile.table) || [])].filter((table) => table !== profile.table);

    if ((modelBuildMode === "automatic" || modelBuildMode === "powerbi-optimized")
      && moves.length
      && uniqueColumns.length === 0
      && downstream.every((table) => Object.keys(movedToTables).includes(table))) {
      disposition = "load-disabled staging";
      includeInModel = false;
      loadEnabled = false;
      confidence = Math.max(confidence, 94);
      reason = `All non-key attributes are reconstructed in ${Object.keys(movedToTables).join(", ")}. A key-only semantic table would add no analytical value, so the complete source is retained as load-disabled staging and no relationship is exported.`;
    }

    if (modelBuildMode === "queries-only") {
      includeInModel = false;
      loadEnabled = false;
      if (profile.status === "generated") disposition = "load-disabled staging";
      reason = "Queries-only mode exports Power Query lineage without automatically creating semantic-model tables or relationships.";
    }

    const preserveQlikShape = modelBuildMode === "qlik-equivalent" || modelBuildMode === "desktop-review";
    const retainedColumns = includeInModel
      ? preserveQlikShape
        ? [...outputColumns]
        : outputColumns.filter((field) => {
            const normalized = cleanName(field).toLowerCase();
            return joinKeys.has(normalized) || !movedColumns.has(normalized);
          })
      : [];
    const retainedSet = new Set(retainedColumns.map((field) => cleanName(field).toLowerCase()));
    const prunedColumns = outputColumns.filter((field) => !retainedSet.has(cleanName(field).toLowerCase()));

    return {
      table: profile.table,
      disposition,
      includeInModel,
      loadEnabled,
      retainedColumns,
      prunedColumns,
      movedToTables,
      reason,
      confidence,
    };
  });
}

function buildFieldLineage(joins: JoinReconstructionPlan[], operations: Operation[]): FieldLineageRecord[] {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  const records: FieldLineageRecord[] = [];
  for (const join of joins) {
    const operation = byId.get(join.operationId);
    if (!operation) continue;
    join.keyColumns.forEach((field, index) => records.push({
      field,
      sourceTable: join.sourceTable,
      targetTable: join.targetTable,
      sourceExpression: operation.fieldExpressions[join.sourceKeyColumns[index] || field] || join.sourceKeyColumns[index] || field,
      operationId: join.operationId,
      role: "key",
    }));
    for (const field of join.expandColumns) records.push({
      field: join.qualifiedCollisions[field] || field,
      sourceTable: join.sourceTable,
      targetTable: join.targetTable,
      sourceExpression: operation.fieldExpressions[field] || field,
      operationId: join.operationId,
      role: /ApplyMap/i.test(operation.fieldExpressions[field] || "") ? "mapped" : "expanded",
    });
  }
  return records;
}

function buildMigrationDecisions(
  operations: Operation[],
  joins: JoinReconstructionPlan[],
  compositeKeys: CompositeKeyPlan[],
  classifications: TableClassificationPlan[],
  decisions: ReconstructionDecisionRow[],
): MigrationDecision[] {
  const result: MigrationDecision[] = decisions.map((decision) => {
    const operation = operations.find((item) => item.id === decision.operationId);
    return {
      id: decision.id,
      category: "operation",
      sourceScript: operation?.file,
      sourceStatement: operation?.raw,
      sourceTable: operation?.resident[0] || operation?.table,
      targetTable: operation?.joinTarget || operation?.concatTarget || operation?.table,
      sourceFields: operation?.fields || [],
      targetFields: operation?.fields || [],
      decision: decision.powerBiHandling,
      reason: decision.reason,
      confidence: decision.confidence,
      requiresReview: decision.decision === "manual-review" || decision.confidence < 75,
    };
  });
  for (const join of joins) result.push({
    id: `MIG-${join.id}`,
    category: "join-reconstruction",
    sourceStatement: join.qlikStatement,
    sourceTable: join.sourceTable,
    targetTable: join.targetTable,
    sourceFields: [...join.sourceKeyColumns, ...join.expandColumns],
    targetFields: [...join.keyColumns, ...join.expandColumns.map((field) => join.qualifiedCollisions[field] || field)],
    decision: `Generate ${join.joinKind} Power Query join in script sequence.`,
    reason: join.reason,
    confidence: join.confidence,
    requiresReview: !join.keyColumns.length,
  });
  for (const key of compositeKeys) result.push({
    id: `MIG-${key.id}`,
    category: "composite-key",
    sourceTable: key.leftTable,
    targetTable: key.rightTable,
    sourceFields: key.columns,
    targetFields: [key.keyColumn],
    decision: `Create one deterministic key ${key.keyColumn} on both tables.`,
    reason: key.reason,
    confidence: key.confidence,
    requiresReview: false,
  });
  for (const table of classifications) result.push({
    id: `MIG-TABLE-${cleanName(table.table)}`,
    category: "table-classification",
    sourceTable: table.table,
    targetTable: table.includeInModel ? table.table : undefined,
    sourceFields: [...table.retainedColumns, ...table.prunedColumns],
    targetFields: table.retainedColumns,
    decision: `${table.disposition}; includeInModel=${table.includeInModel}; loadEnabled=${table.loadEnabled}`,
    reason: table.reason,
    confidence: table.confidence,
    requiresReview: table.disposition === "manual review",
  });
  return result;
}

function buildDroppedPlans(operations: Operation[]): RetainedDroppedTablePlan[] {
  const dropped = uniq(operations.filter((operation) => operation.opType === "drop").map((operation) => operation.table));
  return dropped.map((table) => ({
    table,
    operationIds: operations.filter((operation) => operation.table === table && operation.opType !== "store_qvd").map((operation) => operation.id),
    retainedAsQuery: true,
    includeInModel: false,
    loadEnabled: false,
    reason: "Qlik DROP TABLE is represented as a load-disabled staging query for lineage and debugging, but it is excluded from the Power BI semantic model.",
  }));
}

function buildDecisions(
  operations: Operation[],
  profiles: Record<string, TableProfile>,
  staticTables: StaticTablePlan[],
  aggregates: AggregateMeasurePlan[],
  dropped: RetainedDroppedTablePlan[],
): ReconstructionDecisionRow[] {
  const staticByOperation = new Map(staticTables.flatMap((plan) => plan.sourceOperationIds.map((id) => [id, plan] as const)));
  const aggregateByOperation = new Map(aggregates.map((plan) => [plan.sourceOperationId, plan] as const));
  const droppedNames = new Set(dropped.map((plan) => plan.table));
  return operations.map((operation): ReconstructionDecisionRow => {
    if (operation.opType === "store_qvd") {
      return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: "STORE ... INTO QVD", decision: "omit", powerBiHandling: "Omitted. Upstream lineage is connected directly to the downstream consumer.", reason: "QVD persistence is a Qlik reload artifact, not business transformation logic.", confidence: 100 };
    }
    if (operation.opType === "drop") {
      return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: "DROP TABLE", decision: "staging-query", powerBiHandling: "Retain as a load-disabled staging query; exclude from semantic model.", reason: "Retains traceability without adding an unwanted model table.", confidence: 98 };
    }
    const staticPlan = staticByOperation.get(operation.id);
    if (staticPlan) {
      return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: operation.opType === "mapping_load" ? "MAPPING INLINE" : "INLINE", decision: staticPlan.materialize ? "static-query" : "omit", powerBiHandling: staticPlan.materialize ? `Use canonical static query ${staticPlan.canonicalName}.` : "Omit unused inline data from export.", reason: staticPlan.reason, confidence: 98 };
    }
    const aggregatePlan = aggregateByOperation.get(operation.id);
    if (aggregatePlan) {
      return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: "GROUP BY / aggregation", decision: "measure-dax", powerBiHandling: `Create DAX measure ${aggregatePlan.name}; retain row-grain source in Power Query.`, reason: "Aggregations are evaluated by filter context in the semantic model instead of creating a redundant aggregate table.", confidence: aggregatePlan.confidence };
    }
    const profile = profiles[operation.table];
    if (droppedNames.has(operation.table)) {
      return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: operation.opType, decision: "staging-query", powerBiHandling: "Build as load-disabled staging M query.", reason: "The table is dropped later in Qlik but retained in Power Query for lineage.", confidence: 95 };
    }
    if (profile?.status === "generated") {
      return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: operation.opType, decision: "materialize-m", powerBiHandling: "Translate into the consolidated final-table M query.", reason: "Operation contributes to a surviving model table.", confidence: Math.max(70, profile.confidence) };
    }
    return { id: `DEC-${operation.id}`, operationId: operation.id, table: operation.table, qlikConstruct: operation.opType, decision: "omit", powerBiHandling: "Retain in lineage metadata only.", reason: profile?.reason || "Operation does not contribute to a surviving Power BI model table.", confidence: profile?.confidence || 60 };
  });
}

export function buildQlikReconstructionPlan(
  operations: Operation[],
  profiles: Record<string, TableProfile>,
  variables: Record<string, string>,
  modelBuildMode: ModelBuildMode = "automatic",
): QlikReconstructionPlan {
  const staticTables = buildStaticTables(operations, profiles);
  const joinReconstructions = buildJoinReconstructions(operations, profiles);
  const aggregateMeasures = buildAggregateMeasures(operations, profiles);
  const variableMeasures = Object.entries(variables).map(([name, value]) => variableToDax(name, value, profiles));
  const compositeKeys = buildCompositeKeys(joinReconstructions, profiles);
  const tableClassifications = buildTableClassifications(profiles, joinReconstructions, operations, modelBuildMode);
  const fieldLineage = buildFieldLineage(joinReconstructions, operations);
  const retainedDroppedTables = buildDroppedPlans(operations);
  const omittedStoreOperationIds = operations.filter((operation) => operation.opType === "store_qvd").map((operation) => operation.id);
  const excludedModelTables = Object.values(profiles).filter((profile) => profile.status !== "generated").map((profile) => profile.table);
  const decisions = buildDecisions(operations, profiles, staticTables, aggregateMeasures, retainedDroppedTables);
  const migrationDecisions = buildMigrationDecisions(operations, joinReconstructions, compositeKeys, tableClassifications, decisions);
  const classificationByTable = new Map(tableClassifications.map((classification) => [classification.table, classification]));
  const staticAliasMap = new Map(staticTables.flatMap((plan) => plan.aliases.map((alias) => [alias, plan] as const)));
  const droppedNames = new Set(retainedDroppedTables.map((plan) => plan.table));
  const tables: Record<string, TableReconstructionPlan> = {};
  for (const profile of Object.values(profiles)) {
    const lineageOperations = operations.filter((operation) => profile.lineageIds.includes(operation.id));
    const classification = classificationByTable.get(profile.table);
    tables[profile.table] = {
      table: profile.table,
      includeInModel: classification?.includeInModel ?? profile.status === "generated",
      loadEnabled: classification?.loadEnabled ?? profile.status === "generated",
      hidden: !(classification?.includeInModel ?? profile.status === "generated"),
      classification: classification?.disposition || profile.classification,
      confidence: classification?.confidence ?? profile.confidence,
      operationIds: lineageOperations.map((operation) => operation.id),
      sourceRefs: profile.sourceRefs,
      dependencies: profile.dependencies,
      inlineDependencies: uniq(profile.inlineDependencies.map((name) => staticAliasMap.get(name)?.canonicalName || name)),
      droppedDependencies: uniq([...profile.droppedIntermediates, ...profile.dependencies.filter((name) => droppedNames.has(name))]),
      omittedStoreOperations: lineageOperations.filter((operation) => operation.opType === "store_qvd").map((operation) => operation.id),
      aggregationMeasures: aggregateMeasures.filter((measure) => measure.homeTable === profile.table || profile.lineageIds.includes(measure.sourceOperationId)).map((measure) => measure.name),
      compositeKeys: compositeKeys.filter((key) => key.leftTable === profile.table || key.rightTable === profile.table).map((key) => key.keyColumn),
      fullLoadScript: profile.lineageScript,
      decision: (classification?.includeInModel ?? profile.status === "generated") ? "materialize-m" : (classification?.loadEnabled === false || droppedNames.has(profile.table)) ? "staging-query" : "omit",
      reason: classification?.reason || profile.reason,
    };
  }
  const warnings: string[] = [];
  const unresolvedVariables = variableMeasures.filter((measure) => measure.category === "unresolved");
  if (unresolvedVariables.length) warnings.push(`${unresolvedVariables.length} variable definition(s) require review before use as DAX measures.`);
  const manualOps = operations.filter((operation) => operation.warnings.length > 0);
  if (manualOps.length) warnings.push(`${manualOps.length} operation(s) contain Qlik functions that require manual review.`);
  const unresolvedJoins = joinReconstructions.filter((join) => !join.keyColumns.length);
  if (unresolvedJoins.length) warnings.push(`${unresolvedJoins.length} JOIN/KEEP operation(s) have no deterministic common key and must be reviewed before export.`);
  const passes: ReconstructionPass[] = [
    { id: "parse", name: "Parse and normalize", status: operations.length ? "passed" : "failed", detail: `${operations.length} ordered Qlik operations were normalized.` },
    { id: "lineage", name: "Backtrack final-table lineage", status: Object.values(profiles).some((profile) => profile.status === "generated") ? "passed" : "failed", detail: `${Object.values(profiles).filter((profile) => profile.status === "generated").length} surviving tables were reconstructed from source to final state.` },
    { id: "static", name: "Consolidate inline and mapping tables", status: "passed", detail: `${staticTables.length} unique static table definition(s) remain after duplicate consolidation.` },
    { id: "joins", name: "Reconstruct joins in script order", status: joinReconstructions.some((join) => !join.keyColumns.length) ? "warning" : "passed", detail: `${joinReconstructions.length} Qlik JOIN/KEEP operation(s) were reconstructed; ${joinReconstructions.filter((join) => !join.keyColumns.length).length} require key confirmation.` },
    { id: "aggregation", name: "Move aggregations to DAX", status: "passed", detail: `${aggregateMeasures.length} aggregation measure(s) were separated from row-level Power Query logic.` },
    { id: "keys", name: "Build composite keys", status: "passed", detail: `${compositeKeys.length} explicit multi-column join(s) require deterministic composite keys; shared-name-only candidates were ignored.` },
    { id: "classification", name: "Classify and prune model tables", status: tableClassifications.some((table) => table.disposition === "manual review") ? "warning" : "passed", detail: `${tableClassifications.filter((table) => table.includeInModel).length} model table(s), ${tableClassifications.filter((table) => !table.includeInModel).length} staging/excluded table(s).` },
    { id: "model", name: "Optimize Power BI model", status: "passed", detail: `${excludedModelTables.length} helper/staging table(s) are excluded from the semantic model while lineage is retained.` },
    { id: "variables", name: "Create reusable variable measures", status: unresolvedVariables.length ? "warning" : "passed", detail: `${variableMeasures.length} Qlik variable(s) were represented once as reusable DAX measures.` },
  ];
  const failed = passes.some((pass) => pass.status === "failed");
  const warningPenalty = warnings.length * 4 + passes.filter((pass) => pass.status === "warning").length * 4;
  return {
    version: "5.0.0-governed-reconstruction",
    generatedAt: new Date().toISOString(),
    stable: !failed,
    confidence: Math.max(50, Math.min(99, 96 - warningPenalty)),
    modelBuildMode,
    passes,
    tables,
    staticTables,
    joinReconstructions,
    compositeKeys,
    tableClassifications,
    fieldLineage,
    migrationDecisions,
    aggregateMeasures,
    variableMeasures,
    retainedDroppedTables,
    omittedStoreOperationIds,
    excludedModelTables,
    decisions,
    warnings,
  };
}

export function reconstructionMeasuresAsDax(plan: QlikReconstructionPlan): DaxMeasure[] {
  const aggregate: DaxMeasure[] = plan.aggregateMeasures.map((measure) => ({
    measureName: measure.name,
    dax: measure.dax,
    qlikExpression: measure.qlikExpression,
    table: measure.homeTable,
    confidence: measure.confidence,
    notes: `Aggregation moved from Qlik ETL to DAX. Grouping fields: ${measure.groupBy.join(", ") || "visual filter context"}.`,
    source: measure.sourceOperationId,
    warning: "",
  }));
  const variables: DaxMeasure[] = plan.variableMeasures.map((measure) => ({
    measureName: measure.name,
    dax: measure.dax,
    qlikExpression: measure.originalValue,
    table: "Qlik Variables",
    confidence: measure.confidence,
    notes: `Reusable Qlik variable measure (${measure.category}). Referenced variables: ${measure.variablesUsed.join(", ") || "none"}.`,
    source: measure.id,
    warning: measure.category === "unresolved" ? "Variable definition requires review." : "",
  }));
  return [...aggregate, ...variables];
}

export function canonicalStaticAliasMap(plan: QlikReconstructionPlan): Record<string, string> {
  return Object.fromEntries(plan.staticTables.flatMap((table) => table.aliases.map((alias) => [alias, table.canonicalName])));
}
