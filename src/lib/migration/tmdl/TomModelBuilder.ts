import type { DaxMeasure, EnterpriseAnalysis } from "../enterprise-parser";
import { applyReviewedTypesToMQuery } from "../enterprise-parser";
import type { ExpressionInventory } from "../expression";
import type { PowerBiModelState, PowerBiTable } from "../model";
import type { QvwAnalysis } from "../qvw";
import { defaultMeasureFolder } from "../model/MeasureNormalization";
import { validateRelationship } from "../model/ModelValidationEngine";
import { rewriteQlikColourFunctions } from "../dax/DaxSafety";
import type {
  TomAnnotation,
  TomColumn,
  TomDatabaseSpec,
  TomMeasure,
  TomRelationship,
  TomTable,
} from "./TomModelTypes";
import { mapSummarizeBy, mapTomDataType, normalizeExpression, stableGuid } from "./TmdlUtils";

export interface TomModelBuildEnhancements {
  expressionInventory?: ExpressionInventory | null;
  powerBiModel?: PowerBiModelState | null;
  qvwAnalysis?: QvwAnalysis | null;
  daxMeasures?: DaxMeasure[] | null;
}

function modelTableByName(model: PowerBiModelState | null | undefined, name: string): PowerBiTable | undefined {
  return model?.tables.find((table) => table.name === name || table.sourceName === name || table.queryName === name);
}

function annotations(values: Array<[string, unknown]>): TomAnnotation[] {
  return values
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => ({ name, value: typeof value === "string" ? value : JSON.stringify(value) }));
}

function buildColumns(analysis: EnterpriseAnalysis, sourceName: string, modelTable?: PowerBiTable): TomColumn[] {
  const semanticTable = (analysis.semanticModel?.tables || []).find((table: any) => table.name === sourceName) as any;
  const typeMap = analysis.columnTypes?.[sourceName] || {};
  const profile = analysis.profiles?.[sourceName];
  const columnsSource = modelTable?.columns.length
    ? modelTable.columns
    : semanticTable?.columns?.length
      ? semanticTable.columns.map((column: any) => ({
          id: column.id || column.name,
          name: column.name,
          sourceName: column.sourceColumn || column.name,
          dataType: column.data_type || column.dataType || "string",
          hidden: Boolean(column.hidden),
          isKey: Boolean(column.isKey),
          expression: column.expression,
          formatString: column.formatString,
          sortByColumn: column.sortByColumn,
          dataCategory: column.dataCategory,
        }))
      : Object.keys(typeMap).length
        ? Object.keys(typeMap).map((name) => ({ id: name, name, sourceName: name, dataType: typeMap[name], hidden: false, isKey: false }))
        : (profile?.fields || ["Column1"]).map((name) => ({ id: name, name, sourceName: name, dataType: "string", hidden: false, isKey: false }));

  const seen = new Set<string>();
  return columnsSource.flatMap((column: any): TomColumn[] => {
    const name = String(column.name || column.sourceName || "Column").trim() || "Column";
    const key = name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const dataType = mapTomDataType(typeMap[column.sourceName] || typeMap[name] || column.dataType || column.data_type);
    const base = {
      id: String(column.id || `${sourceName}.${name}`),
      name,
      dataType,
      isHidden: Boolean(column.hidden),
      isKey: Boolean(column.isKey),
      summarizeBy: mapSummarizeBy(column.defaultSummarization, dataType),
      formatString: column.formatString,
      dataCategory: column.dataCategory,
      sortByColumn: column.sortByColumn,
      lineageTag: stableGuid(`column:${sourceName}:${column.id || name}`),
      annotations: annotations([
        ["Qlik.SourceExpressionId", column.sourceExpressionId],
        ["Qlik.SourceColumn", column.sourceName || name],
      ]),
    };
    if (typeof column.expression === "string" && column.expression.trim()) {
      return [{ ...base, kind: "calculated", expression: column.expression.trim() }];
    }
    return [{ ...base, kind: "data", sourceColumn: String(column.sourceName || name) }];
  });
}

function exportableMeasure(measure: { expression: string; approved?: boolean; status?: string }): boolean {
  const expression = measure.expression?.trim() || "";
  if (!expression) return false;
  if (/Manual conversion required|FUNCTION_NOT_MAPPED|\bPLACEHOLDER\b|The end of the input/i.test(expression)) return false;
  const status = String(measure.status || "").toLowerCase();
  if (!measure.approved && ["manual", "unsupported", "missing-dependency", "excluded"].includes(status)) return false;
  return true;
}

function buildMeasures(analysis: EnterpriseAnalysis, sourceName: string, modelTable?: PowerBiTable): TomMeasure[] {
  const seen = new Set<string>();
  const measures: TomMeasure[] = [];
  for (const measure of modelTable?.measures || []) {
    if (!exportableMeasure(measure)) continue;
    const name = measure.name.trim();
    if (!name || !measure.expression.trim() || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    measures.push({
      id: measure.id,
      name,
      expression: rewriteQlikColourFunctions(measure.expression.trim()),
      formatString: measure.formatString,
      displayFolder: defaultMeasureFolder(modelTable?.name || sourceName, measure),
      description: measure.description,
      isHidden: Boolean(measure.hidden),
      lineageTag: stableGuid(`measure:${modelTable?.id || sourceName}:${measure.id}`),
      annotations: annotations([
        ["Qlik.SourceExpressionId", measure.sourceExpressionId],
        ["Qlik.SourceExpressionIds", measure.sourceExpressionIds],
        ["Qlik.OriginalExpression", measure.originalExpression],
        ["Qlik.MigrationStatus", measure.status],
        ["Qlik.UserApproved", String(measure.approved)],
      ]),
    });
  }
  if (!measures.length) {
    for (const measure of (analysis.daxMeasures || []).filter((item) => item.table === sourceName && !/manual|placeholder|function_not_mapped/i.test(`${item.warning || ""} ${item.dax || ""}`))) {
      const name = measure.measureName.trim();
      if (!name || !measure.dax?.trim() || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      measures.push({
        id: `enterprise:${sourceName}:${name}`,
        name,
        expression: rewriteQlikColourFunctions(measure.dax.trim()),
        displayFolder: defaultMeasureFolder(sourceName, { status: measure.warning ? "warning" : "automatic" }),
        lineageTag: stableGuid(`enterprise-measure:${sourceName}:${name}`),
        annotations: annotations([
          ["Qlik.OriginalExpression", measure.qlikExpression],
          ["Qlik.MigrationStatus", measure.warning ? "warning" : "automatic"],
          ["Qlik.MeasureKind", measure.source.startsWith("VAR-") ? "variable" : "measure"],
          ["Qlik.SourceExpressionId", measure.source],
        ]),
      });
    }
  }
  return measures;
}

function buildImportedTable(analysis: EnterpriseAnalysis, sourceName: string, model?: PowerBiModelState | null): TomTable {
  const modelTable = modelTableByName(model, sourceName);
  const profile = analysis.profiles?.[sourceName];
  const tableName = modelTable?.name || sourceName;
  const reviewedMQuery = applyReviewedTypesToMQuery(
    analysis.mQueries?.[sourceName] || `let\n    Source = #table({}, {})\nin\n    Source`,
    analysis.columnTypes?.[sourceName] || {},
  );
  const mExpression = normalizeExpression(
    reviewedMQuery,
    `let\n    Source = #table({}, {})\nin\n    Source`,
  );
  return {
    id: modelTable?.id || `table:${sourceName}`,
    name: tableName,
    description: modelTable?.description,
    isHidden: Boolean(modelTable?.hidden),
    lineageTag: stableGuid(`table:${modelTable?.id || sourceName}`),
    columns: buildColumns(analysis, sourceName, modelTable),
    measures: buildMeasures(analysis, sourceName, modelTable),
    hierarchies: (modelTable?.hierarchies || []).map((hierarchy) => ({
      id: hierarchy.id,
      name: hierarchy.name,
      lineageTag: stableGuid(`hierarchy:${modelTable?.id}:${hierarchy.id}`),
      levels: hierarchy.levels.map((column, index) => ({
        name: column,
        column,
        ordinal: index,
        lineageTag: stableGuid(`level:${modelTable?.id}:${hierarchy.id}:${column}:${index}`),
      })),
    })),
    partitions: [{
      id: `partition:${modelTable?.id || sourceName}`,
      name: `${tableName}-partition`,
      mode: "import",
      sourceType: "m",
      expression: mExpression,
      annotations: annotations([["Qlik.QueryName", modelTable?.queryName || sourceName]]),
    }],
    annotations: annotations([
      ["Qlik.SourceTable", modelTable?.sourceName || sourceName],
      ["Qlik.TableKind", modelTable?.kind || "unknown"],
      ["Qlik.SourceLineage", modelTable?.sourceLineage || profile?.sourceRefs || []],
    ]),
  };
}

function buildGeneratedTable(table: PowerBiTable): TomTable {
  const columns: TomColumn[] = table.columns.map((column) => {
    const dataType = mapTomDataType(column.dataType);
    const base = {
      id: column.id,
      name: column.name,
      dataType,
      isHidden: Boolean(column.hidden),
      isKey: Boolean(column.isKey),
      summarizeBy: mapSummarizeBy(column.defaultSummarization, dataType),
      formatString: column.formatString,
      dataCategory: column.dataCategory,
      sortByColumn: column.sortByColumn,
      lineageTag: stableGuid(`column:${table.id}:${column.id}`),
      annotations: annotations([["Qlik.SourceExpressionId", column.sourceExpressionId]]),
    };
    if (column.expression?.trim()) return { ...base, kind: "calculated", expression: column.expression.trim() };
    return { ...base, kind: "data", sourceColumn: column.sourceName || column.name };
  });
  const isMeasureHost = table.kind === "disconnected" && !table.calculatedExpression;
  const partitionExpression = isMeasureHost
    ? 'let\n    Source = #table(type table [_MeasureHost = Int64.Type], {{1}})\nin\n    Source'
    : normalizeExpression(table.calculatedExpression, "{ BLANK() }");
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    isHidden: Boolean(table.hidden),
    lineageTag: stableGuid(`table:${table.id}`),
    columns,
    measures: table.measures.filter((measure) => exportableMeasure(measure)).map((measure) => ({
      id: measure.id,
      name: measure.name,
      expression: rewriteQlikColourFunctions(measure.expression.trim()),
      formatString: measure.formatString,
      displayFolder: defaultMeasureFolder(table.name, measure),
      description: measure.description,
      isHidden: Boolean(measure.hidden),
      lineageTag: stableGuid(`measure:${table.id}:${measure.id}`),
      annotations: annotations([
        ["Qlik.SourceExpressionId", measure.sourceExpressionId],
        ["Qlik.SourceExpressionIds", measure.sourceExpressionIds],
        ["Qlik.OriginalExpression", measure.originalExpression],
        ["Qlik.MigrationStatus", measure.status],
        ["Qlik.UserApproved", String(measure.approved)],
      ]),
    })),
    hierarchies: table.hierarchies.map((hierarchy) => ({
      id: hierarchy.id,
      name: hierarchy.name,
      lineageTag: stableGuid(`hierarchy:${table.id}:${hierarchy.id}`),
      levels: hierarchy.levels.map((column, index) => ({
        name: column,
        column,
        ordinal: index,
        lineageTag: stableGuid(`level:${table.id}:${hierarchy.id}:${column}:${index}`),
      })),
    })),
    partitions: [{
      id: `partition:${table.id}`,
      name: `${table.name}-partition`,
      mode: "import",
      sourceType: isMeasureHost ? "m" : "calculated",
      expression: partitionExpression,
    }],
    annotations: annotations([
      ["Qlik.TableKind", table.kind],
      ["Qlik.GeneratedArtifact", "true"],
      ["Qlik.SourceLineage", table.sourceLineage],
    ]),
  };
}


function semanticBaseName(value: string): string {
  let result = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const prefixes = ["actual", "budget", "forecast", "planned", "plan", "current", "prior", "previous", "total", "net", "gross", "base", "source", "original"];
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (result.startsWith(prefix) && result.length > prefix.length + 2) {
        result = result.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function repairTomDaxDependencies(tables: TomTable[]): TomTable[] {
  const byName = new Map(tables.map((table) => [tomNameKey(table.name), table]));
  return tables.map((table) => ({
    ...table,
    measures: table.measures.map((measure) => {
      let expression = rewriteQlikColourFunctions(measure.expression);
      for (const match of [...expression.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))\s*\[([^\]]+)\]/g)]) {
        const tableName = (match[1] || match[2] || "").replace(/''/g, "'").trim();
        const objectName = (match[3] || "").trim();
        // If the referenced table is missing and it's a calendar-type table, replace with BLANK()
        const referencedTable = byName.get(tomNameKey(tableName));
        if (!referencedTable) {
          if (/calendar|date/i.test(tableName)) {
            expression = expression.replace(match[0], `BLANK() /* ${match[0]} - Add Date table in Power BI */`);
          }
          continue;
        }
        const exact = [...referencedTable.columns, ...referencedTable.measures]
          .find((item) => tomNameKey(item.name) === tomNameKey(objectName));
        if (exact) {
          if (exact.name !== objectName || referencedTable.name !== tableName) {
            expression = expression.replace(match[0], `'${referencedTable.name.replace(/'/g, "''")}'[${exact.name}]`);
          }
          continue;
        }
        const requestedBase = semanticBaseName(objectName);
        const candidates = referencedTable.columns.filter((column) => semanticBaseName(column.name) === requestedBase);
        if (candidates.length === 1) {
          expression = expression.replace(match[0], `'${referencedTable.name.replace(/'/g, "''")}'[${candidates[0].name}]`);
        }
      }
      return { ...measure, expression };
    }),
  }));
}

function tomNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function tomDaxKey(value: string): string {
  return value.replace(/\/\/.*$/gm, "").replace(/\s+/g, "").toLocaleLowerCase();
}

function tomSafeMeasureName(name: string, expression: string, table: TomTable, used: Set<string>): string {
  const clean = name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Measure";
  const columnCollision = table.columns.some((column) => tomNameKey(column.name) === tomNameKey(clean));
  let candidate = clean;
  if (columnCollision) {
    if (/^(?:CALCULATE\s*\(\s*)?SUMX?\s*\(/i.test(expression)) candidate = /^total\s+/i.test(clean) ? clean : `Total ${clean}`;
    else if (/^(?:CALCULATE\s*\(\s*)?AVERAGEX?\s*\(/i.test(expression)) candidate = /^average\s+/i.test(clean) ? clean : `Average ${clean}`;
    else if (/^(?:CALCULATE\s*\(\s*)?(?:DISTINCTCOUNT|COUNTROWS|COUNTX|COUNT)\s*\(/i.test(expression)) candidate = /\bcount\b/i.test(clean) ? clean : `${clean} Count`;
    else candidate = /\bmeasure$/i.test(clean) ? clean : `${clean} Measure`;
  }
  if (!used.has(tomNameKey(candidate))) return candidate;
  const contextual = `${candidate} - ${table.name}`;
  if (!used.has(tomNameKey(contextual))) return contextual;
  let suffix = 2;
  while (used.has(tomNameKey(`${contextual} ${suffix}`))) suffix += 1;
  return `${contextual} ${suffix}`;
}

function replaceTomMeasureReference(expression: string, oldName: string, newName: string): string {
  if (tomNameKey(oldName) === tomNameKey(newName)) return expression;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return expression.replace(new RegExp(`\\[${escaped}\\]`, "gi"), (match, offset: number, source: string) => {
    const previous = offset > 0 ? source[offset - 1] : "";
    return previous && /[A-Za-z0-9_']/u.test(previous) ? match : `[${newName}]`;
  });
}

function annotationValue(measure: TomMeasure, name: string): string | undefined {
  return measure.annotations?.find((annotation) => annotation.name === name)?.value;
}

function normalizeTomMeasures(tables: TomTable[]): TomTable[] {
  const cloned = tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => ({ ...column })),
    measures: table.measures.map((measure) => ({ ...measure, annotations: [...(measure.annotations || [])] })),
    hierarchies: table.hierarchies.map((hierarchy) => ({ ...hierarchy, levels: hierarchy.levels.map((level) => ({ ...level })) })),
    partitions: table.partitions.map((partition) => ({ ...partition })),
  }));

  const byExpression = new Map<string, TomMeasure>();
  for (const table of cloned) {
    table.measures = table.measures.filter((measure) => {
      const isVariable = table.name === "Qlik Variables" || annotationValue(measure, "Qlik.MeasureKind") === "variable";
      if (isVariable) return true;
      const expressionKey = tomDaxKey(measure.expression);
      if (!expressionKey) return true;
      const canonical = byExpression.get(expressionKey);
      if (!canonical) {
        byExpression.set(expressionKey, measure);
        return true;
      }
      const sourceIds = [annotationValue(canonical, "Qlik.SourceExpressionIds"), annotationValue(canonical, "Qlik.SourceExpressionId"), annotationValue(measure, "Qlik.SourceExpressionIds"), annotationValue(measure, "Qlik.SourceExpressionId")]
        .filter(Boolean)
        .flatMap((value) => {
          try { const parsed = JSON.parse(value as string); return Array.isArray(parsed) ? parsed : [value as string]; }
          catch { return [value as string]; }
        });
      const merged = [...new Set(sourceIds)];
      canonical.annotations = (canonical.annotations || []).filter((annotation) => annotation.name !== "Qlik.SourceExpressionIds");
      if (merged.length) canonical.annotations.push({ name: "Qlik.SourceExpressionIds", value: JSON.stringify(merged) });
      return false;
    });
  }

  const allMeasures = cloned.flatMap((table) => table.measures.map((measure) => ({ table, measure })));
  const originalNameCounts = new Map<string, number>();
  for (const { measure } of allMeasures) originalNameCounts.set(tomNameKey(measure.name), (originalNameCounts.get(tomNameKey(measure.name)) || 0) + 1);

  const usedNames = new Set<string>();
  const renameMap = new Map<string, string>();
  for (const { table, measure } of allMeasures) {
    const original = measure.name.trim() || "Measure";
    const unavailableNames = new Set([...usedNames, ...table.columns.map((column) => tomNameKey(column.name))]);
    const name = tomSafeMeasureName(original, measure.expression, table, unavailableNames);
    usedNames.add(tomNameKey(name));
    if (tomNameKey(name) !== tomNameKey(original) && originalNameCounts.get(tomNameKey(original)) === 1) renameMap.set(original, name);
    measure.name = name;
    measure.displayFolder = defaultMeasureFolder(table.name, {
      displayFolder: measure.displayFolder,
      status: annotationValue(measure, "Qlik.MigrationStatus"),
    });
  }

  if (renameMap.size) {
    for (const table of cloned) for (const measure of table.measures) {
      for (const [oldName, newName] of renameMap) measure.expression = replaceTomMeasureReference(measure.expression, oldName, newName);
    }
  }
  return cloned;
}

function buildRelationships(model: PowerBiModelState | null | undefined): TomRelationship[] {
  if (!model || model.buildMode === "queries-only") return [];
  const eligible = model.relationships.filter((relationship) => {
    if (relationship.deleted || relationship.recommendationStatus === "exclude") return false;
    return !validateRelationship(relationship, model.tables, model.relationships)
      .some((diagnostic) => diagnostic.severity === "blocking-error");
  });
  const candidates = model.buildMode === "desktop-review"
    ? eligible
    : eligible.filter((relationship) => relationship.active || relationship.userApproved);
  return candidates.flatMap((relationship): TomRelationship[] => {
    const fromTable = model.tables.find((table) => table.id === relationship.fromTableId);
    const toTable = model.tables.find((table) => table.id === relationship.toTableId);
    const fromColumn = fromTable?.columns.find((column) => column.id === relationship.fromColumnId);
    const toColumn = toTable?.columns.find((column) => column.id === relationship.toColumnId);
    if (!fromTable || !toTable || !fromColumn || !toColumn) return [];
    const cardinality = relationship.cardinality;
    return [{
      id: relationship.id,
      name: stableGuid(`relationship:${relationship.id}`),
      fromTable: fromTable.name,
      fromColumn: fromColumn.name,
      toTable: toTable.name,
      toColumn: toColumn.name,
      fromCardinality: cardinality === "many-to-one" || cardinality === "many-to-many" ? "many" : "one",
      toCardinality: cardinality === "one-to-many" || cardinality === "many-to-many" ? "many" : "one",
      crossFilteringBehavior: relationship.crossFilterDirection === "both" ? "bothDirections" : "oneDirection",
      isActive: model.buildMode === "desktop-review" ? false : relationship.active,
      annotations: annotations([
        ["Qlik.RelationshipId", relationship.id],
        ["Qlik.RelationshipSource", relationship.source],
        ["Qlik.Confidence", String(relationship.confidence)],
        ["Qlik.UserApproved", String(relationship.userApproved)],
        ["Qlik.Evidence", relationship.evidence],
        ["Qlik.Notes", relationship.notes],
      ]),
    }];
  });
}

export function buildTomDatabaseSpec(
  analysis: EnterpriseAnalysis,
  projectName: string,
  enhancements: TomModelBuildEnhancements = {},
): TomDatabaseSpec {
  const importedNames = Object.keys(analysis.mQueries || {});
  // Exclude calendar tables — users create Date tables natively in Power BI
  const isCalendarTable = (name: string) => /calendar|date(?!time)|dim.?date|date.?dim|^cal$/i.test(name || "");
  const exportedImportedNames = importedNames.filter((name) => !isCalendarTable(name));
  let tables = exportedImportedNames.map((name) => buildImportedTable(analysis, name, enhancements.powerBiModel));
  for (const table of enhancements.powerBiModel?.tables || []) {
    if (importedNames.some((name) => table.sourceName === name || table.queryName === name)) continue;
    if (isCalendarTable(table.name) || isCalendarTable(table.sourceName)) continue;
    if (table.calculatedExpression || ["parameter", "calculated", "disconnected"].includes(table.kind)) {
      tables.push(buildGeneratedTable(table));
    }
  }
  if (!tables.length && enhancements.powerBiModel?.tables.length) {
    tables.push(...enhancements.powerBiModel.tables
      .filter((t) => !isCalendarTable(t.name) && !isCalendarTable(t.sourceName))
      .map(buildGeneratedTable));
  }

  tables = normalizeTomMeasures(repairTomDaxDependencies(tables));

  // Inject DAX measures from the DAX Measures page into a single dedicated
  // "Qlik Measures" table so they are clearly visible in the Power BI Data pane.
  const extraMeasures = (enhancements.daxMeasures || analysis.daxMeasures || []).filter(
    (m) => m.dax?.trim() && m.measureName?.trim(),
  );
  if (extraMeasures.length) {
    const isCalendarRef = (expr: string) => /calendar|date(?!time)/i.test(expr);

    // Collect names already in use across all tables to avoid duplicates.
    const existingMeasureKeys = new Set(
      tables.flatMap((t) => t.measures.map((m) => m.name.toLowerCase())),
    );

    // Always use a single dedicated measure-host table named "Qlik Measures".
    const hostName = "Qlik Measures";
    const hostId = stableGuid(`dax-host:${hostName}:${projectName}`);
    let hostTable = tables.find((t) => t.name === hostName);
    if (!hostTable) {
      hostTable = {
        id: hostId,
        name: hostName,
        description: "Migrated DAX measures from Qlik set analysis and variable expressions.",
        isHidden: false,
        columns: [],
        measures: [],
        hierarchies: [],
        partitions: [{
          id: `partition:${hostId}`,
          name: `${hostName}-partition`,
          mode: "import",
          sourceType: "m",
          // Minimal single-row measure host table (valid Power Query M).
          expression: "let\n    Source = #table(type table [_Host = Int64.Type], {{0}})\nin\n    Source",
        }],
        annotations: [
          { name: "Qlik.GeneratedArtifact", value: "true" },
          { name: "Qlik.TableRole", value: "measure-host" },
        ],
      };
      tables.push(hostTable);
    }

    for (const m of extraMeasures) {
      const measureKey = m.measureName.toLowerCase();
      if (existingMeasureKeys.has(measureKey)) continue;
      existingMeasureKeys.add(measureKey);

      // Safely rewrite Qlik colour functions and stub out calendar references.
      let dax = rewriteQlikColourFunctions(m.dax.trim());
      if (isCalendarRef(dax)) {
        dax = dax.replace(
          /(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ ]*)\s*\[([^\]]+)\]/g,
          (full) => isCalendarRef(full) ? `BLANK() /* ${full} — reconnect after adding Date table */` : full,
        );
      }

      hostTable.measures.push({
        id: stableGuid(`dax-measure:${m.measureName}`),
        name: m.measureName,
        expression: dax,
        displayFolder: m.table ? m.table.trim() : "General",
        description: m.notes?.trim() || m.qlikExpression?.trim() || undefined,
        isHidden: false,
        lineageTag: stableGuid(`dax-lineage:${m.measureName}`),
        annotations: [
          { name: "Qlik.MigrationStatus", value: m.source || "auto" },
          { name: "Qlik.OriginalExpression", value: m.qlikExpression || "" },
          { name: "Qlik.Confidence", value: String(m.confidence ?? 1) },
        ],
      });
    }
  }

  const databaseId = stableGuid(`database:${projectName}`);
  return {
    id: databaseId,
    name: projectName,
    compatibilityLevel: 1604,
    model: {
      id: stableGuid(`model:${projectName}`),
      name: "Model",
      culture: "en-US",
      sourceQueryCulture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      tables,
      relationships: enhancements.powerBiModel
        ? buildRelationships(enhancements.powerBiModel)
        : (analysis.semanticModel?.relationships || []).map((relationship: any, index: number) => ({
            id: `semantic:${index}`,
            name: stableGuid(`semantic-relationship:${index}:${relationship.fromTable}:${relationship.fromColumn}:${relationship.toTable}:${relationship.toColumn}`),
            fromTable: relationship.fromTable,
            fromColumn: relationship.fromColumn,
            toTable: relationship.toTable,
            toColumn: relationship.toColumn,
            fromCardinality: "many",
            toCardinality: "one",
            crossFilteringBehavior: relationship.direction === "Both" ? "bothDirections" : "oneDirection",
            isActive: relationship.active !== false,
            annotations: [],
          })),
      expressions: Object.entries(analysis.stagingQueries || {}).map(([name, expression]) => ({
        id: `expression:${name}`,
        name,
        expression: normalizeExpression(expression, `let\n    Source = #table({}, {})\nin\n    Source`),
        kind: "m" as const,
        description: "Load-disabled/helper query retained from Qlik lineage. It is not loaded into the Power BI semantic model.",
        annotations: annotations([
          ["Qlik.QueryRole", "staging-or-static"],
          ["Qlik.LoadEnabled", "false"],
        ]),
      })),
      annotations: annotations([
        ["Qlik.MigrationEngineVersion", "3.0.0-tom-tmdl"],
        ["Qlik.ExpressionArtifactCount", enhancements.expressionInventory?.artifacts.length || 0],
        ["Qlik.ModelReadiness", enhancements.powerBiModel?.readiness || (analysis.validation.isReadyForPbipExport ? "ready" : "not-ready")],
        ["Qlik.SourceQvw", enhancements.qvwAnalysis?.document.fileName],
      ]),
    },
  };
}
