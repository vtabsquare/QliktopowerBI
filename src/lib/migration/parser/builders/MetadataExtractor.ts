import type {
  ParsedOperation,
  ParsedStatement,
  ParserDiagnostic,
  QlikField,
  QlikParserMetadata,
  QlikSourceReference,
  TableMetadata,
} from "../core/ParserTypes";
import { canonicalName } from "../core/ParserUtils";
import { ExecutionGraphBuilder } from "./ExecutionGraphBuilder";
import { LineageBuilder } from "./LineageBuilder";
import { RelationshipBuilder } from "./RelationshipBuilder";

function mergeFields(existing: QlikField[], incoming: readonly QlikField[]): QlikField[] {
  const result = [...existing];
  const index = new Map(result.map((field, position) => [canonicalName(field.name), position]));
  for (const field of incoming) {
    const key = canonicalName(field.name);
    const position = index.get(key);
    if (position === undefined) {
      index.set(key, result.length);
      result.push(field);
    } else {
      result[position] = field;
    }
  }
  return result;
}

function inferRole(
  table: TableMetadata,
  operations: readonly ParsedOperation[],
): TableMetadata["role"] {
  if (
    operations.some(
      (operation) =>
        operation.kind === "MAPPING_LOAD" &&
        canonicalName(operation.targetTable ?? "") === canonicalName(table.name),
    )
  ) {
    return "mapping";
  }
  if (/calendar|date.?dim|master.?date/i.test(table.name)) return "calendar";
  if (/bridge|link.?table/i.test(table.name)) return "bridge";

  const referencedBy = operations.filter((operation) =>
    operation.sourceTables.some((name) => canonicalName(name) === canonicalName(table.name)),
  );
  const hasJoinTarget = operations.some(
    (operation) =>
      operation.kind === "JOIN" &&
      canonicalName(operation.join?.targetTable ?? "") === canonicalName(table.name),
  );
  const numericMeasures = table.fields.filter((field) =>
    /(^|[_ .-])(amount|sales|revenue|cost|price|quantity|qty|count|total|margin|profit|value|balance)(s)?($|[_ .-])/i.test(
      field.name,
    ),
  ).length;
  const keyFields = table.fields.filter((field) =>
    /(^id$|id$|key$|_key$|_id$)/i.test(field.name),
  ).length;

  if (
    hasJoinTarget ||
    (numericMeasures >= 1 && keyFields >= 1) ||
    (referencedBy.length === 0 && table.fields.length > 8 && keyFields >= 1)
  )
    return "fact";
  if (table.isFinal && keyFields >= 1) return "dimension";
  if (!table.isFinal) return "intermediate";
  return "unknown";
}

export interface MetadataExtractorInput {
  fileName?: string;
  statements: ParsedStatement[];
  operations: ParsedOperation[];
  variables: ReadonlyMap<string, string>;
  connections: ReadonlyMap<string, string>;
  diagnostics: ParserDiagnostic[];
  inferRelationships?: boolean;
}

export class MetadataExtractor {
  private readonly lineageBuilder = new LineageBuilder();
  private readonly executionGraphBuilder = new ExecutionGraphBuilder();
  private readonly relationshipBuilder = new RelationshipBuilder();

  extract(input: MetadataExtractorInput): QlikParserMetadata {
    const tables = new Map<string, TableMetadata>();
    const dropped = new Set<string>();
    const consumedTables = new Set<string>();

    const ensureTable = (name: string): TableMetadata => {
      const key = canonicalName(name);
      const existing = tables.get(key);
      if (existing) return existing;
      const table: TableMetadata = {
        name,
        role: "unknown",
        fields: [],
        sourceTables: [],
        sourceReferences: [],
        createdBy: [],
        modifiedBy: [],
        dropped: false,
        storedTargets: [],
        isFinal: true,
      };
      tables.set(key, table);
      return table;
    };

    for (const operation of input.operations) {
      if (
        operation.source?.kind === "resident" ||
        operation.kind === "RESIDENT" ||
        operation.kind === "APPLYMAP"
      ) {
        for (const sourceName of operation.sourceTables)
          consumedTables.add(canonicalName(sourceName));
      }

      if (operation.kind === "DROP_TABLE" && operation.drop) {
        for (const name of operation.drop.names) {
          dropped.add(canonicalName(name));
          ensureTable(name).dropped = true;
        }
        continue;
      }

      if (operation.kind === "DROP_FIELD" && operation.drop?.fromTable) {
        const table = ensureTable(operation.drop.fromTable);
        const names = new Set(operation.drop.names.map(canonicalName));
        table.fields = table.fields.filter((field) => !names.has(canonicalName(field.name)));
        table.modifiedBy.push(operation.id);
        continue;
      }

      if (operation.kind === "STORE" && operation.store) {
        const table = ensureTable(operation.store.sourceTable);
        table.storedTargets.push(operation.store.targetPath);
        table.modifiedBy.push(operation.id);
        continue;
      }

      const targetName = operation.targetTable ?? operation.join?.targetTable;
      if (!targetName) continue;
      const table = ensureTable(targetName);
      table.fields = mergeFields(table.fields, operation.fields);
      table.sourceTables = [...new Set([...table.sourceTables, ...operation.sourceTables])];
      if (operation.source) {
        const sourceKey = `${operation.source.kind}|${operation.source.raw}`;
        const existingSourceKeys = new Set(
          table.sourceReferences.map((source) => `${source.kind}|${source.raw}`),
        );
        if (!existingSourceKeys.has(sourceKey))
          table.sourceReferences.push(operation.source as QlikSourceReference);
      }
      if (["LOAD", "SELECT", "RESIDENT", "MAPPING_LOAD", "CALENDAR"].includes(operation.kind)) {
        table.createdBy.push(operation.id);
      } else {
        table.modifiedBy.push(operation.id);
      }
    }

    const tableList = [...tables.values()];
    for (const table of tableList) {
      table.dropped = table.dropped || dropped.has(canonicalName(table.name));
      table.isFinal = !table.dropped;
    }
    for (const table of tableList) {
      table.role = inferRole(table, input.operations);
      if (table.role === "mapping") table.isFinal = false;
      if (
        table.role === "unknown" &&
        consumedTables.has(canonicalName(table.name)) &&
        /(^|[_ -])(tmp|temp|staging|stage|raw|payload)([_ -]|$)/i.test(table.name)
      ) {
        table.role = "intermediate";
        table.isFinal = false;
      }
    }

    const lineage = this.lineageBuilder.build(input.operations);
    const executionGraph = this.executionGraphBuilder.build(input.operations);
    const relationships =
      input.inferRelationships === false
        ? []
        : this.relationshipBuilder.build(tableList, input.operations);
    const operationDiagnostics = input.operations.flatMap((operation) => operation.diagnostics);
    const diagnostics = [...input.diagnostics, ...operationDiagnostics];

    const uniqueVariables = new Map<string, [string, string]>();
    for (const [name, value] of input.variables) {
      const key = name.toLowerCase();
      if (!uniqueVariables.has(key)) uniqueVariables.set(key, [name, value]);
    }

    return {
      fileName: input.fileName,
      statements: input.statements,
      operations: input.operations,
      tables: tableList,
      relationships,
      lineage,
      executionGraph,
      variables: Object.fromEntries([...uniqueVariables.values()]),
      connections: Object.fromEntries(input.connections),
      droppedTables: tableList.filter((table) => table.dropped).map((table) => table.name),
      finalTables: tableList
        .filter((table) => table.isFinal && table.role !== "mapping")
        .map((table) => table.name),
      diagnostics,
      metrics: {
        statements: input.statements.length,
        operations: input.operations.length,
        loads: input.operations.filter(
          (operation) => operation.kind === "LOAD" || operation.kind === "SELECT",
        ).length,
        residentLoads: input.operations.filter((operation) => operation.kind === "RESIDENT").length,
        joins: input.operations.filter((operation) => operation.kind === "JOIN").length,
        mappingLoads: input.operations.filter((operation) => operation.kind === "MAPPING_LOAD")
          .length,
        applyMaps: input.operations.filter((operation) => operation.kind === "APPLYMAP").length,
        stores: input.operations.filter((operation) => operation.kind === "STORE").length,
        drops: input.operations.filter(
          (operation) => operation.kind === "DROP_TABLE" || operation.kind === "DROP_FIELD",
        ).length,
        calendars: input.operations.filter((operation) => operation.kind === "CALENDAR").length,
      },
    };
  }
}
