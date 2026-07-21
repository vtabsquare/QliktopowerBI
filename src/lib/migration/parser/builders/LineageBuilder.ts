import type { LineageEdge, ParsedOperation } from "../core/ParserTypes";

function edgeId(index: number): string {
  return `lineage_${String(index + 1).padStart(5, "0")}`;
}

export class LineageBuilder {
  build(operations: readonly ParsedOperation[]): LineageEdge[] {
    const edges: LineageEdge[] = [];
    const signatures = new Set<string>();

    const add = (edge: Omit<LineageEdge, "id">): void => {
      const signature = `${edge.kind}|${edge.from}|${edge.to}|${edge.operationId}`;
      if (signatures.has(signature)) return;
      signatures.add(signature);
      edges.push({ id: edgeId(edges.length), ...edge });
    };

    for (const operation of operations) {
      const target = operation.targetTable ?? operation.join?.targetTable;

      if (operation.kind === "STORE" && operation.store) {
        add({
          from: operation.store.sourceTable,
          to: operation.store.targetPath,
          kind: "store",
          operationId: operation.id,
        });
        continue;
      }

      if (operation.kind === "DROP_TABLE" && operation.drop) {
        for (const table of operation.drop.names) {
          add({ from: table, to: "<dropped>", kind: "drop", operationId: operation.id });
        }
        continue;
      }

      if (!target) continue;
      const fieldMappings: Record<string, string> = {};
      for (const field of operation.fields) {
        fieldMappings[field.name] = field.sourceField ?? field.expression;
      }

      for (const source of operation.sourceTables) {
        add({
          from: source,
          to: target,
          kind:
            operation.kind === "JOIN"
              ? "join"
              : operation.kind === "MAPPING_LOAD"
                ? "mapping"
                : operation.kind === "RESIDENT"
                  ? "resident"
                  : "load",
          operationId: operation.id,
          fieldMappings,
        });
      }

      for (const call of operation.applyMaps) {
        add({
          from: call.mapName,
          to: target,
          kind: "applymap",
          operationId: operation.id,
          fieldMappings: call.outputField
            ? { [call.outputField]: call.lookupExpression }
            : undefined,
        });
      }
    }

    return edges;
  }
}
