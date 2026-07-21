import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { parseJoinType, parseTargetFromPrefixes } from "../core/ParserUtils";
import { parseLoadOperation } from "./LoadParser";

export class JoinParser implements StatementParserPlugin {
  readonly name = "JoinParser";
  readonly priority = 200;

  canParse(statement: ParsedStatement): boolean {
    return (
      statement.kind === "join" ||
      statement.prefixes.some((prefix) => /\bJOIN\b|\bKEEP\b/i.test(prefix))
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const operation = parseLoadOperation(statement, context);
    const explicitTarget = parseTargetFromPrefixes(statement.prefixes);
    const keep = statement.prefixes.some((prefix) => /\bKEEP\b/i.test(prefix));
    operation.kind = "JOIN";
    operation.join = {
      type: parseJoinType(statement.prefixes),
      targetTable: explicitTarget ?? context.lastCreatedTable,
      keep,
    };
    operation.targetTable = operation.join.targetTable ?? operation.targetTable;
    operation.attributes.payloadTable = statement.label;
    operation.attributes.joinPrefixes = [...statement.prefixes];
    return { operations: [operation] };
  }
}
