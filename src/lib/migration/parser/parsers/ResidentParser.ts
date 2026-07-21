import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { parseLoadOperation } from "./LoadParser";

export class ResidentParser implements StatementParserPlugin {
  readonly name = "ResidentParser";
  readonly priority = 170;

  canParse(statement: ParsedStatement): boolean {
    return (
      statement.kind === "resident" &&
      !statement.prefixes.some((prefix) => /\bJOIN\b|\bKEEP\b|\bMAPPING\b/i.test(prefix))
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const operation = parseLoadOperation(statement, context);
    operation.kind = "RESIDENT";
    return { operations: [operation] };
  }
}
