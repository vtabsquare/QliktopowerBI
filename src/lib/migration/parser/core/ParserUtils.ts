import type {
  ApplyMapCall,
  JoinType,
  ParsedOperation,
  ParsedStatement,
  ParserContextLike,
  QlikField,
  QlikSourceReference,
  SourceLocation,
} from "./ParserTypes";

export function cleanIdentifier(value: string, fallback = "AnonymousTable"): string {
  const cleaned = value
    .trim()
    .replace(/^[\[\]`'\"]+|[\[\]`'\"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

export function canonicalName(value: string): string {
  return cleanIdentifier(value).toLowerCase();
}

export function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function splitTopLevel(value: string, delimiter = ","): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (quote) {
      current += char;
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          current += next;
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") roundDepth += 1;
    if (char === ")") roundDepth = Math.max(0, roundDepth - 1);
    if (char === "[") squareDepth += 1;
    if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (char === "{") curlyDepth += 1;
    if (char === "}") curlyDepth = Math.max(0, curlyDepth - 1);

    if (char === delimiter && roundDepth === 0 && squareDepth === 0 && curlyDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function findTopLevelKeyword(
  value: string,
  keywords: string[],
): { index: number; keyword: string } | undefined {
  const upper = value.toUpperCase();
  let quote: string | undefined;
  let roundDepth = 0;
  let squareDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (quote) {
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") roundDepth += 1;
    else if (char === ")") roundDepth = Math.max(0, roundDepth - 1);

    if (roundDepth !== 0 || squareDepth !== 0) continue;

    for (const keyword of keywords) {
      const target = keyword.toUpperCase();
      if (!upper.startsWith(target, index)) continue;
      const before = index === 0 ? " " : upper[index - 1];
      const after = upper[index + target.length] ?? " ";
      if (/[^A-Z0-9_]/.test(before) && /[^A-Z0-9_]/.test(after)) {
        return { index, keyword };
      }
    }
  }

  return undefined;
}

export function parseApplyMapCalls(expression: string, outputField?: string): ApplyMapCall[] {
  const calls: ApplyMapCall[] = [];
  const marker = /\bApplyMap\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(expression)) !== null) {
    const open = expression.indexOf("(", match.index);
    let depth = 1;
    let quote: string | undefined;
    let end = open + 1;

    for (; end < expression.length; end += 1) {
      const char = expression[end];
      const next = expression[end + 1];
      if (quote) {
        if (char === quote) {
          if ((quote === "'" || quote === '"') && next === quote) end += 1;
          else quote = undefined;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0) break;
    }

    const raw = expression.slice(match.index, Math.min(end + 1, expression.length));
    const args = splitTopLevel(expression.slice(open + 1, end));
    if (args.length >= 2) {
      calls.push({
        mapName: cleanIdentifier(unquote(args[0])),
        lookupExpression: args[1].trim(),
        defaultExpression: args[2]?.trim(),
        outputField,
        raw,
      });
    }
    marker.lastIndex = Math.max(marker.lastIndex, end + 1);
  }

  return calls;
}

export function parseFields(fieldList: string): QlikField[] {
  if (!fieldList.trim()) return [];
  return splitTopLevel(fieldList).map((rawField, index) => {
    const trimmed = rawField.trim();
    if (trimmed === "*") {
      return {
        name: "*",
        expression: "*",
        isDerived: false,
        isWildcard: true,
        applyMaps: [],
      };
    }

    const aliasMatch = trimmed.match(/^([\s\S]+?)\s+AS\s+(.+)$/i);
    const expression = (aliasMatch?.[1] ?? trimmed).trim();
    const alias = aliasMatch ? cleanIdentifier(aliasMatch[2]) : undefined;
    const simpleField = /^\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_.$#@]*)\s*$/.test(expression);
    const sourceField = simpleField ? cleanIdentifier(expression) : undefined;
    const name = alias ?? sourceField ?? `Expression_${index + 1}`;

    return {
      name,
      expression,
      sourceField,
      alias,
      isDerived:
        !simpleField || Boolean(alias && canonicalName(alias) !== canonicalName(sourceField ?? "")),
      isWildcard: false,
      applyMaps: parseApplyMapCalls(expression, name),
    };
  });
}

export function parseClause(
  body: string,
  clause: string,
  stopClauses: string[],
): string | undefined {
  const found = findTopLevelKeyword(body, [clause]);
  if (!found) return undefined;
  const rest = body.slice(found.index + found.keyword.length).trim();
  const stop = findTopLevelKeyword(rest, stopClauses);
  return (stop ? rest.slice(0, stop.index) : rest).trim() || undefined;
}

export function parseListClause(body: string, clause: string, stopClauses: string[]): string[] {
  const value = parseClause(body, clause, stopClauses);
  return value ? splitTopLevel(value) : [];
}

export function parseJoinType(prefixes: string[]): JoinType {
  const joined = prefixes.join(" ").toUpperCase();
  if (/\bLEFT\b/.test(joined)) return "left";
  if (/\bRIGHT\b/.test(joined)) return "right";
  if (/\bINNER\b/.test(joined)) return "inner";
  if (/\bOUTER\b/.test(joined)) return "outer";
  return "natural";
}

export function parseTargetFromPrefixes(prefixes: string[]): string | undefined {
  for (const prefix of prefixes) {
    const match = prefix.match(/\(\s*([^)]+?)\s*\)/);
    if (match) return cleanIdentifier(match[1]);
  }
  return undefined;
}

export function parseSourceReference(
  rawSource: string,
  context: ParserContextLike,
  explicitKind?: QlikSourceReference["kind"],
): QlikSourceReference {
  const resolved = context.resolveVariables(rawSource.trim()).replace(/;$/, "").trim();
  let referenceText = resolved;
  if (referenceText.startsWith("[")) {
    const close = referenceText.indexOf("]");
    if (close >= 0) referenceText = referenceText.slice(0, close + 1);
  } else if (referenceText.startsWith("'") || referenceText.startsWith('"')) {
    const quote = referenceText[0];
    let close = 1;
    while (close < referenceText.length) {
      if (referenceText[close] === quote && referenceText[close + 1] !== quote) break;
      if (referenceText[close] === quote && referenceText[close + 1] === quote) close += 1;
      close += 1;
    }
    if (close < referenceText.length) referenceText = referenceText.slice(0, close + 1);
  } else {
    referenceText = referenceText.replace(/\s+\([^)]*\)\s*$/, "").trim();
  }
  const unquoted = unquote(referenceText);
  const lower = unquoted.toLowerCase();
  let kind = explicitKind ?? "unknown";

  if (!explicitKind) {
    if (/^sql\s*:/i.test(unquoted)) kind = "sql";
    else if (/\.qvd(?:\b|$)/i.test(unquoted)) kind = "qvd";
    else if (/\.(csv|txt|tsv|xlsx?|xlsb|parquet|json|xml)(?:\b|$)/i.test(unquoted)) kind = "file";
    else if (/^inline$/i.test(unquoted)) kind = "inline";
    else if (/^autogenerate$/i.test(unquoted)) kind = "autogenerate";
    else if (/^extension$/i.test(unquoted)) kind = "extension";
  }

  const baseName =
    unquoted
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.(qvd|csv|txt|tsv|xlsx?|xlsb|parquet|json|xml)$/i, "") ?? unquoted;

  return {
    kind,
    raw: rawSource.trim(),
    name: cleanIdentifier(baseName, "UnknownSource"),
    path: kind === "file" || kind === "qvd" ? unquoted : undefined,
    table: kind === "resident" ? cleanIdentifier(unquoted) : undefined,
  };
}

export function baseOperation(
  statement: ParsedStatement,
  context: ParserContextLike,
  kind: ParsedOperation["kind"],
  prefix = "op",
): ParsedOperation {
  return {
    id: context.nextOperationId(prefix),
    sequence: context.operations.length + 1,
    kind,
    statementId: statement.id,
    location: statement.location,
    raw: statement.raw,
    sourceTables: [],
    fields: [],
    groupBy: [],
    orderBy: [],
    distinct: false,
    precedingLoad: false,
    applyMaps: [],
    attributes: {},
    diagnostics: [],
  };
}

export function cloneLocation(location: SourceLocation): SourceLocation {
  return { ...location };
}

export function operationTarget(operation: ParsedOperation): string | undefined {
  return operation.targetTable ?? operation.join?.targetTable;
}
