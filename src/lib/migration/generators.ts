import type {
  Requirement, BusinessMetadata, TechnicalMetadata, FinalTable, SourceTable,
  Relationship, TableStep, MigrationValidationReport, MigrationValidationIssue, 
  DataType, ExecutionNode
} from "./types";

export interface GenerationResult {
  queries: { table: FinalTable; code: string }[];
  validationReport: MigrationValidationReport;
  generationConfidence: number;
}

const TYPE_MAP: Record<DataType | string, string> = {
  String: "type text", 
  Integer: "type number", 
  Decimal: "type number",
  Date: "type date", 
  Boolean: "type logical",
  Unknown: "type any"
};

const SET_ANALYSIS_AGG_MAP: Record<string, string> = { 
  Sum: "SUM", 
  Count: "COUNT", 
  Avg: "AVERAGE", 
  Min: "MIN", 
  Max: "MAX" 
};

// ============================================================================
// GLOBAL HOISTED UTILITIES SECTION
// ============================================================================

function assembleLetBody(lines: string[]): string {
  const isComment = (l: string) => /^\s*\/\//.test(l);
  let lastStatementIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isComment(lines[i])) {
      lastStatementIdx = i;
    }
  }
  return lines
    .map((line, i) => (isComment(line) || i === lastStatementIdx ? line : `${line},`))
    .join("\n");
}

function splitTopLevel(body: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, inStr: string | null = null, cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"') { inStr = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ✅ Fixed: Fully hoisted to the top to resolve the missing compiler identifier errors
function replaceFunctionCall(str: string, name: string, build: (args: string[]) => string): string {
  const re = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let result = "";
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const start = m.index;
    const parenStart = start + m[0].length - 1;
    let depth = 1, i = parenStart + 1;
    while (i < str.length && depth > 0) {
      if (str[i] === "(") depth++;
      else if (str[i] === ")") depth--;
      i++;
    }
    const inner = str.slice(parenStart + 1, i - 1);
    const args = splitTopLevel(inner).map((a: string) => a.trim());
    result += str.slice(lastIndex, start) + build(args);
    lastIndex = i;
    re.lastIndex = i;
  }
  result += str.slice(lastIndex);
  return result;
}

// ✅ Fixed: Fully hoisted to the top to safely reference expression engine transformations
function convertIfExpr(expr: string): string {
  const match = expr.match(/^\s*if\s*\((.*)\)\s*$/i);
  if (!match) return expr;
  const parts = splitTopLevel(match[1]);
  if (parts.length < 3) return expr;
  return `if ${qlikExprToM(parts[0])} then ${qlikExprToM(parts[1])} else ${qlikExprToM(parts.slice(2).join(","))}`;
}

function inferMType(name: string): string {
  if (!name) return "type text";
  const n = String(name).toLowerCase();
  if (/date|_dt$/.test(n)) return "type date";
  if (/time/.test(n)) return "type time";
  if (/_id$|id$|key$/.test(n)) return "type number";
  if (/qty|quantity|count|amount|price|revenue|cost|total|sum|margin/.test(n)) return "type number";
  return "type text";
}

function escapeM(s: string): string {
  if (s == null) return "";
  return String(s).replace(/"/g, '""');
}

function safeName(s: string): string {
  if (s == null) return "Unnamed";
  const cleaned = String(s).replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `Step_${cleaned}`;
}

function quoteStep(name: string): string {
  return `#"${escapeM(name)}"`;
}

function mField(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `[${name}]` : `[#"${escapeM(name)}"]`;
}

function recordField(record: string, field: string): string {
  return `Record.Field(${record}, "${escapeM(field)}")`;
}

function typedColumnsBlock(columns: FinalTable["columns"]): string {
  return (columns || [])
    .filter((c: { name: string }) => c.name !== "*")
    .map((c: { name: string; dataType: DataType }) => `        {"${escapeM(c.name)}", ${TYPE_MAP[c.dataType] || inferMType(c.name)}}`)
    .join(",\n");
}

function detectPlatform(from: string): string {
  if (!from) return "Unknown";
  if (/\.qvd$/i.test(from)) return "QVD";
  if (/\.xlsx?$/i.test(from)) return "Excel";
  if (/\.csv$/i.test(from)) return "CSV";
  if (/\.tsv$/i.test(from)) return "CSV";
  if (/\.parquet$/i.test(from)) return "Parquet";
  if (/\.json$/i.test(from)) return "JSON";
  if (/\.xml$/i.test(from)) return "XML";
  if (/^SQL:/i.test(from) || /SELECT\s+/i.test(from)) return "SQL";
  if (/odbc|dsn=/i.test(from)) return "ODBC";
  if (/snowflake/i.test(from)) return "Snowflake";
  if (/oracle/i.test(from)) return "Oracle";
  if (/postgres/i.test(from)) return "PostgreSQL";
  if (/mysql/i.test(from)) return "MySQL";
  if (/databricks/i.test(from)) return "Databricks";
  if (/sap/i.test(from)) return "SAP";
  return "Unknown";
}

function sourceConnector(step: {
  kind: string;
  from?: string;
  platform?: string;
  connectionName?: string;
  database?: string;
  sourceQuery?: string;
  fields?: { name: string }[];
  qvd?: string;
  file?: string;
}): string {
  const from = step.from || "";
  const platform = step.platform || detectPlatform(from);
  const sql = ("sourceQuery" in step ? step.sourceQuery : undefined)?.replace(/^SQL\s+/i, "");
  const sqlTable = from.match(/^SQL:\s*([A-Za-z0-9_.[\]"]+)/i)?.[1]?.replace(/[\[\]"]/g, "");
  const sqlParts = sqlTable?.split(".").filter(Boolean) ?? [];
  const database = "database" in step && step.database ? step.database : sqlParts.length >= 3 ? sqlParts[0] : undefined;
  const file = step.file || (!/^SQL:/i.test(from) && !/^[A-Za-z][A-Za-z0-9_]*$/.test(from) ? from : undefined);
  const qvd = step.qvd || (/\.qvd$/i.test(from) ? from : undefined);
  const requireConnection = () => step.connectionName || (sqlParts.length >= 2 ? sqlParts.slice(0, -1).join(".") : from);
  
  switch (platform) {
    case "SQL": return `Sql.Database("${escapeM(requireConnection())}", ${database ? `"${escapeM(database)}"` : "null"}${sql ? `, [Query="${escapeM(sql)}"]` : ""})`;
    case "Oracle": return `Oracle.Database("${escapeM(requireConnection())}"${sql ? `, [Query="${escapeM(sql)}"]` : ""})`;
    case "Snowflake": return `Snowflake.Databases("${escapeM(requireConnection())}", "WAREHOUSE")`;
    case "PostgreSQL": return `PostgreSQL.Database("${escapeM(requireConnection())}", ${database ? `"${escapeM(database)}"` : "null"})`;
    case "MySQL": return `MySQL.Database("${escapeM(requireConnection())}", ${database ? `"${escapeM(database)}"` : "null"})`;
    case "Excel": return `Excel.Workbook(File.Contents("${escapeM(file || from)}"), null, true)`;
    case "CSV": return `Csv.Document(File.Contents("${escapeM(file || from)}"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv])`;
    case "Parquet": return `Parquet.Document(File.Contents("${escapeM(file || from)}"))`;
    case "JSON": return `Json.Document(File.Contents("${escapeM(file || from)}"))`;
    case "XML": return `Xml.Tables(File.Contents("${escapeM(file || from)}"))`;
    case "QVD": return `File.Contents("${escapeM(qvd || file || from)}") /* TODO: Replace with target data source (was QVD) */`;
    case "REST": return `Json.Document(Web.Contents("${escapeM(file || from)}"))`;
    case "Databricks": return `Databricks.Catalogs("${escapeM(requireConnection())}", "/sql/1.0/warehouses")`;
    case "SAP": return `SapBusinessWarehouse.Cubes("${escapeM(requireConnection())}", "00", "800")`;
    case "ODBC":
      if (sql) return `Odbc.Query("dsn=${escapeM(requireConnection())}", "${escapeM(sql)}")`;
      if (file || qvd) return `File.Contents("${escapeM(file || qvd || from)}")`;
      return `Odbc.DataSource("dsn=${escapeM(requireConnection())}")`;
    default:
      if (sql) return `Sql.Database("${escapeM(requireConnection())}", null, [Query="${escapeM(sql)}"])`;
      if (file || qvd) return `File.Contents("${escapeM(file || qvd || from)}")`;
      return quoteStep(from || "UnknownSource");
  }
}

function findMappingTable(name: string, allTables: FinalTable[]): FinalTable | undefined {
  return (allTables || []).find((t: FinalTable) => t.name === name && t.type === "Mapping");
}

function tableSourceExpression(table: FinalTable, sources: SourceTable[]): string {
  const src = (sources || []).find((s: SourceTable) => s.name === table.name);
  if (src) return sourceConnector({ kind: "LOAD", from: src.connectionPath || src.name, platform: src.platform });
  return quoteStep(table.name);
}

function getFullLineageGraphNodes(targetTableName: string, executionGraph: ExecutionNode[]): ExecutionNode[] {
  const collectedNodes = new Map<string, ExecutionNode>();
  
  function traverse(tableName: string) {
    const directNodes = executionGraph.filter((n: ExecutionNode) => n.outputTable === tableName);
    for (const node of directNodes) {
      if (!collectedNodes.has(node.id)) {
        collectedNodes.set(node.id, node);
        
        const dependencies: string[] = [];
        if (node.meta.residentSourceTable) dependencies.push(node.meta.residentSourceTable);
        if (node.meta.joinSource) dependencies.push(node.meta.joinSource);
        if (node.meta.appendedSource) dependencies.push(node.meta.appendedSource);
        if (node.meta.keepSource) dependencies.push(node.meta.keepSource);
        if (node.meta.mappingTableName) dependencies.push(node.meta.mappingTableName);

        for (const upstreamTable of dependencies) {
          traverse(upstreamTable);
        }
      }
    }
  }

  traverse(targetTableName);
  return Array.from(collectedNodes.values()).sort((a: ExecutionNode, b: ExecutionNode) => a.sequenceOrder - b.sequenceOrder);
}

function eqName(a: string, b: string) {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  return a.replace(/[^a-z0-9]/gi, "").toLowerCase() === b.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function findColumnTable(field: string, tables: FinalTable[]): string {
  const owner = (tables || []).find((t: FinalTable) => (t.columns || []).some((c: { name: string }) => eqName(c.name, field)));
  if (owner) return owner.name;
  return (tables || []).find((t: FinalTable) => t.type === "Fact")?.name || "FactTable";
}

function parseSetAnalysisModifiers(modifierStr: string, tables: FinalTable[]): string[] {
  const filters: string[] = [];
  const fieldPattern = /([A-Za-z_][A-Za-z0-9_ ]*?)\s*=\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = fieldPattern.exec(modifierStr))) {
    const field = m[1].trim();
    const valuesRaw = m[2];
    const values = [...valuesRaw.matchAll(/'([^']*)'|"([^"]*)"/g)].map((v) => v[1] ?? v[2]);
    const tableName = findColumnTable(field, tables);
    if (values.length) {
      const valueList = values.map((v: string) => `"${v.replace(/"/g, '""')}"`).join(", ");
      filters.push(`'${tableName}'[${field}] IN {${valueList}}`);
    } else if (valuesRaw.trim()) {
      filters.push(`'${tableName}'[${field}] = ${valuesRaw.trim()}`);
    }
  }
  return filters;
}

function extractBalanced(str: string, openChar: string, closeChar: string, startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === openChar) depth++;
    else if (str[i] === closeChar) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return str.length;
}

function fallbackAggMapping(expr: string): string {
  return expr
    .replace(/\bSum\s*\(/gi, "SUM(")
    .replace(/\bAvg\s*\(/gi, "AVERAGE(")
    .replace(/\bCount\s*\(/gi, "COUNT(")
    .replace(/\bMin\s*\(/gi, "MIN(")
    .replace(/\bMax\s*\(/gi, "MAX(");
}

function convertSetAnalysis(expr: string, tables: FinalTable[]): string {
  if (!expr) return "BLANK()";
  const headMatch = expr.match(/\b(Sum|Count|Avg|Min|Max)\s*\(\s*\{/i);
  if (!headMatch || headMatch.index === undefined) return fallbackAggMapping(expr);

  const aggFnRaw = headMatch[1];
  const parenIdx = expr.indexOf("(", headMatch.index);
  const parenEnd = extractBalanced(expr, "(", ")", parenIdx);
  const callInner = expr.slice(parenIdx + 1, parenEnd - 1);

  const braceStart = callInner.indexOf("{");
  if (braceStart === -1) return fallbackAggMapping(expr);
  const braceEnd = extractBalanced(callInner, "{", "}", braceStart);
  const modifiers = callInner.slice(braceStart + 1, braceEnd - 1).replace(/^</, "").replace(/>$/, "");
  const fieldExprRaw = callInner.slice(braceEnd).trim();

  const aggFn = SET_ANALYSIS_AGG_MAP[aggFnRaw] || aggFnRaw.toUpperCase();
  const field = fieldExprRaw.replace(/^\[|\]$/g, "");
  const tableName = findColumnTable(field, tables);
  const filters = parseSetAnalysisModifiers(modifiers, tables);
  const measureExpr = `${aggFn}('${tableName}'[${field}])`;
  if (!filters.length) {
    return `CALCULATE(${measureExpr})  // Original expression trace logic: ${expr.slice(0, 120)}`;
  }
  return `CALCULATE(${measureExpr}, ${filters.join(", ")})`;
}

// ============================================================================
// CORE EXPORTED COMPILER OPERATIONS
// ============================================================================

export function generatePowerQuery(
  table: FinalTable, 
  sources: SourceTable[], 
  allTables: FinalTable[] = [], 
  executionGraph: ExecutionNode[] = []
): string {
  const lineageChainNodes = getFullLineageGraphNodes(table.name, executionGraph);

  if (!lineageChainNodes.length) {
    return `// Power Query M — ${table.name} (${table.type})\n// WARNING: No execution nodes discovered along this branch lineage vector.\nlet\n    Source = #table({}, {})\nin\n    Source`;
  }

  const stepLines: string[] = [];
  let lastStep = "Source";
  let stepIdx = 0;
  const nextName = (base: string) => `${safeName(base)}_${++stepIdx}`;
  
  let knownColumns: string[] = [];

  for (const node of lineageChainNodes) {
    stepLines.push(`    // Trace Step [${node.sequenceOrder}]: Target -> ${node.outputTable} | Operation -> ${node.operation}`);
    
    switch (node.operation) {
      case "LOAD": {
        const fromPath = node.meta.sourcePath || node.meta.from || node.outputTable;
        stepLines.push(`    Source = ${sourceConnector({ kind: "LOAD", from: fromPath, platform: node.meta.platform })}`);
        knownColumns = (table.columns || []).map((c: { name: string }) => c.name);
        break;
      }
      case "RESIDENT": {
        const resSource = node.meta.residentSourceTable || "SourceOriginTable";
        stepLines.push(`    Source = Table.Buffer(${quoteStep(resSource)})`);
        knownColumns = (table.columns || []).map((c: { name: string }) => c.name);
        break;
      }
      case "JOIN": {
        const joinSrc = node.meta.joinSource || "JoinedTableReference";
        const isResidentJoin = (allTables || []).some((t: FinalTable) => t.name === joinSrc);
        const rightSideSelector = isResidentJoin ? quoteStep(joinSrc) : sourceConnector({ kind: "LOAD", from: joinSrc, platform: detectPlatform(joinSrc) });
        
        const joinKeys = Array.isArray(node.meta.joinKeys) ? node.meta.joinKeys : [];
        const keysBlock = `{${joinKeys.map((k: string) => `"${escapeM(k)}"`).join(", ")}}`;
        const joinKind = node.meta.joinType === "Inner" ? "JoinKind.Inner" : `JoinKind.${node.meta.joinType || "Left"}Outer`;
        
        const mergedLabel = nextName("MergedJoinNode");
        stepLines.push(`    ${mergedLabel} = Table.NestedJoin(${lastStep}, ${keysBlock}, ${rightSideSelector}, ${keysBlock}, "_joinScope", ${joinKind})`);
        
        const colsAdded = Array.isArray(node.meta.columnsAdded) ? node.meta.columnsAdded : [];
        if (colsAdded.length) {
          const expandedLabel = nextName("ExpandedJoinNode");
          stepLines.push(`    ${expandedLabel} = Table.ExpandTableColumn(${mergedLabel}, "_joinScope", {${colsAdded.map((f: string) => `"${escapeM(f)}"`).join(", ")}}, {${colsAdded.map((f: string) => `"${escapeM(f)}"`).join(", ")}})`);
          lastStep = expandedLabel;
          knownColumns.push(...colsAdded);
        } else {
          lastStep = mergedLabel;
        }
        break;
      }
      case "KEEP": {
        const keepSrc = node.meta.keepSource || "KeepTableReference";
        const isResidentKeep = (allTables || []).some((t: FinalTable) => t.name === keepSrc);
        const rightSide = isResidentKeep ? quoteStep(keepSrc) : sourceConnector({ kind: "LOAD", from: keepSrc, platform: detectPlatform(keepSrc) });
        
        const keepKeys = Array.isArray(node.meta.keysAligned) ? node.meta.keysAligned : [];
        const keysBlock = `{${keepKeys.map((k: string) => `"${escapeM(k)}"`).join(", ")}}`;
        const keepKind = node.meta.keepType === "Inner" ? "JoinKind.Inner" : "JoinKind.LeftOuter";
        
        const nestedLabel = nextName("KeepNestedJoin");
        stepLines.push(`    ${nestedLabel} = Table.NestedJoin(${lastStep}, ${keysBlock}, ${rightSide}, ${keysBlock}, "_keepScope", ${keepKind})`);
        const filteredLabel = nextName("KeepFilteredRows");
        stepLines.push(`    ${filteredLabel} = Table.SelectRows(${nestedLabel}, each Table.RowCount([_keepScope]) > 0)`);
        const cleanedLabel = nextName("KeepRemovedScope");
        stepLines.push(`    ${cleanedLabel} = Table.RemoveColumns(${filteredLabel}, {"_keepScope"})`);
        lastStep = cleanedLabel;
        break;
      }
      case "CONCATENATE": {
        const appendSrc = node.meta.appendedSource || "AppendedTableReference";
        const isResidentAppend = (allTables || []).some((t: FinalTable) => t.name === appendSrc);
        const rightSide = isResidentAppend ? quoteStep(appendSrc) : sourceConnector({ kind: "LOAD", from: appendSrc, platform: detectPlatform(appendSrc) });
        
        const combinedLabel = nextName("CombinedUnionNode");
        stepLines.push(`    ${combinedLabel} = Table.Combine({${lastStep}, ${rightSide}})`);
        lastStep = combinedLabel;
        break;
      }
      case "APPLYMAP": {
        const mapName = node.meta.mappingTableName || "";
        const mapTbl = mapName ? findMappingTable(mapName, allTables) : undefined;
        const keyField = mapTbl?.columns?.[0]?.name || node.meta.sourceField || "KeyField";
        const valField = mapTbl?.columns?.[1]?.name || node.meta.targetValueField || "ValueField";
        
        const lookupField = node.meta.lookupKeyField || "LookupKey";
        const resCol = node.meta.resultColumn || "MappedOutputColumn";
        const mapOutputLabel = nextName(`ValueMapped_${resCol}`);
        
        const mapSourceExpr = mapTbl ? tableSourceExpression(mapTbl, sources) : quoteStep(mapName);
        const fallbackValue = node.meta.defaultValue ? qlikExprToM(node.meta.defaultValue) : `_[${lookupField}]`;
        
        stepLines.push(`    ${mapOutputLabel} = Table.AddColumn(${lastStep}, "${escapeM(resCol)}", each let cache = Table.SelectRows(Table.Buffer(${mapSourceExpr}), (r) => ${recordField("r", keyField)} = ${recordField("_", lookupField)}) in if Table.RowCount(cache) > 0 then ${recordField("cache{0}", valField)} else ${fallbackValue})`);
        lastStep = mapOutputLabel;
        if (!knownColumns.includes(resCol)) knownColumns.push(resCol);
        break;
      }
      case "DERIVED": {
        const derivedFieldName = node.meta.fieldName || "CalculatedColumn";
        const formulaExpression = node.meta.expression || "null";
        const derivedLabel = nextName(`Added_${derivedFieldName}`);
        
        stepLines.push(`    ${derivedLabel} = Table.AddColumn(${lastStep}, "${escapeM(derivedFieldName)}", each ${qlikExprToM(formulaExpression)}, type any)`);
        lastStep = derivedLabel;
        if (!knownColumns.includes(derivedFieldName)) knownColumns.push(derivedFieldName);
        break;
      }
      case "DROP_FIELD": {
        const fieldToDrop = node.meta.field || "DiscardedColumn";
        const dropFieldLabel = nextName("RemovedColumnNode");
        stepLines.push(`    ${dropFieldLabel} = Table.RemoveColumns(${lastStep}, {"${escapeM(fieldToDrop)}"}, MissingField.Ignore)`);
        lastStep = dropFieldLabel;
        knownColumns = knownColumns.filter((c: string) => c !== fieldToDrop);
        break;
      }
      case "RENAME_FIELD": {
        const orig = node.meta.originalField || "OldColumn";
        const targetField = node.meta.targetField || "NewColumn";
        const renameLabel = nextName("RenamedFieldNode");
        stepLines.push(`    ${renameLabel} = Table.RenameColumns(${lastStep}, {{"${escapeM(orig)}", "${escapeM(targetField)}"\n}}, MissingField.Ignore)`);
        lastStep = renameLabel;
        knownColumns = knownColumns.map((c: string) => c === orig ? targetField : c);
        break;
      }
      default:
        break;
    }
  }

  const targetColumnsToType = (table.columns || []).filter((c: { name: string }) => c.name !== "*");
  if (targetColumnsToType.length) {
    const finalTypedNodeLabel = nextName("FinalModelSchemaTyped");
    stepLines.push(`    ${finalTypedNodeLabel} = Table.TransformColumnTypes(${lastStep}, {\n${typedColumnsBlock(targetColumnsToType)}\n    }, "en-US")`);
    lastStep = finalTypedNodeLabel;
  }

  const header = `// Power Query M — ${table.name} (${table.type})\n// Compiled via structural Graph Sequencer from Lineage Ancestry\n// Path roots: ${(table.lineage || table.sourceTables || []).join(" -> ") || table.name}`;
  return `${header}\nlet\n${assembleLetBody(stepLines)}\nin\n    ${lastStep}`;
}

export function generatePowerQueriesFromMigrationMetadata(
  business: BusinessMetadata,
  technical: TechnicalMetadata,
): GenerationResult {
  const report = validateMigrationMetadata(business, technical);
  
  let generationConfidence = 1.0;
  if (report.issues.length > 0) {
    const errorsCount = report.issues.filter((i: MigrationValidationIssue) => i.severity === "error").length;
    const warningsCount = report.issues.filter((i: MigrationValidationIssue) => i.severity === "warning").length;
    generationConfidence = Math.max(0.1, 1.0 - (errorsCount * 0.25) - (warningsCount * 0.05));
  }

  const graphModelContext = technical.executionGraph || [];

  const generatedPayloads = (technical.finalTables || [])
    .filter((t: FinalTable) => t.isFinal && t.type !== "Mapping")
    .map((table: FinalTable) => ({
      table,
      code: generatePowerQuery(table, technical.sourceTables || [], technical.allTables || [], graphModelContext)
    }));

  return {
    queries: generatedPayloads,
    validationReport: report,
    generationConfidence
  };
}

export function buildBusinessMetadata(requirement: Requirement, ruleBookMd: string, expectedRelationships: Relationship[] = []): BusinessMetadata {
  const split = (s: string) => (s || "").split(/[\n,;]+/).map((x: string) => x.trim()).filter(Boolean);
  const rules = [...ruleBookMd.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
  const expectedFinalTables = split(requirement.expectedOutput || "").flatMap((x: string) => {
    const explicit = [...x.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((m) => m[1]);
    const labelled = x.match(/(?:final\s+table|output\s+table|dataset|model)\s*[:=-]\s*([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    const singleModelName = /^(Fact|Dim|Bridge|Calendar)[A-Za-z0-9_]*$/i.test(x) ? x : undefined;
    return [...explicit, labelled, singleModelName].filter(Boolean) as string[];
  });
  return {
    reportName: requirement.reportName || "Unnamed Report",
    businessObjective: requirement.businessObjective || "",
    businessRequirement: requirement.businessRequirement || "",
    expectedOutput: requirement.expectedOutput || "",
    businessRules: rules,
    expectedTables: split(requirement.sourceTableNames || ""),
    expectedFinalTables,
    expectedColumns: split(requirement.sourceColumnNames || "").map((c: string) => c.replace(/^[A-Za-z0-9_]+\./, "")),
    expectedRelationships,
  };
}

export function validateMigrationMetadata(business: BusinessMetadata, technical: TechnicalMetadata): MigrationValidationReport {
  const issues: MigrationValidationIssue[] = [];
  const add = (severity: MigrationValidationIssue["severity"], area: MigrationValidationIssue["area"], message: string, detail?: string) => {
    issues.push({ id: `val_${issues.length + 1}`, severity, area, message, detail });
  };

  if (!business.reportName || !business.businessRequirement || !business.expectedOutput) {
    add("warning", "Business Metadata", "Requirement Input is incomplete.", "Report name, business requirement, and expected output are recommended before Power Query generation, but analysis can proceed without them.");
  }
  if (!(technical.sourceTables || []).length) add("error", "Technical Metadata", "No source tables were parsed from the Source QVS.");
  if (!(technical.finalTables || []).length) add("error", "Technical Metadata", "No final surviving tables were identified from the ETL dependency graph.");

  // Run Lane 1: Expected Source Staging Verification Check
  for (const expected of (business.expectedTables || [])) {
    const exists = (technical.sourceTables || []).some((t: SourceTable) => eqName(t.name, expected));
    if (!exists) {
      add("warning", "Business Metadata", "Expected source table not found in parsed technical source metadata: " + expected);
    }
  }

  // Run Lane 2: Expected Compiled Target Architecture Verification Check
  for (const expected of (business.expectedFinalTables || [])) {
    const exists = (technical.finalTables || []).some((t: FinalTable) => eqName(t.name, expected));
    if (!exists) {
      add("warning", "Business Metadata", "Expected final table not found in compiled model final metadata: " + expected);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    blockingErrors: issues.some((i: MigrationValidationIssue) => i.severity === "error"),
    issues,
  };
}

export function generateDaxMeasures(tables: FinalTable[], variables: Record<string, string>): string {
  const facts = (tables || []).filter((t: FinalTable) => t.type === "Fact");
  const lines: string[] = ["// Auto-generated DAX measures from analyzed Qlik metadata", ""];

  for (const fact of facts) {
    const numericCols = (fact.columns || []).filter((c: any) => /Decimal|Integer|Number/.test(c.dataType));
    for (const col of numericCols) {
      const measureName = `Total ${col.name}`;
      lines.push(`${measureName} = SUM('${fact.name}'[${col.name}])`, "");
    }
    if (numericCols.length) {
      lines.push(`${fact.name} Row Count = COUNTROWS('${fact.name}')`, "");
    }
  }

  for (const [varName, expr] of Object.entries(variables || {})) {
    const dax = convertSetAnalysis(expr, tables);
    lines.push(`${varName} = ${dax}`, "");
  }
  return lines.join("\n");
}

export function buildTableDependencyOrder(tables: FinalTable[]): FinalTable[] {
  const visited = new Set<string>();
  const order: FinalTable[] = [];
  function visit(t: FinalTable) {
    if (visited.has(t.name)) return;
    visited.add(t.name);
    for (const s of (t.steps || [])) {
      if (s.kind === "JOIN" || s.kind === "CONCATENATE") {
        const dep = (tables || []).find((x: FinalTable) => x.name === s.withTable);
        if (dep) visit(dep);
      }
      if (s.kind === "RESIDENT") {
        const dep = (tables || []).find((x: FinalTable) => x.name === s.from);
        if (dep) visit(dep);
      }
    }
    order.push(t);
  }
  for (const t of (tables || [])) visit(t);
  return order;
}

export function generateSemanticModel(tables: FinalTable[], rels: Relationship[]) {
  return {
    name: "MigratedSemanticModel",
    tables: (tables || []).map((t: FinalTable) => ({
      name: t.name,
      columns: (t.columns || []).map((c: any) => ({ name: c.name, dataType: c.dataType })),
      keys: (t.keys || (t.columns || []).filter((c: any) => /(_id|Id|Key|_KEY)$/.test(c.name) || /^id$/i.test(c.name)).map((c: any) => c.name)),
    })),
    relationships: (rels || []).map((r: Relationship) => ({
      fromTable: r.fromTable, fromColumn: r.fromColumn,
      toTable: r.toTable, toColumn: r.toColumn,
      cardinality: r.cardinality,
    })),
  };
}

export function buildGenerationArgs(args: {
  businessMetadata: BusinessMetadata;
  technicalMetadata: TechnicalMetadata;
  finalTables: FinalTable[];
  relationships: Relationship[];
  variables: Record<string, string>;
}) {
  return {
    tables: args.finalTables || [],
    relationships: args.relationships || [],
    variables: args.variables || {},
    keys: (args.finalTables || []).map((t: FinalTable) => ({ table: t.name, columns: (t.keys || (t.columns || []).filter((c: any) => /(_id|Id|Key|_KEY)$/.test(c.name) || /^id$/i.test(c.name)).map((c: any) => c.name)) })),
  };
}

export function qlikExprToM(expr: string): string {
  if (expr == null) return "null";
  let e = String(expr).trim();
  if (!e || e === "*") return "true";
  e = e.replace(/\$\(([A-Za-z0-9_]+)\)/g, "$1");
  e = convertIfExpr(e);
  e = e.replace(/\bdate#?\s*\(([^,)]+)(?:,\s*'([^']+)')?\)/gi, (_m, v) => `Date.From(${qlikExprToM(v.trim())})`);
  e = e.replace(/\bnum#?\s*\(([^,)]+)(?:,\s*'[^']*')?\)/gi, (_m, v) => `Number.From(${qlikExprToM(v.trim())})`);
  
  e = replaceFunctionCall(e, "RangeSum", (args: string[]) => `List.Sum(List.RemoveNulls({${args.map((a: string) => qlikExprToM(a)).join(", ")}}))`);
  e = replaceFunctionCall(e, "RangeMax", (args: string[]) => `List.Max(List.RemoveNulls({${args.map((a: string) => qlikExprToM(a)).join(", ")}}))`);
  e = replaceFunctionCall(e, "RangeMin", (args: string[]) => `List.Min(List.RemoveNulls({${args.map((a: string) => qlikExprToM(a)).join(", ")}}))`);
  e = replaceFunctionCall(e, "RangeAvg", (args: string[]) => `List.Average(List.RemoveNulls({${args.map((a: string) => qlikExprToM(a)).join(", ")}}))`);
  e = replaceFunctionCall(e, "RangeCount", (args: string[]) => `List.Count(List.RemoveNulls({${args.map((a: string) => qlikExprToM(a)).join(", ")}}))`);
  e = replaceFunctionCall(e, "Alt", (args: string[]) => {
    if (args.length < 2) return args.length ? qlikExprToM(args[0]) : "null";
    const candidates = args.slice(0, -1).map((a: string) => qlikExprToM(a));
    const dflt = qlikExprToM(args[args.length - 1]);
    return `List.First(List.RemoveNulls({${candidates.join(", ")}}), ${dflt})`;
  });
  e = replaceFunctionCall(e, "IsNull", (args: string[]) => `(${qlikExprToM(args[0] ?? "null")} = null)`);
  e = replaceFunctionCall(e, "IsNum", (args: string[]) => `((try Number.From(${qlikExprToM(args[0] ?? "null")}) otherwise null) <> null)`);
  e = replaceFunctionCall(e, "Round", (args: string[]) => {
    const v = qlikExprToM(args[0] ?? "0");
    if (args.length < 2) return `Number.Round(${v})`;
    const step = qlikExprToM(args[1]);
    return `Number.Round(${v} / (${step}), 0) * (${step})`;
  });
  e = replaceFunctionCall(e, "Div", (args: string[]) => `Number.IntegerDivide(${qlikExprToM(args[0] ?? "0")}, ${qlikExprToM(args[1] ?? "1")})`);
  e = replaceFunctionCall(e, "Mod", (args: string[]) => `Number.Mod(${qlikExprToM(args[0] ?? "0")}, ${qlikExprToM(args[1] ?? "1")})`);
  e = replaceFunctionCall(e, "Fabs", (args: string[]) => `Number.Abs(${qlikExprToM(args[0] ?? "0")})`);
  e = replaceFunctionCall(e, "Sign", (args: string[]) => `Number.Sign(${qlikExprToM(args[0] ?? "0")})`);
  e = replaceFunctionCall(e, "Ceil", (args: string[]) => `Number.RoundUp(${qlikExprToM(args[0] ?? "0")})`);
  e = replaceFunctionCall(e, "Floor", (args: string[]) => `Number.RoundDown(${qlikExprToM(args[0] ?? "0")})`);
  e = replaceFunctionCall(e, "Weekday", (args: string[]) => `Date.DayOfWeek(${qlikExprToM(args[0] ?? "null")})`);
  e = replaceFunctionCall(e, "Capitalize", (args: string[]) => `Text.Proper(${qlikExprToM(args[0] ?? '""')})`);
  e = replaceFunctionCall(e, "Replace", (args: string[]) => `Text.Replace(${qlikExprToM(args[0] ?? '""')}, ${qlikExprToM(args[1] ?? '""')}, ${qlikExprToM(args[2] ?? '""')})`);
  e = replaceFunctionCall(e, "SubField", (args: string[]) => {
    const v = qlikExprToM(args[0] ?? '""');
    const delim = qlikExprToM(args[1] ?? '","');
    if (args.length < 3) return `Text.Split(${v}, ${delim})`;
    const idx = qlikExprToM(args[2]);
    return `Text.Split(${v}, ${delim}){(${idx}) - 1}`;
  });
  e = replaceFunctionCall(e, "Match", (args: string[]) => {
    if (args.length < 2) return "0";
    const target = qlikExprToM(args[0]);
    const candidates = args.slice(1).map((a: string) => qlikExprToM(a)).join(", ");
    return `(if List.PositionOf({${candidates}}, ${target}) = -1 then 0 else List.PositionOf({${candidates}}, ${target}) + 1)`;
  });
  e = e.replace(/\btext\s*\(([^)]+)\)/gi, (_m, v) => `Text.From(${qlikExprToM(v.trim())})`);
  e = e.replace(/\bupper\s*\(([^)]+)\)/gi, (_m, v) => `Text.Upper(${qlikExprToM(v.trim())})`);
  e = e.replace(/\blower\s*\(([^)]+)\)/gi, (_m, v) => `Text.Lower(${qlikExprToM(v.trim())})`);
  e = e.replace(/\btrim\s*\(([^)]+)\)/gi, (_m, v) => `Text.Trim(${qlikExprToM(v.trim())})`);
  e = e.replace(/\bleft\s*\(([^,]+),\s*([^)]+)\)/gi, (_m, v, n) => `Text.Start(${qlikExprToM(v.trim())}, ${n.trim()})`);
  e = e.replace(/\bright\s*\(([^,]+),\s*([^)]+)\)/gi, (_m, v, n) => `Text.End(${qlikExprToM(v.trim())}, ${n.trim()})`);
  e = e.replace(/\bmid\s*\(([^,]+),\s*([^,]+),\s*([^)]+)\)/gi, (_m, v, start, len) => `Text.Middle(${qlikExprToM(v.trim())}, ${start.trim()} - 1, ${len.trim()})`);
  e = e.replace(/\blen\s*\(([^)]+)\)/gi, (_m, v) => `Text.Length(${qlikExprToM(v.trim())})`);
  e = e.replace(/\byear\s*\(([^)]+)\)/gi, (_m, v) => `Date.Year(${qlikExprToM(v.trim())})`);
  e = e.replace(/\bmonth\s*\(([^)]+)\)/gi, (_m, v) => `Date.Month(${qlikExprToM(v.trim())})`);
  e = e.replace(/\bday\s*\(([^)]+)\)/gi, (_m, v) => `Date.Day(${qlikExprToM(v.trim())})`);
  e = e.replace(/\btoday\s*\(\s*\)/gi, "Date.From(DateTime.LocalNow())");
  e = e.replace(/'([^']*)'/g, '"$1"');
  
  const strings: string[] = [];
  const bracketRefs: string[] = [];
  e = e.replace(/"[^"]*"/g, (m: string) => {
    strings.push(m);
    return `\u0015${strings.length - 1}\u0015`;
  });
  e = e.replace(/\[[^\]]+\]/g, (m: string) => {
    bracketRefs.push(mField(m.slice(1, -1)));
    return `\u000f${bracketRefs.length - 1}\u000f`;
  });
  e = e.replace(/\bAND\b/gi, "and").replace(/\bOR\b/gi, "or").replace(/\bNOT\b/gi, "not");
  e = e.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (match: string, _ident: string, offset: number, full: string) => {
    const prev = full[offset - 1];
    const next = full[offset + match.length];
    if (prev === '"' || next === '"') return match;
    if (/^(and|or|not|if|then|else|true|false|null|each|let|in|is|as|meta|error|try|otherwise|section|shared)$/i.test(match)) return match;
    if (next === "(" || next === ".") return match;
    return mField(match);
  });
  e = e.replace(/\u000f(\d+)\u000f/g, (_m: string, i: string) => bracketRefs[Number(i)] || "");
  e = e.replace(/\u0015(\d+)\u0015/g, (_m: string, i: string) => strings[Number(i)] || '""');
  return e;
}