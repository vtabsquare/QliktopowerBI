export type DataType =
  | "String"
  | "Integer"
  | "Decimal"
  | "Date"
  | "Boolean"
  | "Unknown";

export type SourcePlatform = 
  | "SQL Server" | "Oracle" | "MySQL" | "PostgreSQL" | "Snowflake" 
  | "Databricks" | "Excel" | "CSV" | "Parquet" | "JSON" | "XML" 
  | "SAP" | "REST API" | "QVD" | "Unknown";

export interface SourceColumn {
  name: string;
  dataType: DataType;
}

export interface SourceTable {
  id: string;
  name: string;
  platform: SourcePlatform;
  database?: string;
  schema?: string;
  connectionName?: string;
  sourceQuery?: string;
  connectionPath: string;
  qvdName?: string;
  filePath?: string;
  columns: SourceColumn[];
}

export interface TableStep {
  kind: "LOAD" | "RESIDENT" | "JOIN" | "KEEP" | "CONCATENATE" | "APPLYMAP" | "DERIVED" | "RENAME_FIELD" | "DROP_FIELD" | "PEEK" | "PREVIOUS" | "AUTONUMBER" | "CROSSTABLE" | "HIERARCHY" | "INTERVALMATCH";
  from?: string;
  withTable?: string;
  mapName?: string;
  sourceField?: string;
  asField?: string;
  expression?: string;
  name?: string;
  where?: string;
  isDistinct?: boolean;
  groupBy?: string[];
  orderBy?: string[];
  withFields?: string[];
  keyFields?: string[];
  platform?: SourcePlatform;
  connectionName?: string;
  sourceQuery?: string;
  resident?: string;
  joinType?: "Left" | "Right" | "Inner" | "Outer";
  fromClause?: string;
  defaultValue?: string; 
  to?: string;            
  field?: string;
  fields?: {
    name: string;
    expression?: string;
  }[];
}

export interface FinalTable {
  id: string;
  name: string;
  type: "Fact" | "Dimension" | "Calendar" | "Bridge" | "Mapping";
  sourceTables: string[];
  isFinal: boolean;
  steps: TableStep[];
  keys: string[];
  lineage: string[];
  columns: {
    name: string;
    dataType: DataType;
    derived: boolean;
    expression?: string;
    nullable?: boolean;
    isKey?: boolean;
  }[];
  sourcePlatform?: SourcePlatform;
  sourceConnection?: string;
}

export interface EtlOperation {
  kind: "LOAD" | "RESIDENT" | "JOIN" | "KEEP" | "CONCATENATE" | "MAPPING" | "DROP" | "RENAME_TABLE" | "RENAME_FIELD" | "STORE" | "APPLYMAP";
  table: string;
  target?: string;
  detail?: string;
  raw: string;
}

export interface Relationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: "1:1" | "1:N" | "N:1" | "N:N";
  isActive?: boolean;
  crossFilterDirection?: "Single" | "Both";
}

export interface Requirement {
  reportName?: string;
  businessObjective?: string;
  businessRequirement?: string;
  sourceTableNames?: string;
  sourceColumnNames?: string;
  expectedOutput?: string;
  sampleData?: string; 
}

export interface BusinessMetadata {
  reportName: string;
  businessObjective: string;
  businessRequirement: string;
  expectedOutput: string;
  businessRules: string[];
  expectedTables?: string[];
  expectedFinalTables?: string[];
  expectedColumns?: string[];
  generatedRuleBook?: string;
  analysisConfidence?: number;
  expectedRelationships?: Relationship[]; 
}

export interface ExecutionNodeMeta {
  sourcePath?: string;
  from?: string;
  platform?: string;
  residentSourceTable?: string;
  joinSource?: string;
  joinTarget?: string;
  joinKeys?: string[];
  joinType?: string;
  columnsAdded?: string[];
  columnsOverwritten?: string[];
  baseTable?: string;
  appendedSource?: string;
  appendedFieldsCount?: number;
  mappingTableName?: string;
  lookupKeyField?: string;
  resultColumn?: string;
  sourceField?: string;
  targetValueField?: string;
  defaultValue?: string;
  fieldName?: string;
  expression?: string;
  field?: string;
  keepSource?: string;
  keysAligned?: string[];
  keepType?: string;
  isDropped?: boolean;
  isMappingTable?: boolean;
  lookupKey?: string;
  outputValue?: string;
  hasWhereClause?: boolean;
  originalField?: string;
  targetField?: string;
  fromTable?: string;
  toTable?: string; // Welcomed to the party! Fixed the qvs-parser.ts build error.
}

export interface ExecutionNode {
  id: string;
  operation: "LOAD" | "RESIDENT" | "JOIN" | "KEEP" | "CONCATENATE" | "APPLYMAP" | "DROP" | "RENAME_TABLE" | "RENAME_FIELD" | "DERIVED" | "DROP_FIELD";
  sequenceOrder: number;
  inputNodes: string[];
  outputTable: string;
  meta: ExecutionNodeMeta;
  rawExpression: string;
}

export interface StatementMetrics {
  totalLoadStatements: number;
  totalJoinStatements: number;
  totalResidentLoads: number;
  totalApplyMapCalls: number;
}

export interface MigrationValidationIssue {
  id: string;
  severity: "error" | "warning";
  area: string;
  message: string;
  detail?: string;
}

export interface MigrationValidationReport {
  checkedAt: string;
  blockingErrors: boolean;
  issues: MigrationValidationIssue[];
}

export interface TechnicalMetadata {
  statementMetrics: StatementMetrics;
  executionOrder: string[];
  lineageGraph: string[];
  droppedTables: string[];
  joins: any[];
  residentLoads: any[];
  applyMaps: any[];
  concatenateOperations: any[];
  renameOperations: any[];
  filters: any[];
  sourceTables: SourceTable[];
  finalTables: FinalTable[];
  allTables: FinalTable[]; 
  relationships: Relationship[];
  variables: Record<string, string>;
  executionGraph: ExecutionNode[];
  etlOperations?: EtlOperation[];
  sourcePlatform?: SourcePlatform;
}

export interface SetAnalysisRow {
  name: string;
  expression: string;
  description?: string;
}

export interface MigrationMetadata {
  requirement?: Requirement;
  ruleBookMd?: string;
  sourceFileName?: string;
  etlFileName?: string;
  setAnalysisFileName?: string;
  variableLogicFileName?: string;
  sourceTables: SourceTable[];
  etlOperations: EtlOperation[];
  allTables?: FinalTable[];
  finalTables: FinalTable[];
  relationships: Relationship[];
  variables: Record<string, string>;
  droppedTables: string[];
  intermediateTables: string[];
  setAnalysisRows: SetAnalysisRow[];
  businessMetadata?: BusinessMetadata;
  technicalMetadata?: TechnicalMetadata;
  validationReport?: MigrationValidationReport;
  stageStatus: Record<number, "pending" | "in-progress" | "complete" | "failed">;
  stageAccuracy: Record<number, number | null>;
}
export interface BulkMeasureResult {
  measureName: string;
  qlikExpression: string;
  variablesUsed: string[];
  generatedDax: string;
  status: "SUCCESS" | "ERROR";
  confidence: number;
}
