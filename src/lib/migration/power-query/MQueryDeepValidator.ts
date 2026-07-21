import type { TableDataPreview } from "../enterprise-parser";

export type DeepMValidationSeverity = "blocking-error" | "warning" | "info";

export interface DeepMValidationIssue {
  id: string;
  queryName: string;
  severity: DeepMValidationSeverity;
  code: string;
  phase: "lexer" | "parser" | "semantic" | "preview";
  message: string;
  recommendation: string;
  line?: number;
  column?: number;
  evidence?: string;
}

export interface DeepMQueryResult {
  queryName: string;
  status: "passed" | "warning" | "blocked";
  parserPassed: boolean;
  semanticPassed: boolean;
  previewRowCount: number;
  issues: DeepMValidationIssue[];
}

export interface DeepPowerQueryValidationResult {
  engine: "microsoft-powerquery-parser+qlik2pbi-semantic-lint";
  generatedAt: string;
  passed: boolean;
  blockingCount: number;
  warningCount: number;
  queries: Record<string, DeepMQueryResult>;
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function stripMStringsAndComments(query: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let lineComment = false;
  let blockComment = false;
  while (index < query.length) {
    const char = query[index];
    const next = query[index + 1] || "";
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += "\n";
      } else output += " ";
      index += 1;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index += 2;
      } else {
        output += char === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (char === '"' && next === '"') {
        output += "  ";
        index += 2;
      } else if (char === '"') {
        inString = false;
        output += " ";
        index += 1;
      } else {
        output += char === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index += 2;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += " ";
      index += 1;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(index, text.length));
  const before = text.slice(0, safe);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length || 0) + 1 };
}

function referencedQueries(query: string): string[] {
  const names = [...query.matchAll(/#"((?:""|[^"])*)"/g)].map((match) => match[1].replace(/""/g, '"'));
  return [...new Set(names)];
}

function parserErrorLocation(error: any): { line?: number; column?: number } {
  const token = error?.innerError?.foundToken?.positionStart || error?.foundToken?.positionStart;
  if (!token) return {};
  return {
    line: typeof token.lineNumber === "number" ? token.lineNumber + 1 : undefined,
    column: typeof token.columnNumber === "number" ? token.columnNumber + 1 : undefined,
  };
}

function addIssue(
  issues: DeepMValidationIssue[],
  queryName: string,
  severity: DeepMValidationSeverity,
  code: string,
  phase: DeepMValidationIssue["phase"],
  message: string,
  recommendation: string,
  extras: Partial<Pick<DeepMValidationIssue, "line" | "column" | "evidence">> = {},
): void {
  issues.push({
    id: `M-${stableId(`${queryName}|${code}|${message}|${extras.line || 0}|${extras.column || 0}`)}`,
    queryName,
    severity,
    code,
    phase,
    message,
    recommendation,
    ...extras,
  });
}

export async function deepValidatePowerQueries(
  mQueries: Record<string, string>,
  stagingQueries: Record<string, string> = {},
  columnTypes: Record<string, Record<string, string>> = {},
  previews: Record<string, TableDataPreview> = {},
): Promise<DeepPowerQueryValidationResult> {
  const parser = await import("@microsoft/powerquery-parser");
  const allQueries = { ...stagingQueries, ...mQueries };
  const known = new Set(Object.keys(allQueries).map((name) => name.toLowerCase()));
  const results: Record<string, DeepMQueryResult> = {};

  for (const [queryName, query] of Object.entries(allQueries)) {
    const issues: DeepMValidationIssue[] = [];
    let parserPassed = false;
    try {
      const task = await parser.TaskUtils.tryLexParse(parser.DefaultSettings, query);
      parserPassed = parser.TaskUtils.isOk(task);
      if (!parserPassed) {
        const error = (task as any).error;
        const phase = String((task as any).stage || "Parse").toLowerCase() === "lex" ? "lexer" : "parser";
        addIssue(
          issues,
          queryName,
          "blocking-error",
          phase === "lexer" ? "M_LEXER_ERROR" : "M_PARSER_ERROR",
          phase,
          error?.message || "Microsoft Power Query parser rejected the generated M expression.",
          "Open the exact generated query and regenerate the failing Qlik expression before PBIP export.",
          parserErrorLocation(error),
        );
      }
    } catch (error) {
      addIssue(
        issues,
        queryName,
        "blocking-error",
        "M_PARSER_RUNTIME_ERROR",
        "parser",
        `Power Query parser validation failed: ${(error as Error).message}`,
        "Repair the generated expression and rerun the Microsoft M parser validation.",
      );
    }

    const stripped = stripMStringsAndComments(query);
    const rawQlikFunction = /(?<![A-Za-z0-9_.])(Abs|Fabs|ApplyMap|RangeSum|Aggr|Date#|Num#|Pick|Match|WildMatch)\s*\(/i.exec(stripped);
    if (rawQlikFunction) {
      const location = lineColumnAt(stripped, rawQlikFunction.index);
      addIssue(
        issues,
        queryName,
        "blocking-error",
        "QLIK_FUNCTION_IN_M",
        "semantic",
        `Qlik function '${rawQlikFunction[1]}()' remains in the generated Power Query expression.`,
        "Translate the function to a supported M expression or move the logic to DAX/manual review.",
        { ...location, evidence: rawQlikFunction[0] },
      );
    }

    const reviewedColumns = Object.entries(columnTypes).find(([table]) => table.toLowerCase() === queryName.toLowerCase())?.[1] || {};
    const strippedLines = stripped.split("\n");
    for (const column of Object.keys(reviewedColumns)) {
      if (!column || column.length < 2) continue;
      const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (let lineIndex = 0; lineIndex < strippedLines.length; lineIndex += 1) {
        const lineText = strippedLines[lineIndex];
        if (!/\beach\b/i.test(lineText)) continue;
        const bare = new RegExp(`(?<![A-Za-z0-9_#.'\"\\]])\b${escaped}\b(?![A-Za-z0-9_'\"\\]])`, "i").exec(lineText);
        if (!bare) continue;
        const before = lineText.slice(Math.max(0, bare.index - 80), bare.index);
        if (/Record\.Field(?:OrDefault)?\s*\([^)]*$/i.test(before)) continue;
        if (/Table\.(?:HasColumns|ColumnNames|SelectColumns|TransformColumns|TransformColumnTypes)\s*\([^)]*$/i.test(before)) continue;
        addIssue(
          issues,
          queryName,
          "blocking-error",
          "BARE_ROW_FIELD_REFERENCE",
          "semantic",
          `Column '${column}' is referenced as an unresolved M name instead of a row field.`,
          `Use Record.FieldOrDefault(_, "${column}", null) or [${column}] inside the row expression.`,
          { line: lineIndex + 1, column: bare.index + 1, evidence: lineText.slice(Math.max(0, bare.index - 30), bare.index + column.length + 30).trim() },
        );
        break;
      }
    }

    for (const reference of referencedQueries(query)) {
      if (known.has(reference.toLowerCase())) continue;
      addIssue(
        issues,
        queryName,
        "blocking-error",
        "UNKNOWN_NAMED_QUERY",
        "semantic",
        `The generated query references missing query '${reference}'.`,
        "Backtrack the Qlik resident/source lineage and either generate the dependency or inline its valid transformation.",
        { evidence: reference },
      );
    }

    if (/QLIK2PBI MANUAL REVIEW/i.test(query)) {
      addIssue(
        issues,
        queryName,
        "blocking-error",
        "MANUAL_M_CONVERSION_REMAINS",
        "semantic",
        "The query still contains an unresolved manual-conversion marker.",
        "Resolve or exclude the unsupported Qlik operation before PBIP generation.",
      );
    }

    const preview = previews[queryName];
    const previewRowCount = preview?.outputRows?.length || 0;
    if (mQueries[queryName] && preview?.sourceRows?.length) {
      const directDependencies = referencedQueries(query).filter((reference) => Boolean(stagingQueries[reference]));
      const sourceDependencies = directDependencies.filter((reference) => /QLIK2PBI SOURCE MODE:/i.test(stagingQueries[reference] || ""));
      for (const reference of sourceDependencies) {
        const sourceQuery = stagingQueries[reference] || "";
        if (/QLIK2PBI SOURCE MODE:\s*external-connector/i.test(sourceQuery)) {
          addIssue(
            issues,
            queryName,
            "blocking-error",
            "UPLOADED_PREVIEW_NOT_BOUND_TO_M_SOURCE",
            "preview",
            `Uploaded rows are available for '${queryName}', but generated Power Query still points to an external connector query '${reference}'.`,
            "Bind the uploaded source file into the generated Source_* query or map an executable external source path before PBIP export.",
            { evidence: reference },
          );
        }
        if (/#table\s*\(\s*\{\s*\}\s*,\s*\{\s*\}\s*\)/i.test(sourceQuery)) {
          addIssue(
            issues,
            queryName,
            "blocking-error",
            "SOURCE_QUERY_RETURNS_EMPTY_PLACEHOLDER",
            "preview",
            `Source query '${reference}' falls back to an empty placeholder although uploaded source rows exist.`,
            "Regenerate the source query from the uploaded file and do not suppress source-read failures with #table({}, {}).",
            { evidence: reference },
          );
        }
      }
    }
    if (mQueries[queryName] && preview?.sourceRows?.length && previewRowCount === 0) {
      addIssue(
        issues,
        queryName,
        "blocking-error",
        "PREVIEW_OUTPUT_EMPTY",
        "preview",
        "Uploaded source rows are available, but the reconstructed output preview produced no rows.",
        "Review filters, joins, aliases and calculated columns before exporting the PBIP.",
      );
    } else if (mQueries[queryName] && !preview?.sourceRows?.length) {
      addIssue(
        issues,
        queryName,
        "warning",
        "PREVIEW_SOURCE_UNAVAILABLE",
        "preview",
        "No parseable uploaded source sample was available for local 10-row output validation.",
        "Provide CSV, TSV, JSON or INLINE sample data to validate the converted output before Power BI Desktop.",
      );
    }

    const blocking = issues.some((issue) => issue.severity === "blocking-error");
    const warning = issues.some((issue) => issue.severity === "warning");
    results[queryName] = {
      queryName,
      status: blocking ? "blocked" : warning ? "warning" : "passed",
      parserPassed,
      semanticPassed: !issues.some((issue) => issue.phase === "semantic" && issue.severity === "blocking-error"),
      previewRowCount,
      issues,
    };
  }

  const allIssues = Object.values(results).flatMap((result) => result.issues);
  const blockingCount = allIssues.filter((issue) => issue.severity === "blocking-error").length;
  const warningCount = allIssues.filter((issue) => issue.severity === "warning").length;
  return {
    engine: "microsoft-powerquery-parser+qlik2pbi-semantic-lint",
    generatedAt: new Date().toISOString(),
    passed: blockingCount === 0,
    blockingCount,
    warningCount,
    queries: results,
  };
}
