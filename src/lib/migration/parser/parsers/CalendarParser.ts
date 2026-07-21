import type {
  ParsedStatement,
  ParserContextLike,
  ParserResult,
  StatementParserPlugin,
} from "../core/ParserTypes";
import { parseLoadOperation } from "./LoadParser";

function extractCalendarBounds(raw: string): { minExpression?: string; maxExpression?: string } {
  const whileMatch = raw.match(/\bWHILE\s+([\s\S]+?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|$)/i);
  const minMatch = raw.match(/\b(?:MinDate|vMinDate|Min_Date)\b\s*(?:=|AS)?\s*([^,;]+)/i);
  const maxMatch = whileMatch?.[1]?.match(/<=\s*([^;]+)/);
  return {
    minExpression: minMatch?.[1]?.trim(),
    maxExpression: maxMatch?.[1]?.trim(),
  };
}

export class CalendarParser implements StatementParserPlugin {
  readonly name = "CalendarParser";
  readonly priority = 180;

  canParse(statement: ParsedStatement): boolean {
    if (statement.kind === "calendar") return true;
    const text = `${statement.label ?? ""} ${statement.body}`;
    return (
      /\bAUTOGENERATE\b/i.test(text) &&
      /\b(?:DATE|YEAR|MONTH|MONTHSTART|WEEK|WEEKDAY|DAY|YEARNAME|MONTHNAME|ITERNO|RECNO)\s*\(/i.test(
        text,
      )
    );
  }

  parse(statement: ParsedStatement, context: ParserContextLike): ParserResult {
    const operation = parseLoadOperation(statement, context);
    operation.kind = "CALENDAR";
    const bounds = extractCalendarBounds(statement.body);
    operation.calendar = {
      ...bounds,
      generatedFields: operation.fields.map((field) => field.name),
      sourceTable: operation.sourceTables[0],
    };
    operation.attributes.calendarConfidence = /calendar|date/i.test(statement.label ?? "")
      ? 0.98
      : 0.8;
    return { operations: [operation] };
  }
}
