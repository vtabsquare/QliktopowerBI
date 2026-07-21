import type { EnterpriseAnalysis } from "../enterprise-parser";
import type { PowerBiTable } from "../model/PowerBiModelTypes";
import { rewriteQlikColourFunctions } from "./DaxSafety";

export interface DaxDependencyRepair {
  table: string;
  resolvedTable?: string;
  measure: string;
  requestedColumn: string;
  resolvedColumn?: string;
  confidence: number;
  reason: string;
}

export interface DaxDependencyRepairResult {
  tables: PowerBiTable[];
  repairs: DaxDependencyRepair[];
  unresolved: DaxDependencyRepair[];
}

function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function simpleField(expression: string): string | null {
  const trimmed = expression.trim().replace(/^\[|\]$/g, "").replace(/^["']|["']$/g, "");
  return /^[A-Za-z_][A-Za-z0-9_.$#@ -]*$/.test(trimmed) ? trimmed : null;
}

function buildAliasMap(analysis?: EnterpriseAnalysis | null): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const operation of analysis?.operations || []) {
    const tableKey = nameKey(operation.table);
    if (!result.has(tableKey)) result.set(tableKey, new Map());
    const aliases = result.get(tableKey)!;
    for (const [alias, expression] of Object.entries(operation.fieldExpressions || {})) {
      const source = simpleField(expression);
      if (source) aliases.set(nameKey(alias), source);
    }
  }
  return result;
}

const SEMANTIC_PREFIXES = [
  "actual", "budget", "forecast", "planned", "plan", "current", "prior", "previous",
  "total", "net", "gross", "base", "source", "original", "selected", "calculated",
  "order", "ship", "stock", "fiscal", "calendar", "transaction",
];
const SEMANTIC_SUFFIXES = ["code", "id", "key", "name", "value", "number", "no", "amount"];

function prefixBase(value: string): string {
  let result = nameKey(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of SEMANTIC_PREFIXES) {
      if (result.startsWith(prefix) && result.length > prefix.length + 2) {
        result = result.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function semanticBase(value: string): string {
  let result = nameKey(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of SEMANTIC_PREFIXES) {
      if (result.startsWith(prefix) && result.length > prefix.length + 2) {
        result = result.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SEMANTIC_SUFFIXES) {
      if (result.endsWith(suffix) && result.length > suffix.length + 2) {
        result = result.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function levenshtein(left: string, right: string): number {
  const a = nameKey(left);
  const b = nameKey(right);
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j += 1) {
    let previous = rows[0];
    rows[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const before = rows[i];
      rows[i] = Math.min(
        rows[i] + 1,
        rows[i - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = before;
    }
  }
  return rows[a.length];
}

function candidateScore(
  requested: string,
  candidate: string,
  sourceName: string,
  aliasTarget?: string,
): { score: number; reason: string } {
  const requestedKey = nameKey(requested);
  const candidateKey = nameKey(candidate);
  const sourceKey = nameKey(sourceName);
  if (requestedKey === candidateKey || requestedKey === sourceKey) return { score: 100, reason: "Case-insensitive column match." };
  if (aliasTarget && (nameKey(aliasTarget) === candidateKey || nameKey(aliasTarget) === sourceKey)) return { score: 99, reason: "Qlik LOAD alias resolved to the physical Power BI column." };

  const requestedPrefixBase = prefixBase(requested);
  if (requestedPrefixBase && (requestedPrefixBase === candidateKey || requestedPrefixBase === sourceKey)) {
    return { score: 96, reason: `Semantic prefix was removed from '${requested}' to match '${candidate}'.` };
  }
  const requestedBase = semanticBase(requested);
  const candidateBase = semanticBase(candidate);
  const sourceBase = semanticBase(sourceName);
  if (requestedBase && (requestedBase === candidateKey || requestedBase === sourceKey)) {
    return { score: 96, reason: `Semantic prefix/suffix normalization matched '${requested}' to '${candidate}'.` };
  }
  if (requestedBase && (requestedBase === candidateBase || requestedBase === sourceBase)) {
    return { score: 91, reason: "Columns share the same business field after removing common Qlik prefixes and suffixes." };
  }
  if (requestedKey.endsWith(candidateKey) || candidateKey.endsWith(requestedKey)) {
    return { score: 84, reason: "One normalized column name is a suffix of the other." };
  }
  const distance = levenshtein(requestedKey, candidateKey);
  const similarity = 1 - distance / Math.max(1, requestedKey.length, candidateKey.length);
  if (similarity >= 0.88) return { score: Math.round(similarity * 90), reason: "High normalized-name similarity." };
  return { score: 0, reason: "No safe deterministic mapping." };
}

function replaceQualifiedReference(
  expression: string,
  rawMatch: string,
  tableName: string,
  columnName: string,
): string {
  const table = `'${tableName.replace(/'/g, "''")}'`;
  return expression.replace(rawMatch, `${table}[${columnName}]`);
}

function tableRelated(analysis: EnterpriseAnalysis | null | undefined, left: string, right: string): boolean {
  if (!analysis) return false;
  const l = nameKey(left);
  const r = nameKey(right);
  if (l === r) return true;
  const profile = Object.values(analysis.profiles || {}).find((item) => nameKey(item.table) === l);
  if (profile && [...profile.dependencies, ...profile.mappingDependencies, ...profile.inlineDependencies].some((item) => nameKey(item) === r)) return true;
  return (analysis.relationships || []).some((relationship) => {
    const pair = new Set([nameKey(relationship.fromTable), nameKey(relationship.toTable)]);
    return pair.has(l) && pair.has(r);
  });
}

function tableBaseName(tableName: string): string {
  return nameKey(tableName.replace(/^(dim|fact|tbl|ref)_?/i, "").replace(/s$/i, ""));
}

function columnNaturallyBelongsToTable(table: PowerBiTable, columnName: string): boolean {
  const base = tableBaseName(table.name);
  const column = nameKey(columnName);
  return Boolean(base && (column === `${base}id` || column === `${base}key` || column === `${base}code` || column.startsWith(base)));
}

function financeAmountFamilyScore(table: PowerBiTable, requestedColumn: string): number {
  if (!/(actual|budget|forecast|planned|plan).*amount/i.test(requestedColumn)) return 0;
  const names = new Set(table.columns.map((column) => nameKey(column.name)));
  const family = ["amount", "budgetamount", "forecastamount", "plannedamount", "planamount"].filter((name) => names.has(name));
  return family.length >= 2 ? 7 : 0;
}

function globalCandidates(
  tables: PowerBiTable[],
  requestedTableName: string,
  requestedColumn: string,
  homeTable: PowerBiTable,
  analysis?: EnterpriseAnalysis | null,
): Array<{ table: PowerBiTable; column: PowerBiTable["columns"][number]; score: number; reason: string }> {
  const aliases = buildAliasMap(analysis);
  const rows: Array<{ table: PowerBiTable; column: PowerBiTable["columns"][number]; score: number; reason: string }> = [];
  for (const table of tables) {
    const aliasTarget = aliases.get(nameKey(table.sourceName || table.name))?.get(nameKey(requestedColumn))
      || aliases.get(nameKey(table.name))?.get(nameKey(requestedColumn));
    for (const column of table.columns) {
      const base = candidateScore(requestedColumn, column.name, column.sourceName, aliasTarget);
      if (!base.score) continue;
      let score = base.score;
      const reasons = [base.reason];
      if (nameKey(table.name) === nameKey(homeTable.name)) { score += 7; reasons.push("Candidate is in the measure home table."); }
      if (tableRelated(analysis, requestedTableName, table.name)) { score += 5; reasons.push("Candidate table participates in the Qlik lineage/relationship path."); }
      if (nameKey(table.name) === nameKey(requestedTableName)) { score += 8; reasons.push("Candidate is in the originally referenced table."); }
      if (columnNaturallyBelongsToTable(table, requestedColumn)) { score += 9; reasons.push("The column name matches the candidate table's business entity."); }
      const familyBoost = financeAmountFamilyScore(table, requestedColumn);
      if (familyBoost) { score += familyBoost; reasons.push("Candidate belongs to a complete actual/budget/forecast amount family."); }
      if (/^actualamount$/i.test(nameKey(requestedColumn)) && nameKey(column.name) === "amount" && familyBoost) {
        score += 6;
        reasons.push("The unprefixed Amount column is the canonical actual amount in this finance field family.");
      }
      if (/calendar|date/i.test(table.name) && !/date|year|month|quarter|week|day/i.test(requestedColumn) && nameKey(table.name) !== nameKey(requestedTableName)) score -= 8;
      rows.push({ table, column, score, reason: reasons.join(" ") });
    }
  }
  return rows.sort((left, right) => right.score - left.score || left.table.name.localeCompare(right.table.name));
}

/**
 * Repairs qualified column references after the Power Query/model schema has
 * been finalized. The engine first searches the requested table, then performs
 * a controlled cross-table lineage search. Only unique, high-confidence
 * candidates are applied. Ambiguous dependencies remain blocking diagnostics.
 */
export function repairDaxDependencies(
  sourceTables: PowerBiTable[],
  analysis?: EnterpriseAnalysis | null,
): DaxDependencyRepairResult {
  const tables = sourceTables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => ({ ...column })),
    measures: table.measures.map((measure) => ({ ...measure })),
    hierarchies: table.hierarchies.map((hierarchy) => ({ ...hierarchy, levels: [...hierarchy.levels] })),
    warnings: [...table.warnings],
    sourceLineage: [...table.sourceLineage],
  }));
  const tableByName = new Map(tables.map((table) => [nameKey(table.name), table]));
  const aliases = buildAliasMap(analysis);
  const repairs: DaxDependencyRepair[] = [];
  const unresolved: DaxDependencyRepair[] = [];

  for (const homeTable of tables) {
    for (const measure of homeTable.measures) {
      let expression = rewriteQlikColourFunctions(measure.expression);
      const qualified = [...expression.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))\s*\[([^\]]+)\]/g)];
      for (const match of qualified) {
        const requestedTableName = (match[1] || match[2] || "").replace(/''/g, "'").trim();
        const requestedColumn = (match[3] || "").trim();
        const targetTable = tableByName.get(nameKey(requestedTableName));
        if (targetTable) {
          const exact = targetTable.columns.find((column) => [column.name, column.sourceName].some((value) => nameKey(value) === nameKey(requestedColumn)));
          if (exact) {
            // An existing column can still be semantically unusable when its
            // table is disconnected from the fact table used by the measure.
            // In that case, backtrack to a unique field in a referenced fact
            // table (for example Calendar[Year] -> Sales[OrderYear]).
            const referencedTableNames = [...expression.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))\s*\[[^\]]+\]/g)]
              .map((reference) => (reference[1] || reference[2] || "").replace(/''/g, "'").trim())
              .filter((name) => name && nameKey(name) !== nameKey(targetTable.name));
            const factTables = tables.filter((candidate) => referencedTableNames.some((name) => nameKey(name) === nameKey(candidate.name)) && ["fact", "bridge"].includes(candidate.kind));
            const disconnected = factTables.length > 0 && factTables.every((candidate) => !tableRelated(analysis, targetTable.name, candidate.name));
            if (disconnected) {
              const alternatives = factTables.flatMap((candidate) => candidate.columns.map((column) => ({
                table: candidate,
                column,
                ...candidateScore(requestedColumn, column.name, column.sourceName),
              }))).filter((candidate) => candidate.score >= 90)
                .sort((left, right) => right.score - left.score);
              const bestAlternative = alternatives[0];
              const runnerUpAlternative = alternatives[1];
              if (bestAlternative && (!runnerUpAlternative || bestAlternative.score - runnerUpAlternative.score >= 6)) {
                expression = replaceQualifiedReference(expression, match[0], bestAlternative.table.name, bestAlternative.column.name);
                repairs.push({ table: targetTable.name, resolvedTable: bestAlternative.table.name, measure: measure.name, requestedColumn, resolvedColumn: bestAlternative.column.name, confidence: bestAlternative.score, reason: "Disconnected-dimension lineage repair. The replacement field is in the fact table used by the measure." });
                continue;
              }
            }
            if (exact.name !== requestedColumn || targetTable.name !== requestedTableName) expression = replaceQualifiedReference(expression, match[0], targetTable.name, exact.name);
            continue;
          }

          const aliasTarget = aliases.get(nameKey(targetTable.sourceName || targetTable.name))?.get(nameKey(requestedColumn))
            || aliases.get(nameKey(targetTable.name))?.get(nameKey(requestedColumn));
          const scored = targetTable.columns
            .map((column) => ({ column, ...candidateScore(requestedColumn, column.name, column.sourceName, aliasTarget) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score);
          const best = scored[0];
          const runnerUp = scored[1];
          if (best && best.score >= 84 && (!runnerUp || best.score - runnerUp.score >= 5)) {
            expression = replaceQualifiedReference(expression, match[0], targetTable.name, best.column.name);
            repairs.push({ table: targetTable.name, resolvedTable: targetTable.name, measure: measure.name, requestedColumn, resolvedColumn: best.column.name, confidence: best.score, reason: best.reason });
            continue;
          }
        }

        const exactGlobal = tables.flatMap((table) => table.columns
          .filter((column) => [column.name, column.sourceName].some((value) => nameKey(value) === nameKey(requestedColumn)))
          .map((column) => ({ table, column })));
        let global = globalCandidates(tables, requestedTableName, requestedColumn, homeTable, analysis);
        // An exact physical column match in a single table is stronger than any
        // lower-scoring semantic alternative. If the exact name occurs in more
        // than one table, table/entity evidence is still used to disambiguate.
        if (exactGlobal.length === 1) {
          const exact = exactGlobal[0];
          global = [{ table: exact.table, column: exact.column, score: 120, reason: "Unique exact model-wide column match." }, ...global.filter((item) => item.table.id !== exact.table.id || item.column.id !== exact.column.id)];
        }
        const bestGlobal = global[0];
        const runnerUpGlobal = global[1];
        if (bestGlobal && bestGlobal.score >= 90 && (!runnerUpGlobal || bestGlobal.score - runnerUpGlobal.score >= 6)) {
          expression = replaceQualifiedReference(expression, match[0], bestGlobal.table.name, bestGlobal.column.name);
          repairs.push({
            table: requestedTableName,
            resolvedTable: bestGlobal.table.name,
            measure: measure.name,
            requestedColumn,
            resolvedColumn: bestGlobal.column.name,
            confidence: bestGlobal.score,
            reason: `Cross-table lineage repair. ${bestGlobal.reason}`,
          });
        } else {
          unresolved.push({
            table: requestedTableName,
            measure: measure.name,
            requestedColumn,
            confidence: bestGlobal?.score || 0,
            reason: bestGlobal
              ? "More than one table/column candidate was plausible, so no unsafe automatic replacement was made."
              : targetTable ? "No physical or calculated column matched the DAX reference." : "Referenced table is not exported and no unique lineage-equivalent column was found.",
          });
        }
      }
      measure.expression = expression;
      const measureUnresolved = unresolved.filter((item) => item.measure === measure.name && item.table);
      if (measureUnresolved.length) {
        measure.approved = false;
        measure.status = "missing-dependency";
        const note = `Unresolved DAX dependencies: ${measureUnresolved.map((item) => `${item.table}[${item.requestedColumn}]`).join(", ")}.`;
        measure.description = [measure.description, note].filter(Boolean).join(" ");
      } else if (measure.status === "missing-dependency") {
        measure.status = "converted";
        measure.approved = true;
        measure.description = String(measure.description || "").replace(/\s*Unresolved DAX dependencies:[^.]*\./g, "").trim();
      }
    }
  }

  return { tables, repairs, unresolved };
}
