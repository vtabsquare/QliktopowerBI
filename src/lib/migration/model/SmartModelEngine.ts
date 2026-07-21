import { validatePowerBiModel, validateRelationship } from "./ModelValidationEngine";
import type {
  ModelDiagnostic,
  PowerBiColumn,
  PowerBiModelState,
  PowerBiRelationship,
  PowerBiTable,
  RelationshipCardinality,
} from "./PowerBiModelTypes";

export interface KeyRecommendation {
  tableId: string;
  columnId: string | null;
  confidence: number;
  reason: string;
}

export interface RelationshipRecommendation {
  relationshipId: string;
  status: "ready" | "review" | "exclude";
  reason: string;
}

export interface SmartModelSummary {
  keyRecommendations: KeyRecommendation[];
  relationshipRecommendations: RelationshipRecommendation[];
  appliedRelationships: number;
  reviewRelationships: number;
  excludedRelationships: number;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const isDimensionLike = (table: PowerBiTable) => table.kind === "dimension" || table.kind === "date" || table.kind === "parameter";
const isFactLike = (table: PowerBiTable) => table.kind === "fact" || table.kind === "bridge";
const isKeyLike = (name: string) => /(?:^id$|id$|key$|code$|guid$|date$)/i.test(name.trim());

function oneSideQuality(relationship: PowerBiRelationship, tables: PowerBiTable[]): { valid: boolean; known: boolean; reason?: string } {
  const sides = relationshipSides(relationship);
  if (!sides) return { valid: false, known: true, reason: "The relationship does not have a single one side." };
  const table = tables.find((item) => item.id === sides.oneTableId);
  const column = table?.columns.find((item) => item.id === sides.oneColumnId);
  if (!table || !column) return { valid: false, known: true, reason: "The one-side table or column is missing." };
  const known = typeof table.sampleRowCount === "number" && typeof column.distinctCount === "number";
  if ((column.nullPercentage ?? 0) > 0) return { valid: false, known: true, reason: `${table.name}[${column.name}] contains blank sample values and cannot be used on the one side.` };
  if (known && column.distinctCount! < table.sampleRowCount!) return { valid: false, known: true, reason: `${table.name}[${column.name}] is not unique in the uploaded sample and cannot be used on the one side.` };
  return { valid: true, known };
}

function isCompatibleType(left: string, right: string): boolean {
  const family = (value: string) => {
    const lower = value.toLowerCase();
    if (/int|decimal|double|number|currency|float/.test(lower)) return "number";
    if (/date|time/.test(lower)) return "date";
    if (/bool/.test(lower)) return "boolean";
    return "string";
  };
  return family(left) === family(right);
}

function relationshipSides(relationship: PowerBiRelationship): { oneTableId: string; oneColumnId: string; manyTableId: string; manyColumnId: string } | null {
  if (relationship.cardinality === "one-to-many") {
    return { oneTableId: relationship.fromTableId, oneColumnId: relationship.fromColumnId, manyTableId: relationship.toTableId, manyColumnId: relationship.toColumnId };
  }
  if (relationship.cardinality === "many-to-one") {
    return { oneTableId: relationship.toTableId, oneColumnId: relationship.toColumnId, manyTableId: relationship.fromTableId, manyColumnId: relationship.fromColumnId };
  }
  return null;
}

function keyScore(table: PowerBiTable, column: PowerBiColumn, relationships: PowerBiRelationship[]): { score: number; reasons: string[] } {
  const name = normalize(column.name);
  const tableBase = normalize(table.name.replace(/^(dim|fact)/i, ""));
  const reasons: string[] = [];
  let score = 0;

  const oneSide = relationships.some((relationship) => {
    if (relationship.deleted) return false;
    const sides = relationshipSides(relationship);
    return sides?.oneTableId === table.id && sides.oneColumnId === column.id;
  });
  const manySide = relationships.some((relationship) => {
    if (relationship.deleted) return false;
    const sides = relationshipSides(relationship);
    return sides?.manyTableId === table.id && sides.manyColumnId === column.id;
  });

  if (oneSide) { score += 45; reasons.push("Used on the one side of a relationship"); }
  if (manySide) { score -= 35; reasons.push("Used as a foreign key on the many side"); }
  if (column.distinctCount && column.distinctCount > 0 && column.nullPercentage === 0) { score += 10; reasons.push("Profile indicates non-null distinct values"); }
  if (column.nullPercentage && column.nullPercentage > 0) { score -= 15; reasons.push("Contains null values"); }

  if (table.kind === "date") {
    if (/^(date|datekey|calendardate|fulldate)$/.test(name)) { score += 55; reasons.push("Recognized date-table key"); }
  } else if (table.kind === "parameter") {
    if (/^(value|parameter|parameterkey|id)$/.test(name)) { score += 50; reasons.push("Recognized parameter key"); }
  } else if (table.kind === "dimension") {
    if (name === `${tableBase}id` || name === `${tableBase}key`) { score += 55; reasons.push("Column name matches the dimension name"); }
    if (/^(id|key)$/.test(name)) { score += 40; reasons.push("Generic dimension key name"); }
    if (/(id|key)$/.test(name)) { score += 25; reasons.push("Key naming convention"); }
  } else if (isFactLike(table)) {
    // A fact table does not require IsKey. Only recommend an unmistakable row identifier.
    if (/^(rowid|recordid|transactionid|salesrecordid|salesrowid|orderlineid|invoicelineid|factkey)$/.test(name)) {
      score += 90;
      reasons.push("Recognized unique fact-row identifier");
    }
    if (/(customer|employee|product|region|country|date|calendar|supplier|store)(id|key|code)$/.test(name)) {
      score -= 55;
      reasons.push("Looks like a dimension foreign key");
    }
  }

  return { score, reasons };
}

export function recommendTableKey(table: PowerBiTable, relationships: PowerBiRelationship[]): KeyRecommendation {
  const candidates = table.columns
    .map((column) => ({ column, ...keyScore(table, column, relationships) }))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const threshold = isFactLike(table) ? 80 : table.kind === "unknown" || table.kind === "calculated" || table.kind === "disconnected" ? 70 : 40;
  if (!best || best.score < threshold) {
    return {
      tableId: table.id,
      columnId: null,
      confidence: best ? Math.max(0, Math.min(100, best.score)) : 0,
      reason: isFactLike(table)
        ? "No verified unique row identifier was found. Fact tables can safely use no IsKey column."
        : "No sufficiently reliable single key was found. Review the table only when a relationship needs a one-side key.",
    };
  }
  return {
    tableId: table.id,
    columnId: best.column.id,
    confidence: Math.max(0, Math.min(100, best.score)),
    reason: best.reasons.join("; ") || "Best available key candidate",
  };
}

export function normalizeTableKeys(tables: PowerBiTable[], relationships: PowerBiRelationship[]): { tables: PowerBiTable[]; recommendations: KeyRecommendation[] } {
  const recommendations = tables.map((table) => recommendTableKey(table, relationships));
  const recommendationByTable = new Map(recommendations.map((item) => [item.tableId, item]));
  return {
    recommendations,
    tables: tables.map((table) => {
      const activeKeys = table.columns.filter((column) => column.isKey);
      const recommendation = recommendationByTable.get(table.id);
      let selectedColumnId: string | null = null;
      if (activeKeys.length === 1) selectedColumnId = activeKeys[0].id;
      else if (activeKeys.length > 1) selectedColumnId = recommendation?.columnId ?? null;
      else selectedColumnId = recommendation?.columnId ?? null;
      return {
        ...table,
        recommendedKeyColumnId: recommendation?.columnId ?? null,
        keyRecommendationReason: recommendation?.reason,
        columns: table.columns.map((column) => ({ ...column, isKey: selectedColumnId === column.id })),
      };
    }),
  };
}

function relationPairKey(relationship: PowerBiRelationship): string {
  return [relationship.fromTableId, relationship.toTableId].sort().join("|");
}

function orientRelationship(relationship: PowerBiRelationship, tables: PowerBiTable[]): PowerBiRelationship {
  const fromTable = tables.find((table) => table.id === relationship.fromTableId);
  const toTable = tables.find((table) => table.id === relationship.toTableId);
  if (!fromTable || !toTable || relationship.cardinality === "many-to-many" || relationship.cardinality === "one-to-one") return relationship;

  if (isDimensionLike(fromTable) && isFactLike(toTable)) {
    return { ...relationship, cardinality: "one-to-many" };
  }
  if (isFactLike(fromTable) && isDimensionLike(toTable)) {
    return { ...relationship, cardinality: "many-to-one" };
  }
  return relationship;
}

export function recommendRelationship(relationship: PowerBiRelationship, tables: PowerBiTable[], all: PowerBiRelationship[]): RelationshipRecommendation {
  if (relationship.deleted) return { relationshipId: relationship.id, status: "exclude", reason: "Relationship is excluded from export." };
  const fromTable = tables.find((table) => table.id === relationship.fromTableId);
  const toTable = tables.find((table) => table.id === relationship.toTableId);
  const fromColumn = fromTable?.columns.find((column) => column.id === relationship.fromColumnId);
  const toColumn = toTable?.columns.find((column) => column.id === relationship.toColumnId);
  if (!fromTable || !toTable || !fromColumn || !toColumn) return { relationshipId: relationship.id, status: "exclude", reason: "Table or column is missing." };
  if (!isCompatibleType(fromColumn.dataType, toColumn.dataType)) return { relationshipId: relationship.id, status: "exclude", reason: "Column data types are incompatible." };
  if (isDimensionLike(fromTable) && isDimensionLike(toTable) && fromTable.kind !== "bridge" && toTable.kind !== "bridge") {
    return { relationshipId: relationship.id, status: "exclude", reason: "Dimension-to-dimension mesh relationships are excluded to prevent cyclic and ambiguous filter paths." };
  }
  if (relationship.source === "inferred" && (!isKeyLike(fromColumn.name) || !isKeyLike(toColumn.name))) {
    return { relationshipId: relationship.id, status: "exclude", reason: "Shared descriptive attributes are not valid relationship keys. Only verified ID/key/code/date fields are inferred." };
  }
  const oneSide = oneSideQuality(relationship, tables);
  if (!oneSide.valid) return { relationshipId: relationship.id, status: "exclude", reason: oneSide.reason || "The one-side key is invalid." };

  const diagnostics = validateRelationship(relationship, tables, all);
  if (diagnostics.some((item) => item.severity === "blocking-error")) {
    return { relationshipId: relationship.id, status: "exclude", reason: diagnostics.find((item) => item.severity === "blocking-error")?.message || "Blocking relationship issue." };
  }
  if (relationship.cardinality === "many-to-many" || relationship.crossFilterDirection === "both" || relationship.riskLevel === "high") {
    return { relationshipId: relationship.id, status: "review", reason: "Advanced cardinality or bidirectional filtering requires review." };
  }
  if (relationship.source === "qlik-association" && relationship.confidence >= 70) {
    return { relationshipId: relationship.id, status: oneSide.known ? "ready" : "review", reason: oneSide.known ? "Validated Qlik key association with compatible fields and a unique, nonblank one-side sample." : "Qlik key association is structurally valid, but source samples were not available to prove one-side uniqueness." };
  }
  if (relationship.source === "join" && relationship.confidence >= 85) {
    return { relationshipId: relationship.id, status: oneSide.known ? "ready" : "review", reason: oneSide.known ? "Explicit Qlik join key validated against the final model." : "Explicit Qlik join key found; review one-side uniqueness because no sample data was available." };
  }
  if (relationship.confidence >= 90 && oneSide.known) {
    return { relationshipId: relationship.id, status: "ready", reason: "High-confidence key match with compatible fields and validated one-side uniqueness." };
  }
  if (relationship.confidence >= 65) {
    return { relationshipId: relationship.id, status: "review", reason: "Plausible relationship, but confidence is not high enough for automatic activation." };
  }
  return { relationshipId: relationship.id, status: "exclude", reason: "Insufficient evidence for a reliable Power BI relationship." };
}

export function applySmartModelRecommendations(model: PowerBiModelState): { model: PowerBiModelState; summary: SmartModelSummary } {
  const oriented = model.relationships.map((relationship) => orientRelationship(relationship, model.tables));
  const recommendations = oriented.map((relationship) => recommendRelationship(relationship, model.tables, oriented));
  const recommendationById = new Map(recommendations.map((item) => [item.relationshipId, item]));

  // Keep only the strongest auto-active relationship for a table pair. Alternate paths remain available but inactive.
  const readyByPair = new Map<string, PowerBiRelationship[]>();
  for (const relationship of oriented) {
    if (recommendationById.get(relationship.id)?.status !== "ready") continue;
    const pair = relationPairKey(relationship);
    readyByPair.set(pair, [...(readyByPair.get(pair) ?? []), relationship]);
  }
  const selectedReady = new Set<string>();
  for (const relationships of readyByPair.values()) {
    relationships.sort((left, right) => right.confidence - left.confidence);
    if (relationships[0]) selectedReady.add(relationships[0].id);
  }

  const updatedRelationships = oriented.map((relationship) => {
    const recommendation = recommendationById.get(relationship.id)!;
    const autoActive = recommendation.status === "ready" && selectedReady.has(relationship.id);
    return {
      ...relationship,
      active: autoActive,
      userApproved: autoActive,
      autoApplied: autoActive,
      recommendationStatus: recommendation.status,
      recommendationReason: recommendation.reason,
      validationMessages: recommendation.status === "ready" ? [] : [recommendation.reason],
    };
  });

  const normalized = normalizeTableKeys(model.tables, updatedRelationships);
  const validated = validatePowerBiModel({ ...model, tables: normalized.tables, relationships: updatedRelationships });
  return {
    model: validated,
    summary: {
      keyRecommendations: normalized.recommendations,
      relationshipRecommendations: recommendations,
      appliedRelationships: recommendations.filter((item) => item.status === "ready").length,
      reviewRelationships: recommendations.filter((item) => item.status === "review").length,
      excludedRelationships: recommendations.filter((item) => item.status === "exclude").length,
    },
  };
}

export function modelHealthDiagnostics(model: PowerBiModelState): ModelDiagnostic[] {
  return validatePowerBiModel(model).diagnostics;
}

export function cardinalitySymbols(cardinality: RelationshipCardinality): { from: string; to: string } {
  if (cardinality === "one-to-many") return { from: "1", to: "*" };
  if (cardinality === "many-to-one") return { from: "*", to: "1" };
  if (cardinality === "one-to-one") return { from: "1", to: "1" };
  return { from: "*", to: "*" };
}
