import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { parseLoadOperation } from "./LoadParser";

export class MappingParser implements StatementParserPlugin {
  readonly name = "MappingParser";
  readonly priority = 210;

  canParse(statement: ParsedStatement): boolean {
    return (
      statement.kind === "mapping" ||
      statement.prefixes.some((prefix) => /^MAPPING\b/i.test(prefix))
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const operation = parseLoadOperation(statement, context);
    operation.kind = "MAPPING_LOAD";
    const tableName = statement.label ?? operation.targetTable ?? `Mapping_${operation.sequence}`;
    operation.targetTable = tableName;
    operation.mapping = {
      tableName,
      keyField: operation.fields[0]?.name,
      valueField: operation.fields[1]?.name,
    };
    if (operation.fields.length !== 2) {
      operation.diagnostics.push({
        code: "QLIK_MAPPING_FIELD_COUNT",
        severity: "warning",
        message: `Mapping table '${tableName}' normally requires exactly two fields; ${operation.fields.length} were detected.`,
        location: statement.location,
        statementId: statement.id,
        parser: this.name,
      });
    }
    return { operations: [operation] };
  }
}
