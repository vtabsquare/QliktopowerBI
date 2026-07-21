import type {
  ParsedOperation,
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  QlikSourceReference,
  StatementParserPlugin,
} from "../core/ParserTypes";
import {
  baseOperation,
  cleanIdentifier,
  findTopLevelKeyword,
  parseClause,
  parseFields,
  parseListClause,
  parseSourceReference,
  parseTargetFromPrefixes,
  unquote,
} from "../core/ParserUtils";

const LOAD_SOURCE_KEYWORDS = ["FROM", "RESIDENT", "INLINE", "AUTOGENERATE", "EXTENSION"];
const CLAUSE_KEYWORDS = ["WHERE", "WHILE", "GROUP BY", "ORDER BY"];

function deriveTargetName(
  statement: ParsedStatement,
  source: QlikSourceReference | undefined,
  context: ParserContextLike,
): string {
  if (statement.label) return statement.label;

  const isConcatenate = statement.prefixes.some((prefix) =>
    /\bCONCATENATE\b/i.test(prefix),
  );
  if (isConcatenate) {
    const explicitTarget = parseTargetFromPrefixes(statement.prefixes);
    if (explicitTarget) return explicitTarget;
    if (context.lastCreatedTable) return context.lastCreatedTable;
  }

  if (source?.kind === "resident")
    return `${source.name}_Resident_${context.operations.length + 1}`;
  if (source?.name && source.name !== "UnknownSource") return source.name;
  return `AnonymousTable_${String(context.operations.length + 1).padStart(4, "0")}`;
}

function sourceTextAfterKeyword(body: string, keywordIndex: number, keyword: string): string {
  const rest = body.slice(keywordIndex + keyword.length).trim();
  const stop = findTopLevelKeyword(rest, CLAUSE_KEYWORDS);
  return (stop ? rest.slice(0, stop.index) : rest).trim();
}

function parseSqlSelect(statement: ParsedStatement, context: ParserContextLike): ParsedOperation {
  const operation = baseOperation(statement, context, "SELECT", "select");
  const sql = statement.body.replace(/^\s*SQL\s+/i, "").trim();
  const selectMatch = sql.match(/^SELECT\s+([\s\S]+)$/i);
  const selectBody = selectMatch?.[1] ?? sql;
  const from = findTopLevelKeyword(selectBody, ["FROM"]);

  if (from) {
    operation.fields = parseFields(selectBody.slice(0, from.index).trim());
    const rest = selectBody.slice(from.index + from.keyword.length).trim();
    const stop = findTopLevelKeyword(rest, ["WHERE", "GROUP BY", "ORDER BY", "HAVING"]);
    const sourceTable = (stop ? rest.slice(0, stop.index) : rest).trim();
    const source = parseSourceReference(`SQL:${sourceTable}`, context, "sql");
    source.table = cleanIdentifier(sourceTable);
    source.name = cleanIdentifier(sourceTable);
    operation.source = source;
    operation.sourceTables = [source.name];
    operation.where = parseClause(selectBody, "WHERE", ["GROUP BY", "ORDER BY", "HAVING"]);
    operation.groupBy = parseListClause(selectBody, "GROUP BY", ["ORDER BY", "HAVING"]);
    operation.orderBy = parseListClause(selectBody, "ORDER BY", []);
  } else {
    operation.fields = [];
    operation.source = parseSourceReference(`SQL:${sql}`, context, "sql");
  }

  operation.targetTable =
    statement.label ?? context.lastCreatedTable ?? `SqlResult_${operation.sequence}`;
  operation.attributes.sql = sql;
  operation.applyMaps = operation.fields.flatMap((field) => field.applyMaps);
  return operation;
}

export function parseLoadOperation(
  statement: ParsedStatement,
  context: ParserContextLike,
): ParsedOperation {
  if (/^\s*(?:SQL\s+)?SELECT\b/i.test(statement.body)) {
    return parseSqlSelect(statement, context);
  }

  const operation = baseOperation(statement, context, "LOAD", "load");
  let body = statement.body.replace(/^\s*LOAD\b/i, "").trim();
  if (/^DISTINCT\b/i.test(body)) {
    operation.distinct = true;
    body = body.replace(/^DISTINCT\b/i, "").trim();
  }

  const sourceMarker = findTopLevelKeyword(body, LOAD_SOURCE_KEYWORDS);
  const fieldText = sourceMarker ? body.slice(0, sourceMarker.index).trim() : body;
  operation.fields = parseFields(fieldText);
  operation.applyMaps = operation.fields.flatMap((field) => field.applyMaps);
  operation.where = parseClause(body, "WHERE", ["WHILE", "GROUP BY", "ORDER BY"]);
  operation.groupBy = parseListClause(body, "GROUP BY", ["ORDER BY"]);
  operation.orderBy = parseListClause(body, "ORDER BY", []);
  operation.attributes.while = parseClause(body, "WHILE", ["GROUP BY", "ORDER BY"]);

  if (sourceMarker) {
    const rawSource = sourceTextAfterKeyword(body, sourceMarker.index, sourceMarker.keyword);
    const upperKind = sourceMarker.keyword.toUpperCase();
    if (upperKind === "RESIDENT") {
      const residentName = cleanIdentifier(unquote(rawSource.split(/\s+/)[0] ?? rawSource));
      operation.kind = "RESIDENT";
      operation.source = {
        kind: "resident",
        raw: rawSource,
        name: residentName,
        table: residentName,
      };
      operation.sourceTables = [residentName];
    } else if (upperKind === "INLINE") {
      operation.source = parseSourceReference("INLINE", context, "inline");
      operation.attributes.inlineBody = rawSource;
    } else if (upperKind === "AUTOGENERATE") {
      operation.source = parseSourceReference("AUTOGENERATE", context, "autogenerate");
      operation.attributes.autogenerate = rawSource;
    } else if (upperKind === "EXTENSION") {
      operation.source = parseSourceReference("EXTENSION", context, "extension");
      operation.attributes.extension = rawSource;
    } else {
      operation.source = parseSourceReference(rawSource, context);
      if (operation.source.table) operation.sourceTables = [operation.source.table];
      else if (operation.source.name) operation.sourceTables = [operation.source.name];
    }
  }

  operation.targetTable = deriveTargetName(statement, operation.source, context);
  if (statement.prefixes.some((prefix) => /\bCONCATENATE\b/i.test(prefix))) {
    operation.attributes.concatenateTarget = operation.targetTable;
    operation.attributes.concatenatePrefixes = [...statement.prefixes];
  }
  operation.precedingLoad =
    !statement.label && !operation.source && Boolean(context.lastCreatedTable);
  if (operation.precedingLoad && context.lastCreatedTable) {
    operation.sourceTables = [context.lastCreatedTable];
    operation.attributes.precedingTarget = context.lastCreatedTable;
  }

  return operation;
}

export class LoadParser implements StatementParserPlugin {
  readonly name = "LoadParser";
  readonly priority = 100;

  canParse(statement: ParsedStatement): boolean {
    if (!["load", "select"].includes(statement.kind)) return false;
    return (
      !/\bRESIDENT\b/i.test(statement.body) &&
      !statement.prefixes.some((prefix) => /\bJOIN\b|\bKEEP\b|\bMAPPING\b/i.test(prefix)) &&
      !/\bAPPLYMAP\s*\(/i.test(statement.body) &&
      statement.kind !== "calendar"
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    return { operations: [parseLoadOperation(statement, context)] };
  }
}
