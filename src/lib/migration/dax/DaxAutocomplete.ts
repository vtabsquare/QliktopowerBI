import type { EnterpriseAnalysis } from "../enterprise-parser";
import type { PowerBiModelState } from "../model";

export type DaxCompletionKind = "column" | "measure" | "variable" | "table";

export interface DaxCompletionItem {
  id: string;
  kind: DaxCompletionKind;
  name: string;
  table?: string;
  detail: string;
  insertText: string;
  searchText: string;
}

export interface DaxCompletionCatalog {
  tables: Array<{
    name: string;
    columns: string[];
    measures: string[];
  }>;
  variables: string[];
}

export interface DaxCompletionContext {
  start: number;
  end: number;
  query: string;
  mode: "qualified" | "bracket" | "word";
  table?: string;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function quoteTable(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

export function buildDaxCompletionCatalog(
  analysis: EnterpriseAnalysis,
  model?: PowerBiModelState | null,
): DaxCompletionCatalog {
  const tableMap = new Map<string, { name: string; columns: string[]; measures: string[] }>();

  for (const table of analysis.finalTables || []) {
    tableMap.set(table.table.toLowerCase(), {
      name: table.table,
      columns: unique(table.fields || []),
      measures: [],
    });
  }

  for (const table of model?.tables || []) {
    const existing = tableMap.get(table.name.toLowerCase());
    tableMap.set(table.name.toLowerCase(), {
      name: table.name,
      columns: unique([...(existing?.columns || []), ...table.columns.map((column) => column.name)]),
      measures: unique([...(existing?.measures || []), ...table.measures.map((measure) => measure.name)]),
    });
  }

  for (const measure of analysis.daxMeasures || []) {
    const tableName = measure.table || "Qlik Measures";
    const key = tableName.toLowerCase();
    const existing = tableMap.get(key) || { name: tableName, columns: [], measures: [] };
    existing.measures = unique([...existing.measures, measure.measureName]);
    tableMap.set(key, existing);
  }

  return {
    tables: [...tableMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    variables: unique(Object.keys(analysis.variables || {})).sort((left, right) => left.localeCompare(right)),
  };
}

export function getDaxCompletionContext(value: string, cursor: number): DaxCompletionContext | null {
  const before = value.slice(0, Math.max(0, cursor));

  const quotedQualified = before.match(/'((?:''|[^'])+)'\[\s*([A-Za-z0-9_.$#@-]*)$/);
  if (quotedQualified) {
    const query = quotedQualified[2] || "";
    return {
      start: cursor - query.length,
      end: cursor,
      query,
      mode: "qualified",
      table: quotedQualified[1].replace(/''/g, "'"),
    };
  }

  const plainQualified = before.match(/\b([A-Za-z_][A-Za-z0-9_ ]*)\[\s*([A-Za-z0-9_.$#@-]*)$/);
  if (plainQualified) {
    const query = plainQualified[2] || "";
    return {
      start: cursor - query.length,
      end: cursor,
      query,
      mode: "qualified",
      table: plainQualified[1].trim(),
    };
  }

  const bracket = before.match(/\[\s*([A-Za-z0-9_.$#@-]*)$/);
  if (bracket) {
    const query = bracket[1] || "";
    return { start: cursor - query.length, end: cursor, query, mode: "bracket" };
  }

  const word = before.match(/([A-Za-z_][A-Za-z0-9_.$#@-]*)$/);
  if (word) {
    const query = word[1] || "";
    return { start: cursor - query.length, end: cursor, query, mode: "word" };
  }

  return null;
}

function score(item: DaxCompletionItem, query: string): number {
  const name = item.name.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return item.kind === "column" ? 5 : item.kind === "measure" ? 4 : 3;
  if (name === normalizedQuery) return 100;
  if (name.startsWith(normalizedQuery)) return 80 - name.length / 100;
  if (name.includes(normalizedQuery)) return 40 - name.indexOf(normalizedQuery) / 100;
  return -1;
}

export function getDaxCompletions(
  value: string,
  cursor: number,
  catalog: DaxCompletionCatalog,
  limit = 16,
): { context: DaxCompletionContext | null; items: DaxCompletionItem[] } {
  const context = getDaxCompletionContext(value, cursor);
  if (!context) return { context: null, items: [] };

  const items: DaxCompletionItem[] = [];
  const pushColumn = (table: string, column: string, qualified: boolean) => {
    items.push({
      id: `column:${table}:${column}`,
      kind: "column",
      name: column,
      table,
      detail: `Column • ${table}`,
      insertText: qualified ? `${column}]` : `${quoteTable(table)}[${column}]`,
      searchText: `${column} ${table}`,
    });
  };
  const pushMeasure = (table: string, measure: string, bracketed: boolean) => {
    items.push({
      id: `measure:${table}:${measure}`,
      kind: "measure",
      name: measure,
      table,
      detail: `Measure • ${table}`,
      insertText: bracketed ? `${measure}]` : `[${measure}]`,
      searchText: `${measure} ${table}`,
    });
  };

  if (context.mode === "qualified") {
    const table = catalog.tables.find((candidate) => candidate.name.toLowerCase() === context.table?.toLowerCase());
    if (table) {
      table.columns.forEach((column) => pushColumn(table.name, column, true));
      table.measures.forEach((measure) => pushMeasure(table.name, measure, true));
    }
  } else if (context.mode === "bracket") {
    for (const table of catalog.tables) table.measures.forEach((measure) => pushMeasure(table.name, measure, true));
    for (const variable of catalog.variables) {
      items.push({ id: `variable:${variable}`, kind: "variable", name: variable, table: "Qlik Variables", detail: "Qlik variable measure", insertText: `${variable}]`, searchText: variable });
    }
  } else {
    for (const table of catalog.tables) {
      items.push({ id: `table:${table.name}`, kind: "table", name: table.name, detail: "Table", insertText: quoteTable(table.name), searchText: table.name });
      table.columns.forEach((column) => pushColumn(table.name, column, false));
      table.measures.forEach((measure) => pushMeasure(table.name, measure, false));
    }
    for (const variable of catalog.variables) {
      items.push({ id: `variable:${variable}`, kind: "variable", name: variable, table: "Qlik Variables", detail: "Qlik variable measure", insertText: `[${variable}]`, searchText: variable });
    }
  }

  return {
    context,
    items: items
      .map((item) => ({ item, score: score(item, context.query) }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score || left.item.kind.localeCompare(right.item.kind) || left.item.name.localeCompare(right.item.name))
      .slice(0, limit)
      .map((entry) => entry.item),
  };
}

export function applyDaxCompletion(
  value: string,
  context: DaxCompletionContext,
  item: DaxCompletionItem,
): { value: string; cursor: number } {
  const nextValue = `${value.slice(0, context.start)}${item.insertText}${value.slice(context.end)}`;
  return { value: nextValue, cursor: context.start + item.insertText.length };
}
