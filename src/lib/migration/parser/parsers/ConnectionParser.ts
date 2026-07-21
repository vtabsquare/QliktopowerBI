import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { unquote } from "../core/ParserUtils";

export class ConnectionParser implements StatementParserPlugin {
  readonly name = "ConnectionParser";
  readonly priority = 300;

  canParse(statement: ParsedStatement): boolean {
    return statement.kind === "connection";
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const lib = statement.body.match(/^LIB\s+CONNECT\s+TO\s+([\s\S]+)$/i);
    if (lib) {
      const value = unquote(lib[1].replace(/;$/, "").trim());
      context.registerConnection(value, value);
      return { operations: [] };
    }

    const connection = statement.body.match(/^(?:ODBC|OLEDB)?\s*CONNECT\s+(?:TO\s+)?([\s\S]+)$/i);
    if (connection) {
      const value = connection[1].replace(/;$/, "").trim();
      context.registerConnection(`Connection_${context.connections.size + 1}`, value);
    }
    return { operations: [] };
  }
}
