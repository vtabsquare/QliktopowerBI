export type TomDataType = "string" | "int64" | "double" | "decimal" | "dateTime" | "boolean";
export type TomSummarizeBy = "none" | "sum" | "count" | "min" | "max" | "average" | "distinctCount";

export interface TomAnnotation {
  name: string;
  value: string;
}

interface TomColumnBase {
  id: string;
  name: string;
  dataType: TomDataType;
  isHidden?: boolean;
  isKey?: boolean;
  summarizeBy?: TomSummarizeBy;
  formatString?: string;
  dataCategory?: string;
  sortByColumn?: string;
  description?: string;
  lineageTag?: string;
  annotations?: TomAnnotation[];
}

export interface TomDataColumn extends TomColumnBase {
  kind: "data";
  sourceColumn: string;
}

export interface TomCalculatedColumn extends TomColumnBase {
  kind: "calculated";
  expression: string;
}

export type TomColumn = TomDataColumn | TomCalculatedColumn;

export interface TomMeasure {
  id: string;
  name: string;
  expression: string;
  formatString?: string;
  displayFolder?: string;
  description?: string;
  isHidden?: boolean;
  lineageTag?: string;
  annotations?: TomAnnotation[];
}

export interface TomHierarchyLevel {
  name: string;
  column: string;
  ordinal: number;
  lineageTag?: string;
}

export interface TomHierarchy {
  id: string;
  name: string;
  levels: TomHierarchyLevel[];
  description?: string;
  lineageTag?: string;
}

export interface TomPartition {
  id: string;
  name: string;
  mode: "import" | "directQuery" | "dual";
  sourceType: "m" | "calculated";
  expression: string;
  description?: string;
  annotations?: TomAnnotation[];
}

export interface TomTable {
  id: string;
  name: string;
  description?: string;
  isHidden?: boolean;
  lineageTag?: string;
  columns: TomColumn[];
  measures: TomMeasure[];
  hierarchies: TomHierarchy[];
  partitions: TomPartition[];
  annotations?: TomAnnotation[];
}

export interface TomRelationship {
  id: string;
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromCardinality: "one" | "many";
  toCardinality: "one" | "many";
  crossFilteringBehavior: "oneDirection" | "bothDirections";
  isActive: boolean;
  annotations?: TomAnnotation[];
}

export interface TomNamedExpression {
  id: string;
  name: string;
  expression: string;
  kind: "m";
  description?: string;
  annotations?: TomAnnotation[];
}

export interface TomDatabaseSpec {
  id: string;
  name: string;
  compatibilityLevel: number;
  model: {
    id: string;
    name: string;
    culture: string;
    sourceQueryCulture: string;
    defaultPowerBIDataSourceVersion: "powerBI_V3";
    tables: TomTable[];
    relationships: TomRelationship[];
    expressions: TomNamedExpression[];
    annotations: TomAnnotation[];
  };
}

export type TmdlDiagnosticSeverity = "information" | "warning" | "error" | "blocking-error";

export interface TmdlDiagnostic {
  code: string;
  severity: TmdlDiagnosticSeverity;
  objectPath: string;
  message: string;
  recommendation: string;
}

export interface TmdlFolderResult {
  engine: "typescript-tmdl" | "microsoft-tom";
  files: Record<string, string>;
  diagnostics: TmdlDiagnostic[];
  modelSpec: TomDatabaseSpec;
}
