import type { SourceLocation, Token, TokenKind } from "./ParserTypes";

const KEYWORDS = new Set([
  "ADD",
  "ALIAS",
  "AS",
  "AUTOGENERATE",
  "BINARY",
  "BUFFER",
  "BY",
  "CALL",
  "CONCATENATE",
  "CONNECT",
  "CROSSTABLE",
  "DISTINCT",
  "DO",
  "DROP",
  "EACH",
  "ELSE",
  "ELSEIF",
  "END",
  "EXIT",
  "FIELD",
  "FIELDS",
  "FIRST",
  "FOR",
  "FROM",
  "GENERIC",
  "GROUP",
  "HIERARCHY",
  "IF",
  "INLINE",
  "INNER",
  "INTERVALMATCH",
  "JOIN",
  "KEEP",
  "LEFT",
  "LET",
  "LIB",
  "LOAD",
  "LOOP",
  "MAPPING",
  "NEXT",
  "NOCONCATENATE",
  "ODBC",
  "OLEDB",
  "ORDER",
  "OUTER",
  "QUALIFY",
  "RENAME",
  "REPLACE",
  "RESIDENT",
  "RIGHT",
  "SECTION",
  "SELECT",
  "SET",
  "SQL",
  "STORE",
  "TABLE",
  "TABLES",
  "THEN",
  "TO",
  "TRACE",
  "UNQUALIFY",
  "UNTIL",
  "WHERE",
  "WHILE",
]);

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_.$#@]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_.$#@-]/.test(char);
}

export interface TokenizeOptions {
  fileName?: string;
  includeComments?: boolean;
  includeNewlines?: boolean;
}

export class Tokenizer {
  tokenize(source: string, options: TokenizeOptions = {}): Token[] {
    const tokens: Token[] = [];
    let index = 0;
    let line = 1;
    let column = 1;

    const location = (
      startOffset: number,
      startLine: number,
      startColumn: number,
      endOffset: number,
      endLine: number,
      endColumn: number,
    ): SourceLocation => ({
      fileName: options.fileName,
      startLine,
      startColumn,
      endLine,
      endColumn,
      startOffset,
      endOffset,
    });

    const push = (
      kind: TokenKind,
      value: string,
      startOffset: number,
      startLine: number,
      startColumn: number,
    ): void => {
      tokens.push({
        kind,
        value,
        upperValue: value.toUpperCase(),
        location: location(startOffset, startLine, startColumn, index, line, column),
      });
    };

    const advance = (): string => {
      const char = source[index] ?? "";
      index += 1;
      if (char === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      return char;
    };

    while (index < source.length) {
      const char = source[index];
      const next = source[index + 1];
      const startOffset = index;
      const startLine = line;
      const startColumn = column;

      if (char === "\r") {
        advance();
        continue;
      }

      if (char === "\n") {
        advance();
        if (options.includeNewlines) push("newline", "\n", startOffset, startLine, startColumn);
        continue;
      }

      if (/\s/.test(char)) {
        advance();
        while (index < source.length && /[\t\f\v ]/.test(source[index])) advance();
        continue;
      }

      if (char === "/" && next === "/" && source[index - 1] !== ":") {
        let value = "";
        while (index < source.length && source[index] !== "\n") value += advance();
        if (options.includeComments) push("comment", value, startOffset, startLine, startColumn);
        continue;
      }

      if (char === "/" && next === "*") {
        let value = advance() + advance();
        while (index < source.length) {
          if (source[index] === "*" && source[index + 1] === "/") {
            value += advance() + advance();
            break;
          }
          value += advance();
        }
        if (options.includeComments) push("comment", value, startOffset, startLine, startColumn);
        continue;
      }

      if ((char === "R" || char === "r") && /^REM(?:\s|$)/i.test(source.slice(index, index + 4))) {
        const before = index === 0 ? "\n" : source[index - 1];
        if (before === "\n" || /\s/.test(before)) {
          let value = "";
          while (index < source.length && source[index] !== "\n") value += advance();
          if (options.includeComments) push("comment", value, startOffset, startLine, startColumn);
          continue;
        }
      }

      if (char === "$" && next === "(") {
        let value = advance() + advance();
        let depth = 1;
        let quote: string | undefined;
        while (index < source.length && depth > 0) {
          const current = advance();
          value += current;
          if (quote) {
            if (current === quote) quote = undefined;
            continue;
          }
          if (current === "'" || current === '"') quote = current;
          else if (current === "(") depth += 1;
          else if (current === ")") depth -= 1;
        }
        push("variable", value, startOffset, startLine, startColumn);
        continue;
      }

      if (char === "'" || char === '"' || char === "`") {
        const quote = char;
        let value = advance();
        while (index < source.length) {
          const current = advance();
          value += current;
          if (current !== quote) continue;
          if (source[index] === quote && (quote === "'" || quote === '"')) {
            value += advance();
            continue;
          }
          break;
        }
        push("string", value, startOffset, startLine, startColumn);
        continue;
      }

      if (char === "[") {
        let value = advance();
        while (index < source.length) {
          const current = advance();
          value += current;
          if (current === "]") {
            if (source[index] === "]") {
              value += advance();
              continue;
            }
            break;
          }
        }
        push("identifier", value, startOffset, startLine, startColumn);
        continue;
      }

      if (/\d/.test(char) || (char === "." && /\d/.test(next ?? ""))) {
        let value = advance();
        while (index < source.length && /[0-9A-Fa-fxX.eE+-]/.test(source[index])) {
          const candidate = value + source[index];
          if (!/^[-+]?(?:0[xX][0-9A-Fa-f]*|\d*\.?\d*(?:[eE][-+]?\d*)?)$/.test(candidate)) break;
          value += advance();
        }
        push("number", value, startOffset, startLine, startColumn);
        continue;
      }

      if (isIdentifierStart(char)) {
        let value = advance();
        while (index < source.length && isIdentifierPart(source[index])) value += advance();
        push(
          KEYWORDS.has(value.toUpperCase()) ? "keyword" : "identifier",
          value,
          startOffset,
          startLine,
          startColumn,
        );
        continue;
      }

      const twoChar = `${char}${next ?? ""}`;
      if (["<=", ">=", "<>", "!=", "==", "=>", "=:", "::"].includes(twoChar)) {
        advance();
        advance();
        push("operator", twoChar, startOffset, startLine, startColumn);
        continue;
      }

      if ("+-*/&=<>|".includes(char)) {
        advance();
        push("operator", char, startOffset, startLine, startColumn);
        continue;
      }

      if ("(),;:{}".includes(char)) {
        advance();
        push("punctuation", char, startOffset, startLine, startColumn);
        continue;
      }

      advance();
      push("unknown", char, startOffset, startLine, startColumn);
    }

    tokens.push({
      kind: "eof",
      value: "",
      upperValue: "",
      location: location(index, line, column, index, line, column),
    });

    return tokens;
  }
}
