import type { ExecutionGraphNode, ParsedOperation } from "../core/ParserTypes";

export class ExecutionGraphBuilder {
  build(operations: readonly ParsedOperation[]): ExecutionGraphNode[] {
    const graph: ExecutionGraphNode[] = [];
    const latestProducer = new Map<string, string>();

    for (const operation of operations) {
      const inputs = [...operation.sourceTables];
      if (operation.kind === "STORE" && operation.store) inputs.push(operation.store.sourceTable);
      if (operation.kind === "APPLYMAP") {
        for (const call of operation.applyMaps) inputs.push(call.mapName);
        const applyMapTarget = operation.targetTable ?? operation.join?.targetTable;
        if (applyMapTarget) inputs.push(applyMapTarget);
      }

      const outputs: string[] = [];
      const target = operation.targetTable ?? operation.join?.targetTable;
      if (target) outputs.push(target);
      if (operation.kind === "STORE" && operation.store) outputs.push(operation.store.targetPath);
      if (operation.kind === "DROP_TABLE") outputs.push("<dropped>");

      const dependsOn = [
        ...new Set(
          inputs
            .map((input) => latestProducer.get(input))
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const node: ExecutionGraphNode = {
        id: `node_${String(graph.length + 1).padStart(5, "0")}`,
        operationId: operation.id,
        sequence: operation.sequence,
        kind: operation.kind,
        inputs: [...new Set(inputs)],
        outputs: [...new Set(outputs)],
        dependsOn,
        raw: operation.raw,
      };
      graph.push(node);

      for (const output of node.outputs) {
        if (output !== "<dropped>") latestProducer.set(output, node.id);
      }
    }

    return graph;
  }
}
