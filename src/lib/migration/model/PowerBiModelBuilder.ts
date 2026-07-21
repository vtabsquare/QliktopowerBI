import type { EnterpriseAnalysis } from "../enterprise-parser";
import type { ExpressionArtifact, ExpressionInventory } from "../expression";
import type { QvwAnalysis } from "../qvw";
import { validatePowerBiModel } from "./ModelValidationEngine";
import { normalizeModelMeasures } from "./MeasureNormalization";
import { repairDaxDependencies } from "../dax/DaxDependencyRepair";
import { applySmartModelRecommendations, normalizeTableKeys } from "./SmartModelEngine";
import type {
  ModelTableKind,
  PowerBiColumn,
  PowerBiMeasure,
  PowerBiModelState,
  PowerBiRelationship,
  PowerBiTable,
  RelationshipCardinality,
  VisualBinding,
} from "./PowerBiModelTypes";

function id(prefix: string, value: string): string {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
function norm(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function tableKind(name: string, classification?: string): ModelTableKind {
  const value = `${name} ${classification ?? ""}`.toLowerCase();
  if (/calendar|date/.test(value)) return "date";
  if (/bridge|link/.test(value)) return "bridge";
  if (/fact|transaction|sales|orders|events|finance|ledger|inventory|stock|movement|payment|claim/.test(value)) return "fact";
  if (/dimension|dim_|master|lookup|customer|product|region/.test(value)) return "dimension";
  if (/parameter/.test(value)) return "parameter";
  return "unknown";
}
function columnType(value?: string): string {
  const lower = (value || "string").toLowerCase();
  if (/int|whole/.test(lower)) return "int64";
  if (/decimal|double|float|number|currency/.test(lower)) return "double";
  if (/date|time/.test(lower)) return "dateTime";
  if (/bool/.test(lower)) return "boolean";
  return "string";
}
function approvedArtifacts(inventory?: ExpressionInventory | null): ExpressionArtifact[] {
  return (inventory?.artifacts ?? []).filter((item) => item.status !== "excluded" && !["manual-redesign", "existing-column"].includes(item.artifactType) && item.generatedDax.trim());
}

function sampleProfile(enterprise: EnterpriseAnalysis, table: string, column: string): { distinctCount?: number; nullPercentage?: number; sampleRowCount?: number } {
  const preview = enterprise.tablePreviews?.[table];
  const candidates = [preview?.outputRows ?? [], preview?.sourceRows ?? []].filter((rows) => rows.length);
  if (!candidates.length) return {};
  const scored = candidates.map((rows) => {
    const values = rows.map((row) => {
      const key = Object.keys(row).find((name) => norm(name) === norm(column));
      return key ? row[key] : undefined;
    });
    const observed = values.filter((value) => value !== undefined).length;
    const nonblank = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").length;
    return { rows, values, score: nonblank * 1000 + observed };
  }).sort((left, right) => right.score - left.score)[0];
  if (!scored || !scored.rows.length || scored.score === 0) return {};
  const nulls = scored.values.filter((value) => value === null || value === undefined || String(value).trim() === "").length;
  const distinct = new Set(scored.values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").map((value) => String(value))).size;
  return { distinctCount: distinct, nullPercentage: (nulls / scored.rows.length) * 100, sampleRowCount: scored.rows.length };
}

function scalarizeBareColumnMeasure(expression: string): string {
  const trimmed = expression.trim();
  const match = trimmed.match(/^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))\s*\[([^\]]+)\]$/);
  if (!match) return expression;
  const table = (match[1] || match[2] || "").replace(/''/g, "'").trim();
  const column = (match[3] || "").trim();
  if (!table || !column) return expression;
  return `SELECTEDVALUE('${table.replace(/'/g, "''")}'[${column}])`;
}

function buildImportedTables(enterprise?: EnterpriseAnalysis | null): PowerBiTable[] {
  if (!enterprise) return [];
  const names = new Set([...Object.keys(enterprise.mQueries ?? {}), ...(enterprise.finalTables ?? []).map((table) => table.table)]);
  return [...names].map((name) => {
    const semantic = (enterprise.semanticModel?.tables ?? []).find((table: any) => table.name === name) as any;
    const profile = enterprise.profiles?.[name] || enterprise.finalTables.find((item) => item.table === name);
    const typeMap = enterprise.columnTypes?.[name] ?? {};
    const semanticFields = semantic?.columns?.map((column: any) => column.name) as string[] | undefined;
    const fieldNames = semanticFields?.length
      ? semanticFields
      : Object.keys(typeMap).length
        ? Object.keys(typeMap)
        : profile?.fields ?? [];
    const columns: PowerBiColumn[] = Array.from(new Set(fieldNames as string[])).map((field) => {
      const sample = sampleProfile(enterprise, name, field);
      return {
        id: id(`COL-${name}`, field), name: field, sourceName: field,
        dataType: columnType(typeMap[field] || semantic?.columns?.find((column: any) => column.name === field)?.data_type || semantic?.columns?.find((column: any) => column.name === field)?.dataType),
        hidden: false, isKey: false, distinctCount: sample.distinctCount, nullPercentage: sample.nullPercentage,
      };
    });
    const preview = enterprise.tablePreviews?.[name];
    const sampleRowCount = preview?.outputRows?.length || preview?.sourceRows?.length || undefined;
    return {
      id: id("TBL", name), name, sourceName: name, queryName: name, description: profile?.etlStory,
      kind: tableKind(name, profile?.classification), hidden: false, columns, measures: [], hierarchies: [], sampleRowCount,
      sourceLineage: profile?.sourceRefs ?? [], warnings: profile?.reviewNotes ?? [],
    };
  });
}

function attachArtifacts(tables: PowerBiTable[], artifacts: ExpressionArtifact[]): PowerBiTable[] {
  const ensureTable = (name: string, kind: ModelTableKind = "calculated", expression?: string) => {
    let table = tables.find((item) => item.name === name);
    if (!table) {
      const isMeasureHost = name === "Measures" || name === "Qlik Variables";
      table = {
        id: id("TBL", name),
        name,
        sourceName: name,
        kind: isMeasureHost ? "disconnected" : kind,
        hidden: isMeasureHost,
        columns: isMeasureHost
          ? [{
              id: id(`COL-${name}`, "_MeasureHost"),
              name: "_MeasureHost",
              sourceName: "_MeasureHost",
              dataType: "int64",
              hidden: true,
              isKey: false,
            }]
          : [],
        measures: [],
        hierarchies: [],
        calculatedExpression: isMeasureHost ? undefined : expression,
        sourceLineage: [],
        warnings: [],
      };
      tables.push(table);
    }
    return table;
  };
  for (const artifact of artifacts) {
    if (artifact.artifactType === "existing-column") continue;
    if (["what-if-parameter", "field-parameter", "disconnected-parameter-table", "calculated-table"].includes(artifact.artifactType)) {
      const table = ensureTable(artifact.name, artifact.artifactType === "calculated-table" ? "calculated" : "parameter", artifact.editedDax || artifact.generatedDax);
      if (!table.columns.length) table.columns.push({ id: id(`COL-${table.name}`, artifact.name), name: artifact.name, sourceName: artifact.name, dataType: artifact.artifactType === "what-if-parameter" ? "int64" : "string", hidden: false, isKey: true, sourceExpressionId: artifact.id });
      continue;
    }
    const targetHomeTable = artifact.homeTable || "Measures";
    const table = ensureTable(targetHomeTable, ["Measures", "Qlik Variables"].includes(targetHomeTable) ? "disconnected" : "unknown");
    if (artifact.artifactType === "calculated-column") {
      if (!table.columns.some((column) => column.sourceExpressionId === artifact.id)) table.columns.push({ id: id(`COL-${table.name}`, artifact.name), name: artifact.name, sourceName: artifact.name, dataType: "string", hidden: false, isKey: false, expression: artifact.editedDax || artifact.generatedDax, sourceExpressionId: artifact.id, formatString: artifact.formatString });
      continue;
    }
    const rawExpression = artifact.editedDax || artifact.generatedDax;
    const measureExpression = scalarizeBareColumnMeasure(rawExpression);
    const measure: PowerBiMeasure = { id: id("MEA", artifact.id), name: artifact.name, expression: measureExpression, originalExpression: artifact.originalExpression, sourceExpressionId: artifact.id, homeTable: table.name, displayFolder: artifact.displayFolder, formatString: artifact.formatString, description: artifact.description, hidden: false, approved: artifact.approved, status: artifact.status };
    if (!table.measures.some((item) => item.id === measure.id)) table.measures.push(measure);
  }
  return tables;
}

function existingRelationships(enterprise: EnterpriseAnalysis | null | undefined, tables: PowerBiTable[]): PowerBiRelationship[] {
  if (!enterprise) return [];
  return (enterprise.relationships ?? []).flatMap((relationship, index) => {
    const fromTable = tables.find((table) => table.name === relationship.fromTable);
    const toTable = tables.find((table) => table.name === relationship.toTable);
    const fromColumn = fromTable?.columns.find((column) => column.name === relationship.fromColumn);
    const toColumn = toTable?.columns.find((column) => column.name === relationship.toColumn);
    if (!fromTable || !toTable || !fromColumn || !toColumn) return [];
    const cardinality = (/many.*many/i.test(relationship.cardinality) ? "many-to-many" : /one.*one/i.test(relationship.cardinality) ? "one-to-one" : /many.*one/i.test(relationship.cardinality) ? "many-to-one" : "one-to-many") as RelationshipCardinality;
    return [{ id: id("REL", `${fromTable.name}-${fromColumn.name}-${toTable.name}-${toColumn.name}-${index}`), fromTableId: fromTable.id, fromColumnId: fromColumn.id, toTableId: toTable.id, toColumnId: toColumn.id, cardinality, crossFilterDirection: /both/i.test(relationship.filterDirection) ? "both" : "single", active: relationship.active !== false, source: "qlik-association", confidence: relationship.confidence ?? relationship.score ?? 70, evidence: [relationship.reason || "Imported from enterprise relationship analysis"], riskLevel: (relationship.confidence ?? 70) >= 85 ? "low" : "medium", userApproved: relationship.active !== false, validationMessages: [] }];
  });
}

function inferRelationships(tables: PowerBiTable[], existing: PowerBiRelationship[]): PowerBiRelationship[] {
  const existingPairs = new Set(existing.map((relationship) => [relationship.fromTableId, relationship.toTableId].sort().join("|")));
  const candidates: PowerBiRelationship[] = [];
  const baseName = (table: PowerBiTable) => norm(table.name.replace(/^(dim|fact|tbl|ref)_?/i, "").replace(/s$/i, ""));
  const isFact = (table: PowerBiTable) => table.kind === "fact" || table.kind === "bridge";
  const isDimension = (table: PowerBiTable) => table.kind === "dimension" || table.kind === "date";
  const isDimensionKey = (table: PowerBiTable, column: PowerBiColumn) => {
    const base = baseName(table);
    const name = norm(column.name);
    return name === `${base}id` || name === `${base}key` || name === `${base}code`
      || (table.kind === "date" && /^(calendar)?date(key)?$/.test(name));
  };

  for (const fact of tables.filter(isFact)) {
    for (const dimension of tables.filter(isDimension)) {
      if (fact.id === dimension.id || existingPairs.has([fact.id, dimension.id].sort().join("|"))) continue;
      const dimensionKey = dimension.columns.find((column) => isDimensionKey(dimension, column));
      if (!dimensionKey) continue;
      let factKey = fact.columns.find((column) => norm(column.name) === norm(dimensionKey.name));
      if (!factKey && dimension.kind === "date") {
        factKey = fact.columns.find((column) => /date$/i.test(column.name));
      }
      if (!factKey || factKey.dataType !== dimensionKey.dataType) continue;
      const confidence = dimension.kind === "date" ? 88 : 92;
      candidates.push({
        id: id("REL-INF", `${fact.name}-${factKey.name}-${dimension.name}-${dimensionKey.name}`),
        fromTableId: fact.id,
        fromColumnId: factKey.id,
        toTableId: dimension.id,
        toColumnId: dimensionKey.id,
        cardinality: "many-to-one",
        crossFilterDirection: "single",
        active: false,
        source: "inferred",
        confidence,
        evidence: [`Verified key pattern ${fact.name}[${factKey.name}] → ${dimension.name}[${dimensionKey.name}]`],
        riskLevel: "low",
        userApproved: false,
        validationMessages: ["Inferred key relationship remains inactive until uniqueness and null checks pass."],
      });
    }
  }
  return candidates;
}

function buildVisualBindings(qvw: QvwAnalysis | null | undefined, inventory: ExpressionInventory | null | undefined, tables: PowerBiTable[]): VisualBinding[] {
  if (!qvw || !inventory) return [];
  const artifactBySource = new Map<string, ExpressionArtifact>();
  for (const artifact of inventory.artifacts) for (const sourceId of artifact.sourceExpressionIds) artifactBySource.set(sourceId, artifact);
  return qvw.objects.map((object) => {
    const dimensions = object.dimensions.map((expression) => artifactBySource.get(expression.id)).filter(Boolean) as ExpressionArtifact[];
    const measures = object.measures.map((expression) => artifactBySource.get(expression.id)).filter(Boolean) as ExpressionArtifact[];
    const conditional = object.conditionalExpressions.map((expression) => artifactBySource.get(expression.id)).filter(Boolean) as ExpressionArtifact[];
    const dimensionIds = dimensions.flatMap((artifact) => {
      const preferred = tables.find((table) => table.name.toLowerCase() === artifact.homeTable.toLowerCase());
      const direct = preferred?.columns.filter((column) =>
        column.sourceExpressionId === artifact.id
        || artifact.referencedFields.some((field) => norm(field) === norm(column.name)),
      ) ?? [];
      if (direct.length) return direct.slice(0, 1).map((column) => column.id);
      const candidates = tables.flatMap((table) => table.columns
        .filter((column) => column.sourceExpressionId === artifact.id || artifact.referencedFields.some((field) => norm(field) === norm(column.name)))
        .map((column) => ({ table, column })));
      const factCandidate = candidates.find((item) => item.table.kind === "fact");
      return (factCandidate ? [factCandidate] : candidates.slice(0, 1)).map((item) => item.column.id);
    }).filter((value, index, all) => all.indexOf(value) === index);
    const measureIds = measures.flatMap((artifact) => {
      const direct = tables.flatMap((table) => table.measures.filter((measure) => measure.sourceExpressionId === artifact.id || measure.sourceExpressionIds?.includes(artifact.id)).map((measure) => measure.id));
      if (direct.length) return direct;
      // Input boxes and variable references should bind to the reusable Qlik
      // variable measure instead of generating a Calendar or fact-table column.
      return tables.flatMap((table) => table.measures
        .filter((measure) => artifact.referencedVariables.some((name) => norm(name) === norm(measure.name)))
        .map((measure) => measure.id));
    }).filter((value, index, all) => all.indexOf(value) === index);
    const messages: string[] = [];
    if (object.measures.length && !measureIds.length) messages.push("No approved Power BI measure is currently bound to the Qlik measure expression.");
    if (object.dimensions.length && !dimensionIds.length) messages.push("No semantic-model column is currently bound to the Qlik dimension.");
    const sheet = qvw.sheets.find((item) => item.id === object.sheetId);
    return { id: id("VIS", object.id), sheetId: sheet?.id, sheetName: sheet?.name, objectId: object.id, objectTitle: object.title, originalObjectType: object.type, targetVisual: object.powerBiVisual, dimensionIds, measureIds, filterArtifactIds: conditional.filter((item) => item.artifactType === "visual-filter").map((item) => item.id), conditionalFormattingArtifactIds: conditional.filter((item) => item.artifactType === "conditional-formatting").map((item) => item.id), dynamicTitleArtifactIds: conditional.filter((item) => item.artifactType === "dynamic-title-measure").map((item) => item.id), bookmarkIds: object.actions.filter((action) => /bookmark/i.test(action.type)).map((action) => action.target || action.value || action.id), status: messages.length ? "warning" : object.migrationStatus === "manual-redesign" ? "manual" : "valid", messages };
  });
}

export function buildPowerBiModel(enterprise?: EnterpriseAnalysis | null, inventory?: ExpressionInventory | null, qvw?: QvwAnalysis | null, projectName = "Qlik Migration"): PowerBiModelState {
  const attachedTables = attachArtifacts(buildImportedTables(enterprise), approvedArtifacts(inventory));
  const normalizedMeasures = normalizeModelMeasures(attachedTables);
  const repairedDependencies = repairDaxDependencies(normalizedMeasures.tables, enterprise);
  const tables = repairedDependencies.tables;
  const current = existingRelationships(enterprise, tables);
  const inferred = inferRelationships(tables, current);
  const layout = Object.fromEntries(tables.map((table, index) => [table.id, { x: 40 + (index % 4) * 310, y: 40 + Math.floor(index / 4) * 300 }]));
  const model: PowerBiModelState = { id: id("MODEL", `${projectName}-${Date.now()}`), projectName, generatedAt: new Date().toISOString(), version: "4.0.0", viewMode: "powerbi", buildMode: "automatic", tables, relationships: [...current, ...inferred], originalQlikAssociations: current, layout, diagnostics: [], visualBindings: buildVisualBindings(qvw, inventory, tables), readiness: "not-ready", blockingErrorCount: 0, warningCount: 0, expressionArtifactIds: inventory?.artifacts.map((item) => item.id) ?? [] };
  return applySmartModelRecommendations(model).model;
}

export function mergePowerBiModel(generated: PowerBiModelState, previous?: PowerBiModelState | null, enterprise?: EnterpriseAnalysis | null): PowerBiModelState {
  if (!previous) return generated;
  const previousTables = new Map(previous.tables.map((table) => [table.id, table]));
  const tables = generated.tables.map((table) => {
    const old = previousTables.get(table.id);
    if (!old) return table;
    return {
      ...table,
      name: old.name,
      description: old.description,
      kind: old.kind,
      hidden: old.hidden,
      columns: table.columns.map((column) => {
        const previousColumn = old.columns.find((item) => item.id === column.id);
        return previousColumn
          ? {
              ...previousColumn,
              ...column,
              // The reviewed Power Query/Data Types page is authoritative.
              // Preserve presentation edits, but never restore a stale model type.
              name: previousColumn.name,
              hidden: previousColumn.hidden,
              isKey: previousColumn.isKey,
              dataType: column.dataType,
            }
          : column;
      }),
      measures: table.measures.map((measure) => ({ ...measure, ...(old.measures.find((item) => item.id === measure.id) ?? {}) })),
    };
  });
  const generatedRelationships = new Map(generated.relationships.map((item) => [item.id, item]));
  const relationships = [
    ...generated.relationships.map((item) => ({ ...item, ...(previous.relationships.find((old) => old.id === item.id) ?? {}) })),
    ...previous.relationships.filter((item) => item.source === "manual" && !generatedRelationships.has(item.id)),
  ];
  const normalized = normalizeTableKeys(tables, relationships);
  const normalizedMeasures = normalizeModelMeasures(normalized.tables);
  const repairedDependencies = repairDaxDependencies(normalizedMeasures.tables, enterprise);
  const visualBindings = generated.visualBindings.map((binding) => ({
    ...binding,
    measureIds: [...new Set(binding.measureIds.map((id) => normalizedMeasures.idAliases[id] || id))],
  }));
  return validatePowerBiModel({ ...generated, tables: repairedDependencies.tables, relationships, visualBindings, layout: { ...generated.layout, ...previous.layout }, viewMode: previous.viewMode, buildMode: previous.buildMode || generated.buildMode });
}
