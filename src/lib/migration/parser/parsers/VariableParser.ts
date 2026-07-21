import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";

export class VariableParser implements StatementParserPlugin {
  readonly name = "VariableParser";
  readonly priority = 300;

  canParse(statement: ParsedStatement): boolean {
    return statement.kind === "variable";
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const match = statement.body.match(
      /^\s*(SET|LET)\s+([A-Za-z_][A-Za-z0-9_.$#@]*)\s*=\s*([\s\S]*)$/i,
    );
    if (match) {
      const name = match[2];
      const value = match[3].replace(/;$/, "").trim();
      context.registerVariable(name, value);
    } else {
      context.addDiagnostic({
        code: "QLIK_VARIABLE_UNPARSED",
        severity: "warning",
        message: "A SET/LET statement was detected but could not be parsed.",
        location: statement.location,
        statementId: statement.id,
        parser: this.name,
      });
    }
    return { operations: [] };
  }
}
