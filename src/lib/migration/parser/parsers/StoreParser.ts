import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { baseOperation, cleanIdentifier, findTopLevelKeyword, unquote } from "../core/ParserUtils";

export class StoreParser implements StatementParserPlugin {
  readonly name = "StoreParser";
  readonly priority = 220;

  canParse(statement: ParsedStatement): boolean {
    return statement.kind === "store" || /^STORE\b/i.test(statement.body.trim());
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const operation = baseOperation(statement, context, "STORE", "store");
    const body = statement.body
      .replace(/^STORE\s+/i, "")
      .replace(/;$/, "")
      .trim();
    const into = findTopLevelKeyword(body, ["INTO"]);

    if (into) {
      const left = body.slice(0, into.index).trim();
      let right = body.slice(into.index + into.keyword.length).trim();
      const from = findTopLevelKeyword(left, ["FROM"]);
      const sourceText = from ? left.slice(from.index + from.keyword.length).trim() : left;
      const formatMatch = right.match(/\s*\(([^()]*)\)\s*$/);
      const format = formatMatch?.[1]?.trim();
      if (formatMatch?.index !== undefined) right = right.slice(0, formatMatch.index).trim();

      const sourceTable = cleanIdentifier(sourceText);
      const targetPath = unquote(context.resolveVariables(right));
      operation.targetTable = sourceTable;
      operation.sourceTables = [sourceTable];
      operation.store = { sourceTable, targetPath, format };
    } else {
      operation.diagnostics.push({
        code: "QLIK_STORE_UNPARSED",
        severity: "warning",
        message: "The STORE statement was detected but its source or target could not be parsed.",
        location: statement.location,
        statementId: statement.id,
        parser: this.name,
      });
    }

    return { operations: [operation] };
  }
}
