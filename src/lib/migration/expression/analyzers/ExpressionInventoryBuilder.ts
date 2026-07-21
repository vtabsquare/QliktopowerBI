import type { EnterpriseAnalysis } from "../../enterprise-parser";
import type { QvwAnalysis, QvwExpression, QvwVariable } from "../../qvw";
import { DaxTranslator, sanitizeMeasureName } from "../../dax";
import type {
  ExpressionArtifact,
  ExpressionArtifactType,
  ExpressionConversionStatus,
  ExpressionInventory,
  ExpressionInventoryMetrics,
  ExpressionIssue,
  ExpressionUsage,
} from "../core/ExpressionTypes";
import { expressionDepth } from "../core/ExpressionParser";

const PARSER_VERSION = "2.0.0";

function normalizeExpression(value: string): string {
  return value.replace(/^\s*=\s*/, "").replace(/\s+/g, " ").trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mapRole(expression: QvwExpression): string {
  switch (expression.role) {
    case "measure": return "measure";
    case "dimension": return "calculated-dimension";
    case "sort": return "sort-rule";
    case "color": return "conditional-formatting";
    case "visibility": return "visibility-rule";
    case "calculation-condition": return "visual-filter";
    default: return "measure";
  }
}

function artifactForRole(role: string, translated: ExpressionArtifactType, directField?: string | null, variableOnly = false, label = ""): ExpressionArtifactType {
  if (role === "conditional-formatting") return "conditional-formatting";
  if (role === "sort-rule") return "visual-filter";
  if (role === "visibility-rule" || role === "visual-filter") return "visual-filter";
  // A plain Qlik field dimension is a binding to an existing semantic-model
  // column. It must never be emitted as a calculated column on an arbitrary
  // home table, because expressions such as 'Sales'[Region] have no row
  // context when written into Calendar or another unrelated table.
  if (role === "calculated-dimension" && directField) return "existing-column";
  if (variableOnly || /dynamic\s*title|title\s*expression/i.test(label)) return "dynamic-title-measure";
  if (role === "calculated-dimension") return translated === "measure" ? "calculated-column" : translated;
  return translated;
}

function directFieldReference(value: string): string | null {
  const normalized = normalizeExpression(value)
    .replace(/^\s*=\s*/, "")
    .trim();
  const qualified = normalized.match(/^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))\s*\[([^\]]+)\]$/);
  if (qualified) return (qualified[3] || "").trim() || null;
  const bracketed = normalized.match(/^\[([^\]]+)\]$/);
  if (bracketed) return bracketed[1].trim() || null;
  if (/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(normalized)) return normalized.trim();
  return null;
}

function resolveFieldHomeTable(field: string, enterprise?: EnterpriseAnalysis | null): string {
  if (!enterprise) return "Measures";
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = Object.values(enterprise.profiles ?? {})
    .filter((profile) => profile.status === "generated" && profile.fields.some((item) => item.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized));
  if (!candidates.length) return homeTableFor({ fields: [field] } as QvwExpression, enterprise);

  // Prefer a reconstructed target table when the field was physically moved by
  // a Qlik JOIN. This keeps direct Qlik dimensions aligned with the denormalised
  // Power Query result and avoids binding the same attribute to both tables.
  const movedTargets = new Set((enterprise.reconstruction?.fieldLineage ?? [])
    .filter((item) => item.role === "expanded" && item.field.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized)
    .map((item) => item.targetTable));
  const moved = candidates.find((profile) => movedTargets.has(profile.table));
  if (moved) return moved.table;

  const fact = candidates.find((profile) => /fact|sales|order|transaction|ledger|finance|inventory|movement|event|detail/i.test(`${profile.table} ${profile.classification}`));
  return (fact ?? candidates[0]).table;
}

function statusToMigration(status: ExpressionConversionStatus) {
  if (status === "automatic" || status === "approved") return "auto-convertible" as const;
  if (status === "missing-dependency") return "missing-dependency" as const;
  if (status === "unsupported") return "unsupported" as const;
  if (status === "manual") return "manual-redesign" as const;
  return "review-required" as const;
}

function buildFieldMap(enterprise?: EnterpriseAnalysis | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!enterprise) return map;
  const tables = enterprise.semanticModel?.tables ?? [];
  for (const table of tables as Array<{ name?: string; columns?: Array<{ name?: string }> }>) {
    if (!table.name) continue;
    for (const column of table.columns ?? []) {
      if (!column.name) continue;
      map[column.name] ??= table.name;
      map[column.name.toLowerCase().replace(/[^a-z0-9]/g, "")] ??= table.name;
    }
  }
  for (const profile of Object.values(enterprise.profiles ?? {})) {
    for (const field of profile.fields ?? []) {
      map[field] ??= profile.table;
      map[field.toLowerCase().replace(/[^a-z0-9]/g, "")] ??= profile.table;
    }
  }
  return map;
}

function homeTableFor(expression: QvwExpression, enterprise?: EnterpriseAnalysis | null): string {
  const fieldMap = buildFieldMap(enterprise);
  const counts = new Map<string, number>();
  for (const field of expression.fields) {
    const table = fieldMap[field] || fieldMap[field.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (table) counts.set(table, (counts.get(table) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best || enterprise?.finalTables?.[0]?.table || Object.keys(enterprise?.mQueries ?? {})[0] || "Measures";
}

function variableContext(variables: QvwVariable[]) {
  return Object.fromEntries(variables.map((variable) => [variable.name, {
    definition: variable.definition,
    evaluatedValue: variable.evaluatedValue,
    isCalculated: variable.isCalculated,
    proposedPowerBiType: variable.proposedPowerBiType,
  }]));
}

function uniqueName(base: string, used: Set<string>, suffix: string): string {
  let name = sanitizeMeasureName(base, "Converted Measure");
  if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  const contextual = sanitizeMeasureName(`${name} - ${suffix}`);
  if (!used.has(contextual.toLowerCase())) { used.add(contextual.toLowerCase()); return contextual; }
  let index = 2;
  while (used.has(`${contextual} ${index}`.toLowerCase())) index++;
  name = `${contextual} ${index}`;
  used.add(name.toLowerCase());
  return name;
}

function expressionLabel(expression: QvwExpression, usage: ExpressionUsage): string {
  if (expression.label?.trim()) return expression.label.trim();
  if (usage.objectTitle) return `${usage.objectTitle} ${expression.role === "dimension" ? "Dimension" : "Measure"}`;
  return `${usage.objectId || "Document"} ${expression.role}`;
}

function staticVariableDax(definition: string): { dax: string; formatString?: string } {
  const raw = definition.trim().replace(/^=/, "").trim();
  if (!raw) return { dax: "BLANK()" };
  if (/^(true|false)$/i.test(raw)) return { dax: raw.toLowerCase() === "true" ? "TRUE()" : "FALSE()" };
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { dax: raw };
  const dateMatch = raw.replace(/^['"]|['"]$/g, "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    return {
      dax: `DATE(${Number(dateMatch[1])}, ${Number(dateMatch[2])}, ${Number(dateMatch[3])})`,
      formatString: "Short Date",
    };
  }
  const value = raw.replace(/^['"]|['"]$/g, "").replace(/"/g, '""');
  return { dax: `"${value}"` };
}

function addVariableArtifacts(
  qvw: QvwAnalysis,
  artifacts: ExpressionArtifact[],
  usedNames: Set<string>,
  enterprise?: EnterpriseAnalysis | null,
) {
  const translator = new DaxTranslator();
  const fieldMap = buildFieldMap(enterprise);
  const vars = variableContext(qvw.variables);

  for (const variable of qvw.variables) {
    const rawDefinition = variable.definition?.trim() || "";
    const isExpression = Boolean(
      variable.isCalculated ||
      /\$\(|\b(sum|count|avg|min|max|if|aggr|year|month|date|round|ceil|floor|rangesum)\s*\(/i.test(rawDefinition),
    );
    const id = `VAR-${stableHash(variable.name)}`;
    if (artifacts.some((item) => item.id === id)) continue;

    let result: ReturnType<DaxTranslator["translate"]> | undefined;
    let generatedDax = "BLANK()";
    let formatString: string | undefined;
    let status: ExpressionConversionStatus = "automatic";
    let confidence = 95;
    let issues: ExpressionIssue[] = [];
    let explanation = ["Qlik variable converted to a dedicated Power BI DAX measure."];
    let ast: ReturnType<DaxTranslator["translate"]>["ast"] | undefined;
    let referencedTables: string[] = [];
    let referencedFields: string[] = [];
    let referencedMeasures: string[] = [];

    if (!rawDefinition) {
      status = "missing-dependency";
      confidence = 20;
      issues = [{
        severity: "error",
        code: "VARIABLE_DEFINITION_MISSING",
        message: `Variable ${variable.name} is available in the QVW metadata, but its definition was not supplied.`,
        construct: variable.name,
        recommendation: "Include DocInternals.xml, AllProperties.xml and LoadScript.txt, then review the generated BLANK() measure.",
      }];
      explanation = ["A placeholder DAX measure was created so the variable remains visible and traceable."];
    } else if (isExpression) {
      result = translator.translate(rawDefinition, {
        homeTable: "Qlik Variables",
        fieldToTable: fieldMap,
        variables: vars,
      });
      generatedDax = result.dax || "BLANK()";
      status = result.status;
      confidence = result.confidence;
      issues = result.issues;
      explanation = [
        "Calculated Qlik variable converted to a reusable DAX measure.",
        ...result.explanation,
      ];
      ast = result.ast;
      referencedTables = result.referencedTables;
      referencedFields = result.referencedColumns;
      referencedMeasures = result.referencedMeasures;
    } else {
      const constant = staticVariableDax(rawDefinition);
      generatedDax = constant.dax;
      formatString = constant.formatString;
      explanation = ["Static Qlik variable converted to a scalar DAX measure."];
    }

    const now = new Date().toISOString();
    const name = uniqueName(variable.name, usedNames, "Qlik Variable");
    artifacts.push({
      id,
      sourceExpressionIds: [],
      documentId: qvw.document.documentId,
      label: variable.name,
      name,
      originalExpression: rawDefinition,
      normalizedExpression: normalizeExpression(rawDefinition),
      role: "parameter-expression",
      usages: [{ role: "variable" }],
      ast,
      astJson: ast ? JSON.stringify(ast, null, 2) : undefined,
      referencedTables,
      referencedFields,
      referencedVariables: variable.references,
      referencedMeasures,
      functions: [],
      hasSetAnalysis: /\{</.test(rawDefinition),
      hasAggr: /\bAggr\s*\(/i.test(rawDefinition),
      hasInterRecordFunctions: /\b(Above|Below|Before|After|RowNo|ColumnNo)\s*\(/i.test(rawDefinition),
      nestedDepth: ast ? expressionDepth(ast) : 0,
      artifactType: "measure",
      generatedDax,
      homeTable: "Qlik Variables",
      displayFolder: `Qlik Variables\\${!rawDefinition ? "Missing Definition" : isExpression ? "Calculated" : "Static"}`,
      formatString,
      description: `Converted from Qlik variable ${variable.name}. Original definition: ${rawDefinition || "not supplied"}.`,
      confidence,
      status,
      migrationStatus: statusToMigration(status),
      issues,
      explanation,
      approved: status === "automatic" && confidence >= 90,
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function calculateExpressionMetrics(artifacts: ExpressionArtifact[]): ExpressionInventoryMetrics {
  return {
    total: artifacts.length,
    automatic: artifacts.filter((x) => x.status === "automatic").length,
    warning: artifacts.filter((x) => x.status === "warning").length,
    manual: artifacts.filter((x) => x.status === "manual").length,
    unsupported: artifacts.filter((x) => x.status === "unsupported").length,
    missingDependency: artifacts.filter((x) => x.status === "missing-dependency").length,
    approved: artifacts.filter((x) => x.approved).length,
    measures: artifacts.filter((x) => ["measure", "dynamic-title-measure"].includes(x.artifactType)).length,
    calculatedColumns: artifacts.filter((x) => x.artifactType === "calculated-column").length,
    parameters: artifacts.filter((x) => ["what-if-parameter", "field-parameter", "disconnected-parameter-table"].includes(x.artifactType)).length,
    formattingRules: artifacts.filter((x) => ["conditional-formatting", "dynamic-format-string"].includes(x.artifactType)).length,
  };
}

export function buildExpressionInventory(qvw: QvwAnalysis, enterprise?: EnterpriseAnalysis | null): ExpressionInventory {
  const translator = new DaxTranslator();
  const fieldMap = buildFieldMap(enterprise);
  const variables = variableContext(qvw.variables);
  const byKey = new Map<string, { expression: QvwExpression; usages: ExpressionUsage[]; ids: string[] }>();
  for (const expression of qvw.expressions) {
    const object = qvw.objects.find((item) => item.id === expression.objectId);
    const sheet = qvw.sheets.find((item) => item.id === expression.sheetId || item.id === object?.sheetId);
    const usage: ExpressionUsage = {
      sheetId: sheet?.id,
      sheetName: sheet?.name,
      objectId: object?.id ?? expression.objectId,
      objectTitle: object?.title,
      objectType: object?.type,
      role: mapRole(expression),
    };
    const key = `${mapRole(expression)}|${normalizeExpression(expression.expression).toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) { existing.usages.push(usage); existing.ids.push(expression.id); }
    else byKey.set(key, { expression, usages: [usage], ids: [expression.id] });
  }

  const usedNames = new Set<string>();
  const artifacts: ExpressionArtifact[] = [];
  for (const { expression, usages, ids } of byKey.values()) {
    const role = mapRole(expression);
    const directField = role === "calculated-dimension" ? directFieldReference(expression.expression) : null;
    const usage = usages[0];
    const label = expressionLabel(expression, usage);
    const variableOnly = expression.variables.length > 0 && expression.fields.length === 0;
    const homeTable = directField ? resolveFieldHomeTable(directField, enterprise) : variableOnly ? "Qlik Variables" : homeTableFor(expression, enterprise);
    const result = translator.translate(expression.expression, { homeTable, fieldToTable: fieldMap, variables });
    const artifactType = artifactForRole(role, result.artifactType, directField, variableOnly, label);
    const name = uniqueName(label, usedNames, usage.sheetName || usage.objectId || "Qlik");
    const now = new Date().toISOString();
    const issues = [...result.issues];
    for (const variable of expression.variables.filter((name) => !qvw.variables.some((item) => item.name === name))) {
      issues.push({ severity: "error", code: "MISSING_VARIABLE", message: `Variable ${variable} is not defined in the uploaded package.`, construct: variable, recommendation: "Upload the complete load script and PRJ files or map this variable manually." });
    }
    const status: ExpressionConversionStatus = issues.some((i) => i.code === "MISSING_VARIABLE" || i.code === "VARIABLE_DEFINITION_MISSING") ? "missing-dependency" : result.status;
    artifacts.push({
      id: `EXP-${stableHash(`${role}|${normalizeExpression(expression.expression)}`)}`,
      sourceExpressionIds: ids,
      documentId: qvw.document.documentId,
      label,
      name,
      originalExpression: expression.expression,
      normalizedExpression: normalizeExpression(expression.expression),
      role,
      usages,
      ast: result.ast,
      astJson: result.ast ? JSON.stringify(result.ast, null, 2) : undefined,
      referencedTables: directField ? [homeTable] : result.referencedTables,
      referencedFields: Array.from(new Set([...(directField ? [directField] : []), ...expression.fields, ...result.referencedColumns])),
      referencedVariables: expression.variables,
      referencedMeasures: result.referencedMeasures,
      functions: expression.functions,
      hasSetAnalysis: expression.setAnalysisDetected,
      hasAggr: expression.aggrDetected,
      hasInterRecordFunctions: /\b(Above|Below|Before|After|RowNo|ColumnNo|RangeSum)\s*\(/i.test(expression.expression),
      nestedDepth: result.ast ? expressionDepth(result.ast) : 0,
      artifactType,
      generatedDax: directField ? `'${homeTable.replace(/'/g, "''")}'[${directField}]` : result.dax,
      homeTable,
      displayFolder: usage.sheetName ? `QVW/${usage.sheetName}` : "QVW Expressions",
      formatString: undefined,
      description: `Migrated from ${usage.sheetName || "QlikView"}${usage.objectId ? ` object ${usage.objectId}` : ""}. Original role: ${role}.`,
      confidence: result.confidence,
      status: directField ? "automatic" : status,
      migrationStatus: statusToMigration(directField ? "automatic" : status),
      issues: directField ? [] : issues,
      explanation: directField
        ? [`Direct Qlik dimension mapped to existing column ${homeTable}[${directField}]. No calculated column is created.`]
        : result.explanation,
      approved: directField ? true : status === "automatic" && result.confidence >= 90,
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  addVariableArtifacts(qvw, artifacts, usedNames, enterprise);
  const diagnostics = artifacts.flatMap((artifact) => artifact.issues.map((issue) => ({ ...issue, message: `${artifact.name}: ${issue.message}` })));
  return { generatedAt: new Date().toISOString(), parserVersion: PARSER_VERSION, artifacts, metrics: calculateExpressionMetrics(artifacts), diagnostics };
}

export function mergeExpressionInventory(generated: ExpressionInventory, previous?: ExpressionInventory | null): ExpressionInventory {
  if (!previous) return generated;
  const prior = new Map(previous.artifacts.map((item) => [item.id, item]));
  const artifacts = generated.artifacts.map((item) => {
    const old = prior.get(item.id);
    if (!old) return item;
    return {
      ...item,
      name: old.name,
      // Generated structural corrections are authoritative. A previously saved
      // calculated-column classification must not resurrect invalid row-context
      // DAX for direct fields or variable-driven titles.
      artifactType: ["existing-column", "dynamic-title-measure"].includes(item.artifactType) ? item.artifactType : old.artifactType,
      editedDax: old.editedDax,
      homeTable: ["existing-column", "dynamic-title-measure"].includes(item.artifactType) ? item.homeTable : old.homeTable,
      displayFolder: old.displayFolder,
      formatString: old.formatString,
      description: old.description,
      status: old.status,
      approved: old.approved,
      excludedReason: old.excludedReason,
      userEdited: old.userEdited,
      updatedAt: old.updatedAt,
    };
  });
  return { ...generated, artifacts, metrics: calculateExpressionMetrics(artifacts) };
}
