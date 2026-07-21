import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { baseOperation } from "../core/ParserUtils";
import { parseLoadOperation } from "./LoadParser";

export class ApplyMapParser implements StatementParserPlugin {
  readonly name = "ApplyMapParser";
  readonly priority = 190;

  canParse(statement: ParsedStatement): boolean {
    return (
      /\bAPPLYMAP\s*\(/i.test(statement.body) &&
      /^(?:LOAD|SQL\s+SELECT|SELECT)\b/i.test(statement.body.trim())
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const load = parseLoadOperation(statement, context);
    const operations = [load];

    for (const call of load.applyMaps) {
      const applyMap = baseOperation(statement, context, "APPLYMAP", "applymap");
      applyMap.targetTable = load.targetTable;
      applyMap.sourceTables = [call.mapName];
      applyMap.applyMaps = [call];
      applyMap.attributes.outputField = call.outputField;
      applyMap.attributes.lookupExpression = call.lookupExpression;
      applyMap.attributes.defaultExpression = call.defaultExpression;
      operations.push(applyMap);
    }

    return { operations };
  }
}
