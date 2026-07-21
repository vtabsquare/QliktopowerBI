import type { PowerBiMeasure, PowerBiTable } from "./PowerBiModelTypes";

export interface MeasureNormalizationResult {
  tables: PowerBiTable[];
  removedDuplicateCount: number;
  renamedCount: number;
  idAliases: Record<string, string>;
}

function nameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function daxKey(value: string): string {
  return value
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "")
    .replace(/\[([^\]]+)\]/g, (_match, name: string) => `[${String(name).trim().toLocaleLowerCase()}]`)
    .toLocaleLowerCase();
}

function cleanName(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Measure";
}

function cleanFolderPart(value: string): string {
  return value.replace(/[\\/]+/g, " - ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "General";
}

export function defaultMeasureFolder(tableName: string, measure?: Partial<Pick<PowerBiMeasure, "displayFolder" | "status">>): string {
  const tablePart = cleanFolderPart(tableName);
  const status = measure?.status?.toLocaleLowerCase() || "";
  const fallbackGroup = /manual|warning|review/.test(status) ? "Review Required" : "Converted Measures";
  const rawFolder = measure?.displayFolder?.trim();
  if (!rawFolder) return `Qlik Measures\\${tablePart}\\${fallbackGroup}`;

  const parts = rawFolder
    .replace(/\//g, "\\")
    .split("\\")
    .map(cleanFolderPart)
    .filter(Boolean);
  if (parts[0]?.toLocaleLowerCase() === "qlik measures") parts.shift();
  if (parts[0]?.toLocaleLowerCase() === tablePart.toLocaleLowerCase()) parts.shift();
  return ["Qlik Measures", tablePart, ...(parts.length ? parts : [fallbackGroup])].join("\\");
}

function aggregateSafeName(originalName: string, expression: string): string {
  const base = cleanName(originalName);
  const dax = expression.trim();
  if (/^(?:CALCULATE\s*\(\s*)?SUMX?\s*\(/i.test(dax)) return /^total\s+/i.test(base) ? base : `Total ${base}`;
  if (/^(?:CALCULATE\s*\(\s*)?AVERAGEX?\s*\(/i.test(dax)) return /^average\s+/i.test(base) ? base : `Average ${base}`;
  if (/^(?:CALCULATE\s*\(\s*)?(?:DISTINCTCOUNT|COUNTROWS|COUNTX|COUNT)\s*\(/i.test(dax)) return /\bcount\b/i.test(base) ? base : `${base} Count`;
  if (/^(?:CALCULATE\s*\(\s*)?MINX?\s*\(/i.test(dax)) return /^minimum\s+/i.test(base) ? base : `Minimum ${base}`;
  if (/^(?:CALCULATE\s*\(\s*)?MAXX?\s*\(/i.test(dax)) return /^maximum\s+/i.test(base) ? base : `Maximum ${base}`;
  return /\bmeasure$/i.test(base) ? base : `${base} Measure`;
}

function nextUniqueName(baseName: string, tableName: string, used: Set<string>): string {
  const base = cleanName(baseName);
  if (!used.has(nameKey(base))) return base;
  const contextual = `${base} - ${cleanFolderPart(tableName)}`;
  if (!used.has(nameKey(contextual))) return contextual;
  let suffix = 2;
  while (used.has(nameKey(`${contextual} ${suffix}`))) suffix += 1;
  return `${contextual} ${suffix}`;
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function replaceMeasureReference(expression: string, oldName: string, newName: string): string {
  if (nameKey(oldName) === nameKey(newName)) return expression;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return expression.replace(new RegExp(`\\[${escaped}\\]`, "gi"), (match, offset: number, source: string) => {
    const previous = offset > 0 ? source[offset - 1] : "";
    // Keep table-qualified column references such as 'Sales'[Salary] or Sales[Salary].
    if (previous && /[A-Za-z0-9_']/u.test(previous)) return match;
    return `[${newName}]`;
  });
}

/**
 * Produces a Power BI-safe measure collection.
 *
 * Rules:
 * - Exact DAX duplicates are consolidated into one canonical measure.
 * - Measure names are unique across the complete semantic model.
 * - A measure never has the same name as a column in its home table.
 * - Every measure is assigned to a display folder.
 * - Source expression IDs from removed duplicates remain attached to the canonical measure.
 */
export function normalizeModelMeasures(inputTables: PowerBiTable[]): MeasureNormalizationResult {
  const tables: PowerBiTable[] = inputTables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => ({ ...column })),
    measures: table.measures.map((measure) => ({
      ...measure,
      sourceExpressionIds: uniqueValues([...(measure.sourceExpressionIds || []), measure.sourceExpressionId]),
    })),
  }));

  const idAliases: Record<string, string> = {};
  const byExpression = new Map<string, { table: PowerBiTable; measure: PowerBiMeasure }>();
  let removedDuplicateCount = 0;

  for (const table of tables) {
    const retained: PowerBiMeasure[] = [];
    for (const measure of table.measures) {
      // Preserve one DAX measure per Qlik variable name even when multiple
      // variables intentionally share the same scalar value or expression.
      // Ordinary visualization measures are still consolidated by DAX.
      const expressionKey = table.name === "Qlik Variables"
        ? `${daxKey(measure.expression)}|${nameKey(measure.name)}`
        : daxKey(measure.expression);
      if (expressionKey) {
        const canonical = byExpression.get(expressionKey);
        if (canonical) {
          canonical.measure.sourceExpressionIds = uniqueValues([
            ...(canonical.measure.sourceExpressionIds || []),
            canonical.measure.sourceExpressionId,
            ...(measure.sourceExpressionIds || []),
            measure.sourceExpressionId,
          ]);
          canonical.measure.description = canonical.measure.description || measure.description;
          canonical.measure.formatString = canonical.measure.formatString || measure.formatString;
          canonical.measure.displayFolder = canonical.measure.displayFolder || measure.displayFolder;
          idAliases[measure.id] = canonical.measure.id;
          removedDuplicateCount += 1;
          continue;
        }
      }
      retained.push(measure);
      if (expressionKey) byExpression.set(expressionKey, { table, measure });
    }
    table.measures = retained;
  }

  const allMeasures = tables.flatMap((table) => table.measures.map((measure) => ({ table, measure })));
  const originalNameCounts = new Map<string, number>();
  for (const { measure } of allMeasures) originalNameCounts.set(nameKey(measure.name), (originalNameCounts.get(nameKey(measure.name)) || 0) + 1);

  const usedMeasureNames = new Set<string>();
  const unambiguousRenames = new Map<string, string>();
  let renamedCount = 0;

  for (const { table, measure } of allMeasures) {
    const originalName = cleanName(measure.name);
    const columnNames = new Set(table.columns.map((column) => nameKey(column.name)));
    let candidate = columnNames.has(nameKey(originalName)) ? aggregateSafeName(originalName, measure.expression) : originalName;
    candidate = nextUniqueName(candidate, table.name, new Set([...usedMeasureNames, ...columnNames]));
    usedMeasureNames.add(nameKey(candidate));

    if (nameKey(candidate) !== nameKey(originalName)) {
      renamedCount += 1;
      if (originalNameCounts.get(nameKey(originalName)) === 1) unambiguousRenames.set(originalName, candidate);
    }

    measure.name = candidate;
    measure.homeTable = table.name;
    measure.displayFolder = defaultMeasureFolder(table.name, measure);
    measure.sourceExpressionIds = uniqueValues([...(measure.sourceExpressionIds || []), measure.sourceExpressionId]);
  }

  if (unambiguousRenames.size) {
    for (const table of tables) {
      for (const measure of table.measures) {
        let expression = measure.expression;
        for (const [oldName, newName] of unambiguousRenames) expression = replaceMeasureReference(expression, oldName, newName);
        measure.expression = expression;
      }
    }
  }

  return { tables, removedDuplicateCount, renamedCount, idAliases };
}
