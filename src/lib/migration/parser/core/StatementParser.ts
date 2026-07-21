import { Tokenizer } from "./Tokenizer";
import type { ParsedStatement, SourceLocation, StatementKind, Token } from "./ParserTypes";
import { cleanIdentifier } from "./ParserUtils";
import { splitQlikScriptStatements } from "../../qlik-script-normalizer";

const PREFIX_PATTERNS: RegExp[] = [
  /^\s*(MAPPING)\b/i,
  /^\s*(NOCONCATENATE)\b/i,
  /^\s*((?:LEFT|RIGHT|INNER|OUTER)\s+JOIN)(?:\s*\(\s*[^)]+\s*\))?/i,
  /^\s*(JOIN)(?:\s*\(\s*[^)]+\s*\))?/i,
  /^\s*((?:LEFT|RIGHT|INNER|OUTER)\s+KEEP)(?:\s*\(\s*[^)]+\s*\))?/i,
  /^\s*(KEEP)(?:\s*\(\s*[^)]+\s*\))?/i,
  /^\s*(CONCATENATE)(?:\s*\(\s*[^)]+\s*\))?/i,
  /^\s*(CROSSTABLE)(?:\s*\(\s*[^)]*\s*\))?/i,
  /^\s*(GENERIC)\b/i,
  /^\s*(HIERARCHY)(?:\s*\(\s*[^)]*\s*\))?/i,
  /^\s*(INTERVALMATCH)(?:\s*\(\s*[^)]*\s*\))?/i,
  /^\s*(FIRST\s+\d+)\b/i,
  /^\s*(BUFFER)(?:\s*\(\s*[^)]*\s*\))?/i,
  /^\s*(ADD|REPLACE)\b/i,
];

function locationFromOffsets(
  source: string,
  fileName: string | undefined,
  startOffset: number,
  endOffset: number,
): SourceLocation {
  const before = source.slice(0, startOffset);
  const body = source.slice(startOffset, endOffset);
  const startLines = before.split("\n");
  const bodyLines = body.split("\n");
  return {
    fileName,
    startLine: startLines.length,
    startColumn: (startLines.at(-1)?.length ?? 0) + 1,
    endLine: startLines.length + bodyLines.length - 1,
    endColumn:
      bodyLines.length === 1
        ? (startLines.at(-1)?.length ?? 0) + body.length + 1
        : (bodyLines.at(-1)?.length ?? 0) + 1,
    startOffset,
    endOffset,
  };
}

function stripCommentsPreservingLayout(source: string): string {
  let result = "";
  let index = 0;
  let quote: string | undefined;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      result += char;
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          result += next;
          index += 2;
          continue;
        }
        quote = undefined;
      }
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/" && source[index - 1] !== ":") {
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          result += "  ";
          index += 2;
          break;
        }
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    const lineStart = index === 0 || source[index - 1] === "\n";
    if (lineStart && /^\s*REM(?:\s|$)/i.test(source.slice(index))) {
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function extractLabel(value: string): { label?: string; body: string } {
  let quote: string | undefined;
  let squareDepth = 0;
  let roundDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") roundDepth += 1;
    else if (char === ")") roundDepth = Math.max(0, roundDepth - 1);
    else if (char === ":" && squareDepth === 0 && roundDepth === 0) {
      const candidate = value.slice(0, index).trim();
      const body = value.slice(index + 1).trim();
      if (candidate && /^(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_.$#@ -]*)$/.test(candidate)) {
        return { label: cleanIdentifier(candidate), body };
      }
      break;
    }
  }
  return { body: value.trim() };
}

function extractPrefixes(value: string): { prefixes: string[]; body: string } {
  const prefixes: string[] = [];
  let body = value;

  while (body.trim()) {
    let matched = false;
    for (const pattern of PREFIX_PATTERNS) {
      const match = body.match(pattern);
      if (!match) continue;
      const full = match[0].trim();
      prefixes.push(full);
      body = body.slice(match[0].length).trimStart();
      matched = true;
      break;
    }
    if (!matched) break;
  }

  return { prefixes, body: body.trim() };
}

function classify(body: string, prefixes: string[]): StatementKind {
  const upper = body.trim().toUpperCase();
  const prefixText = prefixes.join(" ").toUpperCase();
  if (/^(SET|LET)\b/.test(upper)) return "variable";
  if (/^(LIB\s+CONNECT|CONNECT|ODBC\s+CONNECT|OLEDB\s+CONNECT)\b/.test(upper)) return "connection";
  if (/^STORE\b/.test(upper)) return "store";
  if (/^DROP\s+(TABLE|TABLES|FIELD|FIELDS)\b/.test(upper)) return "drop";
  if (/\bMAPPING\b/.test(prefixText)) return "mapping";
  if (/\bJOIN\b|\bKEEP\b/.test(prefixText)) return "join";
  if (/\bRESIDENT\b/.test(upper)) return "resident";
  if (/^(SQL\s+)?SELECT\b/.test(upper)) return "select";
  if (/^LOAD\b/.test(upper)) {
    if (/\bAUTOGENERATE\b/.test(upper) && /\bDATE\s*\(|\bITERNO\s*\(|\bRECNO\s*\(/.test(upper))
      return "calendar";
    if (/\bAPPLYMAP\s*\(/.test(upper)) return "applymap";
    return "load";
  }
  if (/^(FOR|NEXT|IF|ELSEIF|ELSE|END\s+IF|DO|LOOP|SUB|END\s+SUB|CALL|EXIT|SECTION)\b/.test(upper))
    return "control";
  return "unknown";
}

function normalizedStatement(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export interface ParseStatementsOptions {
  fileName?: string;
}

export class StatementParser {
  private readonly tokenizer = new Tokenizer();

  parse(source: string, options: ParseStatementsOptions = {}): ParsedStatement[] {
    return splitQlikScriptStatements(source).map((slice, index) => {
      const cleaned = slice.cleaned.replace(/;\s*$/, "").trim();
      const labelResult = extractLabel(cleaned);
      const prefixResult = extractPrefixes(labelResult.body);

      return {
        id: `stmt_${String(index + 1).padStart(5, "0")}`,
        raw: slice.raw,
        normalized: normalizedStatement(cleaned),
        location: locationFromOffsets(
          source,
          options.fileName,
          slice.startOffset,
          slice.endOffset,
        ),
        label: labelResult.label,
        prefixes: prefixResult.prefixes,
        body: prefixResult.body,
        kind: classify(prefixResult.body, prefixResult.prefixes),
      };
    });
  }

  tokenizeStatement(statement: ParsedStatement): Token[] {
    return this.tokenizer.tokenize(statement.body, {
      fileName: statement.location.fileName,
      includeComments: false,
      includeNewlines: false,
    });
  }
}
