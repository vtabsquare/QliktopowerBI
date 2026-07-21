import { MetadataExtractor } from "../builders/MetadataExtractor";
import { ApplyMapParser } from "../parsers/ApplyMapParser";
import { CalendarParser } from "../parsers/CalendarParser";
import { ConnectionParser } from "../parsers/ConnectionParser";
import { DropParser } from "../parsers/DropParser";
import { JoinParser } from "../parsers/JoinParser";
import { LoadParser } from "../parsers/LoadParser";
import { MappingParser } from "../parsers/MappingParser";
import { ResidentParser } from "../parsers/ResidentParser";
import { StoreParser } from "../parsers/StoreParser";
import { VariableParser } from "../parsers/VariableParser";
import { ParserContext } from "./ParserContext";
import { StatementParser } from "./StatementParser";
import type {
  ParseScriptOptions,
  ParsedOperation,
  QlikParserMetadata,
  StatementParserPlugin,
} from "./ParserTypes";

export class ParserEngine {
  private readonly statementParser = new StatementParser();
  private readonly metadataExtractor = new MetadataExtractor();
  private readonly plugins: StatementParserPlugin[] = [];

  constructor(plugins?: StatementParserPlugin[]) {
    const defaults: StatementParserPlugin[] = [
      new VariableParser(),
      new ConnectionParser(),
      new StoreParser(),
      new DropParser(),
      new MappingParser(),
      new JoinParser(),
      new ApplyMapParser(),
      new CalendarParser(),
      new ResidentParser(),
      new LoadParser(),
    ];
    for (const plugin of plugins ?? defaults) this.register(plugin);
  }

  register(plugin: StatementParserPlugin): this {
    const existing = this.plugins.findIndex((item) => item.name === plugin.name);
    if (existing >= 0) this.plugins.splice(existing, 1);
    this.plugins.push(plugin);
    this.plugins.sort((left, right) => right.priority - left.priority);
    return this;
  }

  parse(source: string, options: ParseScriptOptions = {}): QlikParserMetadata {
    const statements = this.statementParser.parse(source, { fileName: options.fileName });
    const context = new ParserContext(options.fileName);

    for (const statement of statements) {
      const plugin = this.plugins.find((candidate) => candidate.canParse(statement, context));
      if (!plugin) {
        if (statement.kind === "unknown" || options.strict) {
          context.addDiagnostic({
            code: "QLIK_STATEMENT_UNHANDLED",
            severity: options.strict ? "warning" : "info",
            message: `No parser handled statement '${statement.normalized.slice(0, 120)}'.`,
            location: statement.location,
            statementId: statement.id,
          });
        }
        continue;
      }

      try {
        const result = plugin.parse(statement, context);
        for (const diagnostic of result.diagnostics ?? []) context.addDiagnostic(diagnostic);
        for (const operation of result.operations) {
          this.registerOperation(context, operation);
        }
      } catch (error) {
        context.addDiagnostic({
          code: "QLIK_PARSER_FAILURE",
          severity: "error",
          message: `${plugin.name} failed to parse a statement.`,
          detail: error instanceof Error ? error.message : String(error),
          location: statement.location,
          statementId: statement.id,
          parser: plugin.name,
        });
      }
    }

    return this.metadataExtractor.extract({
      fileName: options.fileName,
      statements,
      operations: context.operations,
      variables: context.variables,
      connections: context.connections,
      diagnostics: context.diagnostics,
      inferRelationships: options.inferRelationships,
    });
  }

  private registerOperation(context: ParserContext, operation: ParsedOperation): void {
    operation.sequence = context.operations.length + 1;
    context.registerOperation(operation);
    const target = operation.targetTable ?? operation.join?.targetTable;
    if (
      ["LOAD", "SELECT", "RESIDENT", "MAPPING_LOAD", "CALENDAR", "JOIN"].includes(operation.kind) &&
      target
    ) {
      context.setLastCreatedTable(target);
    }
    if (
      operation.kind === "DROP_TABLE" &&
      operation.drop?.names.some((name) => name === context.lastCreatedTable)
    ) {
      context.setLastCreatedTable(undefined);
    }
  }
}

export function parseQlikScript(
  source: string,
  options: ParseScriptOptions = {},
): QlikParserMetadata {
  return new ParserEngine().parse(source, options);
}
