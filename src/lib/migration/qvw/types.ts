export type QvwMigrationStatus =
  "auto-convertible" | "review-required" | "manual-redesign" | "unsupported" | "missing-dependency";

export interface QvwDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  file?: string;
  objectId?: string;
  recommendation?: string;
}

export interface QvwPackageRequirement {
  id: string;
  label: string;
  category: "mandatory" | "recommended" | "optional";
  present: boolean;
  matchedFiles: string[];
  reason: string;
}

export interface QvwPackageIntake {
  mode: "qvw-with-prj" | "prj-only" | "qvw-only" | "script-only" | "unknown";
  completenessScore: number;
  readyForVisualizationAnalysis: boolean;
  readyForFullMigration: boolean;
  requirements: QvwPackageRequirement[];
  missingMandatory: string[];
  qvwFiles: string[];
  projectFiles: string[];
}

export interface QvwDocumentMetadata {
  fileName?: string;
  title?: string;
  documentId?: string;
  author?: string;
  description?: string;
  qlikVersion?: string;
  createdAt?: string;
  modifiedAt?: string;
  lastReloadAt?: string;
  reloadMode?: string;
  sectionAccessDetected: boolean;
  alternateStates: string[];
  customProperties: Record<string, string>;
}

export interface QvwLayout {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  minimized?: boolean;
  hidden?: boolean;
}

export interface QvwExpression {
  id: string;
  objectId?: string;
  sheetId?: string;
  label?: string;
  role:
    "measure" | "dimension" | "sort" | "color" | "visibility" | "calculation-condition" | "other";
  expression: string;
  variables: string[];
  fields: string[];
  functions: string[];
  setAnalysisDetected: boolean;
  aggrDetected: boolean;
  proposedDax?: string;
  migrationStatus: QvwMigrationStatus;
  notes: string[];
}

export interface QvwAction {
  id: string;
  objectId?: string;
  sheetId?: string;
  trigger?: string;
  type: string;
  target?: string;
  value?: string;
  order: number;
  raw: Record<string, string>;
  powerBiMapping: string;
  migrationStatus: QvwMigrationStatus;
}

export interface QvwTrigger {
  id: string;
  scope: "document" | "sheet" | "object" | "field" | "variable" | "unknown";
  event: string;
  ownerId?: string;
  actionIds: string[];
  raw: Record<string, string>;
  migrationStatus: QvwMigrationStatus;
}

export interface QvwVariable {
  name: string;
  definition?: string;
  evaluatedValue?: string;
  isCalculated: boolean;
  references: string[];
  usedByObjects: string[];
  usedByActions: string[];
  proposedPowerBiType:
    "measure" | "what-if-parameter" | "disconnected-table" | "field-parameter" | "manual";
  migrationStatus: QvwMigrationStatus;
}

export interface QvwBookmarkSelection {
  field: string;
  values: string[];
  state?: string;
}

export interface QvwBookmark {
  id: string;
  name: string;
  description?: string;
  kind: "document" | "user" | "server" | "unknown";
  selections: QvwBookmarkSelection[];
  variableState: Record<string, string>;
  hidden: boolean;
  migrationStatus: QvwMigrationStatus;
  notes: string[];
}

export interface QvwMacro {
  name: string;
  language: "VBScript" | "JScript" | "Unknown";
  body: string;
  calledBy: string[];
  operations: string[];
  riskLevel: "low" | "medium" | "high";
  powerBiReplacement: string[];
  migrationStatus: QvwMigrationStatus;
}

export interface QvwVisualizationObject {
  id: string;
  file: string;
  sheetId?: string;
  type: string;
  title?: string;
  subtitle?: string;
  layout: QvwLayout;
  dimensions: QvwExpression[];
  measures: QvwExpression[];
  conditionalExpressions: QvwExpression[];
  actions: QvwAction[];
  alternateState?: string;
  calculationCondition?: string;
  visibilityCondition?: string;
  numberFormats: string[];
  sortDefinitions: string[];
  extensionName?: string;
  powerBiVisual: string;
  migrationStatus: QvwMigrationStatus;
  warnings: string[];
  rawProperties: Record<string, string>;
}

export interface QvwSheet {
  id: string;
  name: string;
  file?: string;
  order: number;
  description?: string;
  alternateState?: string;
  visibilityCondition?: string;
  objectIds: string[];
  triggers: QvwTrigger[];
  layout: QvwLayout;
}

export interface QvwExtension {
  objectId: string;
  extensionName: string;
  file: string;
  migrationStatus: QvwMigrationStatus;
  notes: string[];
}

export interface QvwAnalysis {
  generatedAt: string;
  intake: QvwPackageIntake;
  document: QvwDocumentMetadata;
  sheets: QvwSheet[];
  objects: QvwVisualizationObject[];
  expressions: QvwExpression[];
  variables: QvwVariable[];
  bookmarks: QvwBookmark[];
  actions: QvwAction[];
  triggers: QvwTrigger[];
  macros: QvwMacro[];
  extensions: QvwExtension[];
  loadScript?: string;
  sourceFiles: string[];
  diagnostics: QvwDiagnostic[];
  metrics: {
    sheetCount: number;
    objectCount: number;
    expressionCount: number;
    variableCount: number;
    bookmarkCount: number;
    actionCount: number;
    triggerCount: number;
    macroCount: number;
    extensionCount: number;
  };
}
