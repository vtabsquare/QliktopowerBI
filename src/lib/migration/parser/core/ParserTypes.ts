export type TokenKind =
  | "keyword"
  | "identifier"
  | "variable"
  | "string"
  | "number"
  | "operator"
  | "punctuation"
  | "newline"
  | "comment"
  | "unknown"
  | "eof";

export interface SourceLocation {
  fileName?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface Token {
  kind: TokenKind;
  value: string;
  upperValue: string;
  location: SourceLocation;
}

export type StatementKind =
  | "load"
  | "select"
  | "resident"
  | "join"
  | "mapping"
  | "store"
  | "drop"
  | "calendar"
  | "applymap"
  | "variable"
  | "connection"
  | "control"
  | "unknown";

export interface ParsedStatement {
  id: string;
  raw: string;
  normalized: string;
  location: SourceLocation;
  label?: string;
  prefixes: string[];
  body: string;
  kind: StatementKind;
}

export type QlikSourceKind =
  "qvd" | "file" | "sql" | "resident" | "inline" | "autogenerate" | "extension" | "unknown";

export interface QlikField {
  name: string;
  expression: string;
  sourceField?: string;
  alias?: string;
  isDerived: boolean;
  isWildcard: boolean;
  applyMaps: ApplyMapCall[];
}

export interface ApplyMapCall {
  mapName: string;
  lookupExpression: string;
  defaultExpression?: string;
  outputField?: string;
  raw: string;
}

export interface QlikSourceReference {
  kind: QlikSourceKind;
  raw: string;
  name: string;
  path?: string;
  table?: string;
  connectionName?: string;
  options?: Record<string, string>;
}

export type OperationKind =
  | "LOAD"
  | "SELECT"
  | "RESIDENT"
  | "JOIN"
  | "MAPPING_LOAD"
  | "STORE"
  | "DROP_TABLE"
  | "DROP_FIELD"
  | "CALENDAR"
  | "APPLYMAP"
  | "UNKNOWN";

export type JoinType = "left" | "right" | "inner" | "outer" | "natural";

export interface ParsedOperation {
  id: string;
  sequence: number;
  kind: OperationKind;
  statementId: string;
  location: SourceLocation;
  raw: string;
  targetTable?: string;
  sourceTables: string[];
  source?: QlikSourceReference;
  fields: QlikField[];
  where?: string;
  groupBy: string[];
  orderBy: string[];
  distinct: boolean;
  precedingLoad: boolean;
  join?: {
    type: JoinType;
    targetTable?: string;
    keep: boolean;
  };
  mapping?: {
    tableName: string;
    keyField?: string;
    valueField?: string;
  };
  store?: {
    sourceTable: string;
    targetPath: string;
    format?: string;
  };
  drop?: {
    objectType: "table" | "field";
    names: string[];
    fromTable?: string;
  };
  calendar?: {
    minExpression?: string;
    maxExpression?: string;
    generatedFields: string[];
    sourceTable?: string;
  };
  applyMaps: ApplyMapCall[];
  attributes: Record<string, unknown>;
  diagnostics: ParserDiagnostic[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface ParserDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location?: SourceLocation;
  statementId?: string;
  parser?: string;
  detail?: string;
}

export interface ParserResult {
  operations: ParsedOperation[];
  diagnostics?: ParserDiagnostic[];
}

export interface StatementParserPlugin {
  readonly name: string;
  readonly priority: number;
  canParse(statement: ParsedStatement, context: ParserContextLike): boolean;
  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult;
}

export interface ParserContextLike {
  readonly fileName?: string;
  readonly variables: ReadonlyMap<string, string>;
  readonly connections: ReadonlyMap<string, string>;
  readonly operations: readonly ParsedOperation[];
  readonly lastCreatedTable?: string;
  nextOperationId(prefix?: string): string;
  resolveVariables(value: string): string;
  addDiagnostic(diagnostic: ParserDiagnostic): void;
  registerVariable(name: string, value: string): void;
  registerConnection(name: string, value: string): void;
  registerOperation(operation: ParsedOperation): void;
  setLastCreatedTable(tableName: string | undefined): void;
}

export interface TableMetadata {
  name: string;
  role: "fact" | "dimension" | "calendar" | "mapping" | "bridge" | "intermediate" | "unknown";
  fields: QlikField[];
  sourceTables: string[];
  sourceReferences: QlikSourceReference[];
  createdBy: string[];
  modifiedBy: string[];
  dropped: boolean;
  storedTargets: string[];
  isFinal: boolean;
}

export interface RelationshipMetadata {
  id: string;
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
  reason: "shared-field" | "join" | "applymap" | "explicit";
  confidence: number;
  cardinality: "1:1" | "1:N" | "N:1" | "N:N" | "unknown";
}

export interface LineageEdge {
  id: string;
  from: string;
  to: string;
  kind: "load" | "resident" | "join" | "mapping" | "applymap" | "store" | "drop";
  operationId: string;
  fieldMappings?: Record<string, string>;
}

export interface ExecutionGraphNode {
  id: string;
  operationId: string;
  sequence: number;
  kind: OperationKind;
  inputs: string[];
  outputs: string[];
  dependsOn: string[];
  raw: string;
}

export interface QlikParserMetadata {
  fileName?: string;
  statements: ParsedStatement[];
  operations: ParsedOperation[];
  tables: TableMetadata[];
  relationships: RelationshipMetadata[];
  lineage: LineageEdge[];
  executionGraph: ExecutionGraphNode[];
  variables: Record<string, string>;
  connections: Record<string, string>;
  droppedTables: string[];
  finalTables: string[];
  diagnostics: ParserDiagnostic[];
  metrics: {
    statements: number;
    operations: number;
    loads: number;
    residentLoads: number;
    joins: number;
    mappingLoads: number;
    applyMaps: number;
    stores: number;
    drops: number;
    calendars: number;
  };
}

export interface ParseScriptOptions {
  fileName?: string;
  includeComments?: boolean;
  inferRelationships?: boolean;
  inferCalendars?: boolean;
  strict?: boolean;
}
