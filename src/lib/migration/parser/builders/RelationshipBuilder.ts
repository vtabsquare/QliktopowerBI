import type { ParsedOperation, RelationshipMetadata, TableMetadata } from "../core/ParserTypes";
import { canonicalName } from "../core/ParserUtils";

function relationshipId(index: number): string {
  return `relationship_${String(index + 1).padStart(5, "0")}`;
}

function likelyKey(fieldName: string): boolean {
  return /(^id$|id$|key$|_key$|_id$|code$|number$)/i.test(fieldName.replace(/\s+/g, ""));
}

export class RelationshipBuilder {
  build(
    tables: readonly TableMetadata[],
    operations: readonly ParsedOperation[],
  ): RelationshipMetadata[] {
    const relationships: RelationshipMetadata[] = [];
    const signatures = new Set<string>();
    const tableMap = new Map(tables.map((table) => [canonicalName(table.name), table]));

    const add = (relationship: Omit<RelationshipMetadata, "id">): void => {
      if (canonicalName(relationship.fromTable) === canonicalName(relationship.toTable)) return;
      const signature = [
        canonicalName(relationship.fromTable),
        canonicalName(relationship.fromField),
        canonicalName(relationship.toTable),
        canonicalName(relationship.toField),
      ].join("|");
      const reverse = [
        canonicalName(relationship.toTable),
        canonicalName(relationship.toField),
        canonicalName(relationship.fromTable),
        canonicalName(relationship.fromField),
      ].join("|");
      if (signatures.has(signature) || signatures.has(reverse)) return;
      signatures.add(signature);
      relationships.push({ id: relationshipId(relationships.length), ...relationship });
    };

    for (const operation of operations) {
      if (operation.kind !== "JOIN" || !operation.join?.targetTable) continue;
      const target = tableMap.get(canonicalName(operation.join.targetTable));
      const sourceName = operation.sourceTables[0];
      const source = sourceName ? tableMap.get(canonicalName(sourceName)) : undefined;
      if (!target || !source) continue;

      const sourceFields = new Map(
        source.fields.map((field) => [canonicalName(field.name), field.name]),
      );
      for (const field of target.fields) {
        const shared = sourceFields.get(canonicalName(field.name));
        if (!shared) continue;
        add({
          fromTable: target.name,
          fromField: field.name,
          toTable: source.name,
          toField: shared,
          reason: "join",
          confidence: 0.98,
          cardinality: target.role === "fact" ? "N:1" : "unknown",
        });
      }
    }

    const mappingDefinitions = new Map<string, { tableName: string; keyField?: string }>();
    for (const operation of operations) {
      if (operation.kind === "MAPPING_LOAD" && operation.mapping) {
        mappingDefinitions.set(canonicalName(operation.mapping.tableName), {
          tableName: operation.mapping.tableName,
          keyField: operation.mapping.keyField,
        });
      }
    }

    for (const operation of operations) {
      const targetName = operation.targetTable ?? operation.join?.targetTable;
      if (!targetName) continue;
      for (const call of operation.applyMaps) {
        const mapping = mappingDefinitions.get(canonicalName(call.mapName));
        if (!mapping?.keyField) continue;
        const lookupField = call.lookupExpression.trim().replace(/^\[|\]$/g, "");
        if (!/^[A-Za-z_][A-Za-z0-9_.$#@ -]*$/.test(lookupField)) continue;
        add({
          fromTable: targetName,
          fromField: lookupField,
          toTable: mapping.tableName,
          toField: mapping.keyField,
          reason: "applymap",
          confidence: 0.96,
          cardinality: "N:1",
        });
      }
    }

    const candidates = tables.filter(
      (table) => table.isFinal && !table.dropped && table.role !== "mapping",
    );
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        const rightFields = new Map(
          right.fields.map((field) => [canonicalName(field.name), field.name]),
        );
        for (const leftField of left.fields) {
          const rightField = rightFields.get(canonicalName(leftField.name));
          if (!rightField || !likelyKey(leftField.name)) continue;

          const leftFact = left.role === "fact";
          const rightFact = right.role === "fact";
          let cardinality: RelationshipMetadata["cardinality"] = "unknown";
          if (leftFact && !rightFact) cardinality = "N:1";
          else if (!leftFact && rightFact) cardinality = "1:N";
          else if (!leftFact && !rightFact) cardinality = "1:1";
          else cardinality = "N:N";

          add({
            fromTable: left.name,
            fromField: leftField.name,
            toTable: right.name,
            toField: rightField,
            reason: "shared-field",
            confidence: leftFact === rightFact ? 0.62 : 0.82,
            cardinality,
          });
        }
      }
    }

    return relationships;
  }
}
