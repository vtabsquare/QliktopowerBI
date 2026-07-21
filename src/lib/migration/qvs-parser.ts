import type {
  DataType, SourcePlatform, SourceTable, SourceColumn, EtlOperation,
  FinalTable, Relationship, TableStep, ExecutionNode
} from "./types";
import { splitQlikScriptStatements } from "./qlik-script-normalizer";

let _id = 0;
const uid = (p: string) => `${p}_${++_id}_${Date.now().toString(36)}`;

const PLATFORM_HINTS: { match: RegExp; platform: SourcePlatform }[] = [
  { match: /sqlserver|mssql|sql_server|Provider=SQLOLEDB|Driver=\{SQL Server/i, platform: "SQL Server" },
  { match: /oracle|oci|tns/i, platform: "Oracle" },
  { match: /mysql/i, platform: "MySQL" },
  { match: /postgres|postgresql/i, platform: "PostgreSQL" },
  { match: /snowflake/i, platform: "Snowflake" },
  { match: /databricks/i, platform: "Databricks" },
  { match: /\.xlsx?|excel|ooxml|biff/i, platform: "Excel" },
  { match: /\.csv|txt.*delimiter|\.tsv/i, platform: "CSV" },
  { match: /\.parquet/i, platform: "Parquet" },
  { match: /\.json/i, platform: "JSON" },
  { match: /\.xml/i, platform: "XML" },
  { match: /sap|abap|bw|hana/i, platform: "SAP" },
  { match: /rest|http[s]?:\/\/|api\./i, platform: "REST API" },
  { match: /\.qvd/i, platform: "QVD" },
];

function detectPlatform(text: string): SourcePlatform {
  for (const h of PLATFORM_HINTS) if (h.match.test(text)) return h.platform;
  if (/^SQL:/i.test(text)) return "SQL Server";
  if (/\bSQL\s+SELECT\b/i.test(text)) return "SQL Server";
  return "Unknown";
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*REM\s.*$/gim, "");
}

interface FieldExpr { name: string; expr?: string; alias?: boolean; }

interface ParsedLoadBody {
  fields: FieldExpr[];
  from?: string;
  resident?: string;
  where?: string;
  sourceQuery?: string;
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

function parseFieldExpr(raw: string): FieldExpr | null {
  let s = raw.trim().replace(/;$/, "");
  if (!s) return null;
  if (/^(LOAD|SQL|RESIDENT|FROM|WHERE|GROUP|ORDER|MAPPING)\b/i.test(s)) return null;
  if (s === "*") return { name: "*" };
  const asMatch = s.match(/^([\s\S]+?)\s+AS\s+\[?([A-Za-z0-9_ #]+?)\]?\s*$/i);
  if (asMatch) {
    const expr = asMatch[1].trim();
    const name = asMatch[2].trim();
    if (/^\[?[A-Za-z0-9_ ]+\]?$/.test(expr) && expr.replace(/[\[\]]/g, "").trim() === name) {
      return { name };
    }
    return { name, expr, alias: true };
  }
  const bare = s.replace(/^\[|\]$/g, "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(bare)) {
    return { name: `Calc${Math.floor(Math.random() * 1e4)}`, expr: s, alias: true };
  }
  return { name: bare };
}

function parseFieldList(body: string): FieldExpr[] {
  return splitTopLevel(body).map((item: string) => parseFieldExpr(item)).filter(Boolean) as FieldExpr[];
}

function inferTypeForField(f: FieldExpr): DataType {
  const s = (f.expr || f.name).toLowerCase();
  if (/\bif\s*\([^)]*['"][^'"]+['"]/.test(s)) return "String";
  if (/\bdate#|\bdate\(|today\(|year\(|month\(|monthstart|day\(|orderdate|shipdate|invoice.?date|created.?date/.test(s)) return "Date";
  if (/\bint\(|round\(|floor\(|ceil\(/.test(s)) return "Integer";
  if (/\bnum#|\bsum\(|\bcount\(|\bavg\(|\bmin\(|\bmax\(|money|\bprice|\bqty|quantity|\bamount|\brevenue|\bcost|profit|margin|\btotal|usd|eur|gbp/.test(s)) return "Decimal";
  if (/(_id|id|key)$/i.test(f.name)) return "Integer";
  if (/date|_dt$/i.test(f.name)) return "Date";
  return "String";
}

interface Statement {
  raw: string;
  prefixes: string[]; 
  tableLabel?: string;
  body: string;       
}

function splitStatements(src: string): Statement[] {
  const stmts = splitQlikScriptStatements(src).map(statement =>
    statement.cleaned.replace(/;\s*$/, "").trim(),
  );

  const out: Statement[] = [];
  for (const s of stmts) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const labelMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/);
    let body = trimmed;
    let tableLabel: string | undefined;
    if (labelMatch && /^(MAPPING\s+|NOCONCATENATE\s+|(?:LEFT|RIGHT|INNER|OUTER)\s+(?:JOIN|KEEP)\s*(?:\([^)]*\))?\s*|JOIN\s*(?:\([^)]*\))?\s*|KEEP\s*(?:\([^)]*\))?\s*|CONCATENATE\s*(?:\([^)]*\))?\s*|ADD\s+|REPLACE\s+|BUFFER\s+)*(LOAD|SQL|SELECT)\b/i.test(labelMatch[2])) {
      tableLabel = labelMatch[1];
      body = labelMatch[2];
    }
    const prefixes: string[] = [];
    const prefixRegex = /^\s*(MAPPING|NOCONCATENATE|(?:LEFT|RIGHT|INNER|OUTER)\s+(?:JOIN|KEEP)|JOIN|KEEP|CONCATENATE|ADD|REPLACE|BUFFER)\s*(?:\(\s*[^)]+\s*\))?\s*/i;
    while (true) {
      const m = body.match(prefixRegex);
      if (!m) break;
      prefixes.push(m[0].trim());
      body = body.slice(m[0].length);
    }
    out.push({ raw: trimmed, prefixes, tableLabel, body });
  }
  return out;
}

export function validateQlikSyntax(files: { name: string, text?: string | null }[]): { file: string; message: string }[] {
  const errors: { file: string; message: string }[] = [];
  
  for (const f of files) {
    if (!f.text) continue;
    let depth = 0, inStr: string | null = null;
    let lineNum = 1;
    for (let i = 0; i < f.text.length; i++) {
      const ch = f.text[i];
      if (ch === '\n') lineNum++;
      if (inStr) {
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"') { inStr = ch; continue; }
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      
      if (depth < 0) {
        errors.push({ file: f.name, message: `Syntax Error: Unmatched closing parenthesis/bracket at line ${lineNum}` });
        depth = 0;
      }
    }
    if (inStr) errors.push({ file: f.name, message: `Syntax Error: Unclosed string literal started with ${inStr}` });
    if (depth > 0) errors.push({ file: f.name, message: `Syntax Error: Missing closing parenthesis/bracket. Found ${depth} unclosed.` });
    
    const stmts = splitStatements(f.text);
    for (const stmt of stmts) {
      const upper = stmt.body.toUpperCase();
      if (upper.startsWith("LOAD ") || upper.startsWith("SQL SELECT ") || upper.startsWith("SELECT ")) {
        if (!/\b(FROM|RESIDENT|INLINE|AUTOGENERATE|EXTENSION)\b/.test(upper)) {
           errors.push({ file: f.name, message: `Invalid Query: LOAD/SELECT statement missing FROM/RESIDENT clause: "${stmt.body.slice(0, 50)}..."` });
        }
      }
    }
  }
  return errors;
}

function parseLoadBody(body: string): ParsedLoadBody {
  const isSql = /^\s*SQL\s+/i.test(body) || /^\s*SELECT\s+/i.test(body);
  if (isSql) {
    const sql = body.replace(/^\s*SQL\s+/i, "").trim();
    const sel = sql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (sel) {
      const fields = sel[1].split(",").map((c: string) => {
        const a = c.trim().match(/^([\s\S]+?)(?:\s+AS\s+([A-Za-z0-9_]+))?$/i);
        const name = a?.[2] || a?.[1]?.replace(/.*\./, "").trim() || c.trim();
        return { name } as FieldExpr;
      });
      return { fields, from: `SQL: ${sel[2].trim()}`, where: sel[3]?.trim(), sourceQuery: sql };
    }
    return { fields: [], from: sql, sourceQuery: sql };
  }
  const loadMatch = body.match(/LOAD\s+([\s\S]*?)(?:\s+(FROM|RESIDENT|INLINE|AUTOGENERATE)\s+([\s\S]*))?$/i);
  if (!loadMatch) return { fields: [] };
  const fields = parseFieldList(loadMatch[1]);
  const kind = loadMatch[2]?.toUpperCase();
  const rest = loadMatch[3] || "";
  if (kind === "FROM") {
    const whereSplit = rest.split(/\bWHERE\b/i);
    return { fields, from: whereSplit[0].trim(), where: whereSplit[1]?.trim() };
  }
  if (kind === "RESIDENT") {
    const whereSplit = rest.split(/\bWHERE\b/i);
    const resName = whereSplit[0].trim().split(/\s+/)[0];
    return { fields, resident: resName, where: whereSplit[1]?.trim() };
  }
  if (kind === "INLINE" || kind === "AUTOGENERATE") {
    return { fields, from: kind };
  }
  return { fields };
}

function parseConnectionName(raw: string): string | undefined {
  const lib = raw.match(/^\s*LIB\s+CONNECT\s+TO\s+['"]?([^;'"\]]+)['"]?/i);
  if (lib) return lib[1].trim();
  const connect = raw.match(/^\s*CONNECT\s+(?:TO\s+)?(?:\[([^\]]+)\]|'([^']+)'|"([^"]+)"|([^;]+))/i);
  return (connect?.[1] || connect?.[2] || connect?.[3] || connect?.[4])?.trim();
}

function inferSqlParts(from: string): { database?: string; schema?: string; table?: string } {
  const table = (from.match(/^SQL:\s*([A-Za-z0-9_.\[\]"]+)/i) || [])[1]?.replace(/[\[\]"]/g, "");
  if (!table) return {};
  const parts = table.split(".").filter(Boolean);
  if (parts.length >= 3) return { database: parts[0], schema: parts[1], table: parts[2] };
  if (parts.length === 2) return { schema: parts[0], table: parts[1] };
  return { table: parts[0] };
}

function isWildcardField(f: FieldExpr): boolean {
  return f.name === "*";
}

function parsePrefixTarget(prefix: string): string | undefined {
  const m = prefix.match(/\(\s*([^)]+)\s*\)/);
  if (!m) return undefined;
  let target = m[1].trim();
  if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'")) || (target.startsWith('[') && target.endsWith(']'))) {
    target = target.slice(1, -1);
  }
  return target;
}

function joinTypeFromPrefix(prefix: string): "Left" | "Right" | "Inner" | "Outer" {
  if (/LEFT/i.test(prefix)) return "Left";
  if (/RIGHT/i.test(prefix)) return "Right";
  if (/OUTER/i.test(prefix)) return "Outer";
  return "Inner";
}

export function parseSourceQvs(text: string): SourceTable[] {
  const src = stripComments(text);
  const stmts = splitStatements(src);
  const tables: SourceTable[] = [];
  let idx = 0;
  let currentConnection: string | undefined;
  for (const s of stmts) {
    const connection = parseConnectionName(s.raw);
    if (connection) {
      currentConnection = connection;
      continue;
    }
    const body = parseLoadBody(s.body);
    if (!body.from) continue;
    const platform = detectPlatform(body.from + " " + s.raw);
    const qvdName = (body.from.match(/([A-Za-z0-9_\-]+\.qvd)/i) || [])[1];
    const filePath = (body.from.match(/([A-Za-z]:[\\\/][^\s\)]+|\/[^\s\)]+|lib:\/\/[^\s\)]+)/i) || [])[1];
    const sql = inferSqlParts(body.from);
    const name = s.tableLabel || sql.table || qvdName?.replace(/\.qvd$/i, "") || `Table_${++idx}`;
    const columns: SourceColumn[] = body.fields
      .filter((f: FieldExpr) => !isWildcardField(f))
      .map((f: FieldExpr) => ({ name: f.name, dataType: inferTypeForField(f) }));
    tables.push({
      id: uid("src"), name, platform, database: sql.database, schema: sql.schema,
      connectionName: currentConnection,
      sourceQuery: body.sourceQuery,
      connectionPath: filePath || body.from.slice(0, 200),
      qvdName, filePath, columns,
    });
  }
  return tables;
}

export interface EtlAnalysisResult {
  etlOperations: EtlOperation[];
  allTables: FinalTable[];
  finalTables: FinalTable[];
  relationships: Relationship[];
  droppedTables: string[];
  intermediateTables: string[];
  variables: Record<string, string>;
  executionGraph: ExecutionNode[]; 
}

export function parseEtlQvs(text: string, sourceTables: SourceTable[] = []): EtlAnalysisResult {
  const src = stripComments(text);
  const ops: EtlOperation[] = [];
  const variables: Record<string, string> = {};
  const dropped = new Set<string>();
  const renamesTable: Record<string, string> = {};
  const tables = new Map<string, FinalTable>();
  const mappings = new Map<string, { keyField: string; valueField: string; tableNodeId: string }>();
  const executionGraph: ExecutionNode[] = [];
  
  let lastTable: string | undefined;
  let currentConnection: string | undefined;
  let sequenceCounter = 0;

  for (const m of src.matchAll(/SET\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/gi)) variables[m[1]] = m[2].trim();
  for (const m of src.matchAll(/LET\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/gi)) variables[m[1]] = m[2].trim();

  const stmts = splitStatements(src);

  const ensureTableState = (name: string, type: FinalTable["type"] = "Dimension"): FinalTable => {
    if (!tables.has(name)) {
      tables.set(name, {
        id: uid("ft"), name, type, columns: [], sourceTables: [], isFinal: true, steps: [], keys: [], lineage: [],
      });
    }
    return tables.get(name)!;
  };

  const getLatestTableNodeId = (tableName: string): string => {
    const nodes = executionGraph.filter((n: ExecutionNode) => n.outputTable === tableName);
    return nodes.length > 0 ? nodes[nodes.length - 1].id : "root_origin";
  };

  const findSourceColumns = (from?: string, resident?: string): FieldExpr[] => {
    if (resident) {
      const rt = tables.get(resident);
      return rt?.columns.map((c: { name: string }) => ({ name: c.name })) ?? [];
    }
    if (!from) return [];
    const clean = from.toLowerCase();
    const match = sourceTables.find((s: SourceTable) => {
      const tokens = [s.name, s.qvdName, s.filePath, s.connectionPath, s.sourceQuery].filter(Boolean).map((x: any) => String(x).toLowerCase());
      return tokens.some((token: string) => clean.includes(token) || token.includes(clean.slice(0, 80)));
    });
    return match?.columns.map((c: SourceColumn) => ({ name: c.name })) ?? [];
  };

  const expandWildcards = (body: ParsedLoadBody): FieldExpr[] => {
    if (!body.fields.some((f: FieldExpr) => isWildcardField(f))) return body.fields;
    const expanded = findSourceColumns(body.from, body.resident);
    return [
      ...body.fields.filter((f: FieldExpr) => !isWildcardField(f)),
      ...expanded.filter((f: FieldExpr) => !body.fields.some((existing: FieldExpr) => existing.name === f.name)),
    ];
  };

  for (const s of stmts) {
    const connection = parseConnectionName(s.raw);
    if (connection) {
      currentConnection = connection;
      continue;
    }

    const globalDropMatch = s.raw.match(/^DROP\s+TABLE[S]?\s+([A-Za-z0-9_, ]+)/i);
    if (globalDropMatch) {
      for (const n of globalDropMatch[1].split(",").map((t: string) => t.trim())) {
        dropped.add(n);
        ops.push({ kind: "DROP", table: n, raw: s.raw });

        executionGraph.push({
          id: uid("node"),
          operation: "DROP" as any,
          sequenceOrder: ++sequenceCounter,
          inputNodes: [getLatestTableNodeId(n)],
          outputTable: n,
          meta: { isDropped: true },
          rawExpression: s.raw.slice(0, 120)
        });
      }
      continue;
    }

    const globalRenameMatch = s.raw.match(/^RENAME\s+TABLE\s+([A-Za-z0-9_]+)\s+TO\s+([A-Za-z0-9_]+)/i);
    if (globalRenameMatch) {
      const fromTable = globalRenameMatch[1].trim();
      const toTable = globalRenameMatch[2].trim();
      renamesTable[fromTable] = toTable;
      ops.push({ kind: "RENAME_TABLE", table: fromTable, target: toTable, raw: s.raw });

      executionGraph.push({
        id: uid("node"),
        operation: "RENAME_TABLE" as any,
        sequenceOrder: ++sequenceCounter,
        inputNodes: [getLatestTableNodeId(fromTable)],
        outputTable: toTable,
        meta: { fromTable, toTable },
        rawExpression: s.raw.slice(0, 120)
      });
      continue;
    }

    const globalStoreMatch = s.raw.match(/^STORE\s+([A-Za-z0-9_]+)\s+INTO/i);
    if (globalStoreMatch) {
      const storeTarget = globalStoreMatch[1].trim();
      ops.push({ kind: "STORE", table: storeTarget, raw: s.raw });
      continue;
    }

    const body = parseLoadBody(s.body);
    if (!body.fields.length && !body.from && !body.resident) continue;
    
    const fields = expandWildcards(body);

    const isMapping = s.prefixes.some((p: string) => /^MAPPING$/i.test(p));
    const joinPrefix = s.prefixes.find((p: string) => /JOIN/i.test(p));
    const keepPrefix = s.prefixes.find((p: string) => /KEEP/i.test(p));
    const concatPrefix = s.prefixes.find((p: string) => /^CONCATENATE/i.test(p));

    const renameFieldMatch = s.raw.match(/^RENAME\s+FIELD[S]?\s+([\s\S]+)$/i);
    if (renameFieldMatch) {
      const pairs = splitTopLevel(renameFieldMatch[1]);
      for (const p of pairs) {
        const pm = p.trim().match(/([A-Za-z0-9_]+)\s+TO\s+([A-Za-z0-9_]+)/i);
        if (pm && lastTable) {
          const t = tables.get(lastTable);
          if (t) {
            const originalField = pm[1].trim();
            const targetField = pm[2].trim();
            t.steps!.push({ kind: "RENAME_FIELD", from: originalField, to: targetField });
            const c = t.columns.find((x: { name: string }) => x.name === originalField);
            if (c) c.name = targetField;

            executionGraph.push({
              id: uid("node"),
              operation: "RENAME_FIELD",
              sequenceOrder: ++sequenceCounter,
              inputNodes: [getLatestTableNodeId(lastTable)],
              outputTable: lastTable,
              meta: { originalField, targetField },
              rawExpression: p.trim()
            });
          }
          ops.push({ kind: "RENAME_FIELD", table: lastTable, raw: p });
        }
      }
      continue;
    }

    const mapUsing = s.raw.match(/MAP\s+([A-Za-z0-9_,\s]+)\s+USING\s+([A-Za-z0-9_]+)/i);
    if (mapUsing) {
      const mappingTable = mapUsing[2].trim();
      if (lastTable) {
        for (const f of mapUsing[1].split(",").map((x: string) => x.trim())) {
          const mapMeta = mappings.get(mappingTable);
          tables.get(lastTable)?.steps!.push({
            kind: "APPLYMAP", mapName: mappingTable, sourceField: f, asField: f,
          });

          executionGraph.push({
            id: uid("node"),
            operation: "APPLYMAP",
            sequenceOrder: ++sequenceCounter,
            inputNodes: [getLatestTableNodeId(lastTable), mapMeta?.tableNodeId || "root_origin"],
            outputTable: lastTable,
            meta: {
              mappingTableName: mappingTable,
              lookupKeyField: f,
              resultColumn: f,
              sourceField: mapMeta?.keyField,
              targetValueField: mapMeta?.valueField
            },
            rawExpression: `Implicit map mapping: ${f} via ${mappingTable}`
          });
        }
      }
      ops.push({ kind: "APPLYMAP", table: mappingTable, raw: s.raw.slice(0, 120) });
      continue;
    }

    if (isMapping) {
      const name = s.tableLabel || `Map_${tables.size + 1}`;
      const t = ensureTableState(name, "Mapping");
      t.type = "Mapping";
      t.isFinal = false;
      t.columns = fields.map((f: FieldExpr) => ({ name: f.name, dataType: inferTypeForField(f), derived: false }));
      
      const nodeElementId = uid("node");
      if (fields.length >= 2) {
        mappings.set(name, { keyField: fields[0].name, valueField: fields[1].name, tableNodeId: nodeElementId });
      }

      t.steps!.push(body.from
        ? { kind: "LOAD", from: body.from, fields, where: body.where, platform: detectPlatform(body.from), connectionName: currentConnection, sourceQuery: body.sourceQuery }
        : { kind: "RESIDENT", from: body.resident!, fields, where: body.where });

      executionGraph.push({
        id: nodeElementId,
        operation: "LOAD",
        sequenceOrder: ++sequenceCounter,
        inputNodes: body.resident ? [getLatestTableNodeId(body.resident)] : ["root_origin"],
        outputTable: name,
        meta: { isMappingTable: true, lookupKey: fields[0]?.name, outputValue: fields[1]?.name },
        rawExpression: s.raw.slice(0, 120)
      });

      ops.push({ kind: "MAPPING", table: name, raw: s.raw.slice(0, 120) });
      continue;
    }

    if (joinPrefix || keepPrefix || concatPrefix) {
      const target = parsePrefixTarget(joinPrefix || keepPrefix || concatPrefix || "") || lastTable;
      if (!target) continue;
      const t = ensureTableState(target);
      
      const incomingFields = fields.map((f: FieldExpr) => f.name);
      const leftKeyColumns = t.columns.map((c: { name: string }) => c.name);
      const intersectingKeys = leftKeyColumns.filter((name: string) => incomingFields.includes(name));

      const inputTableSourceNode = body.resident ? getLatestTableNodeId(body.resident) : uid("origin_root");
      const currentTargetStateNode = getLatestTableNodeId(target);

      const existingColumnNames = new Set(t.columns.map((c: { name: string }) => c.name));
      const addedColumnsThisStep: string[] = [];
      const overwrittenColumnsThisStep: string[] = [];

      for (const f of fields) {
        if (isWildcardField(f)) continue;
        if (!existingColumnNames.has(f.name)) {
          addedColumnsThisStep.push(f.name);
          t.columns.push({
            name: f.name,
            dataType: inferTypeForField(f),
            derived: !!f.expr && !/^\[?[A-Za-z_][A-Za-z0-9_ ]*\]?$/.test(f.expr),
            expression: f.expr,
          });
        } else {
          overwrittenColumnsThisStep.push(f.name);
        }
      }

      t.keys = t.columns.map((c: { name: string }) => c.name).filter((n: string) => /(_id|Id|Key|_KEY)$/.test(n) || /^id$/i.test(n));

      if (body.resident) t.lineage = [...new Set([...(t.lineage || []), body.resident])];
      if (body.from) {
        t.sourceTables.push(body.from.slice(0, 120));
        t.lineage = [...new Set([...(t.lineage || []), body.from.slice(0, 120)])];
      }

      if (concatPrefix) {
        t.steps!.push({
          kind: "CONCATENATE", withTable: target, withFields: incomingFields,
          resident: body.resident, fromClause: body.from, connectionName: currentConnection, sourceQuery: body.sourceQuery, platform: body.from ? detectPlatform(body.from) : undefined,
        });
        
        executionGraph.push({
          id: uid("node"),
          operation: "CONCATENATE",
          sequenceOrder: ++sequenceCounter,
          inputNodes: [currentTargetStateNode, inputTableSourceNode],
          outputTable: target,
          meta: { baseTable: target, appendedSource: body.resident || body.from, appendedFieldsCount: incomingFields.length },
          rawExpression: s.raw.slice(0, 120)
        });

        ops.push({ kind: "CONCATENATE", table: target, raw: s.raw.slice(0, 120) });
      } else if (keepPrefix) {
        const jType = joinTypeFromPrefix(keepPrefix) === "Outer" ? "Inner" : joinTypeFromPrefix(keepPrefix) as "Left" | "Right" | "Inner";
        t.steps!.push({ kind: "KEEP", joinType: jType, withTable: body.resident || target });

        executionGraph.push({
          id: uid("node"),
          operation: "KEEP",
          sequenceOrder: ++sequenceCounter,
          inputNodes: [currentTargetStateNode, inputTableSourceNode],
          outputTable: target,
          meta: { keepType: jType, keysAligned: intersectingKeys },
          rawExpression: s.raw.slice(0, 120)
        });

        ops.push({ kind: "KEEP", table: target, detail: joinTypeFromPrefix(keepPrefix), raw: s.raw.slice(0, 120) });
      } else if (joinPrefix) {
        const jType = joinTypeFromPrefix(joinPrefix);
        t.steps!.push({
          kind: "JOIN", joinType: jType, withTable: body.resident || target,
          withFields: incomingFields, keyFields: intersectingKeys, resident: body.resident, fromClause: body.from, connectionName: currentConnection, sourceQuery: body.sourceQuery, platform: body.from ? detectPlatform(body.from) : undefined,
        });

        executionGraph.push({
          id: uid("node"),
          operation: "JOIN",
          sequenceOrder: ++sequenceCounter,
          inputNodes: [currentTargetStateNode, inputTableSourceNode],
          outputTable: target,
          meta: {
            joinType: jType,
            joinSource: body.resident || body.from,
            joinTarget: target,
            joinKeys: intersectingKeys,
            columnsAdded: addedColumnsThisStep,
            columnsOverwritten: overwrittenColumnsThisStep
          },
          rawExpression: s.raw.slice(0, 120)
        });

        ops.push({ kind: "JOIN", table: target, detail: jType, raw: s.raw.slice(0, 120) });
      }
      lastTable = target;
      continue;
    }

    if (!s.tableLabel && !body.from && !body.resident) continue;
    const precedingTarget = !s.tableLabel && !!body.from && !!lastTable && !!tables.get(lastTable)
      && !(tables.get(lastTable)!.steps || []).some((step: TableStep) => step.kind === "LOAD" || step.kind === "RESIDENT");
    
    const name = precedingTarget ? lastTable! : s.tableLabel || (body.from?.match(/([A-Za-z0-9_]+)\.qvd/i)?.[1]) || `Table_${tables.size + 1}`;
    const t = ensureTableState(name);

    for (const f of fields) {
      if (isWildcardField(f)) continue;
      const inlineApplyMapMatch = f.expr?.match(/ApplyMap\s*\(\s*['"]?([^,'"]+)['"]?\s*,\s*([^,\)]+)(?:,\s*([^\)]+))?\)/i);
      
      if (inlineApplyMapMatch) {
        const mapRef = inlineApplyMapMatch[1].trim();
        const srcCol = inlineApplyMapMatch[2].replace(/[\[\]]/g, "").trim();
        const defVal = inlineApplyMapMatch[3]?.trim();
        const mapMeta = mappings.get(mapRef);

        t.steps!.push({
          kind: "APPLYMAP", mapName: mapRef, sourceField: srcCol, asField: f.name, defaultValue: defVal,
        });

        executionGraph.push({
          id: uid("node"),
          operation: "APPLYMAP",
          sequenceOrder: ++sequenceCounter,
          inputNodes: [getLatestTableNodeId(name), mapMeta?.tableNodeId || "root_origin"],
          outputTable: name,
          meta: { mappingTableName: mapRef, lookupKeyField: srcCol, resultColumn: f.name, defaultValue: defVal },
          rawExpression: f.expr || ""
        });
      }

      if (!t.columns.find((c: { name: string }) => c.name === f.name)) {
        t.columns.push({
          name: f.name,
          dataType: inferTypeForField(f),
          derived: !!f.expr && !/^\[?[A-Za-z_][A-Za-z0-9_ ]*\]?$/.test(f.expr),
          expression: f.expr,
        });
      }
    }
    
    t.keys = t.columns.map((c: { name: string }) => c.name).filter((n: string) => /(_id|Id|Key|_KEY)$/.test(n) || /^id$/i.test(n));

    if (body.from) {
      const platform = detectPlatform(body.from);
      t.sourcePlatform = platform;
      t.sourceConnection = body.from.slice(0, 300);
      t.sourceTables.push(body.from.slice(0, 80));
      t.lineage = [...new Set([...(t.lineage || []), body.from.slice(0, 120)])];
      t.steps!.unshift({ kind: "LOAD", from: body.from, fields, where: body.where, platform, connectionName: currentConnection, sourceQuery: body.sourceQuery });

      executionGraph.push({
        id: uid("node"),
        operation: "LOAD",
        sequenceOrder: ++sequenceCounter,
        inputNodes: ["root_origin"],
        outputTable: name,
        meta: { sourcePath: body.from, platform, hasWhereClause: !!body.where },
        rawExpression: s.raw.slice(0, 120)
      });

      ops.push({ kind: "LOAD", table: name, raw: s.raw.slice(0, 200) });
    } else if (body.resident) {
      const residentSource = body.resident;
      t.sourceTables.push(residentSource);
      t.lineage = [...new Set([...(t.lineage || []), residentSource])];
      t.steps!.unshift({ kind: "RESIDENT", from: residentSource, fields, where: body.where });

      executionGraph.push({
        id: uid("node"),
        operation: "RESIDENT",
        sequenceOrder: ++sequenceCounter,
        inputNodes: [getLatestTableNodeId(residentSource)],
        outputTable: name,
        meta: { residentSourceTable: residentSource, hasWhereClause: !!body.where },
        rawExpression: s.raw.slice(0, 120)
      });

      ops.push({ kind: "RESIDENT", table: name, detail: residentSource, raw: s.raw.slice(0, 200) });
    }
    lastTable = name;
  }

  for (const name of [...tables.keys()]) {
    if (dropped.has(name)) tables.get(name)!.isFinal = false;
  }
  for (const [from, to] of Object.entries(renamesTable)) {
    const t = tables.get(from);
    if (t) { t.name = to; tables.set(to, t); tables.delete(from); }
  }

  const allTables = [...tables.values()];
  const finalTables = allTables.filter((t: FinalTable) => t.isFinal && t.type !== "Mapping");

  for (const t of finalTables) {
    const n = t.name;
    if (/calendar|date_dim|^date$|^time$/i.test(n)) {
      t.type = "Calendar";
    } else if (executionGraph.some((node: ExecutionNode) => node.operation === "JOIN" && node.meta.joinTarget === t.name)) {
      t.type = "Fact";
    } else {
      t.type = "Dimension";
    }
  }

  const relationships: Relationship[] = [];
  const trackedRelationshipSignatures = new Set<string>();

  const registerRelationshipNode = (fromT: string, fromC: string, toT: string, toC: string) => {
    const sig = `${fromT}.${fromC}->${toT}.${toC}`;
    if (!trackedRelationshipSignatures.has(sig) && tables.has(fromT) && tables.has(toT)) {
      trackedRelationshipSignatures.add(sig);

      const targetRightTableObj = tables.get(toT);
      let calculatedCardinality: Relationship["cardinality"] = "N:1";

      if (targetRightTableObj) {
        const isRightTableCalendarOrDim = targetRightTableObj.type === "Calendar" || targetRightTableObj.type === "Dimension";
        const isLeftTableFact = tables.get(fromT)?.type === "Fact";

        if (isRightTableCalendarOrDim && isLeftTableFact) {
          calculatedCardinality = "N:1";
        } else if (fromC.toLowerCase() === "id" && toC.toLowerCase() === "id") {
          calculatedCardinality = "1:1";
        }
      }

      relationships.push({
        id: uid("rel"),
        fromTable: fromT,
        fromColumn: fromC,
        toTable: toT,
        toColumn: toC,
        cardinality: calculatedCardinality
      });
    }
  };

  for (const node of executionGraph) {
    if (node.operation === "JOIN" && node.meta.joinKeys) {
      const srcTable = node.meta.joinSource;
      const targetTable = node.meta.joinTarget;
      if (srcTable && targetTable) {
        for (const key of node.meta.joinKeys) {
          registerRelationshipNode(targetTable, key, srcTable, key);
        }
      }
    }
    if (node.operation === "APPLYMAP") {
      const mappingTableName = node.meta.mappingTableName;
      const lookupKeyField = node.meta.lookupKeyField;
      const sourceField = node.meta.sourceField;
      if (mappingTableName && lookupKeyField && sourceField) {
        registerRelationshipNode(node.outputTable, lookupKeyField, mappingTableName, sourceField);
      }
    }
  }

  return {
    etlOperations: ops,
    allTables,
    finalTables,
    relationships,
    droppedTables: [...dropped],
    intermediateTables: allTables.filter((t: FinalTable) => !t.isFinal && t.type !== "Mapping").map((t: FinalTable) => t.name),
    variables,
    executionGraph
  };
}