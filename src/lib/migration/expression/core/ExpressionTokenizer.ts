import type { ExpressionToken, ExpressionTokenKind } from "./ExpressionTypes";

function token(kind: ExpressionTokenKind, value: string, start: number, end: number, source: string): ExpressionToken {
  const before = source.slice(0, start);
  const lines = before.split(/\r?\n/);
  return { kind, value, start, end, line: lines.length, column: lines.at(-1)!.length + 1 };
}

function matchingEnd(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

export class ExpressionTokenizer {
  tokenize(input: string): ExpressionToken[] {
    const source = input.replace(/^\s*=\s*/, "");
    const tokens: ExpressionToken[] = [];
    let i = 0;
    while (i < source.length) {
      const ch = source[i];
      if (/\s/.test(ch)) { i++; continue; }

      if (source.startsWith("$(", i)) {
        const end = matchingEnd(source, i + 1, "(", ")");
        tokens.push(token("variable", source.slice(i, end), i, end, source));
        i = end;
        continue;
      }
      if (ch === "{") {
        const end = matchingEnd(source, i, "{", "}");
        tokens.push(token("set-analysis", source.slice(i, end), i, end, source));
        i = end;
        continue;
      }
      if (ch === "[") {
        const end = source.indexOf("]", i + 1);
        const stop = end >= 0 ? end + 1 : source.length;
        tokens.push(token("field", source.slice(i + 1, stop - 1), i, stop, source));
        i = stop;
        continue;
      }
      if (ch === "'" || ch === '"') {
        const quote = ch;
        let end = i + 1;
        while (end < source.length) {
          if (source[end] === quote) {
            if (source[end + 1] === quote) { end += 2; continue; }
            end++;
            break;
          }
          end++;
        }
        tokens.push(token("string", source.slice(i, end), i, end, source));
        i = end;
        continue;
      }
      if (/\d/.test(ch) || (ch === "." && /\d/.test(source[i + 1] ?? ""))) {
        const match = source.slice(i).match(/^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
        const value = match?.[0] ?? ch;
        tokens.push(token("number", value, i, i + value.length, source));
        i += value.length;
        continue;
      }
      if (/[A-Za-z_@$#]/.test(ch)) {
        const match = source.slice(i).match(/^[A-Za-z_@$#][A-Za-z0-9_.$#@ ]*/);
        const value = (match?.[0] ?? ch).trimEnd();
        tokens.push(token("identifier", value, i, i + value.length, source));
        i += value.length;
        continue;
      }
      if (ch === "(") { tokens.push(token("lparen", ch, i, i + 1, source)); i++; continue; }
      if (ch === ")") { tokens.push(token("rparen", ch, i, i + 1, source)); i++; continue; }
      if (ch === "," || ch === ";") { tokens.push(token("comma", ch, i, i + 1, source)); i++; continue; }

      const two = source.slice(i, i + 2);
      const op = [">=", "<=", "<>", "!=", "==", "+=", "-=", "*=", "/="].includes(two) ? two : ch;
      tokens.push(token("operator", op, i, i + op.length, source));
      i += op.length;
    }
    tokens.push(token("eof", "", source.length, source.length, source));
    return tokens;
  }
}
