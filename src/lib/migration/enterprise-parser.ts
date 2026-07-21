import { splitQlikScriptStatements } from "./qlik-script-normalizer";
import { compileQlikMExpression } from "./power-query/QlikMExpressionCompiler";
import { deepValidatePowerQueries, type DeepPowerQueryValidationResult } from "./power-query/MQueryDeepValidator";
import { buildQlikLogicDecisions, type QlikLogicDecision } from "./qlik-logic-policy";
import {
  buildQlikReconstructionPlan,
  canonicalStaticAliasMap,
  reconstructionMeasuresAsDax,
  type QlikReconstructionPlan,
} from "./reconstruction";

// ============================================================
// QLIK → Power BI Enterprise Analysis Engine
// Ported from qlik2pbi_enterprise_app Python source
// ============================================================

// ──────────────────────────────────────────────────────────────
// SECTION 1: Models
// ──────────────────────────────────────────────────────────────

export interface ProjectFile {
  path: string;
  ext: string;
  size: number;
  isText: boolean;
  content: string;
  note: string;
}

export interface Operation {
  id: string;
  table: string;
  opType: string;
  role: string;
  file: string;
  startLine: number;
  endLine: number;
  raw: string;
  resolvedRaw: string;
  fields: string[];
  calculatedFields: string[];
  fieldExpressions: Record<string, string>;
  sourceRefs: string[];
  resident: string[];
  qvdInputs: string[];
  qvdOutputs: string[];
  inlineColumns: string[];
  inlineRows: string[][];
  where: string;
  groupBy: string[];
  joinTarget: string;
  concatTarget: string;
  applymaps: string[];
  aggregations: string[];
  warnings: string[];
}

export interface TableProfile {
  table: string;
  classification: string;
  status: string;
  confidence: number;
  reason: string;
  fields: string[];
  sourceRefs: string[];
  qvdInputs: string[];
  qvdOutputs: string[];
  dependencies: string[];
  mappingDependencies: string[];
  inlineDependencies: string[];
  droppedIntermediates: string[];
  joinLogic: string[];
  concatLogic: string[];
  filters: string[];
  calculatedColumns: string[];
  lineageIds: string[];
  lineageScript: string;
  flowSteps: Record<string, string | number>[];
  etlStory: string;
  reviewNotes: string[];
}

export interface SourceMap {
  originalRef: string;
  mappedRef: string;
  connectorType: string;
  status: string;
  notes: string;
  table: string;
  sourceRole: string;
  effectiveRef: string;
  qvdProducerTable: string;
  bypassQvd: boolean;
}

export interface DaxMeasure {
  measureName: string;
  dax: string;
  qlikExpression: string;
  table: string;
  confidence: number;
  notes: string;
  source: string;
  warning: string;
}

export interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  score: number;
  active: boolean;
  status: string;
  reason: string;
  cardinality: string;
  filterDirection: string;
  confidence: number;
}

export interface ValidationIssue {
  severity: string;
  area: string;
  objectName: string;
  message: string;
  recommendation: string;
}

export interface PowerQueryReviewIssue {
  id: string;
  table: string;
  severity: "blocking-error" | "warning" | "info";
  category: "syntax" | "formula-firewall" | "dependency" | "data-type" | "qlik-syntax" | "manual-review";
  message: string;
  recommendation: string;
  evidence?: string;
}

export interface PowerQueryReview {
  table: string;
  status: "passed" | "warning" | "blocked";
  score: number;
  engine: "deterministic-ai-review" | "microsoft-powerquery-parser+qlik2pbi-semantic-lint";
  reviewedAt: string;
  issues: PowerQueryReviewIssue[];
}

export interface TableDataPreview {
  table: string;
  sourceName: string;
  sourceRows: Record<string, unknown>[];
  outputRows: Record<string, unknown>[];
  outputColumns: string[];
  status: "available" | "partial" | "unavailable";
  notes: string[];
}

export type ExecutionStepKind =
  | "source"
  | "select"
  | "clean"
  | "type"
  | "calculate"
  | "filter"
  | "join"
  | "expand"
  | "concatenate"
  | "final-projection"
  | "validation";

export interface TableExecutionCalculation {
  name: string;
  expression: string;
  dependencies: string[];
  phase: "pre-join" | "post-join";
  operationId: string;
}

export interface TableExecutionJoin {
  operationId: string;
  sourceTable: string;
  joinKind: string;
  leftKeys: string[];
  rightKeys: string[];
  expandColumns: string[];
  outputColumns: string[];
  qlikStatement: string;
}

export interface TableExecutionStep {
  id: string;
  order: number;
  name: string;
  kind: ExecutionStepKind;
  description: string;
  inputColumns: string[];
  outputColumns: string[];
  dependsOn: string[];
  returns: "table";
}

export interface TableExecutionPlan {
  tableName: string;
  classification: string;
  sourceTable: string;
  sourceReference: string;
  sourceQuery: string;
  operationIds: string[];
  selectedColumns: string[];
  calculations: TableExecutionCalculation[];
  filters: Array<{ expression: string; dependencies: string[]; operationId: string }>;
  joins: TableExecutionJoin[];
  finalColumns: string[];
  reviewedTypes: Record<string, string>;
  steps: TableExecutionStep[];
  warnings: string[];
}

export interface EnterpriseAnalysis {
  inventory: {
    totalFiles: number;
    textFiles: number;
    files: ProjectFile[];
  };
  operations: Operation[];
  variables: Record<string, string>;
  connections: { type: string; connection: string; file: string; line: number }[];
  profiles: Record<string, TableProfile>;
  finalTables: TableProfile[];
  excludedTables: TableProfile[];
  sourceMappings: SourceMap[];
  sourceCatalog: Record<string, string | boolean>[];
  columnTypes: Record<string, Record<string, string>>;
  columnTypeMeta: Record<string, Record<string, { source: string; confidence: number; reason: string; sampleValues: string[] }>>;
  daxMeasures: DaxMeasure[];
  mQueries: Record<string, string>;
  stagingQueries?: Record<string, string>;
  mQueryDiagnostics: Record<string, string>[];
  relationships: Relationship[];
  semanticModel: { name: string; tables: Record<string, unknown>[]; relationships: Record<string, unknown>[] };
  validation: { isReadyForPbipExport: boolean; errorCount: number; warningCount: number; issues: ValidationIssue[]; desktopDiagnostics: Record<string, string>[] };
  migrationReport: string;
  logs: string[];
  logicDecisions: QlikLogicDecision[];
  reconstruction?: QlikReconstructionPlan;
  powerQueryReviews: Record<string, PowerQueryReview>;
  tablePreviews: Record<string, TableDataPreview>;
  deepPowerQueryValidation?: DeepPowerQueryValidationResult;
  executionPlans?: Record<string, TableExecutionPlan>;
}

// ──────────────────────────────────────────────────────────────
// SECTION 2: Utilities
// ──────────────────────────────────────────────────────────────

export function cleanName(v: string, fallback = 'Object'): string {
  v = (v || '').trim().replace(/^['"\[\]`]+|['"\[\]`]+$/g, '');
  v = v.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.$#@-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return v || fallback;
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(x => { const s = String(x || '').trim(); if (!s || seen.has(s)) return false; seen.add(s); return true; });
}

export function canonicalRef(ref: string): string {
  let x = (ref || '').trim().replace(/^['"\[\]]+|['"\[\]]+$/g, '');
  x = x.replace(/\\/g, '/').replace(/\/\//g, '/');
  x = x.replace(/\$\([^)]+\)/g, '');
  return x.toLowerCase();
}

export function basenameRef(ref: string): string {
  const c = canonicalRef(ref);
  return c.split('/').pop() || '';
}

// ──────────────────────────────────────────────────────────────
// SECTION 3: Qlik Parser
// ──────────────────────────────────────────────────────────────

const AGG_RE = /\b(Sum|Count|Avg|Min|Max|RangeSum|Aggr)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/gi;
const UNSUPPORTED_PATTERNS = [
  'IntervalMatch','CrossTable','Generic Load','Peek','Previous','Exists','Autonumber',
  'Hierarchy','NoOfRows','FieldValue','SubField','Interval','FirstSortedValue'
];

function splitStatements(text: string): [string, number, number][] {
  return splitQlikScriptStatements(text).map(statement => [
    statement.cleaned,
    statement.startLine,
    statement.endLine,
  ]);
}

function splitCsvTop(s: string): string[] {
  const out: string[] = []; let cur: string[] = [], depth = 0; let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ((ch === '"' || ch === "'") && !q) q = ch;
    else if (q === ch) q = null;
    else if (!q) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) { out.push(cur.join('').trim()); cur = []; continue; }
    }
    cur.push(ch);
  }
  if (cur.length) out.push(cur.join('').trim());
  return out.filter(x => x);
}

function cleanVarValue(v: string): string {
  v = (v || '').trim().replace(/;+$/, '').trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  return v;
}

function resolveVariables(text: string, variables: Record<string, string>): string {
  let prev: string | null = null, out = text;
  for (let i = 0; i < 5; i++) {
    if (out === prev) break;
    prev = out;
    out = out.replace(/\$\(\s*([^)]+?)\s*\)/g, (m, key) => {
      const k = cleanName(key);
      return cleanVarValue(variables[k] ?? m);
    });
  }
  return out;
}

function unqRef(x: string): string {
  x = (x || '').trim().replace(/;+$/, '').trim();
  if ((x.startsWith('[') && x.endsWith(']')) || (x.startsWith('"') && x.endsWith('"')) || (x.startsWith("'") && x.endsWith("'")))
    return x.slice(1, -1);
  return x;
}

function parseFields(body: string): [string[], string[], Record<string, string>] {
  const m = body.trim().match(/^(LOAD|SELECT)\s+(.*)/is);
  if (!m) return [[], [], {}];
  const rest = m[2];
  const b = rest.search(/\b(FROM|RESIDENT|INLINE|WHERE|GROUP\s+BY|ORDER\s+BY)\b/i);
  const txt = b >= 0 ? rest.slice(0, b).trim() : rest.trim();
  if (txt === '*') return [['*'], [], { '*': '*' }];
  const fields: string[] = [], calcs: string[] = [], exprs: Record<string, string> = {};
  for (const x of splitCsvTop(txt)) {
    const am = x.match(/(.+?)\s+AS\s+(.+)$/is);
    const expr = am ? am[1].trim() : x.trim();
    const alias = cleanName(am ? am[2] : expr);
    fields.push(alias); exprs[alias] = expr;
    if (/[()+*/]|\b(if|date|num|text|ApplyMap|pick|match|wildmatch|year|month|floor|ceil|round)\b/i.test(expr) || alias !== cleanName(expr)) {
      if (!/^[A-Za-z_][A-Za-z0-9_.$#@-]*$/.test(expr)) calcs.push(alias);
    }
  }
  return [uniq(fields), uniq(calcs), exprs];
}

function parseInline(body: string): [string[], string[][]] {
  const m = body.match(/\bINLINE\s*\[(.*?)\]/is);
  if (!m) return [[], []];
  const lines = m[1].trim().split('\n').map(l => l.trim()).filter(l => l);
  if (!lines.length) return [[], []];
  const rows = lines.map(l => l.split(',').map(c => c.trim()));
  return [rows[0].map(c => cleanName(c)), rows.slice(1)];
}

function parseClause(body: string, clause: string, ends: string[]): string {
  const pattern = new RegExp('\\b' + clause.replace(' ', '\\s+') + '\\b\\s+(.*)$', 'is');
  const m = body.match(pattern);
  if (!m) return '';
  let t = m[1].trim();
  const stops: number[] = [];
  for (const e of ends) {
    const em = new RegExp('\\b' + e.replace(' ', '\\s+') + '\\b', 'i');
    const mm = t.match(em);
    if (mm?.index !== undefined) stops.push(mm.index);
  }
  return stops.length ? t.slice(0, Math.min(...stops)).trim() : t;
}

function parseLoad(raw: string, resolved: string, file: string, start: number, end: number, idx: number): Operation | null {
  let text = resolved.replace(/;+$/, '').trim(), original = raw.replace(/;+$/, '').trim();
  let table = '', body = text;
  const lm = text.match(/^\s*([A-Za-z0-9_.$#@ -]+?)\s*:\s*(.*)/s);
  if (lm) { table = cleanName(lm[1]); body = lm[2].trim(); }
  const prefixes: string[] = [];
  let joinTarget = '', concatTarget = '';
  while (true) {
    let m: RegExpMatchArray | null;
    m = body.match(/^(MAPPING|NOCONCATENATE)\s+(.*)/is);
    if (m) { prefixes.push(m[1].toUpperCase()); body = m[2].trim(); continue; }
    m = body.match(/^((?:LEFT|RIGHT|INNER|OUTER)\s+)?JOIN\s*(?:\(([^)]+)\))?\s*(.*)/is);
    if (m) {
      prefixes.push(((m[1] || '') + 'JOIN').trim().toUpperCase());
      joinTarget = cleanName(m[2] || ''); body = m[3].trim(); continue;
    }
    m = body.match(/^CONCATENATE\s*(?:\(([^)]+)\))?\s*(.*)/is);
    if (m) { prefixes.push('CONCATENATE'); concatTarget = cleanName(m[1] || ''); body = m[2].trim(); continue; }
    break;
  }
  if (!/^(LOAD|SELECT|RESIDENT)\b/i.test(body)) return null;
  if (!table) table = joinTarget ? `JoinPayload_${String(idx).padStart(5,'0')}` : concatTarget ? `ConcatenatePayload_${String(idx).padStart(5,'0')}` : `Anonymous_${String(idx).padStart(5,'0')}`;
  let role = 'load', opType = 'load';
  if (prefixes.some(p => p.includes('MAPPING'))) { role = 'mapping'; opType = 'mapping_load'; }
  else if (prefixes.some(p => p.includes('JOIN'))) { role = 'join_payload'; opType = 'join_load'; }
  else if (prefixes.includes('CONCATENATE')) { role = 'concat_payload'; opType = 'concat_load'; }
  const [fields, calcs, exprs] = parseFields(body);
  const sources = Array.from(body.matchAll(/\bFROM\s+(\[[^\]]+\]|"[^"]+"|'[^']+'|[^\s;]+)/gi)).map(m => unqRef(m[1]));
  const resident = Array.from(body.matchAll(/\bRESIDENT\s+(\[[^\]]+\]|"[^"]+"|'[^']+'|[A-Za-z0-9_.$#@-]+)/gi)).map(m => cleanName(unqRef(m[1])));
  const qvds = sources.filter(s => s.toLowerCase().endsWith('.qvd'));
  const [inlineCols, inlineRows] = parseInline(body);
  if (inlineCols.length) role = 'inline_static';
  const where = parseClause(body, 'WHERE', ['GROUP BY', 'ORDER BY']);
  const g = parseClause(body, 'GROUP BY', ['ORDER BY']);
  const groupBy = g ? splitCsvTop(g) : [];
  const aggs: string[] = [];
  AGG_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = AGG_RE.exec(body)) !== null) aggs.push(am[0]);
  const apps = Array.from(body.matchAll(/ApplyMap\s*\(\s*["']?([^,"']+)/gi)).map(m => cleanName(m[1]));
  const warns: string[] = [];
  for (const pat of UNSUPPORTED_PATTERNS) {
    if (new RegExp('\\b' + pat + '\\b', 'i').test(body)) warns.push(`${pat} requires manual review`);
  }
  return {
    id: `OP${String(idx).padStart(5,'0')}`, table: cleanName(table), opType, role, file,
    startLine: start, endLine: end, raw, resolvedRaw: resolved,
    fields, calculatedFields: calcs, fieldExpressions: exprs,
    sourceRefs: sources, resident, qvdInputs: qvds, qvdOutputs: [],
    inlineColumns: inlineCols, inlineRows, where, groupBy,
    joinTarget, concatTarget, applymaps: apps, aggregations: uniq(aggs), warnings: warns,
  };
}

export function parseProject(files: ProjectFile[]): { operations: Operation[]; variables: Record<string, string>; connections: { type: string; connection: string; file: string; line: number }[] } {
  const statements: [ProjectFile, string, number, number][] = [];
  const variables: Record<string, string> = {};
  const connections: { type: string; connection: string; file: string; line: number }[] = [];
  for (const pf of files) {
    if (!pf.isText) continue;
    for (const [raw, start, end] of splitStatements(pf.content)) {
      const norm = raw.replace(/;+$/, '').trim().replace(/\s+/g, ' ');
      const vm = norm.match(/^(SET|LET)\s+([^=]+?)\s*=\s*(.*)$/i);
      if (vm) { variables[cleanName(vm[2])] = cleanVarValue(vm[3]); continue; }
      statements.push([pf, raw, start, end]);
    }
  }
  const operations: Operation[] = [];
  let count = 0;
  // Tracks the most recently loaded non-join table name.
  // In Qlik, JOIN without an explicit table name in parentheses means
  // "join into the last loaded table". We resolve this implicit target here.
  let lastNonJoinTable = '';
  for (const [pf, raw, start, end] of statements) {
    const resolved = resolveVariables(raw, variables);
    const norm = resolved.replace(/;+$/, '').trim().replace(/\s+/g, ' ');
    const cm = norm.match(/^(ODBC|OLEDB|LIB|CUSTOM)\s+CONNECT(?:\s+TO)?\s+(.*)/i);
    if (cm) { connections.push({ type: cm[1].toUpperCase(), connection: cm[2], file: pf.path, line: start }); continue; }
    const dm = norm.match(/^DROP\s+TABLES?\s+(.+)/i);
    if (dm) {
      for (const t of dm[1].split(/,|\s+/)) {
        const tn = t.trim().replace(/;+$/, '');
        if (tn) { count++; operations.push({ id: `OP${String(count).padStart(5,'0')}`, table: cleanName(tn), opType: 'drop', role: 'dropped', file: pf.path, startLine: start, endLine: end, raw, resolvedRaw: resolved, fields: [], calculatedFields: [], fieldExpressions: {}, sourceRefs: [], resident: [], qvdInputs: [], qvdOutputs: [], inlineColumns: [], inlineRows: [], where: '', groupBy: [], joinTarget: '', concatTarget: '', applymaps: [], aggregations: [], warnings: [] }); }
      }
      continue;
    }
    const sm = norm.match(/^STORE\s+(.+?)\s+INTO\s+(.*?)(?:\s*\(.*?\))?$/i);
    if (sm) {
      count++;
      operations.push({ id: `OP${String(count).padStart(5,'0')}`, table: cleanName(sm[1]), opType: 'store_qvd', role: 'qvd_output', file: pf.path, startLine: start, endLine: end, raw, resolvedRaw: resolved, fields: [], calculatedFields: [], fieldExpressions: {}, sourceRefs: [], resident: [], qvdInputs: [], qvdOutputs: [unqRef(sm[2])], inlineColumns: [], inlineRows: [], where: '', groupBy: [], joinTarget: '', concatTarget: '', applymaps: [], aggregations: [], warnings: [] });
      continue;
    }
    const op = parseLoad(raw, resolved, pf.path, start, end, count + 1);
    if (op) {
      // Resolve implicit join target: Qlik's bare JOIN LOAD (no table name) targets
      // the most recently loaded table. If joinTarget is empty on a join_load
      // operation, fill it in from the lastNonJoinTable tracker.
      if (op.opType === 'join_load' && !op.joinTarget && lastNonJoinTable) {
        op.joinTarget = lastNonJoinTable;
      }
      // Track the last non-join, non-concat, non-mapping table for implicit targeting.
      if (op.opType === 'load' || op.opType === 'inline_static') {
        lastNonJoinTable = op.table;
      }
      count++;
      operations.push(op);
    }
  }
  return { operations, variables, connections };
}

// ──────────────────────────────────────────────────────────────
// SECTION 4: Final Table Detector
// ──────────────────────────────────────────────────────────────

const STAGE_RE = /(^tmp|^temp|^stg|^stage|_tmp$|_stg$|working|_raw$|^raw_|intermediate|scratch|work_)/i;
const METRIC_TABLE_RE = /(metric|kpi|summary|aggregate|agg|measure)/i;
const QVD_GENERATOR_RE = /(qvd.?generator|extract.?generator|qvd.?output|qvd.?stage)/i;

function qvdProducer(q: string, qvdProducerMap: Map<string, string>, qvdProducerByName: Map<string, string>): string {
  return qvdProducerMap.get(canonicalRef(q)) || qvdProducerByName.get(basenameRef(q)) || '';
}

function classifyTable(t: string, ops: Operation[], load: Operation[], dropped: Set<string>, qvdOut: Map<string, string[]>, referencedBy: Map<string, string[]>, joins: Map<string, Operation[]>, concats: Map<string, Operation[]>): [string, string, number, string] {
  if (dropped.has(t)) return ['dropped', 'excluded', 99, 'Table is explicitly dropped in Qlik script; retained only for lineage.'];
  if (load.some(o => o.opType === 'mapping_load')) return ['mapping', 'excluded', 98, 'MAPPING LOAD helper table used by ApplyMap; not exported as a Power BI table.'];
  if (load.some(o => o.opType === 'join_load') || t.startsWith('JoinPayload_')) return ['join payload', 'excluded', 96, 'JOIN payload is merged into its target table lineage and is not a standalone model table.'];
  if (load.some(o => o.opType === 'concat_load') || t.startsWith('ConcatenatePayload_')) return ['concatenate payload', 'excluded', 96, 'CONCATENATE payload is merged into its target table lineage and is not a standalone model table.'];
  const isAgg = load.some(o => (o.groupBy.length || METRIC_TABLE_RE.test(t)) && o.resident.length && o.aggregations.length);
  if (isAgg) return ['aggregated metric table', 'excluded', 91, 'Aggregated resident logic detected; converted to DAX measures by default instead of materializing as M.'];
  const hasStore = (qvdOut.get(t) || []).length > 0;
  const usedByOther = (referencedBy.get(t) || []).some(x => x !== t);
  const hasLoad = load.some(o => o.opType === 'load');
  const hasJoinInto = (joins.get(t) || []).length > 0;
  const hasConcatInto = (concats.get(t) || []).length > 0;
  const inline = load.some(o => o.inlineColumns.length > 0);
  if (hasStore && (STAGE_RE.test(t) || QVD_GENERATOR_RE.test(t)) && !hasJoinInto && !hasConcatInto) return ['qvd-generator-only', 'excluded', 90, 'Staging/generator table is used to create QVD output; it is retained in lineage but excluded from the final Power BI model.'];
  if (inline) return ['inline/static', 'generated', 89, 'INLINE/static table parsed as a safe Power BI static table.'];
  if (STAGE_RE.test(t) && (usedByOther || hasStore)) return ['temporary/staging', 'excluded', 88, 'Generic staging/raw pattern plus dependency/store evidence; retained in lineage only.'];
  if (STAGE_RE.test(t)) return ['temporary/staging', 'manual review', 65, 'Generic staging/raw name pattern detected, but no downstream usage was found; review whether this should be final.'];
  if (hasLoad || hasJoinInto || hasConcatInto) return ['final data model', 'generated', 88, 'Surviving Qlik data-model table after helper, staging, qvd-generator, join/concat payload, and dropped tables are excluded.'];
  return ['unsupported/manual-review', 'manual review', 50, 'Insufficient evidence to classify dynamically; requires review.'];
}

function buildLineage(table: string, operations: Operation[], by: Map<string, Operation[]>, joins: Map<string, Operation[]>, concats: Map<string, Operation[]>, qvdProducerMap: Map<string, string>, qvdProducerByName: Map<string, string>, visited: Set<string>): Operation[] {
  if (visited.has(table)) return [];
  visited.add(table);
  const out: Operation[] = [];
  const current = [...(by.get(table) || []), ...(joins.get(table) || []), ...(concats.get(table) || [])];
  for (const o of current) {
    out.push(o);
    const deps = [...o.resident, ...o.applymaps];
    for (const q of o.qvdInputs) { const prod = qvdProducer(q, qvdProducerMap, qvdProducerByName); if (prod) deps.push(prod); }
    for (const d of deps) { if (d && d !== table) out.push(...buildLineage(d, operations, by, joins, concats, qvdProducerMap, qvdProducerByName, visited)); }
  }
  const order = new Map(operations.map((o, i) => [o.id, i]));
  const seen = new Set<string>(); const res: Operation[] = [];
  for (const o of [...out].sort((a, b) => (order.get(a.id) ?? 999999) - (order.get(b.id) ?? 999999))) {
    if (!seen.has(o.id)) { seen.add(o.id); res.push(o); }
  }
  return res;
}

function buildFlowSteps(lineageOps: Operation[]): Record<string, string | number>[] {
  return lineageOps.map((o, i) => {
    let action = o.opType;
    if (o.opType === 'load') action = o.sourceRefs.length ? 'Source extraction' : o.resident.length ? 'Resident transformation' : o.inlineColumns.length ? 'Inline/static load' : 'LOAD transformation';
    else if (o.opType === 'mapping_load') action = 'Mapping load / ApplyMap lookup';
    else if (o.opType === 'join_load') action = `Join payload into ${o.joinTarget}`;
    else if (o.opType === 'concat_load') action = `Concatenate payload into ${o.concatTarget}`;
    else if (o.opType === 'store_qvd') action = 'Store QVD output';
    else if (o.opType === 'drop') action = 'Drop intermediate table';
    return { Seq: i+1, Operation: o.id, Table: o.table, Action: action, Role: o.role, 'Source Files': o.sourceRefs.join(', '), 'Resident Inputs': o.resident.join(', '), 'Join Target': o.joinTarget, 'Concat Target': o.concatTarget, 'QVD Inputs': o.qvdInputs.join(', '), 'QVD Outputs': o.qvdOutputs.join(', '), Where: o.where, 'Group By': o.groupBy.join(', '), Fields: (o.inlineColumns.length ? o.inlineColumns : o.fields).join(', '), 'Calculated Columns': o.calculatedFields.join(', '), ApplyMap: o.applymaps.join(', '), File: o.file, Lines: `${o.startLine}-${o.endLine}` };
  });
}

function buildEtlStory(table: string, profile: TableProfile, lineageOps: Operation[]): string {
  const lines = [`${table} is classified as ${profile.classification} with confidence ${profile.confidence}.`];
  for (const o of lineageOps) {
    if (o.opType === 'load' && o.sourceRefs.length) lines.push(`${o.table} reads source ${o.sourceRefs.join(', ')}.`);
    if (o.opType === 'store_qvd') lines.push(`${o.table} is stored to QVD ${o.qvdOutputs.join(', ')}.`);
    if (o.opType === 'load' && o.qvdInputs.length) lines.push(`${o.table} reads QVD ${o.qvdInputs.join(', ')}.`);
    if (o.opType === 'load' && o.resident.length) {
      let msg = `${o.table} is built from resident table ${o.resident.join(', ')}`;
      if (o.where) msg += ` with filter ${o.where}`;
      lines.push(msg + '.');
    }
    if (o.opType === 'join_load') lines.push(`${o.joinTarget} receives a JOIN from ${(o.resident.length ? o.resident : o.sourceRefs).join(', ') || 'inline/source load'} using fields ${o.fields.join(', ')}.`);
    if (o.opType === 'concat_load') lines.push(`${o.concatTarget} receives CONCATENATE payload from ${(o.resident.length ? o.resident : o.sourceRefs).join(', ') || 'inline/source load'}.`);
    if (o.opType === 'drop') lines.push(`Intermediate table ${o.table} is dropped and excluded from the Power BI final model.`);
  }
  if (profile.mappingDependencies.length) lines.push(`Mapping dependencies detected: ${profile.mappingDependencies.join(', ')}.`);
  if (profile.reviewNotes.length) lines.push(`Manual review notes: ${profile.reviewNotes.join('; ')}`);
  return lines.join(' ');
}

export function detectTables(operations: Operation[]): Record<string, TableProfile> {
  const by = new Map<string, Operation[]>();
  for (const o of operations) { if (!by.has(o.table)) by.set(o.table, []); by.get(o.table)!.push(o); }
  const dropped = new Set(operations.filter(o => o.opType === 'drop').map(o => o.table));
  const qvdOut = new Map<string, string[]>();
  const qvdProducerMap = new Map<string, string>();
  const qvdProducerByName = new Map<string, string>();
  for (const o of operations) {
    if (o.opType === 'store_qvd') {
      if (!qvdOut.has(o.table)) qvdOut.set(o.table, []);
      for (const q of o.qvdOutputs) { qvdOut.get(o.table)!.push(q); qvdProducerMap.set(canonicalRef(q), o.table); qvdProducerByName.set(basenameRef(q), o.table); }
    }
  }
  const joins = new Map<string, Operation[]>();
  const concats = new Map<string, Operation[]>();
  for (const o of operations) {
    if (o.opType === 'join_load' && o.joinTarget) { if (!joins.has(o.joinTarget)) joins.set(o.joinTarget, []); joins.get(o.joinTarget)!.push(o); }
    if (o.opType === 'concat_load' && o.concatTarget) { if (!concats.has(o.concatTarget)) concats.set(o.concatTarget, []); concats.get(o.concatTarget)!.push(o); }
  }
  const referencedBy = new Map<string, string[]>();
  const dependenciesOf = new Map<string, string[]>();
  for (const o of operations) {
    const deps = [...o.resident, ...o.applymaps];
    for (const q of o.qvdInputs) { const prod = qvdProducer(q, qvdProducerMap, qvdProducerByName); if (prod) deps.push(prod); }
    for (const d of deps) {
      if (!d) continue;
      if (!referencedBy.has(d)) referencedBy.set(d, []);
      referencedBy.get(d)!.push(o.table);
      if (!dependenciesOf.has(o.table)) dependenciesOf.set(o.table, []);
      dependenciesOf.get(o.table)!.push(d);
    }
    if (o.joinTarget) { if (!referencedBy.has(o.table)) referencedBy.set(o.table, []); referencedBy.get(o.table)!.push(o.joinTarget); if (!dependenciesOf.has(o.joinTarget)) dependenciesOf.set(o.joinTarget, []); dependenciesOf.get(o.joinTarget)!.push(o.table); }
    if (o.concatTarget) { if (!referencedBy.has(o.table)) referencedBy.set(o.table, []); referencedBy.get(o.table)!.push(o.concatTarget); if (!dependenciesOf.has(o.concatTarget)) dependenciesOf.set(o.concatTarget, []); dependenciesOf.get(o.concatTarget)!.push(o.table); }
  }
  const profiles: Record<string, TableProfile> = {};
  for (const [t, ops] of by) {
    const load = ops.filter(o => ['load','mapping_load','join_load','concat_load'].includes(o.opType));
    const fields = uniq(ops.flatMap(o => (o.inlineColumns.length ? o.inlineColumns : o.fields).filter(f => f !== '*')));
    const src = uniq(ops.flatMap(o => o.sourceRefs));
    const qvdi = uniq(ops.flatMap(o => o.qvdInputs));
    const deps = uniq((dependenciesOf.get(t) || []).filter(d => d && d !== t));
    const [cls, status, conf, reason] = classifyTable(t, ops, load, dropped, qvdOut, referencedBy, joins, concats);
    profiles[t] = { table: t, classification: cls, status, confidence: conf, reason, fields, sourceRefs: src, qvdInputs: qvdi, qvdOutputs: uniq(qvdOut.get(t) || []), dependencies: deps, mappingDependencies: [], inlineDependencies: [], droppedIntermediates: [], joinLogic: [], concatLogic: [], filters: uniq(ops.map(o => o.where).filter(Boolean)), calculatedColumns: uniq(ops.flatMap(o => o.calculatedFields)), lineageIds: [], lineageScript: '', flowSteps: [], etlStory: '', reviewNotes: uniq(ops.flatMap(o => o.warnings)) };
  }
  for (const [t, p] of Object.entries(profiles)) {
    if (p.status === 'generated') {
      const visited = new Set<string>();
      const lin = buildLineage(t, operations, by, joins, concats, qvdProducerMap, qvdProducerByName, visited);
      p.lineageIds = lin.map(o => o.id);
      p.lineageScript = lin.map(o => `// ${o.file} | lines ${o.startLine}-${o.endLine} | ${o.opType} | ${o.table}\n${o.raw.trim()}`).join('\n\n');
      p.fields = uniq(lin.flatMap(o => (o.inlineColumns.length ? o.inlineColumns : o.fields).filter(f => f !== '*')));
      p.sourceRefs = uniq(lin.flatMap(o => o.sourceRefs));
      p.qvdInputs = uniq(lin.flatMap(o => o.qvdInputs));
      p.qvdOutputs = uniq(lin.flatMap(o => o.qvdOutputs));
      p.dependencies = uniq(lin.flatMap(o => [...o.resident, ...o.applymaps, o.joinTarget, o.concatTarget].filter(d => d && d !== t)));
      p.mappingDependencies = uniq([...lin.filter(o => o.opType === 'mapping_load').map(o => o.table), ...lin.flatMap(o => o.applymaps)]);
      p.inlineDependencies = uniq(lin.filter(o => o.inlineColumns.length && o.table !== t).map(o => o.table));
      p.droppedIntermediates = [...visited].filter(x => dropped.has(x) && x !== t).sort();
      p.joinLogic = uniq(lin.filter(o => o.opType === 'join_load').map(o => o.raw));
      p.concatLogic = uniq(lin.filter(o => o.opType === 'concat_load').map(o => o.raw));
      p.filters = uniq(lin.map(o => o.where).filter(Boolean));
      p.calculatedColumns = uniq(lin.flatMap(o => o.calculatedFields));
      p.reviewNotes = uniq([...p.reviewNotes, ...lin.flatMap(o => o.warnings)]);
      p.flowSteps = buildFlowSteps(lin);
      p.etlStory = buildEtlStory(t, p, lin);
    }
  }
  return profiles;
}

// ──────────────────────────────────────────────────────────────
// SECTION 5: Source Connector
// ──────────────────────────────────────────────────────────────

export function connector(path: string): string {
  const p = (path || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  const noQuery = p.split('?')[0];
  // Detect semicolon-delimited key=value DB connection strings (e.g. Server=...;Database=...)
  // These come from the dynamic mapping UI and may have any key casing
  if (p.includes(';') && (p.includes('server=') || p.includes('host=') || p.includes('database=') || p.includes('db='))) {
    return 'Database/SQL';
  }
  if (p.startsWith('odbc') || p.startsWith('oledb') || p.startsWith('sql:') || p.startsWith('server=') || p.startsWith('database=') || p.includes('dsn=')) return 'Database/SQL';
  if (/^[a-z]+:\/\//.test(p) && !p.startsWith('lib://')) {
    if (noQuery.endsWith('.csv') || noQuery.endsWith('.txt') || noQuery.endsWith('.tsv') || noQuery.endsWith('.dat')) return 'CSV/Text';
    if (noQuery.endsWith('.xlsx') || noQuery.endsWith('.xls') || noQuery.endsWith('.xlsm')) return 'Excel';
    if (noQuery.endsWith('.parquet')) return 'Parquet';
    if (noQuery.endsWith('.json')) return 'JSON';
    if (noQuery.endsWith('.xml')) return 'XML';
    return 'Web/API';
  }
  if (p.includes('$(') || p.startsWith('lib://')) {
    if (noQuery.endsWith('.csv') || noQuery.endsWith('.txt') || noQuery.endsWith('.tsv') || noQuery.endsWith('.dat')) return 'CSV/Text';
    if (noQuery.endsWith('.xlsx') || noQuery.endsWith('.xls') || noQuery.endsWith('.xlsm')) return 'Excel';
    if (noQuery.endsWith('.parquet')) return 'Parquet';
    if (noQuery.endsWith('.json')) return 'JSON';
    if (noQuery.endsWith('.xml')) return 'XML';
    if (noQuery.endsWith('.qvd')) return 'QVD - map to supported source';
    return 'Unknown';
  }
  if (noQuery.endsWith('.csv') || noQuery.endsWith('.txt') || noQuery.endsWith('.tsv') || noQuery.endsWith('.dat')) return 'CSV/Text';
  if (noQuery.endsWith('.xlsx') || noQuery.endsWith('.xls') || noQuery.endsWith('.xlsm')) return 'Excel';
  if (noQuery.endsWith('.parquet')) return 'Parquet';
  if (noQuery.endsWith('.json')) return 'JSON';
  if (noQuery.endsWith('.xml')) return 'XML';
  if (noQuery.endsWith('.qvd')) return 'QVD - map to supported source';
  if (p.endsWith('/') || p.endsWith('\\')) return 'Folder';
  if (/^[a-zA-Z_][\w$#@-]*(\.[a-zA-Z_][\w$#@-]*){1,3}$/.test((path || '').trim())) return 'Database/SQL';
  return 'Unknown';
}

// ──────────────────────────────────────────────────────────────
// SECTION 6: Source Mappings
// ──────────────────────────────────────────────────────────────

function isQvd(ref: string): boolean { return (ref || '').toLowerCase().endsWith('.qvd'); }

function primaryLoad(ops: Operation[]): Operation | null {
  const loads = ops.filter(o => ['load','mapping_load'].includes(o.opType));
  if (!loads.length) return null;
  const regular = loads.filter(o => o.opType === 'load');
  return regular.length ? regular[regular.length-1] : loads[loads.length-1];
}

class QvdLineageResolver {
  private producerOpByQvd = new Map<string, Operation>();
  private producerTableByQvd = new Map<string, string>();
  private by: Map<string, Operation[]>;
  constructor(private operations: Operation[]) {
    this.by = new Map();
    for (const o of operations) { if (!this.by.has(o.table)) this.by.set(o.table, []); this.by.get(o.table)!.push(o); }
    this._build();
  }
  private _build() {
    const lastLoad: Record<string, Operation> = {};
    for (const o of this.operations) {
      if (['load','mapping_load'].includes(o.opType)) lastLoad[o.table] = o;
      else if (o.opType === 'store_qvd') {
        const prod = lastLoad[o.table];
        for (const q of o.qvdOutputs) {
          for (const key of [canonicalRef(q), basenameRef(q)]) {
            if (!key) continue;
            if (prod) this.producerOpByQvd.set(key, prod);
            this.producerTableByQvd.set(key, o.table);
          }
        }
      }
    }
  }
  producerOp(qvdRef: string): Operation | null { return this.producerOpByQvd.get(canonicalRef(qvdRef)) || this.producerOpByQvd.get(basenameRef(qvdRef)) || null; }
  producerTable(qvdRef: string): string { return this.producerTableByQvd.get(canonicalRef(qvdRef)) || this.producerTableByQvd.get(basenameRef(qvdRef)) || ''; }
  upstreamSources(qvdRef: string): string[] {
    const op = this.producerOp(qvdRef);
    return op ? this._sourcesForOp(op, new Set()) : [];
  }
  private _sourcesForTable(table: string, visited: Set<string>): string[] {
    if (visited.has(table)) return [];
    visited.add(table);
    const op = primaryLoad(this.by.get(table) || []);
    return op ? this._sourcesForOp(op, visited) : [];
  }
  private _sourcesForOp(op: Operation, visited: Set<string>): string[] {
    const refs: string[] = [];
    for (const src of op.sourceRefs) {
      if (isQvd(src)) { const prod = this.producerOp(src); if (prod) { refs.push(...this._sourcesForOp(prod, visited)); } else { refs.push(src); } }
      else { refs.push(src); }
    }
    for (const r of op.resident) refs.push(...this._sourcesForTable(r, visited));
    return uniq(refs);
  }
}

function physicalStatus(ref: string, mapped: string, ct: string, explicitStatus = ''): string {
  const rawRef = (ref || '').trim();
  mapped = (mapped || rawRef).trim();
  ct = ct || connector(mapped || rawRef);
  const stillQlikLogical = mapped === rawRef && (mapped.includes('$(') || mapped.toLowerCase().startsWith('lib://'));
  const unsupported = ['Unknown','QVD - map to supported source'].includes(ct);
  const dbIncomplete = ct === 'Database/SQL' && !(mapped.toLowerCase().includes('server=') && mapped.toLowerCase().includes('database='));
  if (explicitStatus && explicitStatus !== 'Needs review' && !dbIncomplete) return explicitStatus;
  if (mapped && mapped !== rawRef && !unsupported && !mapped.toLowerCase().endsWith('.qvd') && !dbIncomplete) return 'Mapped';
  return (unsupported || stillQlikLogical || dbIncomplete) ? 'Needs review' : 'Mapped';
}

export function buildSourceMappings(operations: Operation[], updates: Record<string, { mappedRef?: string; connectorType?: string; status?: string; notes?: string }> = {}): SourceMap[] {
  const resolver = new QvdLineageResolver(operations);
  const rows: SourceMap[] = [];
  const seen = new Set<string>();

  function getUpdate(ref: string) {
    return updates[ref] || updates[canonicalRef(ref)] || updates[basenameRef(ref)] || {};
  }

  function add(ref: string, table = '', role = 'physical source', effectiveRef?: string, producerTable = '', bypass = false, notes = '') {
    if (!ref) return;
    const key = `${ref}||${table}||${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    const u = getUpdate(ref);
    if (bypass) {
      const upstream = effectiveRef || resolver.upstreamSources(ref).join('; ');
      rows.push({ originalRef: ref, mappedRef: u.mappedRef || upstream || ref, connectorType: u.connectorType || 'QVD bypassed via lineage', status: u.status || 'Bypassed', notes: u.notes || notes || 'QVD is not loaded directly. Power Query rebuilds this step from the producer table and original source lineage.', table, sourceRole: role, effectiveRef: upstream || ref, qvdProducerTable: producerTable, bypassQvd: true });
      return;
    }
    const mapped = (u.mappedRef || effectiveRef || ref).trim();
    let ct = u.connectorType || connector(mapped) || connector(ref);
    if (['Unknown','QVD - map to supported source'].includes(ct) && mapped && mapped !== ref) ct = connector(mapped);
    const status = physicalStatus(ref, mapped, ct, u.status || '');
    rows.push({ originalRef: ref, mappedRef: mapped, connectorType: ct, status, notes: u.notes || notes, table, sourceRole: role, effectiveRef: mapped, qvdProducerTable: producerTable, bypassQvd: false });
  }

  for (const o of operations) {
    for (const src of o.sourceRefs) {
      if (isQvd(src)) {
        const prodTable = resolver.producerTable(src);
        const upstream = resolver.upstreamSources(src);
        if (prodTable && upstream.length) {
          add(src, o.table, 'qvd bypass / intermediate handoff', upstream.join('; '), prodTable, true);
          for (const uref of upstream) add(uref, prodTable, 'original source for bypassed QVD', uref, prodTable, false);
        } else {
          add(src, o.table, 'unresolved qvd source', src, '', false, 'No STORE producer found in uploaded scripts. Map this QVD to CSV/Excel/Parquet/SQL or upload the generator script.');
        }
      } else {
        add(src, o.table, 'direct source', src);
      }
    }
    for (const qvd of o.qvdInputs) {
      const prodTable = resolver.producerTable(qvd);
      const upstream = resolver.upstreamSources(qvd);
      if (prodTable && upstream.length) {
        add(qvd, o.table, 'qvd bypass / intermediate handoff', upstream.join('; '), prodTable, true);
      } else if (!o.sourceRefs.includes(qvd)) {
        add(qvd, o.table, 'unresolved qvd source', qvd, '', false, 'No STORE producer found in uploaded scripts. Map this QVD to CSV/Excel/Parquet/SQL or upload the generator script.');
      }
    }
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────
// SECTION 7: Data Types
// ──────────────────────────────────────────────────────────────

export const TYPE_OPTIONS = ['Text','Whole Number','Decimal Number','Currency / Fixed Decimal','Date','Date/Time','True/False','Any'];

const M_TYPE: Record<string, string> = { 'Text': 'type text', 'Whole Number': 'Int64.Type', 'Decimal Number': 'type number', 'Currency / Fixed Decimal': 'Currency.Type', 'Date': 'type date', 'Date/Time': 'type datetime', 'True/False': 'type logical', 'Any': 'type any' };
const BIM_TYPE: Record<string, string> = { 'Text': 'string', 'Whole Number': 'int64', 'Decimal Number': 'double', 'Currency / Fixed Decimal': 'decimal', 'Date': 'dateTime', 'Date/Time': 'dateTime', 'True/False': 'boolean', 'Any': 'string' };
const FORMAT_STRING: Record<string, string> = { 'Date': 'Short Date', 'Date/Time': 'General Date', 'Currency / Fixed Decimal': '#,0.00' };

function normalizeType(value: string): string {
  const raw = String(value || '').trim();
  const v = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const aliases: Record<string, string> = {
    'string': 'Text', 'text': 'Text', 'varchar': 'Text', 'nvarchar': 'Text',
    'int': 'Whole Number', 'integer': 'Whole Number', 'int32': 'Whole Number', 'int64': 'Whole Number',
    'long': 'Whole Number', 'whole': 'Whole Number', 'whole number': 'Whole Number',
    'number': 'Decimal Number', 'numeric': 'Decimal Number', 'decimal': 'Decimal Number',
    'decimal number': 'Decimal Number', 'double': 'Decimal Number', 'float': 'Decimal Number',
    'currency': 'Currency / Fixed Decimal', 'fixed decimal': 'Currency / Fixed Decimal',
    'fixed decimal number': 'Currency / Fixed Decimal', 'currency / fixed decimal': 'Currency / Fixed Decimal',
    'date': 'Date', 'datetime': 'Date/Time', 'date time': 'Date/Time', 'date/time': 'Date/Time',
    'timestamp': 'Date/Time', 'bool': 'True/False', 'boolean': 'True/False',
    'logical': 'True/False', 'true/false': 'True/False', 'any': 'Any', 'type any': 'Any',
  };
  return aliases[v] || TYPE_OPTIONS.find((option) => option.toLowerCase() === raw.toLowerCase()) || 'Text';
}

function mType(dtype: string): string { return M_TYPE[normalizeType(dtype)] || 'type text'; }
function bimType(dtype: string): string { return BIM_TYPE[normalizeType(dtype)] || 'string'; }

function reviewedTypeIsUserOverride(meta: EnterpriseAnalysis["columnTypeMeta"], table: string, column: string): boolean {
  return /user override/i.test(meta?.[table]?.[column]?.source || "");
}

function harmonizeRelationshipKeyTypes(
  relationships: Relationship[],
  columnTypes: Record<string, Record<string, string>>,
  columnTypeMeta: EnterpriseAnalysis["columnTypeMeta"],
): void {
  const numeric = new Set(["Whole Number", "Decimal Number", "Currency / Fixed Decimal"]);
  for (const relationship of relationships) {
    const leftType = normalizeType(columnTypes?.[relationship.fromTable]?.[relationship.fromColumn] || "Text");
    const rightType = normalizeType(columnTypes?.[relationship.toTable]?.[relationship.toColumn] || "Text");
    if (leftType === rightType) continue;
    const leftOverride = reviewedTypeIsUserOverride(columnTypeMeta, relationship.fromTable, relationship.fromColumn);
    const rightOverride = reviewedTypeIsUserOverride(columnTypeMeta, relationship.toTable, relationship.toColumn);
    if (leftOverride && rightOverride) continue;
    let targetType: string;
    if (leftOverride) targetType = leftType;
    else if (rightOverride) targetType = rightType;
    else if (/date/i.test(`${relationship.fromColumn} ${relationship.toColumn}`) || /Date/.test(`${leftType} ${rightType}`)) targetType = "Date";
    else if (numeric.has(leftType) && numeric.has(rightType)) targetType = leftType === "Whole Number" && rightType === "Whole Number" ? "Whole Number" : "Decimal Number";
    else targetType = "Text"; // safest for IDs/codes and preserves leading zeroes
    columnTypes[relationship.fromTable] ||= {};
    columnTypes[relationship.toTable] ||= {};
    columnTypes[relationship.fromTable][relationship.fromColumn] = targetType;
    columnTypes[relationship.toTable][relationship.toColumn] = targetType;
    columnTypeMeta[relationship.fromTable] ||= {};
    columnTypeMeta[relationship.toTable] ||= {};
    const reason = `Relationship key type aligned to ${targetType} for ${relationship.fromTable}[${relationship.fromColumn}] and ${relationship.toTable}[${relationship.toColumn}].`;
    for (const [table, column] of [[relationship.fromTable, relationship.fromColumn], [relationship.toTable, relationship.toColumn]] as const) {
      const current = columnTypeMeta[table][column];
      columnTypeMeta[table][column] = {
        source: current?.source || "Relationship key governance",
        confidence: Math.max(current?.confidence || 0, 94),
        reason,
        sampleValues: current?.sampleValues || [],
      };
    }
  }
}

function previewColumnValues(preview: TableDataPreview | undefined, column: string): string[] {
  if (!preview) return [];
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = [preview.outputRows, preview.sourceRows].filter((rows) => rows.length);
  let best: string[] = [];
  for (const rows of candidates) {
    const values = rows.map((row) => {
      const key = Object.keys(row).find((name) => normalized(name) === normalized(column));
      return key ? row[key] : undefined;
    }).filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
      .map((value) => String(value).trim());
    if (values.length > best.length) best = values;
  }
  return best;
}

function governRelationshipsBySample(
  relationships: Relationship[],
  previews: Record<string, TableDataPreview>,
): Relationship[] {
  const evaluated = relationships.flatMap((relationship) => {
    const manyToOne = /many.*one/i.test(relationship.cardinality);
    const oneTable = manyToOne ? relationship.toTable : relationship.fromTable;
    const oneColumn = manyToOne ? relationship.toColumn : relationship.fromColumn;
    const manyTable = manyToOne ? relationship.fromTable : relationship.toTable;
    const manyColumn = manyToOne ? relationship.fromColumn : relationship.toColumn;
    const oneValues = previewColumnValues(previews[oneTable], oneColumn);
    const manyValues = previewColumnValues(previews[manyTable], manyColumn);
    if (oneValues.length) {
      const unique = new Set(oneValues);
      if (unique.size !== oneValues.length) return [];
    }
    let overlap = -1;
    if (oneValues.length && manyValues.length) {
      const oneSet = new Set(oneValues);
      const matchingManyValues = manyValues.filter((value) => oneSet.has(value));
      overlap = new Set(matchingManyValues).size;
      if (overlap === 0) return [];
      const coverage = matchingManyValues.length / manyValues.length;
      // Date dimensions must actually cover the fact dates. A relationship to
      // a monthly/partial calendar creates blank members and misleading time
      // intelligence, so omit it unless uploaded samples demonstrate coverage.
      if (/date|calendar/i.test(`${oneTable} ${oneColumn} ${manyColumn}`) && coverage < 0.8) return [];
    }
    return [{ relationship, overlap }];
  });

  // A Power BI model should not contain multiple competing relationship paths
  // between the same pair merely because several date/attribute columns exist.
  const byPair = new Map<string, Array<{ relationship: Relationship; overlap: number }>>();
  for (const item of evaluated) {
    const key = [item.relationship.fromTable, item.relationship.toTable].sort().join("|").toLowerCase();
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(item);
  }
  const result: Relationship[] = [];
  for (const items of byPair.values()) {
    items.sort((left, right) => right.overlap - left.overlap || right.relationship.score - left.relationship.score);
    const winner = items[0];
    result.push({ ...winner.relationship, active: winner.relationship.active, reason: `${winner.relationship.reason}; sample key governance passed${winner.overlap >= 0 ? ` with ${winner.overlap} matching sample key value(s)` : ""}.` });
  }
  return result;
}
function relationshipOneSide(relationship: Relationship): { table: string; column: string } {
  return /many.*one/i.test(relationship.cardinality)
    ? { table: relationship.toTable, column: relationship.toColumn }
    : { table: relationship.fromTable, column: relationship.fromColumn };
}

function appendGovernedOneSideKey(query: string, keyColumn: string): string {
  if (!query.trim() || !keyColumn) return query;
  const stepName = `Validated_${cleanName(keyColumn)}_RelationshipKey`;
  const expression = `let
        _source = __PREVIOUS_STEP__,
        _required = if Table.HasColumns(_source, ${esc(keyColumn)}) then _source else error Error.Record("QLIK2PBI.MissingRelationshipKey", "The one-side relationship key is missing.", [Column=${esc(keyColumn)}, AvailableColumns=Table.ColumnNames(_source)]),
        _nonBlank = Table.SelectRows(_required, each let _key = Record.FieldOrDefault(_, ${esc(keyColumn)}, null) in _key <> null and Text.Trim(Text.From(_key)) <> "")
    in
        Table.Distinct(_nonBlank, {${esc(keyColumn)}})`;
  return appendTableProducingStep(query, stepName, expression);
}

/**
 * Enforces the physical requirements of a Power BI one-side table before a
 * relationship is serialized. Blank keys are removed and duplicate keys are
 * collapsed in the semantic query while the complete unmodified source remains
 * available in the load-disabled staging query. Reviewed UI types are then
 * re-applied as the authoritative final M step.
 */
function applyRelationshipKeyGovernance(
  mQueries: Record<string, string>,
  relationships: Relationship[],
  columnTypes: Record<string, Record<string, string>>,
): Record<string, string> {
  const keysByTable = new Map<string, string[]>();
  for (const relationship of relationships) {
    const side = relationshipOneSide(relationship);
    if (!keysByTable.has(side.table)) keysByTable.set(side.table, []);
    keysByTable.get(side.table)!.push(side.column);
  }
  const result = { ...mQueries };
  for (const [table, columns] of keysByTable) {
    if (!result[table]) continue;
    let query = unwrapReviewedTypeQuery(result[table]);
    for (const column of uniq(columns)) query = appendGovernedOneSideKey(query, column);
    result[table] = applyReviewedTypesToMQuery(query, columnTypesForTable(columnTypes, table));
  }
  return result;
}

function formatString(dtype: string): string { return FORMAT_STRING[normalizeType(dtype)] || ''; }


function columnTypesForTable(
  columnTypes: Record<string, Record<string, string>>,
  table: string,
): Record<string, string> {
  const entry = Object.entries(columnTypes || {}).find(([name]) => name.toLowerCase() === String(table || '').toLowerCase());
  return entry?.[1] || {};
}

function reviewedTypeForColumn(types: Record<string, string>, column: string): string {
  const entry = Object.entries(types || {}).find(([name]) => name.toLowerCase() === String(column || '').toLowerCase());
  return normalizeType(entry?.[1] || 'Text');
}

function inferDataType(columnName: string, expression = ''): string {
  const name = cleanName(columnName).toLowerCase();
  const expr = (expression || '').toLowerCase();
  if (/monthname\s*\(/.test(expr) || /quartername\s*\(/.test(expr) || /^(monthyear|monthname|quartername)$/.test(name)) return 'Text';
  if (/(name|type|code|category|subcategory|brand|segment|band|status|city|country|region|currency|description|desc|address|email|phone)$/.test(name)) return 'Text';
  if (name === 'year' || name === 'month' || name === 'quarter' || name === 'week' || /(year|month|quarter|week)$/.test(name)) return 'Whole Number';
  if (/(date|dt$|datetime|timestamp|created|modified|shipdate|orderdate|hiredate)/.test(name) || expr.includes('date#') || expr.includes('date(')) {
    return /(time|timestamp|datetime)/.test(name) ? 'Date/Time' : 'Date';
  }
  if (/(qty|quantity|count|orders|units|age|days|hours|minutes|seq|index)$/.test(name)) return 'Whole Number';
  if (/(amount|sales|cost|profit|margin|discount|price|rate|ratio|percent|pct|latitude|longitude|usd|value|total|balance|revenue|salary)/.test(name)) return 'Decimal Number';
  if (/(^is_|^has_|flag$|active$|enabled$|valid$)/.test(name)) return 'True/False';
  return 'Text';
}


function parseDelimitedRows(content: string, delimiter: string, limit = 20): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length && rows.length <= limit; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(cell); cell = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value, index) => String(value || `Column${index + 1}`).trim() || `Column${index + 1}`);
  return rows.slice(1, limit + 1).filter((values) => values.some((value) => String(value).trim() !== "")).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
  );
}

function projectFileRows(file: ProjectFile, limit = 20): Record<string, unknown>[] {
  const ext = String(file.ext || "").toLowerCase();
  const content = String(file.content || "");
  try {
    if (ext === ".csv") return parseDelimitedRows(content, ",", limit);
    if (ext === ".tsv") return parseDelimitedRows(content, "\t", limit);
    if (ext === ".json") {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object").slice(0, limit);
      if (parsed && typeof parsed === "object") {
        const firstArray = Object.values(parsed).find((value) => Array.isArray(value)) as unknown[] | undefined;
        if (firstArray) return firstArray.filter((item) => item && typeof item === "object").slice(0, limit) as Record<string, unknown>[];
        return [parsed as Record<string, unknown>];
      }
    }
  } catch {
    return [];
  }
  return [];
}

function normalizeSampleKey(value: string): string {
  return canonicalRef(value).split("/").pop()?.replace(/\.[^.]+$/, "") || cleanName(value).toLowerCase();
}

function buildRawSampleRows(
  files: ProjectFile[],
  mappings: SourceMap[],
  operations: Operation[],
): Record<string, { sourceName: string; rows: Record<string, unknown>[] }> {
  const fileCandidates = files
    .map((file) => ({ file, rows: projectFileRows(file) }))
    .filter((item) => item.rows.length > 0);
  const result: Record<string, { sourceName: string; rows: Record<string, unknown>[] }> = {};
  const mappingByTable = new Map<string, SourceMap[]>();
  for (const mapping of mappings) {
    if (!mappingByTable.has(mapping.table)) mappingByTable.set(mapping.table, []);
    mappingByTable.get(mapping.table)!.push(mapping);
  }

  for (const operation of operations) {
    if (result[operation.table]) continue;
    if (operation.inlineColumns.length && operation.inlineRows.length) {
      result[operation.table] = {
        sourceName: `${operation.table} INLINE`,
        rows: operation.inlineRows.slice(0, 20).map((values) =>
          Object.fromEntries(operation.inlineColumns.map((column, index) => [column, values[index] ?? null])),
        ),
      };
      continue;
    }
    const refs = [
      ...operation.sourceRefs,
      ...(mappingByTable.get(operation.table) || []).flatMap((mapping) => [mapping.originalRef, mapping.mappedRef, mapping.effectiveRef]),
    ].filter(Boolean);
    const refKeys = new Set(refs.flatMap((ref) => [canonicalRef(ref), basenameRef(ref), normalizeSampleKey(ref)]));
    const match = fileCandidates.find(({ file }) => {
      const keys = [canonicalRef(file.path), basenameRef(file.path), normalizeSampleKey(file.path), canonicalRef(file.path.replace(/^.*[/\\]/, ""))];
      return keys.some((key) => refKeys.has(key));
    });
    if (match) result[operation.table] = { sourceName: match.file.path, rows: match.rows };
  }

  for (const [table, mappingsForTable] of mappingByTable.entries()) {
    if (result[table]) continue;
    const refs = mappingsForTable.flatMap((mapping) => [mapping.originalRef, mapping.mappedRef, mapping.effectiveRef]).filter(Boolean);
    const refKeys = new Set(refs.flatMap((ref) => [canonicalRef(ref), basenameRef(ref), normalizeSampleKey(ref)]));
    const match = fileCandidates.find(({ file }) => [canonicalRef(file.path), basenameRef(file.path), normalizeSampleKey(file.path)].some((key) => refKeys.has(key)));
    if (match) result[table] = { sourceName: match.file.path, rows: match.rows };
  }
  return result;
}

function inferDataTypeFromSamples(values: unknown[]): string | null {
  const nonBlank = values.map((value) => value == null ? "" : String(value).trim()).filter(Boolean);
  if (!nonBlank.length) return null;
  if (nonBlank.every((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value))) return "True/False";
  if (nonBlank.every((value) => /^-?\d+$/.test(value))) return "Whole Number";
  if (nonBlank.every((value) => /^-?(?:\d+|\d*\.\d+)$/.test(value.replace(/,/g, "")))) return "Decimal Number";
  if (nonBlank.every((value) => !Number.isNaN(Date.parse(value))) && nonBlank.some((value) => /[-/]/.test(value))) {
    return nonBlank.some((value) => /[T:\s]\d{1,2}:\d{2}/.test(value)) ? "Date/Time" : "Date";
  }
  return "Text";
}

function getRowValue(row: Record<string, unknown>, column: string): unknown {
  const exact = Object.keys(row).find((key) => key.toLowerCase() === String(column).toLowerCase());
  return exact ? row[exact] : null;
}

function stripOuterParentheses(value: string): string {
  let result = value.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    let quote = "";
    for (let index = 0; index < result.length; index += 1) {
      const char = result[index];
      if (quote) { if (char === quote && result[index - 1] !== "\\") quote = ""; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) { balanced = false; break; }
    }
    if (!balanced) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function topLevelOperator(value: string, operators: string[]): { index: number; operator: string } | null {
  let depth = 0;
  let quote = "";
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (quote) { if (char === quote && value[index - 1] !== "\\") quote = ""; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === ")") { depth += 1; continue; }
    if (char === "(") { depth -= 1; continue; }
    if (depth !== 0) continue;
    for (const operator of operators) {
      const start = index - operator.length + 1;
      if (start < 0) continue;
      const candidate = value.slice(start, index + 1);
      if (candidate.toUpperCase() !== operator.toUpperCase()) continue;
      if (/^[A-Z]+$/i.test(operator)) {
        const before = value[start - 1] || " ";
        const after = value[index + 1] || " ";
        if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) continue;
      }
      return { index: start, operator };
    }
  }
  return null;
}

function previewScalar(
  expression: string,
  row: Record<string, unknown>,
  mappings: Record<string, Map<string, unknown>> = {},
): unknown {
  const clean = stripOuterParentheses(String(expression || "").trim());
  if (!clean) return null;
  const literal = qlikLiteralToM(clean);
  if (literal !== null) {
    if (literal === "null") return null;
    if (literal === "true") return true;
    if (literal === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(literal)) return Number(literal);
    if (literal.startsWith('"') && literal.endsWith('"')) return literal.slice(1, -1).replace(/""/g, '"');
  }
  if (isPlainField(clean)) return getRowValue(row, cleanName(clean));

  for (const operators of [["OR"], ["AND"], ["<>", ">=", "<=", "=", ">", "<"], ["+", "-"], ["*", "/"]]) {
    const found = topLevelOperator(clean, operators);
    if (!found) continue;
    const left = previewScalar(clean.slice(0, found.index), row, mappings);
    const right = previewScalar(clean.slice(found.index + found.operator.length), row, mappings);
    const operator = found.operator.toUpperCase();
    if (operator === "OR") return Boolean(left) || Boolean(right);
    if (operator === "AND") return Boolean(left) && Boolean(right);
    if (operator === "=") return String(left ?? "") === String(right ?? "");
    if (operator === "<>") return String(left ?? "") !== String(right ?? "");
    if (operator === ">") return Number(left) > Number(right);
    if (operator === "<") return Number(left) < Number(right);
    if (operator === ">=") return Number(left) >= Number(right);
    if (operator === "<=") return Number(left) <= Number(right);
    const l = Number(left); const r = Number(right);
    if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
    if (operator === "+") return l + r;
    if (operator === "-") return l - r;
    if (operator === "*") return l * r;
    if (operator === "/") return r === 0 ? null : l / r;
  }

  const fnMatch = clean.match(/^([A-Za-z#][A-Za-z0-9#]*)\s*\((.*)\)$/s);
  if (!fnMatch) return null;
  const fn = fnMatch[1].toLowerCase();
  const args = splitQlikArguments(fnMatch[2]);
  if (fn === "if") return previewScalar(args[0] || "false", row, mappings)
    ? previewScalar(args[1] || "null", row, mappings)
    : previewScalar(args[2] || "null", row, mappings);
  if (fn === "applymap") {
    const mapName = String(args[0] || "").replace(/^['"]|['"]$/g, "");
    const key = String(previewScalar(args[1] || "null", row, mappings) ?? "<NULL>");
    return mappings[mapName]?.get(key) ?? previewScalar(args[2] || "null", row, mappings);
  }
  if (fn === "date#" || fn === "date") {
    const value = previewScalar(args[0] || "null", row, mappings);
    if (value == null || Number.isNaN(Date.parse(String(value)))) return null;
    return String(value).slice(0, 10);
  }
  if (["year", "month", "monthname", "quartername", "week"].includes(fn)) {
    const value = previewScalar(args[0] || "null", row, mappings);
    const date = value == null ? null : new Date(String(value));
    if (!date || Number.isNaN(date.getTime())) return null;
    if (fn === "year") return date.getUTCFullYear();
    if (fn === "month") return date.getUTCMonth() + 1;
    if (fn === "monthname") return date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    if (fn === "quartername") return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - first.getTime()) / 86400000) + first.getUTCDay() + 1) / 7);
  }
  if (fn === "abs") return Math.abs(Number(previewScalar(args[0] || "0", row, mappings)));
  if (fn === "round") return Math.round(Number(previewScalar(args[0] || "0", row, mappings)));
  if (fn === "len") return String(previewScalar(args[0] || "", row, mappings) ?? "").length;
  if (fn === "trim") return String(previewScalar(args[0] || "", row, mappings) ?? "").trim();
  if (fn === "upper") return String(previewScalar(args[0] || "", row, mappings) ?? "").toUpperCase();
  if (fn === "lower") return String(previewScalar(args[0] || "", row, mappings) ?? "").toLowerCase();
  return null;
}

function simpleCalculatedPreview(expression: string, row: Record<string, unknown>, mappings: Record<string, Map<string, unknown>> = {}): unknown {
  return previewScalar(expression, row, mappings);
}

function buildTablePreviews(
  profiles: Record<string, TableProfile>,
  operations: Operation[],
  reconstruction: QlikReconstructionPlan,
  rawSamples: Record<string, { sourceName: string; rows: Record<string, unknown>[] }>,
  executionPlans: Record<string, TableExecutionPlan> = {},
): Record<string, TableDataPreview> {
  const result: Record<string, TableDataPreview> = {};
  const operationByTable = new Map<string, Operation[]>();
  for (const operation of operations) {
    if (!operationByTable.has(operation.table)) operationByTable.set(operation.table, []);
    operationByTable.get(operation.table)!.push(operation);
  }

  const normalizedSampleName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const chooseSample = (table: string, profile: TableProfile): { sourceName: string; rows: Record<string, unknown>[] } | undefined => {
    const candidates = [rawSamples[table], ...profile.dependencies.map((dependency) => rawSamples[dependency])]
      .filter(Boolean) as Array<{ sourceName: string; rows: Record<string, unknown>[] }>;
    const tableKey = normalizedSampleName(table.replace(/_raw$/i, ""));
    const score = (candidate: { sourceName: string; rows: Record<string, unknown>[] }) => {
      const sourceKey = normalizedSampleName(candidate.sourceName);
      const keys = new Set(Object.keys(candidate.rows[0] || {}).map(normalizedSampleName));
      const sourceStem = sourceKey.replace(/csv|tsv|json|data|inline/g, "");
      const affinity = sourceKey.includes(tableKey) || (sourceStem.length >= 3 && tableKey.includes(sourceStem)) ? 100000 : 0;
      const overlapCount = profile.fields.filter((field) => keys.has(normalizedSampleName(field))).length;
      return { total: affinity + overlapCount * 1000 + candidate.rows.length, affinity, overlapCount };
    };
    const ranked = candidates.sort((left, right) => score(right).total - score(left).total);
    const best = ranked[0];
    if (!best) return undefined;
    const bestScore = score(best);
    // A one-column overlap with an unrelated INLINE/mapping table is not
    // evidence that it represents the fact/dimension source. Require either a
    // filename/table affinity or at least two matching business columns.
    return bestScore.affinity > 0 || bestScore.overlapCount >= 2 ? best : undefined;
  };

  const mappingValues: Record<string, Map<string, unknown>> = {};
  for (const operation of operations.filter((item) => item.opType === "mapping_load" && item.inlineColumns.length >= 2)) {
    const map = new Map<string, unknown>();
    for (const row of operation.inlineRows) map.set(String(row[0] ?? "<NULL>"), row[1] ?? null);
    mappingValues[operation.table] = map;
  }

  const memo = new Map<string, Record<string, unknown>[]>();
  const evaluateTable = (table: string, stack = new Set<string>()): Record<string, unknown>[] => {
    if (memo.has(table)) return memo.get(table)!.map((row) => ({ ...row }));
    if (stack.has(table)) return [];
    stack.add(table);
    const tableOps = operationByTable.get(table) || [];
    const load = [...tableOps].reverse().find((operation) => ["load", "mapping_load", "concat_load"].includes(operation.opType) && !operation.joinTarget);
    let rows: Record<string, unknown>[] = [];
    if (load?.resident.length) rows = evaluateTable(load.resident[0], new Set(stack));
    else if (rawSamples[table]?.rows.length) rows = rawSamples[table].rows.slice(0, 20).map((row) => ({ ...row }));
    else {
      const profile = profiles[table];
      const chosen = profile ? chooseSample(table, profile) : undefined;
      rows = (chosen?.rows || []).slice(0, 20).map((row) => ({ ...row }));
    }

    if (load?.where) rows = rows.filter((row) => Boolean(previewScalar(load.where, row, mappingValues)));
    if (load?.fields.length && load.fields[0] !== "*") {
      rows = rows.map((row) => {
        const projected: Record<string, unknown> = {};
        for (const alias of load.fields) {
          const expression = load.fieldExpressions[alias] || alias;
          projected[alias] = isPlainField(expression)
            ? getRowValue(row, cleanName(expression))
            : simpleCalculatedPreview(expression, row, mappingValues);
        }
        return projected;
      });
    }

    const plannedJoins = executionPlans[table]?.joins || reconstruction.joinReconstructions
      .filter((item) => item.targetTable === table)
      .map((join) => ({
        operationId: join.operationId,
        sourceTable: join.sourceTable,
        joinKind: join.joinKind,
        leftKeys: join.keyColumns,
        rightKeys: join.sourceKeyColumns,
        expandColumns: join.expandColumns,
        outputColumns: join.expandColumns.map((column) => join.qualifiedCollisions[column] || column),
        qlikStatement: join.qlikStatement,
      }));
    for (const join of plannedJoins) {
      const sourceRows = evaluateTable(join.sourceTable, new Set(stack));
      if (!sourceRows.length || !rows.length || !join.leftKeys.length || join.leftKeys.length !== join.rightKeys.length) continue;
      const index = new Map<string, Record<string, unknown>>();
      for (const sourceRow of sourceRows) {
        const key = join.rightKeys.map((column) => String(getRowValue(sourceRow, column) ?? "<NULL>")).join("¦");
        if (!index.has(key)) index.set(key, sourceRow);
      }
      rows = rows.map((row) => {
        const key = join.leftKeys.map((column) => String(getRowValue(row, column) ?? "<NULL>")).join("¦");
        const joined = index.get(key);
        if (!joined) return row;
        const next = { ...row };
        join.expandColumns.forEach((column, indexPosition) => {
          next[join.outputColumns[indexPosition] || column] = getRowValue(joined, column);
        });
        return next;
      });
    }
    stack.delete(table);
    memo.set(table, rows.map((row) => ({ ...row })));
    return rows;
  };

  for (const [table, profile] of Object.entries(profiles)) {
    if (!(reconstruction.tables[table]?.includeInModel ?? profile.status === "generated")) continue;
    const chosen = chooseSample(table, profile);
    const columns = executionPlans[table]?.finalColumns || profile.fields;
    let outputRows = evaluateTable(table).slice(0, 10);
    if (columns.length && outputRows.length) {
      outputRows = outputRows.map((row) => Object.fromEntries(columns.map((column) => [column, getRowValue(row, column)])));
    }
    result[table] = {
      table,
      sourceName: chosen?.sourceName || rawSamples[table]?.sourceName || "No uploaded source sample matched",
      sourceRows: (chosen?.rows || rawSamples[table]?.rows || []).slice(0, 10),
      outputRows,
      outputColumns: columns,
      status: (chosen?.rows.length || rawSamples[table]?.rows.length) ? (outputRows.length ? "available" : "partial") : "unavailable",
      notes: (chosen?.rows.length || rawSamples[table]?.rows.length)
        ? ["Preview is executed from the same TableExecutionPlan used to generate Power Query, semantic-model columns, validation and PBIP export.", "Power BI Desktop refresh remains the final connector and privacy validation."]
        : ["No readable CSV, TSV, JSON or INLINE sample was matched to this table."],
    };
  }
  return result;
}

export function buildColumnTypes(profiles: Record<string, TableProfile>, operations: Operation[], updates: Record<string, string> = {}, sampleRowsByTable: Record<string, Record<string, unknown>[]> = {}): [Record<string, Record<string, string>>, Record<string, Record<string, { source: string; confidence: number; reason: string; sampleValues: string[] }>>] {
  const exprByTableCol: Record<string, string> = {};
  for (const op of operations) {
    for (const [col, expr] of Object.entries(op.fieldExpressions || {})) {
      exprByTableCol[`${op.table}|${col}`] = expr;
    }
  }
  const result: Record<string, Record<string, string>> = {};
  const meta: Record<string, Record<string, { source: string; confidence: number; reason: string; sampleValues: string[] }>> = {};
  for (const [table, profile] of Object.entries(profiles)) {
    if (profile.status !== 'generated') continue;
    result[table] = {}; meta[table] = {};
    for (const col of profile.fields) {
      const candidateKeys = [`${table}.${col}`, `${table}::${col}`];
      const exactKey = candidateKeys.find((key) => Object.prototype.hasOwnProperty.call(updates, key));
      const insensitiveKey = exactKey || Object.keys(updates).find((key) => candidateKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase()));
      const sampleValues = (sampleRowsByTable[table] || [])
        .map((row) => getRowValue(row, col))
        .filter((value) => value != null && String(value).trim() !== "")
        .slice(0, 10)
        .map((value) => String(value));
      if (insensitiveKey && updates[insensitiveKey]) {
        result[table][col] = normalizeType(updates[insensitiveKey]);
        meta[table][col] = { source: 'User override', confidence: 100, reason: 'Selected by user and treated as authoritative for M and TMDL.', sampleValues };
      } else {
        const sampledType = inferDataTypeFromSamples(sampleValues);
        const dtype = sampledType || inferDataType(col, exprByTableCol[`${table}|${col}`] || '');
        result[table][col] = normalizeType(dtype);
        meta[table][col] = sampledType
          ? { source: 'Uploaded data sample', confidence: 92, reason: `Inferred from ${sampleValues.length} non-blank uploaded sample value(s).`, sampleValues }
          : { source: 'Script heuristic', confidence: 60, reason: 'No source sample available; inferred from Qlik expression and column name.', sampleValues };
      }
    }
  }
  return [result, meta];
}

// ──────────────────────────────────────────────────────────────
// SECTION 8: M Query Generator
// ──────────────────────────────────────────────────────────────

const KEY_RE_M = /(id$|_id$|key$|_key$|code$|number$|no$|guid$)/i;
const UNSAFE_M_RE = /\b(LOAD|RESIDENT|ApplyMap|IntervalMatch|CrossTable|Generic Load|Peek|Previous|Autonumber)\b/i;

function esc(s: string): string { return '"' + (s || '').replace(/"/g, '""') + '"'; }
function qname(n: string): string { return '#"' + String(n).replace(/"/g, '""') + '"'; }
function lit(v: string): string {
  const value = String(v || '').trim();
  if (!value) return 'null';
  // ApplyMap defaults and INLINE values commonly arrive as Qlik literals
  // such as 'Other'.  They must be unwrapped and emitted as valid M text
  // literals rather than being double-wrapped as "'Other'".
  const converted = qlikLiteralToM(value);
  if (converted !== null) return converted;
  return esc(value);
}
function isPlainField(expr: string): boolean { return /^[A-Za-z_][A-Za-z0-9_.$#@]*$/.test((expr || '').trim()); }
function normalizeJoinKeysExpression(tableExpression: string, keys: string[]): string {
  const keyList = uniq(keys.filter(Boolean));
  if (!keyList.length) return tableExpression;
  return `Table.TransformColumns(${tableExpression}, {${keyList.map((key) => `{${esc(key)}, each if _ = null then null else Text.Upper(Text.Trim(Text.From(_, "en-US"))), type text}`).join(", ")}}, null, MissingField.Ignore)`;
}

function inlineExpression(op: Operation): string {
  const cols = op.inlineColumns;
  const rows = op.inlineRows.map(r => {
    const vals = [...r, ...Array(Math.max(0, cols.length - r.length)).fill('')];
    return '{' + vals.slice(0, cols.length).map(lit).join(', ') + '}';
  });
  return `#table(\n        {${cols.map(esc).join(', ')}},\n        {\n        ${rows.join(',\n        ')}\n        }\n    )`;
}

function dbSourceExpression(mappedRef: string, connectorType: string): string {
  const parts: Record<string, string> = {};
  for (const piece of (mappedRef || '').split(/;|\n/)) {
    if (piece.includes('=')) { const [k, v] = piece.split('=', 2); parts[k.trim().toLowerCase()] = v.trim().replace(/^["']|["']$/g, ''); }
  }
  const server = parts['server'] || parts['host'] || parts['data source'];
  const database = parts['database'] || parts['db'] || parts['initial catalog'];
  const query = parts['query'] || parts['sql'];
  const schema = parts['schema'] || 'dbo';
  const table = parts['table'] || parts['item'];
  if (!server || !database) return `error Error.Record("QLIK2PBI.SourceMapping", "Database source requires Server and Database values.", [Source=${esc(mappedRef)}])`;

  let dbFunc = 'Sql.Database';
  if (connectorType === 'PostgreSQL') dbFunc = 'PostgreSQL.Database';
  else if (connectorType === 'MySQL') dbFunc = 'MySQL.Database';

  if (query) return `${dbFunc}(${esc(server)}, ${esc(database)}, [Query=${esc(query)}])`;
  if (table) {
    if (connectorType === 'MySQL') return `${dbFunc}(${esc(server)}, ${esc(database)}){[Item=${esc(table)}]}[Data]`;
    return `${dbFunc}(${esc(server)}, ${esc(database)}){[Schema=${esc(schema)},Item=${esc(table)}]}[Data]`;
  }
  return `${dbFunc}(${esc(server)}, ${esc(database)})`;
}


function sharepointSourceExpression(mappedRef: string): string {
  const parts: Record<string, string> = {};
  for (const piece of (mappedRef || '').split(/;|\n/)) {
    if (piece.includes('=')) { const [k, v] = piece.split('=', 2); parts[k.trim().toLowerCase()] = v.trim().replace(/^["']|["']$/g, ''); }
  }
  const url = parts['siteurl'] || parts['url'] || mappedRef;
  if (!url) return `error Error.Record("QLIK2PBI.SourceMapping", "SharePoint source requires a site URL.", [Source=${esc(mappedRef)}])`;
  return `SharePoint.Files(${esc(url)}, [ApiVersion = 15])`;
}


const MAX_EMBEDDED_TEXT_SOURCE_BYTES = 25 * 1024 * 1024;
const EMBEDDABLE_SOURCE_EXTENSIONS = new Set([".csv", ".tsv", ".txt", ".json", ".xml"]);

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    let binary = "";
    for (const byte of chunk) binary += String.fromCharCode(byte);
    chunks.push(binary);
  }
  return btoa(chunks.join(""));
}

function sourceReferenceKeys(value: string): Set<string> {
  const canonical = canonicalRef(value);
  const base = basenameRef(value);
  const stem = base.replace(/\.[^.]+$/, "");
  return new Set([canonical, base, stem].filter(Boolean));
}

function findUploadedSourceFile(
  files: ProjectFile[],
  operation: Operation,
  sourceRef: string,
  mapping: SourceMap | null,
): ProjectFile | null {
  const referenceValues = [
    sourceRef,
    mapping?.originalRef || "",
    mapping?.mappedRef || "",
    mapping?.effectiveRef || "",
  ].filter(Boolean);
  const exactKeys = new Set(referenceValues.map(canonicalRef).filter(Boolean));
  const looseKeys = new Set(referenceValues.flatMap((value) => [...sourceReferenceKeys(value)]));
  const candidates = files.filter((file) => file.isText && EMBEDDABLE_SOURCE_EXTENSIONS.has(String(file.ext || "").toLowerCase()) && Boolean(file.content));
  const exact = candidates.find((file) => exactKeys.has(canonicalRef(file.path)));
  if (exact) return exact;
  const byName = candidates.find((file) => [...sourceReferenceKeys(file.path)].some((key) => looseKeys.has(key)));
  if (byName) return byName;
  const tableStem = cleanName(operation.table).toLowerCase();
  return candidates.find((file) => normalizeSampleKey(file.path) === tableStem) || null;
}

function embeddedProjectFileSourceExpression(file: ProjectFile, connectorType: string): string | null {
  const ext = String(file.ext || "").toLowerCase();
  if (!file.isText || !EMBEDDABLE_SOURCE_EXTENSIONS.has(ext) || !file.content) return null;
  if (file.size > MAX_EMBEDDED_TEXT_SOURCE_BYTES || file.content.length > MAX_EMBEDDED_TEXT_SOURCE_BYTES) return null;
  const encoded = esc(utf8Base64(file.content));
  const binary = `Binary.FromText(${encoded}, BinaryEncoding.Base64)`;
  if (ext === ".json" || connectorType === "JSON") {
    // Single-line: parse JSON binary directly, avoiding nested let...in
    return `Json.Document(${binary})`;
  }
  if (ext === ".xml" || connectorType === "XML") {
    return `Xml.Tables(${binary})`;
  }
  const delimiter = ext === ".tsv" || (ext === ".txt" && file.content.split("\n", 1)[0]?.includes("\t")) ? "#(tab)" : ",";
  // Single-line: parse CSV binary directly, avoiding nested let...in
  return `Table.PromoteHeaders(Csv.Document(${binary}, [Delimiter=${esc(delimiter)}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]), [PromoteAllScalars=true])`;
}

function sourceExpression(m: SourceMap | null, table: string, uploadedFile: ProjectFile | null = null): string {
  const embedded = uploadedFile ? embeddedProjectFileSourceExpression(uploadedFile, m?.connectorType || connector(uploadedFile.path)) : null;
  if (embedded) return embedded;
  if (!m || m.status !== 'Mapped') {
    return `error Error.Record("QLIK2PBI.SourceMapping", "No executable source mapping is available for table ${table}.", [Table=${esc(table)}, Source=${esc(m?.originalRef || "unmapped")}])`;
  }
  const rawPath = (m.mappedRef || '').trim().replace(/^["']|["']$/g, '');
  const p = esc(rawPath);
  const contentFn = /^[a-z]+:\/\//.test(rawPath.toLowerCase()) ? 'Web.Contents' : 'File.Contents';
  const ct = m.connectorType;
  if (ct === 'CSV/Text') return `Table.PromoteHeaders(Csv.Document(${contentFn}(${p}), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]), [PromoteAllScalars=true])`;
  if (ct === 'Excel') return `let _book = Excel.Workbook(${contentFn}(${p}), null, true), _candidates = Table.SelectRows(_book, each [Kind] = "Table" or [Kind] = "Sheet"), _data = if Table.RowCount(_candidates) = 0 then error Error.Record("QLIK2PBI.SourceShape", "The Excel source contains no table or sheet.", [Source=${p}]) else _candidates{0}[Data] in Table.PromoteHeaders(_data, [PromoteAllScalars=true])`;
  if (ct === 'Parquet') return `Parquet.Document(${contentFn}(${p}))`;
  if (ct === 'JSON') return `let _json = Json.Document(${contentFn}(${p})) in if Value.Is(_json, type list) then Table.FromRecords(_json) else if Value.Is(_json, type record) then Record.ToTable(_json) else error Error.Record("QLIK2PBI.SourceShape", "JSON source must contain a record or list of records.", [Source=${p}])`;
  if (ct === 'XML') return `Xml.Tables(${contentFn}(${p}))`;
  if (ct === 'Web/API') return `let _json = Json.Document(Web.Contents(${p})) in if Value.Is(_json, type list) then Table.FromRecords(_json) else if Value.Is(_json, type record) then Record.ToTable(_json) else error Error.Record("QLIK2PBI.SourceShape", "Web API response must contain a record or list of records.", [Source=${p}])`;
  if (ct === 'Folder') return `Folder.Files(${p})`;
  if (ct === 'Database/SQL' || ct === 'SQL Server' || ct === 'PostgreSQL' || ct === 'MySQL') return dbSourceExpression((m.mappedRef || '').trim(), ct);
  if (ct === 'SharePoint') return sharepointSourceExpression((m.mappedRef || '').trim());
  return `error Error.Record("QLIK2PBI.UnsupportedSource", "Unsupported source connector for table ${table}.", [Table=${esc(table)}, Connector=${esc(ct || "Unknown")}, Source=${p}])`;
}


interface SourceStagingPlan {
  queries: Record<string, string>;
  byOperationId: Map<string, string>;
  sourceModeByQuery: Record<string, "embedded-upload" | "external-connector">;
}

function shortStableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36).slice(0, 7);
}

function sourceStagingQueryName(operation: Operation, _sourceRef: string, _signature: string): string {
  return `Source_${cleanName(operation.table)}`;
}

function buildSourceStagingPlan(operations: Operation[], mappings: SourceMap[], files: ProjectFile[] = []): SourceStagingPlan {
  const mappingLookup = new Map<string, SourceMap>();
  for (const mapping of mappings) {
    if (mapping.bypassQvd) continue;
    for (const key of [mapping.originalRef, canonicalRef(mapping.originalRef), basenameRef(mapping.originalRef)]) {
      if (key && !mappingLookup.has(key)) mappingLookup.set(key, mapping);
    }
  }
  const qvdResolver = new QvdLineageResolver(operations);
  const queries: Record<string, string> = {};
  const byOperationId = new Map<string, string>();
  const queryBySignature = new Map<string, string>();
  const sourceModeByQuery: Record<string, "embedded-upload" | "external-connector"> = {};

  for (const operation of operations) {
    if (!operation.sourceRefs.length) continue;
    const sourceRef = operation.sourceRefs[0];
    if (isQvd(sourceRef) && qvdResolver.producerOp(sourceRef)) continue;
    const mapping = mappingLookup.get(sourceRef)
      || mappingLookup.get(canonicalRef(sourceRef))
      || mappingLookup.get(basenameRef(sourceRef))
      || null;
    const signature = [
      mapping?.connectorType || "Unknown",
      canonicalRef(mapping?.mappedRef || mapping?.effectiveRef || sourceRef),
    ].join("::");
    let queryName = queryBySignature.get(signature);
    if (!queryName) {
      queryName = sourceStagingQueryName(operation, sourceRef, signature);
      let suffix = 2;
      const baseName = queryName;
      while (queries[queryName]) queryName = `${baseName}_${suffix++}`;
      queryBySignature.set(signature, queryName);
      const uploadedFile = findUploadedSourceFile(files, operation, sourceRef, mapping);
      sourceModeByQuery[queryName] = uploadedFile && embeddedProjectFileSourceExpression(uploadedFile, mapping?.connectorType || connector(uploadedFile.path))
        ? "embedded-upload"
        : "external-connector";
      const rawSourceExpr = sourceExpression(mapping, operation.table, uploadedFile);
      // If the source expression is itself a let...in block (e.g. embedded CSV/JSON),
      // merge its steps into the outer let block to avoid invalid nested let expressions.
      const letInMatch = rawSourceExpr.match(/^let\s+([\s\S]+?)\s+in\s+([\w_]+)\s*$/i);
      if (letInMatch) {
        const innerSteps = letInMatch[1].trim();
        const innerResult = letInMatch[2].trim();
        queries[queryName] = `let\n    // QLIK2PBI SOURCE MODE: ${sourceModeByQuery[queryName]}\n    // QLIK2PBI SOURCE REF: ${String(uploadedFile?.path || mapping?.mappedRef || sourceRef).replace(/\r?\n/g, " ")}\n    ${innerSteps},\n    Source = ${innerResult}\nin\n    Source`;
      } else {
        queries[queryName] = `let\n    // QLIK2PBI SOURCE MODE: ${sourceModeByQuery[queryName]}\n    // QLIK2PBI SOURCE REF: ${String(uploadedFile?.path || mapping?.mappedRef || sourceRef).replace(/\r?\n/g, " ")}\n    Source = ${rawSourceExpr}\nin\n    Source`;
      }
    }
    if (operation.id) byOperationId.set(operation.id, queryName);
  }
  return { queries, byOperationId, sourceModeByQuery };
}

function operationOrderKey(operation: Operation, index: number): string {
  return `${String(operation.file || "").toLowerCase()}::${String(operation.startLine || 0).padStart(9, "0")}::${String(index).padStart(9, "0")}`;
}

function primaryPlanOperation(table: string, operationsByTable: Map<string, Operation[]>): Operation | null {
  const candidates = (operationsByTable.get(table) || []).filter((operation) =>
    !["join_load", "store", "drop", "rename", "qualify", "unqualify"].includes(operation.opType),
  );
  return candidates[candidates.length - 1] || null;
}

function tracePlanOperations(
  table: string,
  operationsByTable: Map<string, Operation[]>,
  stack = new Set<string>(),
): Operation[] {
  if (stack.has(table)) return [];
  stack.add(table);
  const operation = primaryPlanOperation(table, operationsByTable);
  if (!operation) return [];
  const upstream = operation.resident.length
    ? tracePlanOperations(operation.resident[0], operationsByTable, new Set(stack))
    : [];
  return [...upstream, operation];
}

/**
 * Builds one authoritative execution plan per final table.  The same plan is
 * consumed by local preview, M generation, validation, model projection and
 * PBIP audit output so those surfaces cannot silently diverge.
 */
export function buildTableExecutionPlans(
  profiles: Record<string, TableProfile>,
  operations: Operation[],
  reconstruction: QlikReconstructionPlan,
  columnTypes: Record<string, Record<string, string>> = {},
  sourcePlan?: SourceStagingPlan,
): Record<string, TableExecutionPlan> {
  const operationsByTable = new Map<string, Operation[]>();
  operations.forEach((operation, index) => {
    (operation as Operation & { __planOrder?: string }).__planOrder = operationOrderKey(operation, index);
    if (!operationsByTable.has(operation.table)) operationsByTable.set(operation.table, []);
    operationsByTable.get(operation.table)!.push(operation);
  });
  for (const tableOperations of operationsByTable.values()) {
    tableOperations.sort((left, right) => String((left as Operation & { __planOrder?: string }).__planOrder).localeCompare(String((right as Operation & { __planOrder?: string }).__planOrder)));
  }

  const result: Record<string, TableExecutionPlan> = {};
  for (const [tableName, profile] of Object.entries(profiles)) {
    const includeInModel = reconstruction.tables[tableName]?.includeInModel ?? profile.status === "generated";
    if (!includeInModel) continue;

    const chain = tracePlanOperations(tableName, operationsByTable);
    const sourceOperation = chain.find((operation) => operation.sourceRefs.length || operation.inlineColumns.length) || chain[0] || null;
    const planJoins = reconstruction.joinReconstructions
      .filter((join) => join.targetTable === tableName)
      .map<TableExecutionJoin>((join) => ({
        operationId: join.operationId,
        sourceTable: join.sourceTable,
        joinKind: join.joinKind,
        leftKeys: [...join.keyColumns],
        rightKeys: [...join.sourceKeyColumns],
        expandColumns: [...join.expandColumns],
        outputColumns: join.expandColumns.map((column) => join.qualifiedCollisions[column] || column),
        qlikStatement: join.qlikStatement,
      }));
    const joinedOutputs = new Set(planJoins.flatMap((join) => join.outputColumns.map((column) => column.toLowerCase())));

    const calculations: TableExecutionCalculation[] = [];
    const filters: TableExecutionPlan["filters"] = [];
    const selectedColumns: string[] = [];
    for (const operation of chain) {
      for (const alias of operation.fields || []) {
        if (!alias || alias === "*") continue;
        const expression = operation.fieldExpressions?.[alias] || alias;
        if (AGG_RE.test(expression)) { AGG_RE.lastIndex = 0; continue; }
        AGG_RE.lastIndex = 0;
        if (isPlainField(expression)) selectedColumns.push(cleanName(expression));
        else {
          const dependencies = qlikExpressionFields(expression);
          calculations.push({
            name: alias,
            expression,
            dependencies,
            phase: dependencies.some((dependency) => joinedOutputs.has(dependency.toLowerCase())) ? "post-join" : "pre-join",
            operationId: operation.id,
          });
          selectedColumns.push(...dependencies);
        }
      }
      if (operation.where) filters.push({
        expression: operation.where,
        dependencies: qlikExpressionFields(operation.where),
        operationId: operation.id,
      });
    }

    const sourceQuery = sourceOperation?.id && sourcePlan?.byOperationId.get(sourceOperation.id)
      ? sourcePlan.byOperationId.get(sourceOperation.id)!
      : "";
    const finalColumns = uniq(profile.fields.filter(Boolean));
    const reviewedTypes = columnTypesForTable(columnTypes, tableName);
    const steps: TableExecutionStep[] = [];
    const pushStep = (name: string, kind: ExecutionStepKind, description: string, inputColumns: string[] = [], outputColumns: string[] = [], dependsOn: string[] = []) => {
      steps.push({
        id: `${cleanName(tableName)}-${String(steps.length + 1).padStart(2, "0")}-${cleanName(name)}`,
        order: steps.length + 1,
        name,
        kind,
        description,
        inputColumns: uniq(inputColumns),
        outputColumns: uniq(outputColumns),
        dependsOn: uniq(dependsOn),
        returns: "table",
      });
    };

    pushStep("Source", "source", sourceQuery
      ? `Read the governed staging query ${sourceQuery}.`
      : `Read the resolved source for ${sourceOperation?.sourceRefs[0] || tableName}.`, [], selectedColumns);
    if (selectedColumns.length) pushStep("SelectedColumns", "select", "Select only source fields required by the final table and its row calculations.", selectedColumns, selectedColumns);
    if (filters.length) pushStep("FilteredRows", "filter", `Apply ${filters.length} Qlik row filter(s) after their dependencies are available.`, selectedColumns, selectedColumns, filters.flatMap((filter) => filter.dependencies));
    for (const calculation of calculations.filter((item) => item.phase === "pre-join")) {
      pushStep(`Calculated_${calculation.name}`, "calculate", `Calculate ${calculation.name} before joins because it depends only on source-row fields.`, calculation.dependencies, [calculation.name], calculation.dependencies);
    }
    for (const join of planJoins) {
      pushStep(`Joined_${cleanName(join.sourceTable)}`, "join", `${join.joinKind} join ${join.sourceTable} using ${join.leftKeys.join(" + ") || "unresolved key"}.`, join.leftKeys, join.leftKeys, join.leftKeys);
      if (join.outputColumns.length) pushStep(`Expanded_${cleanName(join.sourceTable)}Fields`, "expand", `Add only the Qlik-selected payload fields from ${join.sourceTable}.`, join.expandColumns, join.outputColumns, join.rightKeys);
    }
    for (const calculation of calculations.filter((item) => item.phase === "post-join")) {
      pushStep(`Calculated_${calculation.name}`, "calculate", `Calculate ${calculation.name} after joins because it depends on joined attributes.`, calculation.dependencies, [calculation.name], calculation.dependencies);
    }
    pushStep(`Final${cleanName(tableName)}Columns`, "final-projection", "Project the exact semantic-model schema with MissingField.Error so missing fields cannot be silently fabricated.", finalColumns, finalColumns);
    pushStep("ReviewedTypeConversions", "type", "Apply the UI-reviewed Power BI data types once, as the final table-producing step.", finalColumns, finalColumns);
    pushStep("ValidatedOutput", "validation", "Parse the M query and compare the locally reconstructed ten-row output against this execution plan before PBIP export.", finalColumns, finalColumns);

    const warnings: string[] = [];
    if (!sourceOperation) warnings.push("No deterministic physical or resident source operation was found.");
    for (const join of planJoins) if (!join.leftKeys.length || join.leftKeys.length !== join.rightKeys.length) warnings.push(`Join ${join.sourceTable} has unresolved or mismatched key fields.`);

    result[tableName] = {
      tableName,
      classification: profile.classification,
      sourceTable: sourceOperation?.table || tableName,
      sourceReference: sourceOperation?.sourceRefs[0] || "",
      sourceQuery,
      operationIds: chain.map((operation) => operation.id),
      selectedColumns: uniq(selectedColumns),
      calculations,
      filters,
      joins: planJoins,
      finalColumns,
      reviewedTypes: { ...reviewedTypes },
      steps,
      warnings,
    };
  }
  return result;
}

function annotatePreviewSourceBindings(
  previews: Record<string, TableDataPreview>,
  mQueries: Record<string, string>,
  stagingQueries: Record<string, string>,
): void {
  for (const [table, preview] of Object.entries(previews)) {
    const query = mQueries[table] || "";
    const references = [...query.matchAll(/#"((?:""|[^"])*)"/g)].map((match) => match[1].replace(/""/g, '"'));
    const sourceQueries = uniq(references.filter((reference) => /QLIK2PBI SOURCE MODE:/i.test(stagingQueries[reference] || "")));
    if (!sourceQueries.length) continue;
    const modes = sourceQueries.map((reference) => /SOURCE MODE:\s*embedded-upload/i.test(stagingQueries[reference] || "") ? "embedded-upload" : "external-connector");
    if (modes.every((mode) => mode === "embedded-upload")) {
      const note = `Power Query source binding: the same uploaded source bytes used by this preview are embedded in ${sourceQueries.join(", ")}.`;
      if (!preview.notes.includes(note)) preview.notes.unshift(note);
    } else {
      const note = `Power Query source binding: ${sourceQueries.join(", ")} uses an external connector and must be refreshed with a valid path, credential and privacy setting.`;
      if (!preview.notes.includes(note)) preview.notes.unshift(note);
    }
  }
}


function converterFunction(dtype: string): string {
  const d = normalizeType(dtype);
  if (d === 'Text') return 'try (if _ = null then null else Text.From(_, "en-US")) otherwise null';
  if (d === 'Whole Number') return 'try (if _ = null then null else Int64.From(_)) otherwise try Int64.From(Number.FromText(Text.Trim(Text.From(_)), "en-US")) otherwise null';
  if (d === 'Decimal Number') return 'try (if _ = null then null else Number.From(_)) otherwise try Number.FromText(Text.Trim(Text.From(_)), "en-US") otherwise null';
  if (d === 'Currency / Fixed Decimal') return 'try (if _ = null then null else Currency.From(_)) otherwise try Currency.From(Number.FromText(Text.Trim(Text.From(_)), "en-US")) otherwise null';
  if (d === 'Date') return 'try (if _ = null then null else Date.From(_)) otherwise try Date.FromText(Text.Trim(Text.From(_)), [Culture="en-US"]) otherwise null';
  if (d === 'Date/Time') return 'try (if _ = null then null else DateTime.From(_)) otherwise try DateTime.FromText(Text.Trim(Text.From(_)), [Culture="en-US"]) otherwise null';
  if (d === 'True/False') return 'try (if _ = null then null else if Value.Is(_, type logical) then _ else if Value.Is(_, type number) then _ <> 0 else let _text = Text.Lower(Text.Trim(Text.From(_))) in if List.Contains({"true", "yes", "y", "1"}, _text) then true else if List.Contains({"false", "no", "n", "0"}, _text) then false else Logical.From(_)) otherwise null';
  return '_';
}

function normalizedReviewedTypes(columnTypes: Record<string, string>): Array<[string, string]> {
  const seen = new Set<string>();
  const result: Array<[string, string]> = [];
  for (const [rawColumn, rawType] of Object.entries(columnTypes || {})) {
    const column = String(rawColumn || '').trim();
    if (!column) continue;
    const key = column.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([column, normalizeType(rawType)]);
  }
  return result;
}

function reviewedTypeColumnList(types: Array<[string, string]>): string {
  return `{${types.map(([column]) => esc(column)).join(', ')}}`;
}

function reviewedTypeValueOperations(types: Array<[string, string]>): string {
  return `{${types.map(([column, type]) => `{${esc(column)}, each ${converterFunction(type)}, ${mType(type)}}`).join(', ')}}`;
}

function reviewedTypeMetadataOperations(types: Array<[string, string]>): string {
  return `{${types.map(([column, type]) => `{${esc(column)}, ${mType(type)}}`).join(', ')}}`;
}

/**
 * Builds the authoritative final type pipeline used by every generated table.
 *
 * Table.TransformColumns sanitises source values without allowing one invalid
 * value to fail the complete refresh. Table.TransformColumnTypes is then kept
 * as the final operation because Power Query Desktop uses that operation to
 * commit and display the selected column types in the query schema.
 */
function reviewedTypeTransformExpression(previousStep: string, columnTypes: Record<string, string>): string {
  const types = normalizedReviewedTypes(columnTypes);
  if (!types.length) return previousStep;
  const columns = reviewedTypeColumnList(types);
  const valueOperations = reviewedTypeValueOperations(types);
  const metadataOperations = reviewedTypeMetadataOperations(types);
  return `let
            _source = ${previousStep},
            _availableColumns = Table.ColumnNames(_source),
            _valueOperations = List.Select(${valueOperations}, each List.Contains(_availableColumns, _{0})),
            _metadataOperations = List.Select(${metadataOperations}, each List.Contains(_availableColumns, _{0})),
            _sanitised = Table.TransformColumns(_source, _valueOperations, null, MissingField.Error)
        in
            Table.TransformColumnTypes(_sanitised, _metadataOperations, "en-US")`;
}

function indentM(text: string, spaces = 8): string {
  const prefix = ' '.repeat(spaces);
  return String(text || '').split('\n').map((line) => `${prefix}${line}`).join('\n');
}

interface ParsedLetQuery {
  body: string;
  finalExpression: string;
}

function parseTopLevelLetQuery(query: string): ParsedLetQuery | null {
  const text = String(query || '').trim();
  if (!/^let\b/i.test(text)) return null;
  let inString = false;
  let lineComment = false;
  let blockComment = false;
  let depth = 0;
  let outerIn = -1;
  const wordAt = (index: number) => {
    const match = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    return match?.[0] || '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] || '';
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (inString) {
      if (char === '"' && next === '"') { index += 1; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"') { inString = true; continue; }
    if (!/[A-Za-z_]/.test(char)) continue;
    const word = wordAt(index);
    if (!word) continue;
    const lower = word.toLowerCase();
    if (lower === 'let') depth += 1;
    else if (lower === 'in') {
      depth -= 1;
      if (depth === 0) { outerIn = index; break; }
    }
    index += word.length - 1;
  }
  if (outerIn < 0) return null;
  return {
    body: text.slice(text.match(/^let\b/i)![0].length, outerIn).trim(),
    finalExpression: text.slice(outerIn + 2).trim(),
  };
}

function lastTopLevelAssignmentName(body: string): string | null {
  const matches = [...String(body || '').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

function uniqueStepNameForQuery(query: string, desiredName: string): string {
  const parsed = parseTopLevelLetQuery(query);
  const body = parsed?.body || query;
  let candidate = cleanName(desiredName);
  let suffix = 2;
  const exists = (name: string) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*${escapedName}\\s*=`, "m").test(body);
  };
  while (exists(candidate)) candidate = `${cleanName(desiredName)}_${suffix++}`;
  return candidate;
}

function appendTableProducingStep(query: string, stepName: string, expression: string, comments: string[] = []): string {
  stepName = uniqueStepNameForQuery(query, stepName);
  const parsed = parseTopLevelLetQuery(query);
  if (!parsed) {
    return `let\n    Source = (\n${indentM(query, 8)}\n    ),\n    ${comments.map((comment) => `// ${comment}\n    `).join('')}${stepName} = ${expression.replace(/\b__PREVIOUS_STEP__\b/g, 'Source')}\nin\n    ${stepName}`;
  }
  const body = parsed.body.replace(/,\s*$/, '');
  const expressionWithSource = expression.replace(/\b__PREVIOUS_STEP__\b/g, parsed.finalExpression);
  const renderedComments = comments.map((comment) => `    // ${comment}`).join('\n');
  return `let\n${indentM(body, 4)},\n${renderedComments ? `${renderedComments}\n` : ''}    ${stepName} = ${expressionWithSource}\nin\n    ${stepName}`;
}

function removeAppendedReviewedTypes(query: string): string {
  const parsed = parseTopLevelLetQuery(query);
  if (!parsed || !parsed.body.includes(REVIEWED_TYPES_BEGIN)) return query;
  const markerIndex = parsed.body.indexOf(REVIEWED_TYPES_BEGIN);
  const baseBody = parsed.body.slice(0, markerIndex).replace(/,\s*$/, '').trim();
  const reviewedBody = parsed.body.slice(markerIndex);
  const sourceMatch = reviewedBody.match(/Table\.TransformColumns\(\s*([A-Za-z_][A-Za-z0-9_]*)/);
  const finalName = sourceMatch?.[1] || lastTopLevelAssignmentName(baseBody);
  if (!finalName) return query;
  return `let\n${indentM(baseBody, 4)}\nin\n    ${finalName}`;
}

const REVIEWED_TYPES_BEGIN = '// QLIK2PBI REVIEWED TYPES BEGIN';
const REVIEWED_TYPES_END = '// QLIK2PBI REVIEWED TYPES END';

function splitQlikArguments(value: string): string[] {
  const result: string[] = [];
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
    if (char === "," && depth === 0) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

const QLIK_M_RESERVED = new Set([
  "if", "then", "else", "and", "or", "not", "null", "true", "false",
  "date", "date#", "year", "month", "monthname", "quartername", "week",
  "abs", "round", "floor", "ceil", "len", "trim", "upper", "lower",
  "applymap", "today", "now",
]);

function qlikExpressionFields(expression: string): string[] {
  const withoutStrings = String(expression || "").replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, " ");
  return uniq([...withoutStrings.matchAll(/\[([^\]]+)\]|\b([A-Za-z_][A-Za-z0-9_.$#@]*)\b/g)]
    .map((match) => cleanName(match[1] || match[2] || ""))
    .filter((name) => name && !QLIK_M_RESERVED.has(name.toLowerCase()) && !/^v[A-Z_]/.test(name) && !/^\d/.test(name)));
}

function qlikLiteralToM(value: string): string | null {
  const trimmed = value.trim();
  if (/^null\(\)$/i.test(trimmed) || /^null$/i.test(trimmed)) return "null";
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^'(?:''|[^'])*'$/.test(trimmed)) return esc(trimmed.slice(1, -1).replace(/''/g, "'"));
  if (/^"(?:""|[^"])*"$/.test(trimmed)) return esc(trimmed.slice(1, -1).replace(/""/g, '"'));
  return null;
}

function qlikSingleQuotedTextToM(expression: string): string {
  // Qlik uses single quotes for text values; Power Query M requires double
  // quoted text literals. Preserve Qlik's doubled-apostrophe escaping.
  return String(expression || '').replace(/'(?:''|[^'])*'/g, (token) =>
    esc(token.slice(1, -1).replace(/''/g, "'")),
  );
}

function qlikConditionToM(expression: string): string | null {
  let converted = qlikSingleQuotedTextToM(expression.trim());
  converted = converted.replace(/<>/g, "!=").replace(/\bAND\b/gi, "and").replace(/\bOR\b/gi, "or");
  // Qlik equality uses '=' while M uses '=' as well. Convert field tokens and
  // preserve quoted strings/numbers/operators.
  const tokens = qlikExpressionFields(converted).sort((left, right) => right.length - left.length);
  for (const field of tokens) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    converted = converted.replace(new RegExp(`(?<![A-Za-z0-9_])\\[?${escaped}\\]?(?![A-Za-z0-9_])`, "g"), `Record.FieldOrDefault(_, ${esc(field)}, null)`);
  }
  return converted || null;
}

function qlikScalarExpressionToM(expression: string): string | null {
  const trimmed = expression.trim();
  const literal = qlikLiteralToM(trimmed);
  if (literal !== null) return literal;
  if (isPlainField(trimmed)) return `Record.FieldOrDefault(_, ${esc(cleanName(trimmed))}, null)`;

  const functionMatch = trimmed.match(/^([A-Za-z#][A-Za-z0-9#]*)\s*\((.*)\)$/s);
  if (functionMatch) {
    const fn = functionMatch[1].toLowerCase();
    const args = splitQlikArguments(functionMatch[2]);
    if (fn === "date#" || fn === "date") {
      const source = args[0] ? qlikScalarExpressionToM(args[0]) : null;
      return source ? `try Date.From(${source}) otherwise try Date.FromText(Text.From(${source}), [Culture="en-US"]) otherwise null` : null;
    }
    if (["year", "month", "week", "monthname", "quartername"].includes(fn)) {
      const source = args[0] ? qlikScalarExpressionToM(args[0]) : null;
      if (!source) return null;
      const date = `(try Date.From(${source}) otherwise null)`;
      if (fn === "year") return `let _date = ${date} in if _date = null then null else Date.Year(_date)`;
      if (fn === "month") return `let _date = ${date} in if _date = null then null else Date.Month(_date)`;
      if (fn === "week") return `let _date = ${date} in if _date = null then null else Date.WeekOfYear(_date, Day.Monday)`;
      if (fn === "monthname") return `let _date = ${date} in if _date = null then null else Date.ToText(_date, "MMM yyyy", "en-US")`;
      return `let _date = ${date} in if _date = null then null else "Q" & Text.From(Date.QuarterOfYear(_date)) & " " & Text.From(Date.Year(_date))`;
    }
    if (fn === "if" && args.length >= 2) {
      const condition = qlikConditionToM(args[0]);
      const whenTrue = qlikScalarExpressionToM(args[1]);
      const whenFalse = qlikScalarExpressionToM(args[2] || "null");
      return condition && whenTrue && whenFalse ? `if ${condition} then ${whenTrue} else ${whenFalse}` : null;
    }
    if (fn === "abs" && args[0]) {
      const value = qlikScalarExpressionToM(args[0]);
      return value ? `try Number.Abs(Number.From(${value})) otherwise null` : null;
    }
    if (fn === "round" && args[0]) {
      const value = qlikScalarExpressionToM(args[0]);
      return value ? `try Number.Round(Number.From(${value})) otherwise null` : null;
    }
    if (fn === "len" && args[0]) {
      const value = qlikScalarExpressionToM(args[0]);
      return value ? `try Text.Length(Text.From(${value})) otherwise null` : null;
    }
    if (["trim", "upper", "lower"].includes(fn) && args[0]) {
      const value = qlikScalarExpressionToM(args[0]);
      if (!value) return null;
      const operation = fn === "trim" ? "Text.Trim" : fn === "upper" ? "Text.Upper" : "Text.Lower";
      return `try ${operation}(Text.From(${value})) otherwise null`;
    }
  }

  // Safe row-level arithmetic/comparison expressions. Replace field tokens
  // with record access and reject any remaining unsupported function calls.
  if (/^[A-Za-z0-9_.$#@\[\] '\"()+\-*/<>=.,]+$/.test(trimmed) && !/[A-Za-z#][A-Za-z0-9#]*\s*\(/.test(trimmed)) {
    const converted = qlikConditionToM(trimmed);
    return converted ? `try (${converted}) otherwise null` : null;
  }
  return null;
}

function reviewedTypeSignature(columnTypes: Record<string, string>): string {
  return normalizedReviewedTypes(columnTypes)
    .map(([column, type]) => `${column.toLowerCase()}:${type}`)
    .sort()
    .join('|');
}


function hasAuthoritativeReviewedTypes(query: string, columnTypes: Record<string, string>): boolean {
  const reviewed = normalizedReviewedTypes(columnTypes);
  if (!reviewed.length) return true;
  const signature = reviewedTypeSignature(columnTypes);
  return Boolean(
    query.includes(REVIEWED_TYPES_BEGIN)
    && query.includes(`// QLIK2PBI REVIEWED TYPES SIGNATURE: ${signature}`)
    && query.includes('Table.TransformColumnTypes')
    && reviewed.every(([column, type]) => query.includes(`{${esc(column)}, ${mType(type)}}`))
    && /\bin\s+ReviewedTypeConversions\s*$/i.test(query),
  );
}

function unwrapReviewedTypeQuery(query: string): string {
  if (query.includes(REVIEWED_TYPES_BEGIN) && !query.includes('QLIK2PBI_ReviewedSource = (')) return removeAppendedReviewedTypes(query);
  if (!query.includes(REVIEWED_TYPES_BEGIN) || !query.includes('QLIK2PBI_ReviewedSource = (')) return query;
  const assignment = 'QLIK2PBI_ReviewedSource = (';
  const start = query.indexOf(assignment);
  if (start < 0) return query;
  const openIndex = start + assignment.length - 1;
  let depth = 0;
  let inString = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < query.length; i++) {
    const ch = query[i];
    const next = query[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (inString) {
      if (ch === '"' && next === '"') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return query.slice(openIndex + 1, i).trim();
    }
  }
  return query;
}

class MBuilder {
  private assignments: [string, string][] = [];
  private step = 1;
  private cache = new Map<string, string>();
  private opCache = new Map<string, string>();
  private stack = new Set<string>();
  private mappingLookup: Map<string, SourceMap>;
  private stepCounts = new Map<string, number>();
  private deferredCalculations: Array<{ alias: string; expression: string; operationId: string }> = [];

  constructor(
    private by: Map<string, Operation[]>,
    private joins: Map<string, Operation[]>,
    private concats: Map<string, Operation[]>,
    private generated: Set<string>,
    private mappings: Map<string, SourceMap>,
    private qvdResolver: QvdLineageResolver,
    private columnTypes: Record<string, Record<string, string>>,
    private staticAliases: Record<string, string> = {},
    private joinPlans: Map<string, QlikReconstructionPlan["joinReconstructions"][number]> = new Map(),
    private sourceQueryByOperationId: Map<string, string> = new Map(),
    private variableValues: Record<string, string> = {},
    private finalTableName = "",
    private executionPlans: Record<string, TableExecutionPlan> = {},
  ) {
    this.mappingLookup = mappings;
  }

  private nextStep(prefix: string): string {
    const clean = cleanName(prefix);
    const count = (this.stepCounts.get(clean) || 0) + 1;
    this.stepCounts.set(clean, count);
    this.step++;
    return count === 1 ? clean : `${clean}_${count}`;
  }
  private addStep(name: string, expr: string): string { this.assignments.push([name, expr || '#table({}, {}']); return name; }

  private render(finalStep: string): string {
    const lines = ['let'];
    for (let i = 0; i < this.assignments.length; i++) {
      const [name, expr] = this.assignments[i];
      const exprLines = expr.split('\n');
      lines.push(`    ${name} = ${exprLines[0]}`);
      for (const line of exprLines.slice(1)) lines.push('        ' + line);
      if (i < this.assignments.length - 1) lines[lines.length-1] += ',';
    }
    lines.push('in'); lines.push(`    ${finalStep}`);
    return lines.join('\n');
  }

  buildFinalTable(table: string): string {
    try {
      let prev = this.buildTable(table, false);
      for (const c of (this.concats.get(table) || [])) {
        const payload = this.buildPayload(c);
        const nm = this.nextStep(`Concat_${table}`);
        this.addStep(nm, `Table.Combine({${prev}, ${payload}})`);
        prev = nm;
      }
      const seenJoins = new Set<string>();
      for (const j of (this.joins.get(table) || [])) {
        const signature = [j.joinTarget, ...j.resident, ...j.sourceRefs, ...j.fields].map((value) => String(value || '').toLowerCase()).join('|');
        if (seenJoins.has(signature)) continue;
        seenJoins.add(signature);
        prev = this.applyJoin(prev, j);
      }
      for (const calculation of this.deferredCalculations) {
        const compiled = this.compileRowExpression(calculation.expression);
        const step = this.nextStep(`Calculated_${calculation.alias}`);
        this.addStep(
          step,
          compiled.code
            ? this.addOrReplaceColumnExpression(prev, calculation.alias, compiled.code)
            : `error Error.Record("QLIK2PBI.UnsupportedPostJoinExpression", "A post-join Qlik expression could not be deterministically converted.", [Table=${esc(table)}, Column=${esc(calculation.alias)}, Expression=${esc(calculation.expression.slice(0, 500))}])`,
        );
        prev = step;
      }
      // Authoritative data types are applied after every structural operation
      // (including composite-key creation) by buildMQueries.
      return this.render(prev);
    } catch (ex) {
      const message = ex instanceof Error ? ex.message : String(ex);
      return `let\n    Source = error Error.Record("QLIK2PBI.Generation", ${esc(message)}, [Table=${esc(table)}])\nin\n    Source`;
    }
  }

  buildStagingTable(table: string): string {
    try {
      let prev = this.buildTable(table, false);
      prev = this.applyTypeConversions(prev, table);
      return this.render(prev);
    } catch (ex) {
      const message = ex instanceof Error ? ex.message : String(ex);
      return `let
    Source = error Error.Record("QLIK2PBI.StagingGeneration", ${esc(message)}, [Table=${esc(table)}])
in
    Source`;
    }
  }

  private buildTable(table: string, allowQueryRef = true): string {
    if (allowQueryRef && this.generated.has(table)) return qname(table);
    if (this.cache.has(table)) return this.cache.get(table)!;
    if (this.stack.has(table)) { const nm = this.nextStep(`Cycle_${table}`); this.addStep(nm, `error Error.Record("QLIK2PBI.Cycle", "A cyclic resident-load dependency was detected.", [Table=${esc(table)}])`); return nm; }
    this.stack.add(table);
    const op = primaryLoad(this.by.get(table) || []);
    if (!op) { const nm = this.nextStep(`Missing_${table}`); this.addStep(nm, `error Error.Record("QLIK2PBI.MissingTablePlan", "No deterministic load operation was found for the table.", [Table=${esc(table)}])`); this.stack.delete(table); return nm; }
    const prev = this.buildOp(op);
    this.cache.set(table, prev); this.stack.delete(table);
    return prev;
  }

  private buildPayload(op: Operation): string { return this.buildOp(op); }

  private mappingFor(src: string): SourceMap | null {
    return this.mappingLookup.get(src) || this.mappingLookup.get(canonicalRef(src)) || this.mappingLookup.get(basenameRef(src)) || null;
  }

  private buildOp(op: Operation): string {
    if (op.id && this.opCache.has(op.id)) return this.opCache.get(op.id)!;
    let result: string;
    if (op.inlineColumns.length) {
      const canonical = this.staticAliases[op.table] || op.table;
      if (canonical !== op.table || !this.generated.has(op.table)) {
        result = qname(canonical);
      } else {
        const nm = this.nextStep(`Inline_${op.table}`);
        this.addStep(nm, inlineExpression(op));
        result = nm;
      }
    } else if (op.sourceRefs.length) {
      const src = op.sourceRefs[0];
      if (isQvd(src)) {
        const prodOp = this.qvdResolver.producerOp(src);
        if (prodOp) {
          const base = this.buildOpWithoutCache(prodOp);
          result = this.applyLoadSteps(base, op);
        } else {
          const sourceQuery = op.id ? this.sourceQueryByOperationId.get(op.id) : undefined;
          const base = sourceQuery
            ? this.addStep(this.nextStep("Source"), qname(sourceQuery))
            : this.addStep(this.nextStep("Source"), sourceExpression(this.mappingFor(src), op.table));
          result = this.applyLoadSteps(base, op);
        }
      } else {
        const sourceQuery = op.id ? this.sourceQueryByOperationId.get(op.id) : undefined;
        const base = sourceQuery
          ? this.addStep(this.nextStep("Source"), qname(sourceQuery))
          : this.addStep(this.nextStep("Source"), sourceExpression(this.mappingFor(src), op.table));
        result = this.applyLoadSteps(base, op);
      }
    } else if (op.resident.length) {
      const base = this.buildTable(op.resident[0], false);
      result = this.applyLoadSteps(base, op);
    } else {
      const nm = this.nextStep(`Manual_${op.table}`);
      this.addStep(nm, `error Error.Record("QLIK2PBI.ManualSource", "No executable source or resident dependency was resolved.", [Table=${esc(op.table)}, Operation=${esc(op.id)}])`);
      result = nm;
    }
    if (op.id) this.opCache.set(op.id, result);
    return result;
  }

  private buildOpWithoutCache(op: Operation): string {
    if (op.inlineColumns.length) {
      const canonical = this.staticAliases[op.table] || op.table;
      if (canonical !== op.table || !this.generated.has(op.table)) return qname(canonical);
      const nm = this.nextStep(`Inline_${op.table}`);
      this.addStep(nm, inlineExpression(op));
      return nm;
    }
    if (op.sourceRefs.length) {
      const src = op.sourceRefs[0];
      if (isQvd(src)) { const prod = this.qvdResolver.producerOp(src); if (prod && prod.id !== op.id) { const base = this.buildOpWithoutCache(prod); return this.applyLoadSteps(base, op); } }
      const sourceQuery = op.id ? this.sourceQueryByOperationId.get(op.id) : undefined;
      const base = sourceQuery
        ? this.addStep(this.nextStep("Source"), qname(sourceQuery))
        : this.addStep(this.nextStep("Source"), sourceExpression(this.mappingFor(src), op.table));
      return this.applyLoadSteps(base, op);
    }
    if (op.resident.length) { const base = this.buildTable(op.resident[0], false); return this.applyLoadSteps(base, op); }
    const nm = this.nextStep(`Manual_${op.table}`); this.addStep(nm, `error Error.Record("QLIK2PBI.ManualSource", "No executable source or resident dependency was resolved.", [Table=${esc(op.table)}, Operation=${esc(op.id)}])`); return nm;
  }

  private compileRowExpression(expression: string) {
    return compileQlikMExpression(expression, {
      resolveVariable: (name) => {
        const key = Object.keys(this.variableValues).find((candidate) => candidate.toLowerCase() === cleanName(name).toLowerCase());
        if (!key) return null;
        const literal = qlikLiteralToM(this.variableValues[key]);
        return literal ?? esc(this.variableValues[key]);
      },
      resolveApplyMap: (mapName, lookupExpression, defaultExpression) => {
        const canonicalMap = this.staticAliases[mapName] || mapName;
        const mapOp = primaryLoad(this.by.get(mapName) || this.by.get(canonicalMap) || []);
        const mapColumns = mapOp?.inlineColumns.length ? mapOp.inlineColumns : mapOp?.fields || [];
        const keyColumn = mapColumns[0] || 'Key';
        const valueColumn = mapColumns[1] || 'Value';
        if (!canonicalMap) return null;
        return `let _key = ${lookupExpression}, _rows = Table.SelectRows(${qname(canonicalMap)}, (r as record) => Record.FieldOrDefault(r, ${esc(keyColumn)}, null) = _key) in if Table.IsEmpty(_rows) then ${defaultExpression} else Record.FieldOrDefault(_rows{0}, ${esc(valueColumn)}, ${defaultExpression})`;
      },
    });
  }

  private applyLoadSteps(prev: string, op: Operation): string {
    if (op.where) {
      const compiled = this.compileRowExpression(op.where);
      const nm = this.nextStep('FilteredRows');
      this.addStep(
        nm,
        compiled.code
          ? `Table.SelectRows(${prev}, each let _qlik2pbi_filter = try (${compiled.code}) in if _qlik2pbi_filter[HasError] then true else if Value.Is(_qlik2pbi_filter[Value], type logical) then _qlik2pbi_filter[Value] else true)`
          : `${prev} /* QLIK2PBI MANUAL REVIEW: unsupported WHERE ${String(op.where).replace(/\*\//g, '* /').slice(0, 180)}; ${compiled.warnings.join('; ').replace(/\*\//g, '* /')} */`,
      );
      prev = nm;
    }
    return this.applyProjectionAndCalcs(prev, op);
  }

  private addOrReplaceColumnExpression(previousStep: string, columnName: string, generator: string): string {
    const tempName = `__QLIK2PBI_${cleanName(columnName)}_VALUE`;
    return `let
            _withoutTemp = Table.RemoveColumns(${previousStep}, {${esc(tempName)}}, MissingField.Ignore),
            _withValue = Table.AddColumn(_withoutTemp, ${esc(tempName)}, each ${generator}),
            _withoutOld = Table.RemoveColumns(_withValue, {${esc(columnName)}}, MissingField.Ignore)
        in
            Table.RenameColumns(_withoutOld, {{${esc(tempName)}, ${esc(columnName)}}}, MissingField.Error)`;
  }

  private safeRenameExpression(previousStep: string, sourceName: string, targetName: string): string {
    if (sourceName === targetName) return previousStep;
    return `let
            _columns = Table.ColumnNames(${previousStep}),
            _sourceExists = List.Contains(_columns, ${esc(sourceName)}),
            _withoutTarget = if List.Contains(_columns, ${esc(targetName)}) and ${esc(sourceName)} <> ${esc(targetName)} then Table.RemoveColumns(${previousStep}, {${esc(targetName)}}, MissingField.Ignore) else ${previousStep}
        in
            if _sourceExists then Table.RenameColumns(_withoutTarget, {{${esc(sourceName)}, ${esc(targetName)}}}, MissingField.Error) else error Error.Record("QLIK2PBI.MissingRenameSource", "Rename source column was not found.", [SourceColumn=${esc(sourceName)}, TargetColumn=${esc(targetName)}, AvailableColumns=_columns])`;
  }

  private requireColumnsExpression(tableExpression: string, columns: string[], context: string): string {
    const required = uniq(columns);
    return `let
            _table = ${tableExpression},
            _required = {${required.map(esc).join(", ")}},
            _missing = List.Difference(_required, Table.ColumnNames(_table))
        in
            if List.IsEmpty(_missing) then _table else error [Reason="QLIK2PBI.MissingColumns", Message=${esc(context)} & " is missing required column(s): " & Text.Combine(List.Transform(_missing, each Text.From(_)), ", "), Detail=[MissingColumns=_missing, AvailableColumns=Table.ColumnNames(_table)]]`;
  }

  private applyProjectionAndCalcs(prev: string, op: Operation): string {
    if (!op.fields.length || op.fields[0] === '*') return prev;
    const direct: string[] = [], renames: [string, string][] = [], calcs: [string, string][] = [];
    const outputFields: string[] = [];
    for (const alias of op.fields) {
      const expr = op.fieldExpressions[alias] || alias;
      if (AGG_RE.test(expr)) {
        AGG_RE.lastIndex = 0;
        continue;
      }
      AGG_RE.lastIndex = 0;
      const plannedCalculation = this.executionPlans[this.finalTableName]?.calculations.find((item) =>
        item.operationId === op.id && item.name.toLowerCase() === alias.toLowerCase(),
      );
      if (plannedCalculation?.phase === "post-join") {
        this.deferredCalculations.push({ alias, expression: expr, operationId: op.id });
        continue;
      }
      outputFields.push(alias);
      if (isPlainField(expr)) {
        const src = cleanName(expr);
        direct.push(src);
        if (src !== alias) renames.push([src, alias]);
      } else {
        calcs.push([alias, expr]);
        const compiled = this.compileRowExpression(expr);
        direct.push(...(compiled.code ? compiled.fields : qlikExpressionFields(expr)));
      }
    }
    if (direct.length) {
      const nm = this.nextStep('SelectedColumns');
      this.addStep(nm, `Table.SelectColumns(${prev}, {${uniq(direct).map(esc).join(', ')}}, MissingField.Error)`);
      prev = nm;
    }
    if (renames.length) {
      const nm = this.nextStep('RenamedColumns');
      this.addStep(nm, renames.reduce((expression, [source, target]) => this.safeRenameExpression(expression, source, target), prev));
      prev = nm;
    }
    for (const [alias, calc] of calcs) {
      const nm = this.nextStep(`Calculated_${alias}`);
      const compiled = this.compileRowExpression(calc);
      this.addStep(
        nm,
        compiled.code
          ? this.addOrReplaceColumnExpression(prev, alias, compiled.code)
          : `error Error.Record("QLIK2PBI.UnsupportedExpression", "A Qlik row expression could not be deterministically converted.", [Table=${esc(op.table)}, Column=${esc(alias)}, Expression=${esc(String(calc).slice(0, 500))}, Warnings=${esc(compiled.warnings.join('; '))}])`,
      );
      prev = nm;
    }
    if (!outputFields.length) return prev;
    const nm = this.nextStep(`Final_${op.table}_Columns`);
    this.addStep(nm, `Table.SelectColumns(${prev}, {${uniq(outputFields).map(esc).join(', ')}}, MissingField.Error)`);
    return nm;
  }

  private applyJoin(prev: string, joinOp: Operation): string {
    let joinTableExpr: string, rightName: string;
    if (joinOp.resident.length) {
      const plan = this.joinPlans.get(joinOp.id);
      const stagedSource = plan?.sourceOperationIds
        ?.map((operationId) => this.sourceQueryByOperationId.get(operationId))
        .find(Boolean);
      joinTableExpr = stagedSource ? qname(stagedSource) : this.buildTable(joinOp.resident[0], true);
      rightName = joinOp.resident[0];
    } else if (joinOp.sourceRefs.length || joinOp.inlineColumns.length) {
      joinTableExpr = this.buildPayload(joinOp);
      rightName = joinOp.table;
    } else {
      return prev;
    }

    let targetFields: string[] = [];
    if (joinOp.joinTarget && this.by.has(joinOp.joinTarget)) {
      targetFields = uniq(this.by.get(joinOp.joinTarget)!.flatMap(op => op.fields).filter(f => f && f !== '*'));
    }
    const naturalKeys = uniq(joinOp.fields.filter(f => targetFields.some(tf => tf.toLowerCase() === f.toLowerCase())));

    const plan = this.joinPlans.get(joinOp.id);
    const leftKeys = plan?.keyColumns?.length
      ? plan.keyColumns
      : naturalKeys.length
        ? naturalKeys
        : uniq(joinOp.fields.filter((field) => KEY_RE_M.test(field))).slice(0, 1);
    const rightKeys = plan?.sourceKeyColumns?.length
      ? plan.sourceKeyColumns
      : leftKeys;
    if (!leftKeys.length || leftKeys.length !== rightKeys.length) {
      const marker = this.nextStep(`ManualJoin_${rightName}`);
      this.addStep(marker, `${prev} /* QLIK2PBI MANUAL REVIEW: no deterministic key for ${String(joinOp.raw || "").replace(/\*\//g, "* /").slice(0, 220)} */`);
      return marker;
    }

    const requestedExpand = plan?.expandColumns?.length
      ? plan.expandColumns
      : uniq(joinOp.fields.filter((field) => !rightKeys.some((key) => key.toLowerCase() === field.toLowerCase())));
    const qualifiedCollisions = plan?.qualifiedCollisions || {};
    const outputNames = requestedExpand.map((field) => qualifiedCollisions[field] || field);
    const leftReadyStep = this.nextStep(`Validated_${joinOp.joinTarget || "Target"}_JoinKeys`);
    const leftReady = this.addStep(leftReadyStep, this.requireColumnsExpression(prev, leftKeys, `Join target ${joinOp.joinTarget || "table"}`));
    const rightReadyStep = this.nextStep(`Validated_${rightName}_JoinColumns`);
    const rightReady = this.addStep(rightReadyStep, this.requireColumnsExpression(joinTableExpr, [...rightKeys, ...requestedExpand], `Join source ${rightName}`));
    const normalizedLeftStep = this.nextStep(`Normalized_${joinOp.joinTarget || "Target"}_JoinKeys`);
    const normalizedLeft = this.addStep(normalizedLeftStep, normalizeJoinKeysExpression(leftReady, leftKeys));
    const normalizedRightStep = this.nextStep(`Normalized_${rightName}_JoinKeys`);
    const normalizedRight = this.addStep(normalizedRightStep, normalizeJoinKeysExpression(rightReady, rightKeys));
    const nestedColumn = `__qlik_join_${cleanName(rightName)}_${this.step}`;
    const rawUp = String(joinOp.raw || "").toUpperCase();
    const keepMode = /\bKEEP\b/.test(rawUp);
    const joinKind = plan?.joinKind;
    let kind = "JoinKind.LeftOuter";
    if (joinKind === "inner" || joinKind === "inner-keep" || rawUp.includes("INNER JOIN")) kind = "JoinKind.Inner";
    else if (joinKind === "right" || joinKind === "right-keep" || rawUp.includes("RIGHT JOIN")) kind = "JoinKind.RightOuter";
    else if (joinKind === "outer" || rawUp.includes("OUTER JOIN")) kind = "JoinKind.FullOuter";

    const nested = this.nextStep(`Joined_${rightName}`);
    this.addStep(
      nested,
      // Comparer.OrdinalIgnoreCase replicates Qlik's case-insensitive join, but causes syntax errors in some PBI builds. Defaulting to standard.
      `Table.NestedJoin(${normalizedLeft}, {${leftKeys.map(esc).join(", ")}}, ${normalizedRight}, {${rightKeys.map(esc).join(", ")}}, ${esc(nestedColumn)}, ${kind})`,
    );

    if (keepMode) {
      const keepStep = this.nextStep(`Keep_${rightName}`);
      if (joinKind === "left-keep") {
        this.addStep(keepStep, `Table.RemoveColumns(${nested}, {${esc(nestedColumn)}}, MissingField.Ignore)`);
      } else {
        this.addStep(keepStep, `Table.RemoveColumns(Table.SelectRows(${nested}, each try Table.RowCount(Record.Field(_, ${esc(nestedColumn)})) > 0 otherwise false), {${esc(nestedColumn)}}, MissingField.Ignore)`);
      }
      return keepStep;
    }

    const expandStep = this.nextStep(`Expanded_${rightName}_Fields`);
    this.addStep(
      expandStep,
      requestedExpand.length
        ? `Table.ExpandTableColumn(${nested}, ${esc(nestedColumn)}, {${requestedExpand.map(esc).join(", ")}}, {${outputNames.map(esc).join(", ")}})`
        : `Table.RemoveColumns(${nested}, {${esc(nestedColumn)}}, MissingField.Ignore)`,
    );
    return expandStep;
  }

  private applyTypeConversions(prev: string, table: string): string {
    const tableEntry = Object.entries(this.columnTypes || {}).find(([name]) => name.toLowerCase() === table.toLowerCase());
    const types: Record<string, string> = { ...(tableEntry?.[1] || {}) };

    // A final table must always receive an explicit type step. When an older
    // saved workspace has no persisted type map, infer a safe baseline from
    // the final Qlik fields rather than silently exporting everything as text.
    if (!Object.keys(types).length) {
      for (const operation of this.by.get(table) || []) {
        for (const column of operation.fields || []) {
          if (column && column !== "*" && !Object.keys(types).some((item) => item.toLowerCase() === column.toLowerCase())) {
            types[column] = inferDataType(column, operation.fieldExpressions?.[column] || "");
          }
        }
      }
    }

    const reviewed = normalizedReviewedTypes(types);
    if (!reviewed.length) return prev;
    const nm = this.nextStep('ReviewedTypeConversions');
    this.addStep(nm, reviewedTypeTransformExpression(prev, Object.fromEntries(reviewed)));
    return nm;
  }
}

export function buildMQueries(
  profiles: Record<string, TableProfile>,
  operations: Operation[],
  mappings: SourceMap[],
  columnTypes: Record<string, Record<string, string>>,
  reconstruction?: QlikReconstructionPlan,
  files: ProjectFile[] = [],
  executionPlans: Record<string, TableExecutionPlan> = {},
): Record<string, string> {
  const sourcePlan = buildSourceStagingPlan(operations, mappings, files);
  const mp = new Map<string, SourceMap>();
  for (const m of mappings) {
    if (m.bypassQvd) continue;
    for (const key of [m.originalRef, canonicalRef(m.originalRef), basenameRef(m.originalRef)]) {
      if (key && !mp.has(key)) mp.set(key, m);
    }
  }
  const by = new Map<string, Operation[]>();
  const joins = new Map<string, Operation[]>();
  const concats = new Map<string, Operation[]>();
  const operationSignatures = new Set<string>();
  for (const o of operations) {
    const signature = [o.opType, o.table, o.joinTarget, o.concatTarget, ...o.resident, ...o.sourceRefs, ...o.fields, o.where].map((value) => String(value || '').trim().toLowerCase()).join('|');
    if (operationSignatures.has(signature) && ['join_load', 'concat_load'].includes(o.opType)) continue;
    operationSignatures.add(signature);
    if (!by.has(o.table)) by.set(o.table, []);
    by.get(o.table)!.push(o);
    if (o.opType === 'join_load' && o.joinTarget) { if (!joins.has(o.joinTarget)) joins.set(o.joinTarget, []); joins.get(o.joinTarget)!.push(o); }
    if (o.opType === 'concat_load' && o.concatTarget) { if (!concats.has(o.concatTarget)) concats.set(o.concatTarget, []); concats.get(o.concatTarget)!.push(o); }
  }
  const generated = new Set(
    reconstruction
      ? Object.values(reconstruction.tables).filter((table) => table.includeInModel).map((table) => table.table)
      : Object.entries(profiles).filter(([, profile]) => profile.status === "generated").map(([table]) => table),
  );
  const resolver = new QvdLineageResolver(operations);
  const res: Record<string, string> = {};
  for (const [t, p] of Object.entries(profiles)) {
    const includeInModel = reconstruction?.tables[t]?.includeInModel ?? p.status === "generated";
    if (!includeInModel) continue;
    const builder = new MBuilder(
      by,
      joins,
      concats,
      generated,
      mp,
      resolver,
      columnTypes,
      reconstruction ? canonicalStaticAliasMap(reconstruction) : {},
      new Map((reconstruction?.joinReconstructions || []).map((join) => [join.operationId, join])),
      sourcePlan.byOperationId,
      {},
      t,
      executionPlans,
    );
    res[t] = builder.buildFinalTable(t);
  }
  if (reconstruction) {
    for (const key of reconstruction.compositeKeys) {
      if (res[key.leftTable]) res[key.leftTable] = appendCompositeKeyToMQuery(res[key.leftTable], key.keyColumn, key.columns, key.delimiter);
      if (res[key.rightTable]) res[key.rightTable] = appendCompositeKeyToMQuery(res[key.rightTable], key.keyColumn, key.columns, key.delimiter);
    }
  }

  // Apply the governed semantic projection after joins and composite keys so
  // attributes copied into the main table are removed from the secondary model
  // query while the complete source remains available as load-disabled staging.
  for (const table of Object.keys(res)) {
    res[table] = appendFinalModelProjectionToMQuery(
      res[table],
      executionPlans[table]?.finalColumns || profiles[table]?.fields || Object.keys(columnTypesForTable(columnTypes, table)),
      table,
    );
  }

  // Apply the latest UI-reviewed types only after all structural M operations
  // have completed. `columnTypes` is the live source of truth supplied by the
  // data-type editor. Execution plans may have been created before an in-UI
  // edit, so their reviewedTypes snapshot must never override this map.
  for (const table of Object.keys(res)) {
    const latestReviewedTypes = columnTypesForTable(columnTypes, table);
    res[table] = applyReviewedTypesToMQuery(res[table], latestReviewedTypes);

    // Keep plan metadata aligned for preview/audit consumers without allowing
    // that metadata to control the generated M query.
    if (executionPlans[table]) {
      executionPlans[table].reviewedTypes = { ...latestReviewedTypes };
    }
  }
  return res;
}


function appendFinalModelProjectionToMQuery(query: string, columns: string[], tableName = "Model"): string {
  const selected = uniq(columns.filter(Boolean));
  if (!query.trim() || !selected.length) return query;
  return appendTableProducingStep(
    query,
    `Final${cleanName(tableName)}Columns`,
    `Table.SelectColumns(__PREVIOUS_STEP__, {${selected.map(esc).join(", ")}}, MissingField.Error)`,
  );
}

function appendCompositeKeyToMQuery(query: string, keyColumn: string, columns: string[], delimiter: string): string {
  if (!query.trim()) return query;
  const encodedValues = columns.map((column) =>
    `let value = Record.FieldOrDefault(_, ${esc(column)}, null), textValue = if value = null then "<NULL>" else Text.From(value, "en-US") in Text.Replace(textValue, ${esc(delimiter)}, ${esc(delimiter + delimiter)})`,
  ).join(", ");
  const expression = `let
        _source = __PREVIOUS_STEP__,
        _missing = List.Difference({${columns.map(esc).join(", ")}}, Table.ColumnNames(_source)),
        _validated = if List.IsEmpty(_missing) then _source else error Error.Record("QLIK2PBI.MissingCompositeKeyColumns", "Composite-key inputs are missing.", [Key=${esc(keyColumn)}, MissingColumns=_missing, AvailableColumns=Table.ColumnNames(_source)]),
        _withoutExisting = Table.RemoveColumns(_validated, {${esc(keyColumn)}}, MissingField.Ignore)
    in
        Table.AddColumn(_withoutExisting, ${esc(keyColumn)}, each Text.Combine({${encodedValues}}, ${esc(delimiter)}), type text)`;
  return appendTableProducingStep(query, `Created_${cleanName(keyColumn)}`, expression);
}

export function buildStagingQueries(
  _profiles: Record<string, TableProfile>,
  operations: Operation[],
  mappings: SourceMap[],
  _columnTypes: Record<string, Record<string, string>>,
  reconstruction: QlikReconstructionPlan,
  files: ProjectFile[] = [],
): Record<string, string> {
  const sourcePlan = buildSourceStagingPlan(operations, mappings, files);
  const result: Record<string, string> = { ...sourcePlan.queries };
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  const classificationByTable = new Map(
    reconstruction.tableClassifications.map((classification) => [classification.table.toLowerCase(), classification]),
  );

  // Only canonical INLINE/MAPPING tables that are actually consumed by a
  // surviving query are materialized. SECTION ACCESS, aggregate-only tables,
  // JOIN payloads, synthetic anonymous aliases and temporary QVD-generator
  // tables remain in lineage/audit metadata instead of cluttering Power Query.
  for (const staticTable of reconstruction.staticTables) {
    const classification = classificationByTable.get(staticTable.canonicalName.toLowerCase());
    const requiredByModel = staticTable.mapping || staticTable.referencedBy.length > 0;
    if (!staticTable.materialize || staticTable.includeInModel || !requiredByModel) continue;
    if (classification?.reason.toLowerCase().includes('section access')) continue;
    const operation = staticTable.sourceOperationIds.map((id) => operationById.get(id)).find(Boolean);
    if (!operation) continue;
    result[staticTable.canonicalName] = `let
    Source = ${inlineExpression(operation)}
in
    Source`;
  }

  return result;
}


/**
 * Appends the reviewed UI data types to any valid `let ... in ...` M query.
 * This is also used for optional AI-generated M so AI output can never bypass
 * the data-type decisions approved in the application.
 */
export function applyReviewedTypesToMQuery(
  query: string,
  columnTypes: Record<string, string>,
): string {
  const reviewed = normalizedReviewedTypes(columnTypes);
  if (!query.trim() || reviewed.length === 0) return query;

  const signature = reviewedTypeSignature(columnTypes);
  const signatureComment = `QLIK2PBI REVIEWED TYPES SIGNATURE: ${signature}`;
  if (query.includes(REVIEWED_TYPES_BEGIN) && query.includes(signatureComment) && /\bin\s+ReviewedTypeConversions\s*$/i.test(query)) {
    return query;
  }

  const baseQuery = unwrapReviewedTypeQuery(query);
  const valueOperations = reviewedTypeValueOperations(reviewed);
  const metadataOperations = reviewedTypeMetadataOperations(reviewed);
  const expression = `Table.TransformColumnTypes(
        Table.TransformColumns(
            __PREVIOUS_STEP__,
            List.Select(${valueOperations}, each Table.HasColumns(__PREVIOUS_STEP__, _{0})),
            null,
            MissingField.Error
        ),
        List.Select(${metadataOperations}, each Table.HasColumns(__PREVIOUS_STEP__, _{0})),
        "en-US"
    )`;
  return appendTableProducingStep(
    baseQuery,
    "ReviewedTypeConversions",
    expression,
    [REVIEWED_TYPES_BEGIN.replace(/^\/\/\s*/, ""), signatureComment, REVIEWED_TYPES_END.replace(/^\/\/\s*/, "")],
  );
}

// ──────────────────────────────────────────────────────────────
// SECTION 9: DAX Translator
// ──────────────────────────────────────────────────────────────

function toDax(expr: string, table: string): [string, string, number, string, string] | null {
  const setwarn = /\{[^}]*<.*?>[^}]*\}/s.test(expr) ? 'Set Analysis detected; filters need manual review.' : '';
  const x = expr.replace(/\{[^}]*<.*?>[^}]*\}/gs, '');
  const m = x.match(/\b(Sum|Count|Avg|Average|Min|Max)\s*\(\s*(DISTINCT\s+)?([^)]+)\)/i);
  if (!m) {
    if (/\b(RangeSum|Aggr)\s*\(/i.test(x)) {
      const name = cleanName('Review_' + x.replace(/\W+/g, '_').slice(0, 50));
      return [name, `/* Manual review required for Qlik expression: ${x.slice(0, 200)} */ BLANK()`, 35, 'Complex Qlik aggregation requires manual DAX review.', 'RangeSum/Aggr requires manual review.'];
    }
    return null;
  }
  const fn = m[1].toLowerCase(), distinct = !!m[2], field = cleanName(m[3].replace(/[^A-Za-z0-9_ ]/g, ''));
  let dax = '', name = '';
  if (fn === 'sum') { dax = `SUM('${table}'[${field}])`; name = `Total_${field}`; }
  else if (fn === 'count' && distinct) { dax = `DISTINCTCOUNT('${table}'[${field}])`; name = `Distinct_${field}`; }
  else if (fn === 'count') { dax = `COUNT('${table}'[${field}])`; name = `Count_${field}`; }
  else if (fn === 'avg' || fn === 'average') { dax = `AVERAGE('${table}'[${field}])`; name = `Average_${field}`; }
  else if (fn === 'min') { dax = `MIN('${table}'[${field}])`; name = `Min_${field}`; }
  else { dax = `MAX('${table}'[${field}])`; name = `Max_${field}`; }
  if (setwarn) dax = `CALCULATE(${dax})`;
  return [cleanName(name), dax, setwarn ? 62 : 92, 'Aggregation converted to DAX measure.', setwarn];
}

export function buildDaxMeasures(operations: Operation[], profiles: Record<string, TableProfile>): DaxMeasure[] {
  const finals = new Set(Object.entries(profiles).filter(([,p]) => p.status === 'generated').map(([t]) => t));
  const out: DaxMeasure[] = [];
  const seen = new Set<string>();
  for (const o of operations) {
    let table = finals.has(o.table) ? o.table : o.resident.find(r => finals.has(r));
    if (!table) table = [...finals][0] || o.table;
    for (const e of uniq(o.aggregations)) {
      const m = toDax(e, table);
      if (m) {
        const key = `${table}||${e}||${m[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ measureName: m[0], dax: m[1], qlikExpression: e, table, confidence: m[2], notes: m[3], source: `${o.file}:${o.startLine}`, warning: m[4] });
        }
      }
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// SECTION 10: Relationship Inference
// ──────────────────────────────────────────────────────────────

const KEY_RE_R = /(id$|_id$|key$|_key$|code$|number$|no$|guid$)/i;
const FACT_RE = /(fact|sales|invoice|order|transaction|ledger|finance|inventory|stock|claim|payment|movement|event|detail|line)/i;
const DIM_RE = /(dim|customer|product|item|vendor|supplier|date|calendar|account|region|country|employee|store|lookup|master)/i;

export function tableRole(p: TableProfile): string {
  if (p.classification === 'inline/static') return 'reference';
  if (/bridge|link/i.test(p.table)) return 'bridge';
  if (FACT_RE.test(p.table)) return 'fact';
  if (DIM_RE.test(p.table)) return 'dimension';
  const measures = p.fields.filter(f => /(amount|sales|qty|quantity|price|cost|value|revenue|margin|total|balance)/i.test(f));
  return measures.length >= 2 || p.fields.length > 12 ? 'fact' : 'dimension';
}

function matchPrefix(t: string, f: string): boolean {
  t = t.replace(/^(dim|fact|tbl|ref)_?/i, '').toLowerCase(); f = f.toLowerCase();
  return !!(t && (f.startsWith(t.slice(0, Math.max(3, Math.min(8, t.length)))) || t.includes(f)));
}

function hasPath(edges: [string, string][], a: string, b: string): boolean {
  const g = new Map<string, Set<string>>();
  for (const [x, y] of edges) {
    if (!g.has(x)) g.set(x, new Set()); g.get(x)!.add(y);
    if (!g.has(y)) g.set(y, new Set()); g.get(y)!.add(x);
  }
  const q = [a]; const seen = new Set([a]);
  while (q.length) {
    const n = q.shift()!;
    if (n === b) return true;
    for (const m of (g.get(n) || [])) { if (!seen.has(m)) { seen.add(m); q.push(m); } }
  }
  return false;
}

function scoreRel(a: [string, string], b: [string, string], roles: Record<string, string>): Relationship {
  let [t1, f1] = a, [t2] = b;
  let r1 = roles[t1] || 'dimension', r2 = roles[t2] || 'dimension';
  let fromT = t1, toT = t2;
  if (r2 === 'fact' && (r1 === 'dimension' || r1 === 'reference')) { [fromT, toT] = [t2, t1]; [r1, r2] = [r2, r1]; }
  let score = 0; const reason: string[] = [];
  if ((r1 === 'fact' || r1 === 'bridge') && (r2 === 'dimension' || r2 === 'reference')) { score += 100; reason.push('Fact/bridge to dimension/reference preferred.'); }
  else if (r1 === 'dimension' && r2 === 'dimension') { score -= 100; reason.push('Dimension-dimension mesh relationship discouraged.'); }
  if (KEY_RE_R.test(f1)) { score += 60; reason.push('Shared field looks like ID/Key/Code/Number.'); }
  if (matchPrefix(toT, f1) || matchPrefix(fromT, f1)) { score += 40; reason.push('Table name matches field prefix.'); }
  if ((roles[toT] === 'dimension' || roles[toT] === 'reference') && (roles[fromT] === 'fact' || roles[fromT] === 'bridge')) { score += 80; reason.push('Metadata role suggests one-side dimension and many-side fact.'); }
  return { fromTable: fromT, fromColumn: f1, toTable: toT, toColumn: f1, score, active: false, status: 'candidate', reason: reason.join(' ') || 'Shared field detected.', cardinality: 'manyToOne', filterDirection: 'single', confidence: Math.max(10, Math.min(98, score > 0 ? score : 30)) };
}

export function inferRelationships(
  profiles: Record<string, TableProfile>,
  reconstruction?: QlikReconstructionPlan,
): Relationship[] {
  const generated = Object.fromEntries(Object.entries(profiles).filter(([, profile]) => profile.status === "generated"));
  const roles = Object.fromEntries(Object.entries(generated).map(([table, profile]) => [table, tableRole(profile)]));
  const result: Relationship[] = [];
  const seen = new Set<string>();
  const activeMode = !reconstruction || ["automatic", "qlik-equivalent", "powerbi-optimized"].includes(reconstruction.modelBuildMode);
  const normalized = (value: string) => cleanName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  const field = (table: string, requested: string): string | undefined => generated[table]?.fields.find((candidate) => normalized(candidate) === normalized(requested));
  const disposition = (table: string) => reconstruction?.tableClassifications.find((item) => item.table === table);
  const modelTable = (table: string) => generated[table] && (disposition(table)?.includeInModel ?? true);
  const pairKey = (fromTable: string, fromColumn: string, toTable: string, toColumn: string) =>
    `${normalized(fromTable)}|${normalized(fromColumn)}|${normalized(toTable)}|${normalized(toColumn)}`;
  const add = (relationship: Relationship) => {
    if (!modelTable(relationship.fromTable) || !modelTable(relationship.toTable)) return;
    const key = pairKey(relationship.fromTable, relationship.fromColumn, relationship.toTable, relationship.toColumn);
    const reverse = pairKey(relationship.toTable, relationship.toColumn, relationship.fromTable, relationship.fromColumn);
    if (seen.has(key) || seen.has(reverse)) return;
    seen.add(key);
    result.push(relationship);
  };

  // 1. Explicit Qlik JOIN/KEEP evidence is authoritative. Only the actual join
  // key is related; payload attributes moved into the target table are never
  // used as additional relationships.
  for (const join of reconstruction?.joinReconstructions ?? []) {
    if (join.keyColumns.length !== 1 || join.sourceKeyColumns.length !== 1) continue;
    if (!modelTable(join.targetTable) || !modelTable(join.sourceTable)) continue;
    const targetKey = field(join.targetTable, join.keyColumns[0]);
    const sourceKey = field(join.sourceTable, join.sourceKeyColumns[0]);
    if (!targetKey || !sourceKey) continue;
    const targetRole = roles[join.targetTable] || "dimension";
    const sourceRole = roles[join.sourceTable] || "dimension";
    const targetIsMany = targetRole === "fact" || targetRole === "bridge" || sourceRole === "dimension" || sourceRole === "reference";
    const fromTable = targetIsMany ? join.targetTable : join.sourceTable;
    const fromColumn = targetIsMany ? targetKey : sourceKey;
    const toTable = targetIsMany ? join.sourceTable : join.targetTable;
    const toColumn = targetIsMany ? sourceKey : targetKey;
    add({
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      score: 260,
      active: activeMode,
      status: activeMode ? "active" : "inactive/desktop review",
      reason: `Explicit Qlik ${join.joinKind} JOIN/KEEP on ${join.keyColumns.join(", ")}. Joined payload columns are materialized only in ${join.targetTable}; this relationship uses the retained key only.`,
      cardinality: "manyToOne",
      filterDirection: "single",
      confidence: Math.max(95, join.confidence),
    });
  }

  const tableBase = (table: string) => normalized(table.replace(/^(dim|fact|tbl|ref)_?/i, "").replace(/s$/i, ""));
  const keyMatchesDimension = (table: string, column: string) => {
    const base = tableBase(table);
    const key = normalized(column);
    return key === `${base}id` || key === `${base}key` || key === `${base}code`
      || (base.length > 4 && (key === `${base.slice(0, -1)}id` || key === `${base.slice(0, -1)}key`));
  };

  // 2. Add only strong primary/foreign-key relationships that are not already
  // explained by a physical Qlik join. Common attributes such as Region,
  // CountryName, Brand or Department are deliberately ignored.
  const facts = Object.keys(generated).filter((table) => ["fact", "bridge"].includes(roles[table]));
  const dimensions = Object.keys(generated).filter((table) => ["dimension", "reference"].includes(roles[table]));
  for (const factTable of facts) {
    for (const dimensionTable of dimensions) {
      if (factTable === dimensionTable) continue;
      const dimensionKey = generated[dimensionTable].fields.find((column) => KEY_RE_R.test(column) && keyMatchesDimension(dimensionTable, column));
      if (!dimensionKey) continue;
      const factKey = field(factTable, dimensionKey);
      if (!factKey) continue;
      add({
        fromTable: factTable,
        fromColumn: factKey,
        toTable: dimensionTable,
        toColumn: dimensionKey,
        score: 190,
        active: activeMode,
        status: activeMode ? "active" : "inactive/desktop review",
        reason: `Verified foreign-key pattern: ${factTable}[${factKey}] matches the row identifier ${dimensionTable}[${dimensionKey}]. Non-key shared attributes were ignored.`,
        cardinality: "manyToOne",
        filterDirection: "single",
        confidence: 94,
      });
    }
  }

  // 3. Role-playing date relationships are created only from a governed date
  // key to date-like fact columns. One primary date is active per fact; other
  // date roles remain inactive for USERELATIONSHIP().
  const dateTables = Object.keys(generated).filter((table) => /calendar|(^|_)date($|_)/i.test(table));
  const expandedFieldKeys = new Set((reconstruction?.fieldLineage || [])
    .filter((item) => item.role === "expanded")
    .map((item) => `${normalized(item.targetTable)}|${normalized(item.field)}`));
  for (const dateTable of dateTables) {
    const dateKey = generated[dateTable].fields.find((column) => /^(calendar)?date(key)?$/i.test(column))
      || generated[dateTable].fields.find((column) => /date$/i.test(column));
    if (!dateKey) continue;
    for (const factTable of facts) {
      const candidates = generated[factTable].fields
        .filter((column) => /date$/i.test(column)
          && normalized(column) !== normalized(dateKey)
          && !expandedFieldKeys.has(`${normalized(factTable)}|${normalized(column)}`))
        .sort((left, right) => {
          const priority = (value: string) => /^(order|transaction|fiscal|stock)date$/i.test(value) ? 0 : /date$/i.test(value) ? 1 : 2;
          return priority(left) - priority(right);
        });
      candidates.forEach((factDate, index) => add({
        fromTable: factTable,
        fromColumn: factDate,
        toTable: dateTable,
        toColumn: dateKey,
        score: index === 0 ? 175 : 125,
        active: activeMode && index === 0,
        status: activeMode && index === 0 ? "active" : "inactive/role-playing date",
        reason: `${factTable}[${factDate}] is a date-role foreign key to ${dateTable}[${dateKey}]. ${index === 0 ? "Selected as the primary active date relationship." : "Kept inactive for USERELATIONSHIP() to avoid multiple active date paths."}`,
        cardinality: "manyToOne",
        filterDirection: "single",
        confidence: index === 0 ? 92 : 86,
      }));
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
// SECTION 11: Semantic Model
// ──────────────────────────────────────────────────────────────

function buildSemanticModel(profiles: Record<string, TableProfile>, measures: DaxMeasure[], relationships: Relationship[], mQueries: Record<string, string>, columnTypes: Record<string, Record<string, string>>): { name: string; tables: Record<string, unknown>[]; relationships: Record<string, unknown>[] } {
  const tables = [];
  for (const [t, p] of Object.entries(profiles)) {
    if (p.status !== 'generated') continue;
    const tableTypes = columnTypesForTable(columnTypes, t);
    const cols = p.fields.map(f => {
      const dtype = reviewedTypeForColumn(tableTypes, f);
      const col: Record<string, string> = { name: f, data_type: bimType(dtype), source_type: dtype };
      const fmt = formatString(dtype);
      if (fmt) col['formatString'] = fmt;
      return col;
    });
    tables.push({ name: t, role: tableRole(p), classification: p.classification, columns: cols, partition: mQueries[t] || '', measures: measures.filter(m => m.table === t).map(m => ({ name: m.measureName, expression: m.dax, source: m.qlikExpression, confidence: m.confidence })) });
  }
  return { name: 'QLIK2PBI_Migrated_Model', tables, relationships: relationships.map(r => ({ ...r })) };
}

// ──────────────────────────────────────────────────────────────
// SECTION 12: M Query Diagnostics
// ──────────────────────────────────────────────────────────────

const QLIK_ONLY_RE = /\b(LOAD|RESIDENT|ApplyMap|IntervalMatch|CrossTable|Generic\s+Load|Peek|Previous|Autonumber)\b/i;
const AGG_IN_M_RE = /\b(Sum|Avg)\s*\(|Count\s*\(\s*DISTINCT/i;

function delimiterBalance(text: string): [boolean, string] {
  const s = text.replace(/"([^"]|"")*"/g, m => ' '.repeat(m.length));
  const stack: [string, number][] = [];
  const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ('({['.includes(ch)) stack.push([ch, i]);
    else if (')}]'.includes(ch)) {
      if (!stack.length || stack[stack.length-1][0] !== pairs[ch]) return [false, `Unexpected '${ch}' near char ${i}.`];
      stack.pop();
    }
  }
  if (stack.length) return [false, `Unclosed '${stack[stack.length-1][0]}' near char ${stack[stack.length-1][1]}.`];
  return [true, 'Balanced delimiters.'];
}

function mCodeOutsideStringsAndComments(text: string): string {
  const source = String(text || "");
  const output = source.split("");
  let state: "code" | "string" | "line-comment" | "block-comment" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";
    if (state === "code") {
      if (char === '"') { output[index] = " "; state = "string"; continue; }
      if (char === "/" && next === "/") { output[index] = output[index + 1] = " "; index += 1; state = "line-comment"; continue; }
      if (char === "/" && next === "*") { output[index] = output[index + 1] = " "; index += 1; state = "block-comment"; continue; }
      continue;
    }
    if (state === "string") {
      output[index] = char === "\n" || char === "\r" ? char : " ";
      if (char === '"' && next === '"') { output[index + 1] = " "; index += 1; continue; }
      if (char === '"') state = "code";
      continue;
    }
    if (state === "line-comment") {
      output[index] = char === "\n" || char === "\r" ? char : " ";
      if (char === "\n" || char === "\r") state = "code";
      continue;
    }
    output[index] = char === "\n" || char === "\r" ? char : " ";
    if (char === "*" && next === "/") { output[index + 1] = " "; index += 1; state = "code"; }
  }
  return output.join("");
}

function invalidMSingleQuoteEvidence(query: string): string | null {
  const code = mCodeOutsideStringsAndComments(query);
  const index = code.indexOf("'");
  if (index < 0) return null;
  const before = query.slice(0, index);
  const line = before.split(/\r?\n/).length;
  const column = index - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  const lineText = query.split(/\r?\n/)[line - 1]?.trim() || query.slice(Math.max(0, index - 40), index + 80).trim();
  return `Invalid single quote at line ${line}, column ${column}: ${lineText.slice(0, 180)}`;
}

function wrappedQlikTextLiteralEvidence(query: string): string | null {
  // Detect regular M text values that still include the original Qlik quote
  // marks, e.g. "'Other'". Quoted identifiers (#"...") are deliberately
  // ignored because apostrophes are valid inside an identifier name.
  const source = String(query || "");
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '"' || source[index - 1] === '#') continue;
    let value = "";
    let cursor = index + 1;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '"' && source[cursor + 1] === '"') { value += '"'; cursor += 1; continue; }
      if (source[cursor] === '"') break;
      value += source[cursor];
    }
    if (cursor >= source.length) break;
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      const before = source.slice(0, index);
      const line = before.split(/\r?\n/).length;
      return `Qlik quote marks remain inside an M text value at line ${line}: ${value.slice(0, 160)}`;
    }
    index = cursor;
  }
  return null;
}

function mStaticCheckRows(table: string, query: string, columnTypes: Record<string, string> = {}): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const add = (status: string, check: string, root: string, fix: string) => rows.push({ Status: status, Table: table, Check: check, 'Possible root cause': root, 'Recommended fix': fix });
  const q = query || '';
  if (!q.trim()) { add('Fail', 'M query exists', 'No Power Query M was generated for this final table.', 'Complete source mapping and regenerate conversion.'); return rows; }
  const hasLet = /(^|\n)\s*let\b/i.test(q), hasIn = /(^|\n)\s*in\b/i.test(q);
  add(hasLet && hasIn ? 'Pass' : 'Fail', 'let/in structure', hasLet && hasIn ? 'Complete let/in expression detected.' : 'M query must be a complete let/in expression.', hasLet && hasIn ? 'No action needed.' : 'Regenerate M after source mapping.');
  const [balOk, balMsg] = delimiterBalance(q);
  add(balOk ? 'Pass' : 'Fail', 'delimiter balance', balMsg, balOk ? 'No action needed.' : 'Regenerate M and check parentheses/braces.');
  const invalidQuote = invalidMSingleQuoteEvidence(q);
  add(invalidQuote ? 'Fail' : 'Pass', 'valid M text literals', invalidQuote || 'All text literals use Power Query double-quote syntax.', invalidQuote ? 'Convert Qlik single-quoted text values to escaped M double-quoted text literals.' : 'No action needed.');
  const wrappedQuote = wrappedQlikTextLiteralEvidence(q);
  add(wrappedQuote ? 'Fail' : 'Pass', 'no wrapped Qlik quote marks', wrappedQuote || 'No Qlik quote marks remain inside M text values.', wrappedQuote ? 'Unwrap the Qlik literal before emitting the M text value.' : 'No action needed.');
  const leadingComma = /\n\s*,\s*(#"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*=/.test(q);
  add(leadingComma ? 'Fail' : 'Pass', 'no leading-comma step syntax', leadingComma ? 'Power Query steps cannot start with a comma.' : 'No leading-comma step syntax found.', leadingComma ? 'Regenerate with safe M writer.' : 'No action needed.');
  const qlik = QLIK_ONLY_RE.test(q);
  add(qlik ? 'Fail' : 'Pass', 'no Qlik-only syntax in M', qlik ? 'Qlik script text was written into M.' : 'No known Qlik-only syntax detected.', qlik ? 'Keep unsupported logic in review notes.' : 'No action needed.');
  const aggs = AGG_IN_M_RE.test(q);
  add(aggs ? 'Fail' : 'Pass', 'aggregations not in M', aggs ? 'Qlik aggregation syntax generated as Power Query.' : 'No Qlik-style aggregations in M.', aggs ? 'Convert aggregations to DAX measures.' : 'No action needed.');
  const manual = ['Manual source mapping required', 'Unsupported connector for table', 'Database connector placeholder'].some(s => q.includes(s));
  add(manual ? 'Fail' : 'Pass', 'no manual/unsupported source placeholder', manual ? 'M still contains a manual mapping placeholder.' : 'No manual source placeholders detected.', manual ? 'Update source mapping.' : 'No action needed.');
  const hasSafeValueStep = q.includes('Table.TransformColumns') && q.includes('MissingField.Ignore');
  const hasFinalMetadataStep = hasAuthoritativeReviewedTypes(q, columnTypes);
  if (Object.keys(columnTypes).length) {
    add(hasSafeValueStep ? 'Pass' : 'Fail', 'safe datatype value conversion', hasSafeValueStep ? 'Error-tolerant value conversion step detected.' : 'Reviewed data types exist but the safe value-conversion step is missing.', hasSafeValueStep ? 'No action needed.' : 'Regenerate Power Query from the Data Types screen.');
    add(hasFinalMetadataStep ? 'Pass' : 'Fail', 'authoritative final datatype metadata', hasFinalMetadataStep ? 'The final Power Query result is explicitly typed with Table.TransformColumnTypes.' : 'The generated query does not end with the exact UI-reviewed type signature.', hasFinalMetadataStep ? 'No action needed.' : 'Save the data types again and regenerate Power Query before PBIP export.');
  } else add('Warning', 'safe datatype conversion step', 'No column type metadata for this table.', 'Review parser output and type inference.');
  return rows;
}

function buildMQueryDiagnostics(mQueries: Record<string, string>, columnTypes: Record<string, Record<string, string>>): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const table of Object.keys(mQueries).sort()) {
    rows.push(...mStaticCheckRows(table, mQueries[table], columnTypesForTable(columnTypes, table)));
  }
  return rows;
}

const DIRECT_SOURCE_RE = /\b(?:File\.Contents|Web\.Contents|Folder\.Files|SharePoint\.Files|Sql\.Database|PostgreSQL\.Database|MySQL\.Database|Excel\.Workbook|Csv\.Document|Parquet\.Document|Json\.Document|Xml\.Tables)\b/i;

function referencedNamedQueries(query: string): string[] {
  return uniq([...String(query || "").matchAll(/#\"([^\"]+)\"/g)].map((match) => match[1]));
}

export function buildPowerQueryReviews(
  mQueries: Record<string, string>,
  stagingQueries: Record<string, string>,
  columnTypes: Record<string, Record<string, string>>,
): Record<string, PowerQueryReview> {
  const knownQueries = new Set([...Object.keys(mQueries), ...Object.keys(stagingQueries)]);
  const reports: Record<string, PowerQueryReview> = {};
  for (const [table, query] of Object.entries(mQueries)) {
    const issues: PowerQueryReviewIssue[] = [];
    const add = (
      severity: PowerQueryReviewIssue["severity"],
      category: PowerQueryReviewIssue["category"],
      message: string,
      recommendation: string,
      evidence?: string,
    ) => issues.push({
      id: `PQ-${cleanName(table)}-${category}-${shortStableHash(`${message}|${evidence || ""}`)}`,
      table,
      severity,
      category,
      message,
      recommendation,
      evidence,
    });

    if (!/(^|\n)\s*let\b/i.test(query) || !/(^|\n)\s*in\b/i.test(query)) {
      add("blocking-error", "syntax", "The M expression is not a complete let/in query.", "Regenerate the table query from the reconstructed operation graph.");
    }
    const [balanced, balanceMessage] = delimiterBalance(query);
    if (!balanced) add("blocking-error", "syntax", balanceMessage, "Regenerate the M expression and review the failing delimiter.");
    const invalidQuote = invalidMSingleQuoteEvidence(query);
    if (invalidQuote) add("blocking-error", "syntax", "A Qlik single-quoted text literal was emitted as invalid Power Query M.", "Convert the value to an escaped M double-quoted literal before PBIP export.", invalidQuote);
    const wrappedQuote = wrappedQlikTextLiteralEvidence(query);
    if (wrappedQuote) add("blocking-error", "syntax", "A Qlik text literal was double-wrapped and would return apostrophes as part of the value.", "Unwrap the Qlik quote marks before emitting the M text literal.", wrappedQuote);
    if (QLIK_ONLY_RE.test(query)) add("blocking-error", "qlik-syntax", "Qlik-only syntax remains in the Power Query expression.", "Move the construct to DAX, staging metadata or manual review instead of emitting it as M.");
    if (/QLIK2PBI MANUAL REVIEW/i.test(query)) add("warning", "manual-review", "The query contains a manual-review marker.", "Open the reconstructed operation and confirm the unsupported expression.");
    const references = referencedNamedQueries(query);
    const unknown = references.filter((name) => !knownQueries.has(name));
    if (unknown.length) add("blocking-error", "dependency", `The query references unknown named query/queries: ${unknown.join(", ")}.`, "Rebuild staging queries and named-query dependencies before export.", unknown.join(", "));
    if (DIRECT_SOURCE_RE.test(query) && references.length) {
      add(
        "blocking-error",
        "formula-firewall",
        "The model query directly accesses a data source and also references another query, which can trigger Formula.Firewall.",
        "Move the physical connector into a load-disabled Source_* staging query and let this model query reference named queries only.",
        references.join(", "),
      );
    }
    const reviewedTypes = columnTypesForTable(columnTypes, table);
    if (Object.keys(reviewedTypes).length && !hasAuthoritativeReviewedTypes(query, reviewedTypes)) {
      add("blocking-error", "data-type", "The final M result does not contain the exact reviewed Power BI data-type signature.", "Reapply the reviewed types after the final structural step.");
    }
    if (/Table\.ExpandTableColumn/i.test(query) && !/QLIK2PBI COLLISION SAFE EXPANSION/i.test(query)) {
      add("warning", "dependency", "An expansion step was found without explicit collision filtering.", "Use collision-safe expansion and exclude join keys and existing output names.");
    }
    const blocking = issues.filter((issue) => issue.severity === "blocking-error").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    reports[table] = {
      table,
      status: blocking ? "blocked" : warnings ? "warning" : "passed",
      score: Math.max(0, 100 - blocking * 30 - warnings * 8),
      engine: "deterministic-ai-review",
      reviewedAt: new Date().toISOString(),
      issues,
    };
  }
  return reports;
}

function addPowerQueryReviewIssues(
  validation: { isReadyForPbipExport: boolean; errorCount: number; warningCount: number; issues: ValidationIssue[]; desktopDiagnostics: Record<string, string>[] },
  reviews: Record<string, PowerQueryReview>,
): void {
  const existing = new Set(validation.issues.map((issue) => `${issue.area}|${issue.objectName}|${issue.message}`.toLowerCase()));
  for (const review of Object.values(reviews)) {
    for (const issue of review.issues) {
      const severity = issue.severity === "blocking-error" ? "Error" : issue.severity === "warning" ? "Warning" : "Info";
      const key = `power query ai review|${review.table}|${issue.message}`.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      validation.issues.push({
        severity,
        area: "Power Query AI Review",
        objectName: review.table,
        message: issue.message,
        recommendation: issue.recommendation,
      });
    }
  }
  validation.errorCount = validation.issues.filter((issue) => /error|fail/i.test(issue.severity)).length;
  validation.warningCount = validation.issues.filter((issue) => /warn/i.test(issue.severity)).length;
  validation.isReadyForPbipExport = validation.errorCount === 0;
}

export function reviewEnterprisePowerQueries(analysis: EnterpriseAnalysis): EnterpriseAnalysis {
  const powerQueryReviews = buildPowerQueryReviews(analysis.mQueries, analysis.stagingQueries || {}, analysis.columnTypes);
  const validation = validate(
    analysis.profiles,
    analysis.sourceMappings,
    analysis.mQueries,
    analysis.daxMeasures,
    analysis.relationships,
    analysis.columnTypes,
  );
  addPowerQueryReviewIssues(validation, powerQueryReviews);
  return {
    ...analysis,
    powerQueryReviews,
    validation,
    mQueryDiagnostics: buildMQueryDiagnostics(analysis.mQueries, analysis.columnTypes),
    migrationReport: buildMigrationReport(analysis.profiles, analysis.sourceMappings, analysis.daxMeasures, analysis.relationships, validation),
  };
}

export async function deepReviewEnterprisePowerQueries(analysis: EnterpriseAnalysis): Promise<EnterpriseAnalysis> {
  const reviewed = reviewEnterprisePowerQueries(analysis);
  const deepPowerQueryValidation = await deepValidatePowerQueries(
    reviewed.mQueries,
    reviewed.stagingQueries || {},
    reviewed.columnTypes,
    reviewed.tablePreviews || {},
  );
  const powerQueryReviews = { ...reviewed.powerQueryReviews };
  for (const result of Object.values(deepPowerQueryValidation.queries)) {
    const current = powerQueryReviews[result.queryName] || {
      table: result.queryName,
      status: "passed" as const,
      score: 100,
      engine: "microsoft-powerquery-parser+qlik2pbi-semantic-lint" as const,
      reviewedAt: deepPowerQueryValidation.generatedAt,
      issues: [],
    };
    const deepIssues: PowerQueryReviewIssue[] = result.issues.map((issue) => ({
      id: issue.id,
      table: result.queryName,
      severity: issue.severity,
      category: issue.phase === "preview" ? "manual-review" : issue.phase === "semantic" ? "dependency" : "syntax",
      message: issue.message,
      recommendation: issue.recommendation,
      evidence: issue.evidence || [issue.line, issue.column].some(Boolean) ? `Line ${issue.line || "?"}, column ${issue.column || "?"}${issue.evidence ? `: ${issue.evidence}` : ""}` : undefined,
    }));
    const issues = [...current.issues.filter((issue) => !deepIssues.some((deep) => deep.id === issue.id)), ...deepIssues];
    const blocked = issues.some((issue) => issue.severity === "blocking-error");
    const warning = issues.some((issue) => issue.severity === "warning");
    powerQueryReviews[result.queryName] = {
      ...current,
      status: blocked ? "blocked" : warning ? "warning" : "passed",
      score: Math.max(0, 100 - issues.filter((issue) => issue.severity === "blocking-error").length * 30 - issues.filter((issue) => issue.severity === "warning").length * 8),
      engine: "microsoft-powerquery-parser+qlik2pbi-semantic-lint",
      reviewedAt: deepPowerQueryValidation.generatedAt,
      issues,
    };
  }
  const validation = validate(
    reviewed.profiles,
    reviewed.sourceMappings,
    reviewed.mQueries,
    reviewed.daxMeasures,
    reviewed.relationships,
    reviewed.columnTypes,
  );
  addPowerQueryReviewIssues(validation, powerQueryReviews);
  return {
    ...reviewed,
    deepPowerQueryValidation,
    powerQueryReviews,
    validation,
    migrationReport: buildMigrationReport(reviewed.profiles, reviewed.sourceMappings, reviewed.daxMeasures, reviewed.relationships, validation),
  };
}

// ──────────────────────────────────────────────────────────────
// SECTION 13: Source Catalog
// ──────────────────────────────────────────────────────────────

function sourceKind(ref: string, connectorType = ''): string {
  const r = (ref || '').trim();
  const low = r.toLowerCase();
  const ct = connectorType || connector(r);
  if (low.endsWith('.qvd')) return 'QVD handoff / staging file';
  if (low.startsWith('lib://')) return 'Qlik library file reference';
  if (low.includes('$(')) return 'Qlik variable-based file reference';
  if (/^[a-z]+:\/\//.test(low)) return 'Web/API file reference';
  if (['CSV/Text','Excel','Parquet','JSON','XML','Folder'].includes(ct)) return 'File source';
  if (ct === 'Database/SQL') return 'Relational database object/query';
  return 'Unknown / manual review';
}

function requiredDetails(connectorType: string, ref = ''): string {
  const ct = connectorType || connector(ref);
  if (ct === 'CSV/Text') return 'Mapped file path, delimiter, encoding, header-row confirmation.';
  if (ct === 'Excel') return 'Workbook path plus optional sheet/table name.';
  if (ct === 'Parquet') return 'Parquet file path or folder path.';
  if (ct === 'JSON') return 'JSON file path or web URL plus record/list expansion rules if nested.';
  if (ct === 'XML') return 'XML file path plus element/table extraction rule if nested.';
  if (ct === 'Folder') return 'Folder path and file-combine rule/pattern.';
  if (ct === 'Database/SQL') return 'Server, database, schema/table or native SQL query, authentication method. Format: server=SERVER;database=DB;schema=dbo;table=TableName';
  if (ref.toLowerCase().includes('qvd')) return 'Upload the QVD generator script or map to the original CSV/Excel/SQL source.';
  return 'Choose connector type and provide a Power BI-readable mapped source reference.';
}

function buildSourceCatalog(mappings: SourceMap[], _operations: Operation[], _connections: { type: string; connection: string; file: string; line: number }[]): Record<string, string | boolean>[] {
  const rows: Record<string, string | boolean>[] = [];
  const seen = new Set<string>();
  for (const m of mappings || []) {
    const key = `${m.originalRef}||${m.table}||${m.sourceRole}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ct = m.connectorType || connector(m.mappedRef || m.originalRef);
    rows.push({
      'Table': m.table,
      'Source role': m.sourceRole,
      'Original Qlik reference': m.originalRef,
      'Mapped / effective reference': m.mappedRef || m.effectiveRef,
      'Inferred connector': ct,
      'Source kind': sourceKind(m.originalRef, ct),
      'Required connection details': requiredDetails(ct, m.originalRef),
      'QVD bypassed': m.bypassQvd,
      'QVD producer table': m.qvdProducerTable,
      'Status': m.status,
      'Notes': m.notes,
    });
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────
// SECTION 14: Validator
// ──────────────────────────────────────────────────────────────

function validate(profiles: Record<string, TableProfile>, mappings: SourceMap[], mQueries: Record<string, string>, measures: DaxMeasure[], relationships: Relationship[], columnTypes: Record<string, Record<string, string>>): { isReadyForPbipExport: boolean; errorCount: number; warningCount: number; issues: ValidationIssue[]; desktopDiagnostics: Record<string, string>[] } {
  const issues: ValidationIssue[] = [];
  for (const m of mappings) {
    if (m.bypassQvd || m.status === 'Bypassed' || m.connectorType === 'QVD bypassed via lineage') continue;
    if (m.status !== 'Mapped') issues.push({ severity: 'Error', area: 'Source Mapping', objectName: m.originalRef, message: 'Required source mapping is not confirmed.', recommendation: 'Update connector type and mapped path.' });
    if (m.connectorType.includes('QVD')) issues.push({ severity: 'Error', area: 'Source Mapping', objectName: m.originalRef, message: 'Unresolved QVD cannot be loaded directly by standard Power Query.', recommendation: 'Upload the QVD generator script or map this QVD to CSV/Excel/Parquet/SQL.' });
  }
  const allowedTypes = new Set(TYPE_OPTIONS);
  for (const [table, cols] of Object.entries(columnTypes || {})) {
    for (const [col, dtype] of Object.entries(cols)) {
      if (!allowedTypes.has(dtype)) issues.push({ severity: 'Error', area: 'Data Types', objectName: `${table}.${col}`, message: `Unsupported Power BI data type: ${dtype}`, recommendation: 'Choose a supported type.' });
    }
  }
  for (const [t, p] of Object.entries(profiles)) {
    if (p.status !== 'generated') continue;
    const q = mQueries[t] || '';
    if (!q) issues.push({ severity: 'Error', area: 'Power Query', objectName: t, message: 'No M query generated.', recommendation: '' });
    else if (!/\blet\b/i.test(q) || !/\bin\b/i.test(q)) issues.push({ severity: 'Error', area: 'Power Query', objectName: t, message: 'M query must contain let/in.', recommendation: '' });
    else if (['Manual source mapping required','Unsupported connector for table','Database connector placeholder'].some(s => q.includes(s))) issues.push({ severity: 'Error', area: 'Power Query', objectName: t, message: 'Generated M contains source mapping error.', recommendation: 'Complete source mapping.' });
    else if (QLIK_ONLY_RE.test(q)) issues.push({ severity: 'Error', area: 'Power Query', objectName: t, message: 'Qlik-only syntax found inside generated M.', recommendation: '' });
    else {
      const reviewedTypes = columnTypesForTable(columnTypes, t);
      if (Object.keys(reviewedTypes).length && !hasAuthoritativeReviewedTypes(q, reviewedTypes)) {
        issues.push({ severity: 'Error', area: 'Data Types', objectName: t, message: 'The generated Power Query does not end with the exact UI-reviewed column types.', recommendation: 'Open Power Query > Data Types, save the selections, and regenerate the query.' });
      }
    }
  }
  for (const m of measures) {
    if (m.warning) issues.push({ severity: 'Warning', area: 'DAX', objectName: m.measureName, message: m.warning, recommendation: 'Manual review required.' });
  }
  for (const r of relationships) {
    if (r.status !== 'active' && r.score > 0) issues.push({ severity: 'Info', area: 'Relationships', objectName: `${r.fromTable}-${r.toTable}`, message: r.reason, recommendation: 'Review inactive relationship if needed.' });
  }
  const desktopDiagnostics: Record<string, string>[] = [];
  const addDiag = (status: string, area: string, check: string, root: string, fix: string) => desktopDiagnostics.push({ Status: status, Area: area, Check: check, 'Possible root cause': root, 'Recommended fix': fix });
  const errors = issues.filter(i => i.severity === 'Error').length;
  if (errors === 0) addDiag('Pass', 'Validation', 'No blocking migration validation errors', 'All required source mappings and generated M checks passed.', 'Proceed to PBIP export.');
  else addDiag('Fail', 'Validation', 'Blocking migration validation errors exist', 'Power BI Desktop may reject or open with broken queries.', 'Fix all Error rows in Validation.');
  for (const [table, query] of Object.entries(mQueries || {})) {
    if (!query || !/\blet\b/i.test(query) || !/\bin\b/i.test(query)) addDiag('Fail', 'Power Query', `${table}: let/in structure`, 'Generated M expression is incomplete.', 'Regenerate M after source mapping.');
    else addDiag('Pass', 'Power Query', `${table}: safe M syntax pre-check`, 'M query has let/in and no known Qlik-only syntax.', 'Open PBIP and refresh.');
  }
  const finalTables = Object.values(profiles).filter(p => p.status === 'generated');
  if (finalTables.length) addDiag('Pass', 'Semantic model', `${finalTables.length} final model tables`, 'Only generated final tables are written to the TMDL semantic model definition folder.', 'Excluded Qlik helper/staging tables remain in review metadata.');
  else addDiag('Fail', 'Semantic model', 'No final model tables', 'Final table detector did not find generated tables.', 'Review parser inventory and final table detector rules.');
  return { isReadyForPbipExport: errors === 0, errorCount: errors, warningCount: issues.filter(i => i.severity === 'Warning').length, issues, desktopDiagnostics };
}

// ──────────────────────────────────────────────────────────────
// SECTION 15: Migration Report
// ──────────────────────────────────────────────────────────────

function buildMigrationReport(profiles: Record<string, TableProfile>, mappings: SourceMap[], measures: DaxMeasure[], relationships: Relationship[], validation: { isReadyForPbipExport: boolean; errorCount: number; warningCount: number; issues: ValidationIssue[] }): string {
  const final = Object.values(profiles).filter(p => p.status === 'generated');
  const excl = Object.values(profiles).filter(p => p.status !== 'generated');
  const bypassed = mappings.filter(m => m.bypassQvd || m.status === 'Bypassed');
  const editable = mappings.filter(m => !m.bypassQvd && m.status !== 'Bypassed');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const lines = [
    '# QLIK2PBI Migration Report', '', `Generated: ${now}`, '',
    '## Executive Summary',
    `- Final/static tables generated: **${final.length}**`,
    `- Helper/excluded tables: **${excl.length}**`,
    `- DAX measures generated: **${measures.length}**`,
    `- Relationship candidates: **${relationships.length}**`,
    `- QVD handoffs bypassed by lineage: **${bypassed.length}**`,
    `- Editable physical source mappings: **${editable.length}**`,
    `- PBIP readiness: **${validation.isReadyForPbipExport ? 'Ready' : 'Blocked'}**`,
    `- Errors: **${validation.errorCount}**`,
    `- Warnings: **${validation.warningCount}**`, '',
    '## Final Tables',
    ...final.flatMap(p => [`### ${p.table}`, `- Classification: ${p.classification}`, `- Confidence: ${p.confidence}`, `- Sources: ${p.sourceRefs.join(', ') || 'None parsed'}`, `- QVD handoffs in lineage: ${p.qvdInputs.join(', ') || 'None'}`, `- Dependencies: ${p.dependencies.join(', ') || 'None'}`, `- Reason: ${p.reason}`, '']),
    '## Excluded / Helper Tables',
    ...excl.map(p => `- **${p.table}** — ${p.classification}; ${p.reason}`), '',
    '## Source Mapping and QVD Bypass Plan',
    ...mappings.map(m => `- **${m.originalRef}** → \`${m.mappedRef}\` [${m.connectorType}] — ${m.status}. ${m.notes}${m.bypassQvd ? ` Producer table: **${m.qvdProducerTable}**.` : m.table ? ` Table: **${m.table}**; role: ${m.sourceRole}.` : ''}`), '',
    '## DAX Measures',
    ...measures.flatMap(m => [`### ${m.measureName}`, `- Table: ${m.table}`, `- DAX: \`${m.dax}\``, `- Source Qlik: \`${m.qlikExpression}\``, `- Confidence: ${m.confidence}`, '']),
    '## Relationships',
    ...relationships.map(r => `- **${r.active ? 'Active' : 'Inactive/Review'}** ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}], score ${r.score}. ${r.reason}`), '',
    '## Validation Issues',
    ...(validation.issues.length ? validation.issues.map(i => `- **${i.severity}** | ${i.area} | ${i.objectName}: ${i.message} ${i.recommendation}`) : ['No validation issues found.']),
  ];
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────
// SECTION 16: M Query Export Helpers
// ──────────────────────────────────────────────────────────────

export function combinedMQueriesText(mQueries: Record<string, string>): string {
  const parts: string[] = [];
  for (const table of Object.keys(mQueries).sort()) {
    parts.push('/' + '*'.repeat(78));
    parts.push(`Power Query M for table: ${table}`);
    parts.push('Copy only the query expression below this header into Power BI Advanced Editor.');
    parts.push('*'.repeat(78) + '/');
    parts.push((mQueries[table] || '').trim());
    parts.push('');
  }
  return parts.join('\n').trim() + '\n';
}

// ──────────────────────────────────────────────────────────────
// SECTION 17: Rows-to-Updates helpers
// ──────────────────────────────────────────────────────────────

export function rowsToUpdates(rows: Record<string, string>[]): Record<string, { mappedRef: string; connectorType: string; status: string; notes: string }> {
  const updates: Record<string, { mappedRef: string; connectorType: string; status: string; notes: string }> = {};
  for (const r of rows || []) {
    const bypass = String(r['bypass_qvd'] || '').toLowerCase();
    if (bypass === 'true' || bypass === '1' || r['status'] === 'Bypassed') continue;
    const original = (r['original_ref'] || r['originalRef'] || '').trim();
    if (!original) continue;
    const mapped = (r['mapped_ref'] || r['mappedRef'] || original).trim();
    const providedCt = r['connector_type'] || r['connectorType'] || '';
    const ct = providedCt ? providedCt : connector(mapped || original);
    const db_incomplete = ct === 'Database/SQL' && !(mapped.toLowerCase().includes('server=') && mapped.toLowerCase().includes('database='));
    let status = r['status'] || 'Needs review';
    if (!status || status === 'Needs review') {
      if (mapped && mapped !== original && !['Unknown','QVD - map to supported source'].includes(ct) && !mapped.toLowerCase().endsWith('.qvd') && !db_incomplete) status = 'Mapped';
    }
    const notes = (r['notes'] || '').trim();
    const update = { mappedRef: mapped, connectorType: ct, status, notes };
    updates[original] = update;
    updates[canonicalRef(original)] = update;
    const base = basenameRef(original);
    if (base) updates[base] = update;
  }
  return updates;
}

function ensureVariableHostTypes(
  columnTypes: Record<string, Record<string, string>>,
  columnTypeMeta: Record<string, Record<string, { source: string; confidence: number; reason: string; sampleValues: string[] }>>,
  reconstruction: QlikReconstructionPlan,
): void {
  if (!reconstruction.variableMeasures.length) return;
  columnTypes["Qlik Variables"] = {
    ...(columnTypes["Qlik Variables"] || {}),
    _MeasureHost: "Whole Number",
  };
  columnTypeMeta["Qlik Variables"] = {
    ...(columnTypeMeta["Qlik Variables"] || {}),
    _MeasureHost: {
      source: "System measure host",
      confidence: 100,
      reason: "Hidden disconnected row used only to host reusable Qlik variable measures.",
      sampleValues: ["1"],
    },
  };
}

// ──────────────────────────────────────────────────────────────
// SECTION 18: Apply reviewed data-type overrides
// ──────────────────────────────────────────────────────────────

/**
 * Rebuilds every downstream artifact affected by user-reviewed data types.
 * This is intentionally deterministic: the reviewed UI type map becomes the
 * source of truth for Power Query M, semantic-model columns, diagnostics and
 * the final PBIP/TMDL export.
 */
export function applyDataTypeOverrides(
  analysis: EnterpriseAnalysis,
  dataTypeUpdates: Record<string, string>,
): EnterpriseAnalysis {
  const reconstruction = analysis.reconstruction || buildQlikReconstructionPlan(analysis.operations, analysis.profiles, analysis.variables);
  const reconstructionTypeSeed: Record<string, Record<string, string>> = {};
  applyReconstructionSchema(analysis.profiles, reconstructionTypeSeed, reconstruction);
  const rawSamples = buildRawSampleRows(analysis.inventory.files, analysis.sourceMappings, analysis.operations);
  const executionSourcePlan = buildSourceStagingPlan(analysis.operations, analysis.sourceMappings, analysis.inventory.files);
  let executionPlans = buildTableExecutionPlans(analysis.profiles, analysis.operations, reconstruction, {}, executionSourcePlan);
  let tablePreviews = buildTablePreviews(analysis.profiles, analysis.operations, reconstruction, rawSamples, executionPlans);
  const sampleRowsByTable = Object.fromEntries(Object.entries(tablePreviews).map(([table, preview]) => [table, [...preview.outputRows, ...preview.sourceRows]]));
  const [columnTypes, columnTypeMeta] = buildColumnTypes(
    analysis.profiles,
    analysis.operations,
    dataTypeUpdates,
    sampleRowsByTable,
  );
  for (const [table, columns] of Object.entries(reconstructionTypeSeed)) {
    columnTypes[table] ||= {};
    for (const [column, dtype] of Object.entries(columns)) columnTypes[table][column] ||= dtype;
  }
  ensureVariableHostTypes(columnTypes, columnTypeMeta, reconstruction);
  executionPlans = buildTableExecutionPlans(analysis.profiles, analysis.operations, reconstruction, columnTypes, executionSourcePlan);
  tablePreviews = buildTablePreviews(analysis.profiles, analysis.operations, reconstruction, rawSamples, executionPlans);
  let mQueries = buildMQueries(
    analysis.profiles,
    analysis.operations,
    analysis.sourceMappings,
    columnTypes,
    reconstruction,
    analysis.inventory.files,
    executionPlans,
  );
  if (reconstruction.variableMeasures.length) mQueries['Qlik Variables'] = variableHostMQuery();
  mQueries = applyRelationshipKeyGovernance(mQueries, analysis.relationships, columnTypes);
  const stagingQueries = buildStagingQueries(
    analysis.profiles,
    analysis.operations,
    analysis.sourceMappings,
    columnTypes,
    reconstruction,
    analysis.inventory.files,
  );
  annotatePreviewSourceBindings(tablePreviews, mQueries, stagingQueries);
  const powerQueryReviews = buildPowerQueryReviews(mQueries, stagingQueries, columnTypes);
  const mQueryDiagnostics = buildMQueryDiagnostics(mQueries, columnTypes);
  const semanticModel = buildSemanticModel(
    analysis.profiles,
    analysis.daxMeasures,
    analysis.relationships,
    mQueries,
    columnTypes,
  );
  const validation = validate(
    analysis.profiles,
    analysis.sourceMappings,
    mQueries,
    analysis.daxMeasures,
    analysis.relationships,
    columnTypes,
  );
  addPowerQueryReviewIssues(validation, powerQueryReviews);
  const migrationReport = buildMigrationReport(
    analysis.profiles,
    analysis.sourceMappings,
    analysis.daxMeasures,
    analysis.relationships,
    validation,
  );
  const typedCount = Object.values(columnTypes).reduce(
    (sum, columns) => sum + Object.keys(columns).length,
    0,
  );
  const overrideCount = Object.keys(dataTypeUpdates).filter((key) => {
    const [table, ...columnParts] = key.split('.');
    const column = columnParts.join('.');
    return Boolean(table && column && columnTypes[table]?.[column]);
  }).length;
  const logs = [
    ...analysis.logs.filter((line) => !line.startsWith('Data-type designer:') && !line.startsWith('M query diagnostics:') && !line.startsWith('PBIP readiness:')),
    `Data-type designer: ${typedCount} columns typed (${overrideCount} user overrides applied)`,
    `M query diagnostics: ${mQueryDiagnostics.filter((item) => item['Status'] === 'Pass').length} pass / ${mQueryDiagnostics.length} checks`,
    `PBIP readiness: ${validation.isReadyForPbipExport ? 'Ready' : 'Blocked'} (${validation.errorCount} errors, ${validation.warningCount} warnings)`,
  ];

  return {
    ...analysis,
    columnTypes,
    columnTypeMeta,
    mQueries,
    stagingQueries,
    reconstruction,
    mQueryDiagnostics,
    semanticModel,
    validation,
    migrationReport,
    powerQueryReviews,
    tablePreviews,
    executionPlans,
    logs,
  };
}


function applyReconstructionSchema(
  profiles: Record<string, TableProfile>,
  columnTypes: Record<string, Record<string, string>>,
  reconstruction: QlikReconstructionPlan,
): void {
  for (const staticTable of reconstruction.staticTables) {
    if (staticTable.includeInModel) {
      const canonical = profiles[staticTable.canonicalName];
      if (canonical) {
        canonical.status = 'generated';
        canonical.classification = 'inline/static';
        canonical.reason = staticTable.reason;
        canonical.fields = uniq(staticTable.columns);
      }
    }
    for (const alias of staticTable.aliases) {
      if (alias === staticTable.canonicalName) continue;
      const duplicate = profiles[alias];
      if (!duplicate) continue;
      duplicate.status = 'excluded';
      duplicate.classification = 'duplicate inline/static alias';
      duplicate.reason = `Duplicate INLINE definition consolidated into ${staticTable.canonicalName}.`;
    }
  }

  for (const classification of reconstruction.tableClassifications) {
    const profile = profiles[classification.table];
    if (!profile) continue;
    profile.classification = classification.disposition;
    profile.reason = classification.reason;
    profile.confidence = classification.confidence;
    if (!classification.includeInModel) {
      profile.status = "excluded";
      // Do not leave the pre-reconstruction schema attached to an excluded
      // semantic table. The full source remains available in its staging query.
      profile.fields = [];
    } else {
      profile.status = "generated";
      // Apply the governed projection even when the retained list is empty.
      // The earlier conditional assignment allowed joined attributes to leak
      // back into secondary tables and created synthetic/cyclic relationships.
      profile.fields = uniq(classification.retainedColumns);
    }
  }

  for (const composite of reconstruction.compositeKeys) {
    for (const table of [composite.leftTable, composite.rightTable]) {
      const profile = profiles[table];
      if (!profile || profile.status !== 'generated') continue;
      if (!profile.fields.some((field) => field.toLowerCase() === composite.keyColumn.toLowerCase())) profile.fields.push(composite.keyColumn);
      columnTypes[table] ||= {};
      columnTypes[table][composite.keyColumn] = 'Text';
    }
  }

  if (reconstruction.variableMeasures.length) {
    profiles['Qlik Variables'] = {
      table: 'Qlik Variables',
      classification: 'measure host',
      status: 'generated',
      confidence: 100,
      reason: 'Disconnected measure host for reusable Qlik variable measures.',
      fields: ['_MeasureHost'],
      sourceRefs: [],
      qvdInputs: [],
      qvdOutputs: [],
      dependencies: [],
      mappingDependencies: [],
      inlineDependencies: [],
      droppedIntermediates: [],
      joinLogic: [],
      concatLogic: [],
      filters: [],
      calculatedColumns: [],
      lineageIds: [],
      lineageScript: '// Generated disconnected table for Qlik variable measures.',
      flowSteps: [],
      etlStory: 'One-row hidden table used only to host reusable variable measures.',
      reviewNotes: [],
    };
    columnTypes['Qlik Variables'] = { _MeasureHost: 'Whole Number' };
  }
}

function mergeReconstructionMeasures(base: DaxMeasure[], reconstruction: QlikReconstructionPlan): DaxMeasure[] {
  const output: DaxMeasure[] = [];
  const names = new Set<string>();
  const expressions = new Set<string>();
  const add = (measure: DaxMeasure, preserveSameExpression = false) => {
    const nameKey = `${measure.table}|${measure.measureName}`.toLowerCase();
    const expressionKey = measure.dax.replace(/\/\/[^\n]*$/gm, '').replace(/\s+/g, '').toLowerCase();
    if (names.has(nameKey)) return;
    if (!preserveSameExpression && expressions.has(expressionKey)) return;
    names.add(nameKey);
    if (!preserveSameExpression) expressions.add(expressionKey);
    output.push(measure);
  };
  for (const measure of base) add(measure);
  for (const measure of reconstructionMeasuresAsDax(reconstruction)) add(measure, measure.table === 'Qlik Variables');
  return output;
}

function applyCompositeRelationshipPolicy(
  relationships: Relationship[],
  profiles: Record<string, TableProfile>,
  reconstruction: QlikReconstructionPlan,
): Relationship[] {
  let result = [...relationships];
  for (const composite of reconstruction.compositeKeys) {
    const leftProfile = profiles[composite.leftTable];
    const rightProfile = profiles[composite.rightTable];
    if (!leftProfile || !rightProfile || leftProfile.status !== "generated" || rightProfile.status !== "generated") continue;
    if (!leftProfile.fields.some((field) => field.toLowerCase() === composite.keyColumn.toLowerCase())
      || !rightProfile.fields.some((field) => field.toLowerCase() === composite.keyColumn.toLowerCase())) continue;
    result = result.filter((relationship) => {
      const samePair = new Set([relationship.fromTable, relationship.toTable]);
      return !(samePair.has(composite.leftTable) && samePair.has(composite.rightTable));
    });
    const leftRole = tableRole(profiles[composite.leftTable]);
    const rightRole = tableRole(profiles[composite.rightTable]);
    const leftIsFact = leftRole === 'fact' || leftRole === 'bridge';
    const fromTable = leftIsFact ? composite.leftTable : composite.rightTable;
    const toTable = leftIsFact ? composite.rightTable : composite.leftTable;
    result.push({
      fromTable,
      fromColumn: composite.keyColumn,
      toTable,
      toColumn: composite.keyColumn,
      score: 240,
      active: ['automatic', 'qlik-equivalent', 'powerbi-optimized'].includes(reconstruction.modelBuildMode),
      status: ['automatic', 'qlik-equivalent', 'powerbi-optimized'].includes(reconstruction.modelBuildMode) ? 'active' : 'inactive/desktop review',
      reason: composite.reason,
      cardinality: 'manyToOne',
      filterDirection: 'single',
      confidence: composite.confidence,
    });
  }
  return result.filter((relationship) => {
    const from = profiles[relationship.fromTable];
    const to = profiles[relationship.toTable];
    return from?.status === "generated" && to?.status === "generated"
      && from.fields.some((field) => field.toLowerCase() === relationship.fromColumn.toLowerCase())
      && to.fields.some((field) => field.toLowerCase() === relationship.toColumn.toLowerCase());
  });
}

function variableHostMQuery(): string {
  return applyReviewedTypesToMQuery(
    `let
    Source = #table(type table [_MeasureHost = Int64.Type], {{1}})
in
    Source`,
    { _MeasureHost: 'Whole Number' },
  );
}

// ──────────────────────────────────────────────────────────────
// SECTION 19: Main Pipeline
// ──────────────────────────────────────────────────────────────

export function runEnterpriseAnalysis(files: ProjectFile[], mappingUpdates: Record<string, { mappedRef?: string; connectorType?: string; status?: string; notes?: string }> = {}, dataTypeUpdates: Record<string, string> = {}): EnterpriseAnalysis {
  const parsed = parseProject(files);
  const ops = parsed.operations;
  const logicDecisions = buildQlikLogicDecisions(files, ops);
  const profiles = detectTables(ops);
  const reconstruction = buildQlikReconstructionPlan(ops, profiles, parsed.variables);
  const maps = buildSourceMappings(ops, mappingUpdates);
  const sourceCatalog = buildSourceCatalog(maps, ops, parsed.connections);
  const rawSamples = buildRawSampleRows(files, maps, ops);
  const executionSourcePlan = buildSourceStagingPlan(ops, maps, files);
  // Apply the reconstructed schema before type inference so static tables,
  // composite keys and the variable host participate in the same UI → M map.
  const reconstructionTypeSeed: Record<string, Record<string, string>> = {};
  applyReconstructionSchema(profiles, reconstructionTypeSeed, reconstruction);
  let executionPlans = buildTableExecutionPlans(profiles, ops, reconstruction, {}, executionSourcePlan);
  let tablePreviews = buildTablePreviews(profiles, ops, reconstruction, rawSamples, executionPlans);
  const sampleRowsByTable = Object.fromEntries(Object.entries(tablePreviews).map(([table, preview]) => [table, [...preview.outputRows, ...preview.sourceRows]]));
  const [columnTypes, columnTypeMeta] = buildColumnTypes(profiles, ops, dataTypeUpdates, sampleRowsByTable);
  for (const [table, columns] of Object.entries(reconstructionTypeSeed)) {
    columnTypes[table] ||= {};
    for (const [column, dtype] of Object.entries(columns)) columnTypes[table][column] ||= dtype;
  }
  ensureVariableHostTypes(columnTypes, columnTypeMeta, reconstruction);
  applyReconstructionSchema(profiles, columnTypes, reconstruction);
  executionPlans = buildTableExecutionPlans(profiles, ops, reconstruction, columnTypes, executionSourcePlan);
  tablePreviews = buildTablePreviews(profiles, ops, reconstruction, rawSamples, executionPlans);
  let rels = applyCompositeRelationshipPolicy(inferRelationships(profiles, reconstruction), profiles, reconstruction);
  harmonizeRelationshipKeyTypes(rels, columnTypes, columnTypeMeta);
  rels = governRelationshipsBySample(rels, tablePreviews);
  const dax = mergeReconstructionMeasures(buildDaxMeasures(ops, profiles), reconstruction);
  let mQueries = buildMQueries(profiles, ops, maps, columnTypes, reconstruction, files, executionPlans);
  if (reconstruction.variableMeasures.length) mQueries['Qlik Variables'] = variableHostMQuery();
  mQueries = applyRelationshipKeyGovernance(mQueries, rels, columnTypes);
  const stagingQueries = buildStagingQueries(profiles, ops, maps, columnTypes, reconstruction, files);
  annotatePreviewSourceBindings(tablePreviews, mQueries, stagingQueries);
  const powerQueryReviews = buildPowerQueryReviews(mQueries, stagingQueries, columnTypes);
  const mDiagnostics = buildMQueryDiagnostics(mQueries, columnTypes);
  const model = buildSemanticModel(profiles, dax, rels, mQueries, columnTypes);
  const val = validate(profiles, maps, mQueries, dax, rels, columnTypes);
  addPowerQueryReviewIssues(val, powerQueryReviews);
  for (const join of reconstruction.joinReconstructions.filter((item) => !item.keyColumns.length)) {
    val.issues.push({
      severity: "Error",
      area: "Join Reconstruction",
      objectName: `${join.targetTable}-${join.sourceTable}`,
      message: "Qlik JOIN/KEEP has no deterministic common key.",
      recommendation: "Open Power Query join mapping and select the exact left and right key fields before PBIP export.",
    });
  }
  val.errorCount = val.issues.filter((issue) => /error|fail/i.test(issue.severity)).length;
  val.warningCount = val.issues.filter((issue) => /warn/i.test(issue.severity)).length;
  val.isReadyForPbipExport = val.errorCount === 0;
  const rep = buildMigrationReport(profiles, maps, dax, rels, val);
  const finalTables = Object.values(profiles).filter((profile) => reconstruction.tables[profile.table]?.includeInModel ?? profile.status === "generated");
  const excludedTables = Object.values(profiles).filter((profile) => !(reconstruction.tables[profile.table]?.includeInModel ?? profile.status === "generated"));
  return {
    inventory: { totalFiles: files.length, textFiles: files.filter(f => f.isText).length, files },
    operations: ops, variables: parsed.variables, connections: parsed.connections,
    profiles, finalTables, excludedTables,
    sourceMappings: maps, sourceCatalog, columnTypes, columnTypeMeta,
    daxMeasures: dax, mQueries, stagingQueries, mQueryDiagnostics: mDiagnostics,
    relationships: rels, semanticModel: model, validation: val, migrationReport: rep, logicDecisions, reconstruction,
    powerQueryReviews, tablePreviews, executionPlans,
    logs: [
      `Upload/extraction: ${files.length} files`,
      `Parser: ${ops.length} operations`,
      `Reconstruction engine: ${reconstruction.passes.filter((pass) => pass.status === 'passed').length}/${reconstruction.passes.length} passes; confidence ${reconstruction.confidence}%`,
      `Final table detector: ${finalTables.length} generated tables`,
      `Static table consolidation: ${reconstruction.staticTables.length} canonical definitions / ${reconstruction.staticTables.reduce((sum, table) => sum + Math.max(0, table.aliases.length - 1), 0)} duplicates removed`,
      `Dropped tables retained as staging queries: ${reconstruction.retainedDroppedTables.length}`,
      `QVD STORE operations omitted: ${reconstruction.omittedStoreOperationIds.length}`,
      `Join reconstruction: ${reconstruction.joinReconstructions.length} operations / ${reconstruction.joinReconstructions.filter((join) => !join.keyColumns.length).length} unresolved`,
      `Composite key engine: ${reconstruction.compositeKeys.length} explicit multi-column keys; shared-name-only keys ignored`,
      `Model classification: ${reconstruction.tableClassifications.filter((table) => table.includeInModel).length} included / ${reconstruction.tableClassifications.filter((table) => !table.includeInModel).length} staging or excluded`,
      `Source mapper: ${maps.length} source refs`,
      `Source catalog: ${sourceCatalog.length} connector-planning rows`,
      `Data-type designer: ${Object.values(columnTypes).reduce((sum, value) => sum + Object.keys(value).length, 0)} columns typed`,
      `DAX translator: ${dax.length} measures (${reconstruction.aggregateMeasures.length} ETL aggregations, ${reconstruction.variableMeasures.length} variables)`,
      `Power Query staging: ${Object.keys(stagingQueries).length} load-disabled source/static/helper queries`,
      `Power Query AI review: ${Object.values(powerQueryReviews).filter((review) => review.status === "passed").length}/${Object.keys(powerQueryReviews).length} tables passed; ${Object.values(powerQueryReviews).reduce((sum, review) => sum + review.issues.filter((issue) => issue.severity === "blocking-error").length, 0)} blocking review issue(s)`,
      `Sample/output preview: ${Object.values(tablePreviews).filter((preview) => preview.status !== "unavailable").length}/${Object.keys(tablePreviews).length} final tables have uploaded-data previews`,
      `M query diagnostics: ${mDiagnostics.filter(d => d['Status'] === 'Pass').length} pass / ${mDiagnostics.length} checks`,
      `Relationship engine: ${rels.length} candidates`,
      `Qlik logic policy: ${logicDecisions.filter((item) => item.action === 'translate').length} translated / ${logicDecisions.filter((item) => item.action === 'ignore-runtime').length} ignored runtime directives / ${logicDecisions.filter((item) => item.action === 'manual-review').length} review items`,
      `PBIP readiness: ${val.isReadyForPbipExport ? 'Ready' : 'Blocked'} (${val.errorCount} errors, ${val.warningCount} warnings)`,
    ],
  };
}


/**
 * Rebuilds Power Query, classifications, relationships and validation when the
 * user changes the model-design policy. The uploaded files are not reparsed;
 * the established operation graph is deterministically re-planned.
 */
export function applyModelBuildMode(
  analysis: EnterpriseAnalysis,
  modelBuildMode: QlikReconstructionPlan["modelBuildMode"],
): EnterpriseAnalysis {
  const profiles = JSON.parse(JSON.stringify(analysis.profiles)) as Record<string, TableProfile>;
  const reconstruction = buildQlikReconstructionPlan(
    analysis.operations,
    profiles,
    analysis.variables,
    modelBuildMode,
  );
  const columnTypes = JSON.parse(JSON.stringify(analysis.columnTypes)) as Record<string, Record<string, string>>;
  const columnTypeMeta = JSON.parse(JSON.stringify(analysis.columnTypeMeta)) as EnterpriseAnalysis["columnTypeMeta"];
  applyReconstructionSchema(profiles, columnTypes, reconstruction);
  ensureVariableHostTypes(columnTypes, columnTypeMeta, reconstruction);
  applyReconstructionSchema(profiles, columnTypes, reconstruction);
  const rawSamples = buildRawSampleRows(analysis.inventory.files, analysis.sourceMappings, analysis.operations);
  const executionSourcePlan = buildSourceStagingPlan(analysis.operations, analysis.sourceMappings, analysis.inventory.files);
  const executionPlans = buildTableExecutionPlans(profiles, analysis.operations, reconstruction, columnTypes, executionSourcePlan);
  const tablePreviews = buildTablePreviews(profiles, analysis.operations, reconstruction, rawSamples, executionPlans);
  let relationships = applyCompositeRelationshipPolicy(inferRelationships(profiles, reconstruction), profiles, reconstruction);
  harmonizeRelationshipKeyTypes(relationships, columnTypes, columnTypeMeta);
  relationships = governRelationshipsBySample(relationships, tablePreviews);
  let mQueries = buildMQueries(
    profiles,
    analysis.operations,
    analysis.sourceMappings,
    columnTypes,
    reconstruction,
    analysis.inventory.files,
    executionPlans,
  );
  if (reconstruction.variableMeasures.length) mQueries["Qlik Variables"] = variableHostMQuery();
  mQueries = applyRelationshipKeyGovernance(mQueries, relationships, columnTypes);
  const stagingQueries = buildStagingQueries(
    profiles,
    analysis.operations,
    analysis.sourceMappings,
    columnTypes,
    reconstruction,
    analysis.inventory.files,
  );
  annotatePreviewSourceBindings(tablePreviews, mQueries, stagingQueries);
  const semanticModel = buildSemanticModel(profiles, analysis.daxMeasures, relationships, mQueries, columnTypes);
  const powerQueryReviews = buildPowerQueryReviews(mQueries, stagingQueries, columnTypes);
  let refreshed: EnterpriseAnalysis = {
    ...analysis,
    profiles,
    reconstruction,
    columnTypes,
    columnTypeMeta,
    mQueries,
    stagingQueries,
    relationships,
    semanticModel,
    tablePreviews,
    executionPlans,
    powerQueryReviews,
    finalTables: Object.values(profiles).filter((profile) => reconstruction.tables[profile.table]?.includeInModel ?? profile.status === "generated"),
    excludedTables: Object.values(profiles).filter((profile) => !(reconstruction.tables[profile.table]?.includeInModel ?? profile.status === "generated")),
    logs: [
      ...analysis.logs.filter((line) => !line.startsWith("Model build mode:")),
      `Model build mode: ${modelBuildMode}; ${reconstruction.tableClassifications.filter((table) => table.includeInModel).length} semantic table(s), ${reconstruction.tableClassifications.filter((table) => !table.includeInModel).length} staging/excluded table(s)`,
    ],
  };
  refreshed = revalidateEnterpriseAnalysis(refreshed);
  return refreshed;
}

/**
 * Rebuilds the authoritative validation result after an in-UI edit.
 * The returned issue collection replaces the previous collection; callers must
 * never append it to stale validation cards.
 */
export function revalidateEnterpriseAnalysis(analysis: EnterpriseAnalysis): EnterpriseAnalysis {
  const validation = validate(
    analysis.profiles,
    analysis.sourceMappings,
    analysis.mQueries,
    analysis.daxMeasures,
    analysis.relationships,
    analysis.columnTypes,
  );
  for (const join of analysis.reconstruction?.joinReconstructions.filter((item) => !item.keyColumns.length) || []) {
    validation.issues.push({
      severity: "Error",
      area: "Join Reconstruction",
      objectName: `${join.targetTable}-${join.sourceTable}`,
      message: "Qlik JOIN/KEEP has no deterministic common key.",
      recommendation: "Open Power Query join mapping and select the exact left and right key fields before PBIP export.",
    });
  }
  const powerQueryReviews = buildPowerQueryReviews(analysis.mQueries, analysis.stagingQueries || {}, analysis.columnTypes);
  addPowerQueryReviewIssues(validation, powerQueryReviews);
  validation.errorCount = validation.issues.filter((issue) => /error|fail/i.test(issue.severity)).length;
  validation.warningCount = validation.issues.filter((issue) => /warn/i.test(issue.severity)).length;
  validation.isReadyForPbipExport = validation.errorCount === 0;
  return {
    ...analysis,
    powerQueryReviews,
    validation,
    mQueryDiagnostics: buildMQueryDiagnostics(analysis.mQueries, analysis.columnTypes),
    migrationReport: buildMigrationReport(analysis.profiles, analysis.sourceMappings, analysis.daxMeasures, analysis.relationships, validation),
  };
}
