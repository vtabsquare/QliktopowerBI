import type { ExpressionArtifact } from "../expression";

export type ModelTableKind = "fact" | "dimension" | "bridge" | "date" | "parameter" | "calculated" | "disconnected" | "unknown";
export type ModelDiagnosticSeverity = "information" | "warning" | "error" | "blocking-error";

export interface PowerBiColumn {
  id: string;
  name: string;
  sourceName: string;
  dataType: string;
  hidden: boolean;
  isKey: boolean;
  nullable?: boolean;
  distinctCount?: number;
  nullPercentage?: number;
  sortByColumn?: string;
  defaultSummarization?: string;
  formatString?: string;
  dataCategory?: string;
  expression?: string;
  sourceExpressionId?: string;
}

export interface PowerBiMeasure {
  id: string;
  name: string;
  expression: string;
  originalExpression?: string;
  sourceExpressionId?: string;
  sourceExpressionIds?: string[];
  homeTable: string;
  displayFolder?: string;
  formatString?: string;
  description?: string;
  hidden: boolean;
  approved: boolean;
  status: string;
}

export interface PowerBiHierarchy {
  id: string;
  name: string;
  levels: string[];
}

export interface PowerBiTable {
  id: string;
  name: string;
  sourceName: string;
  queryName?: string;
  description?: string;
  kind: ModelTableKind;
  hidden: boolean;
  columns: PowerBiColumn[];
  measures: PowerBiMeasure[];
  hierarchies: PowerBiHierarchy[];
  calculatedExpression?: string;
  sourceLineage: string[];
  warnings: string[];
  sampleRowCount?: number;
  recommendedKeyColumnId?: string | null;
  keyRecommendationReason?: string;
}

export type RelationshipCardinality = "one-to-many" | "many-to-one" | "one-to-one" | "many-to-many";
export type CrossFilterDirection = "single" | "both";

export interface PowerBiRelationship {
  id: string;
  fromTableId: string;
  fromColumnId: string;
  toTableId: string;
  toColumnId: string;
  cardinality: RelationshipCardinality;
  crossFilterDirection: CrossFilterDirection;
  active: boolean;
  source: "qlik-association" | "join" | "inferred" | "manual";
  confidence: number;
  evidence: string[];
  riskLevel: "low" | "medium" | "high";
  userApproved: boolean;
  deleted?: boolean;
  notes?: string;
  validationMessages: string[];
  autoApplied?: boolean;
  recommendationStatus?: "ready" | "review" | "exclude";
  recommendationReason?: string;
}

export interface ModelLayoutPosition { x: number; y: number; }

export interface ModelDiagnostic {
  id: string;
  severity: ModelDiagnosticSeverity;
  area: "table" | "column" | "measure" | "relationship" | "visual" | "model";
  objectId?: string;
  objectName: string;
  code: string;
  message: string;
  recommendation: string;
  approved?: boolean;
}

export interface VisualBinding {
  id: string;
  sheetId?: string;
  sheetName?: string;
  objectId: string;
  objectTitle?: string;
  originalObjectType: string;
  targetVisual: string;
  dimensionIds: string[];
  measureIds: string[];
  filterArtifactIds: string[];
  conditionalFormattingArtifactIds: string[];
  dynamicTitleArtifactIds: string[];
  bookmarkIds: string[];
  status: "valid" | "warning" | "manual" | "invalid";
  messages: string[];
}

export interface PowerBiModelState {
  id: string;
  projectName: string;
  generatedAt: string;
  version: string;
  viewMode: "qlik" | "powerbi" | "comparison";
  buildMode: "automatic" | "qlik-equivalent" | "powerbi-optimized" | "desktop-review" | "queries-only";
  tables: PowerBiTable[];
  relationships: PowerBiRelationship[];
  originalQlikAssociations: PowerBiRelationship[];
  layout: Record<string, ModelLayoutPosition>;
  diagnostics: ModelDiagnostic[];
  visualBindings: VisualBinding[];
  readiness: "not-ready" | "ready-with-warnings" | "ready";
  blockingErrorCount: number;
  warningCount: number;
  expressionArtifactIds: string[];
}

export interface PowerBiModelBuildInput {
  expressionArtifacts: ExpressionArtifact[];
}
