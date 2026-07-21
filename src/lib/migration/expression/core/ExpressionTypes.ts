import type { QvwMigrationStatus } from "../../qvw/types";

export type ExpressionTokenKind =
  | "identifier"
  | "field"
  | "variable"
  | "number"
  | "string"
  | "operator"
  | "comma"
  | "lparen"
  | "rparen"
  | "set-analysis"
  | "eof";

export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface ExpressionToken extends SourceSpan {
  kind: ExpressionTokenKind;
  value: string;
}

export interface AstBase {
  kind: string;
  span: SourceSpan;
  raw?: string;
}

export interface LiteralNode extends AstBase {
  kind: "literal";
  value: string | number | boolean | null;
  valueType: "string" | "number" | "boolean" | "null";
}

export interface FieldNode extends AstBase {
  kind: "field";
  name: string;
  table?: string;
}

export interface VariableNode extends AstBase {
  kind: "variable";
  name: string;
  expansion: string;
}

export interface IdentifierNode extends AstBase {
  kind: "identifier";
  name: string;
}

export interface UnaryNode extends AstBase {
  kind: "unary";
  operator: string;
  operand: ExpressionAstNode;
}

export interface BinaryNode extends AstBase {
  kind: "binary";
  operator: string;
  left: ExpressionAstNode;
  right: ExpressionAstNode;
}

export interface SetModifier {
  field: string;
  operator: "=" | "+=" | "-=" | "*=" | "/=";
  values: string[];
  raw: string;
}

export interface SetAnalysisNode extends AstBase {
  kind: "set-analysis";
  identifier: string;
  modifiers: SetModifier[];
}

export interface FunctionNode extends AstBase {
  kind: "function";
  name: string;
  args: ExpressionAstNode[];
  distinct: boolean;
  total: boolean;
  setAnalysis?: SetAnalysisNode;
}

export interface RawNode extends AstBase {
  kind: "raw";
  value: string;
}

export type ExpressionAstNode =
  | LiteralNode
  | FieldNode
  | VariableNode
  | IdentifierNode
  | UnaryNode
  | BinaryNode
  | SetAnalysisNode
  | FunctionNode
  | RawNode;

export type ExpressionArtifactType =
  | "measure"
  | "existing-column"
  | "calculated-column"
  | "calculated-table"
  | "field-parameter"
  | "what-if-parameter"
  | "disconnected-parameter-table"
  | "calculation-group-candidate"
  | "dynamic-format-string"
  | "visual-filter"
  | "page-filter"
  | "report-filter"
  | "conditional-formatting"
  | "dynamic-title-measure"
  | "bookmark-navigation"
  | "manual-redesign";

export type ExpressionConversionStatus =
  | "automatic"
  | "warning"
  | "manual"
  | "unsupported"
  | "missing-dependency"
  | "approved"
  | "excluded";

export interface ExpressionIssue {
  severity: "information" | "warning" | "error" | "blocking-error";
  code: string;
  message: string;
  construct?: string;
  recommendation?: string;
}

export interface ExpressionUsage {
  sheetId?: string;
  sheetName?: string;
  objectId?: string;
  objectTitle?: string;
  objectType?: string;
  role: string;
}

export interface ExpressionArtifact {
  id: string;
  sourceExpressionIds: string[];
  documentId?: string;
  label: string;
  name: string;
  originalExpression: string;
  normalizedExpression: string;
  role: string;
  usages: ExpressionUsage[];
  ast?: ExpressionAstNode;
  astJson?: string;
  referencedTables: string[];
  referencedFields: string[];
  referencedVariables: string[];
  referencedMeasures: string[];
  functions: string[];
  hasSetAnalysis: boolean;
  hasAggr: boolean;
  hasInterRecordFunctions: boolean;
  nestedDepth: number;
  artifactType: ExpressionArtifactType;
  generatedDax: string;
  editedDax?: string;
  homeTable: string;
  displayFolder: string;
  formatString?: string;
  description: string;
  confidence: number;
  status: ExpressionConversionStatus;
  migrationStatus: QvwMigrationStatus;
  issues: ExpressionIssue[];
  explanation: string[];
  approved: boolean;
  excludedReason?: string;
  userEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpressionInventoryMetrics {
  total: number;
  automatic: number;
  warning: number;
  manual: number;
  unsupported: number;
  missingDependency: number;
  approved: number;
  measures: number;
  calculatedColumns: number;
  parameters: number;
  formattingRules: number;
}

export interface ExpressionInventory {
  generatedAt: string;
  parserVersion: string;
  artifacts: ExpressionArtifact[];
  metrics: ExpressionInventoryMetrics;
  diagnostics: ExpressionIssue[];
}
