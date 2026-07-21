import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { baseOperation, cleanIdentifier, splitTopLevel } from "../core/ParserUtils";

export class DropParser implements StatementParserPlugin {
  readonly name = "DropParser";
  readonly priority = 220;

  canParse(statement: ParsedStatement): boolean {
    return (
      statement.kind === "drop" ||
      /^DROP\s+(TABLE|TABLES|FIELD|FIELDS)\b/i.test(statement.body.trim())
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const tableMatch = statement.body.match(/^DROP\s+TABLES?\s+([\s\S]+)$/i);
    if (tableMatch) {
      const operation = baseOperation(statement, context, "DROP_TABLE", "drop_table");
      const names = splitTopLevel(tableMatch[1].replace(/;$/, "")).map((name) =>
        cleanIdentifier(name),
      );
      operation.sourceTables = names;
      operation.drop = { objectType: "table", names };
      return { operations: [operation] };
    }

    const fieldMatch = statement.body.match(/^DROP\s+FIELDS?\s+([\s\S]+?)(?:\s+FROM\s+(.+))?$/i);
    if (fieldMatch) {
      const operation = baseOperation(statement, context, "DROP_FIELD", "drop_field");
      const names = splitTopLevel(fieldMatch[1]).map((name) => cleanIdentifier(name));
      const fromTable = fieldMatch[2] ? cleanIdentifier(fieldMatch[2]) : context.lastCreatedTable;
      operation.targetTable = fromTable;
      operation.sourceTables = fromTable ? [fromTable] : [];
      operation.drop = { objectType: "field", names, fromTable };
      return { operations: [operation] };
    }

    const operation = baseOperation(statement, context, "UNKNOWN", "drop_unknown");
    operation.diagnostics.push({
      code: "QLIK_DROP_UNPARSED",
      severity: "warning",
      message: "The DROP statement was detected but could not be parsed.",
      location: statement.location,
      statementId: statement.id,
      parser: this.name,
    });
    return { operations: [operation] };
  }
}
