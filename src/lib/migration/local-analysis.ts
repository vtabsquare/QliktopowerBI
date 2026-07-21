import { parseEtlQvs, parseSourceQvs, type EtlAnalysisResult } from "./qvs-parser";
import type {
  BusinessMetadata,
  ExecutionNode,
  FinalTable,
  Requirement,
  SourceTable,
  TechnicalMetadata,
} from "./types";

export interface LocalAnalysisResult {
  businessMetadata: BusinessMetadata;
  technicalMetadata: TechnicalMetadata;
  executionMetrics: {
    analysisConfidence: number;
    metadataCompleteness: number;
    warnings: string[];
    missingTablesCount: number;
    missingColumnsCount: number;
    activeEngineTier: "local-deterministic";
    fallbackReason?: string;
  };
}

interface ParserHints {
  srcTables?: SourceTable[];
  etlRes?: EtlAnalysisResult;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function collectRuleBookRules(ruleBookMd: string): string[] {
  return unique(
    ruleBookMd
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean),
  );
}

function sourceTableAsModelTable(source: SourceTable): FinalTable {
  const keys = source.columns
    .map((column) => column.name)
    .filter((name) => /(?:^id$|id$|key$|_key$)/i.test(name));

  return {
    id: `source_${source.id}`,
    name: source.name,
    type: "Dimension",
    sourceTables: [source.name],
    isFinal: true,
    steps: [],
    keys,
    lineage: [source.connectionPath],
    columns: source.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      derived: false,
      isKey: keys.includes(column.name),
    })),
    sourcePlatform: source.platform,
    sourceConnection: source.connectionName || source.connectionPath,
  };
}

function operationDetails(nodes: ExecutionNode[], operation: ExecutionNode["operation"]): Record<string, unknown>[] {
  return nodes
    .filter((node) => node.operation === operation)
    .map((node) => ({
      id: node.id,
      sequenceOrder: node.sequenceOrder,
      outputTable: node.outputTable,
      inputNodes: node.inputNodes,
      ...node.meta,
      rawExpression: node.rawExpression,
    }));
}

export function analyzeQvsScriptsLocally(
  requirement: Requirement,
  ruleBookMd: string,
  sourceQvsText: string,
  etlQvsText: string,
  parserHints?: ParserHints,
  fallbackReason?: string,
): LocalAnalysisResult {
  const srcTables = parserHints?.srcTables?.length
    ? parserHints.srcTables
    : parseSourceQvs(sourceQvsText) || [];
  const etlRes = parserHints?.etlRes || parseEtlQvs(etlQvsText, srcTables);
  const executionGraph = [...(etlRes.executionGraph || [])].sort(
    (left, right) => left.sequenceOrder - right.sequenceOrder,
  );

  const combinedScript = `${sourceQvsText}\n${etlQvsText}`;
  const finalTables = etlRes.finalTables || [];
  const allTables = etlRes.allTables?.length
    ? etlRes.allTables
    : finalTables.length
      ? finalTables
      : srcTables.map(sourceTableAsModelTable);

  const filters = allTables.flatMap((table) =>
    (table.steps || [])
      .filter((step) => Boolean(step.where))
      .map((step) => ({
        table: table.name,
        operation: step.kind,
        expression: step.where,
      })),
  );

  const lineageGraph = unique([
    ...executionGraph.map((node) => {
      const inputs = node.inputNodes.length ? node.inputNodes.join(", ") : "root";
      return `${inputs} -> ${node.outputTable} [${node.operation}]`;
    }),
    ...allTables.flatMap((table) =>
      (table.sourceTables || []).map((source) => `${source} -> ${table.name}`),
    ),
  ]);

  const technicalMetadata: TechnicalMetadata = {
    statementMetrics: {
      totalLoadStatements: countMatches(combinedScript, /\bLOAD\b/gi),
      totalJoinStatements: countMatches(combinedScript, /\b(?:LEFT|RIGHT|INNER|OUTER)?\s*JOIN\b/gi),
      totalResidentLoads: countMatches(combinedScript, /\bRESIDENT\b/gi),
      totalApplyMapCalls: countMatches(combinedScript, /\bAPPLYMAP\s*\(/gi),
    },
    executionOrder: unique(executionGraph.map((node) => node.outputTable)),
    lineageGraph,
    droppedTables: etlRes.droppedTables || [],
    joins: operationDetails(executionGraph, "JOIN"),
    residentLoads: operationDetails(executionGraph, "RESIDENT"),
    applyMaps: operationDetails(executionGraph, "APPLYMAP"),
    concatenateOperations: operationDetails(executionGraph, "CONCATENATE"),
    renameOperations: [
      ...operationDetails(executionGraph, "RENAME_TABLE"),
      ...operationDetails(executionGraph, "RENAME_FIELD"),
    ],
    filters,
    sourceTables: srcTables,
    finalTables,
    allTables,
    relationships: etlRes.relationships || [],
    variables: etlRes.variables || {},
    executionGraph,
    etlOperations: etlRes.etlOperations || [],
    sourcePlatform: srcTables.find((table) => table.platform !== "Unknown")?.platform,
  };

  const expectedColumns = unique(
    finalTables.flatMap((table) => table.columns.map((column) => column.name)),
  );
  const derivedRules = unique(
    allTables.flatMap((table) =>
      (table.steps || [])
        .filter((step) => Boolean(step.where || step.expression))
        .map((step) =>
          step.where
            ? `${table.name}: filter ${step.where}`
            : `${table.name}: ${step.kind} ${step.expression}`,
        ),
    ),
  );

  const businessMetadata: BusinessMetadata = {
    reportName: requirement.reportName?.trim() || "Qlik to Power BI Migration",
    businessObjective:
      requirement.businessObjective?.trim() || "Migrate the Qlik solution to Power BI.",
    businessRequirement:
      requirement.businessRequirement?.trim() ||
      "Preserve source, transformation, lineage and semantic-model logic.",
    expectedOutput:
      requirement.expectedOutput?.trim() || "A validated Power BI migration package.",
    businessRules: unique([...collectRuleBookRules(ruleBookMd), ...derivedRules]),
    expectedTables: srcTables.map((table) => table.name),
    expectedFinalTables: finalTables.map((table) => table.name),
    expectedColumns,
    generatedRuleBook: ruleBookMd,
    analysisConfidence: 0.9,
    expectedRelationships: etlRes.relationships || [],
  };

  const warnings: string[] = [];
  let missingTablesCount = 0;
  let missingColumnsCount = 0;

  if (srcTables.length === 0) {
    warnings.push("No source tables were identified by the deterministic source parser.");
    missingTablesCount += 1;
  }
  if (finalTables.length === 0) {
    warnings.push("No surviving final tables were identified by the deterministic ETL parser.");
    missingTablesCount += 1;
  }
  for (const table of finalTables) {
    if (!table.columns.length) {
      warnings.push(`Final table '${table.name}' has no parsed columns.`);
      missingColumnsCount += 1;
    }
  }
  if (fallbackReason) {
    warnings.push(`AI enrichment was unavailable; deterministic local analysis was used. ${fallbackReason}`);
  }

  const penalty = missingTablesCount * 0.15 + missingColumnsCount * 0.03;
  const executionMetrics: LocalAnalysisResult["executionMetrics"] = {
    analysisConfidence: Math.max(0.5, 0.9 - penalty),
    metadataCompleteness: Math.max(0.5, 1 - penalty),
    warnings,
    missingTablesCount,
    missingColumnsCount,
    activeEngineTier: "local-deterministic",
    fallbackReason,
  };

  return { businessMetadata, technicalMetadata, executionMetrics };
}

function stripCommentsPreservingLines(text: string): string {
  let output = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  let blockComment = false;
  let lineComment = false;

  while (index < text.length) {
    const current = text[index];
    const next = text[index + 1];

    if (blockComment) {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 2;
        blockComment = false;
        continue;
      }
      output += current === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (lineComment) {
      output += current === "\n" ? "\n" : " ";
      if (current === "\n") lineComment = false;
      index += 1;
      continue;
    }

    if (!quote && current === "/" && next === "*") {
      output += "  ";
      blockComment = true;
      index += 2;
      continue;
    }
    if (!quote && current === "/" && next === "/") {
      output += "  ";
      lineComment = true;
      index += 2;
      continue;
    }

    if ((current === "'" || current === '"') && text[index - 1] !== "\\") {
      if (quote === current) quote = null;
      else if (!quote) quote = current;
    }

    output += current;
    index += 1;
  }

  return output;
}

export function validateQvsScriptsLocally(
  files: { name: string; text?: string | null }[],
): { file: string; message: string }[] {
  const issues: { file: string; message: string }[] = [];

  for (const file of files) {
    const raw = file.text || "";
    if (!raw.trim()) continue;

    const text = stripCommentsPreservingLines(raw);
    const stack: { token: string; line: number }[] = [];
    const openerFor: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    let quote: "'" | '"' | null = null;
    let line = 1;

    for (let index = 0; index < text.length; index += 1) {
      const current = text[index];
      if (current === "\n") line += 1;

      if ((current === "'" || current === '"') && text[index - 1] !== "\\") {
        if (quote === current) quote = null;
        else if (!quote) quote = current;
        continue;
      }
      if (quote) continue;

      if (current === "(" || current === "[" || current === "{") {
        stack.push({ token: current, line });
      } else if (current === ")" || current === "]" || current === "}") {
        const expected = openerFor[current];
        const actual = stack.pop();
        if (!actual || actual.token !== expected) {
          issues.push({
            file: file.name,
            message: `Syntax error at line ${line}: unmatched '${current}'.`,
          });
          break;
        }
      }
    }

    if (quote) {
      issues.push({
        file: file.name,
        message: "Syntax error: unterminated quoted string.",
      });
    }
    if (stack.length) {
      const unclosed = stack[stack.length - 1];
      issues.push({
        file: file.name,
        message: `Syntax error at line ${unclosed.line}: unclosed '${unclosed.token}'.`,
      });
    }
  }

  return issues;
}
