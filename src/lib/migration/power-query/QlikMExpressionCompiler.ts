export interface QlikMCompilerContext {
  resolveApplyMap?: (
    mapName: string,
    lookupExpression: string,
    defaultExpression: string,
  ) => string | null;
  resolveVariable?: (name: string) => string | null;
}

export interface CompiledQlikMExpression {
  code: string | null;
  fields: string[];
  variables: string[];
  warnings: string[];
}

type TokenKind =
  | "identifier"
  | "field"
  | "variable"
  | "number"
  | "string"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  position: number;
}

interface CompiledNode {
  code: string;
  fields: string[];
  variables: string[];
  warnings: string[];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function merge(...nodes: CompiledNode[]): Pick<CompiledNode, "fields" | "variables" | "warnings"> {
  return {
    fields: unique(nodes.flatMap((node) => node.fields)),
    variables: unique(nodes.flatMap((node) => node.variables)),
    warnings: nodes.flatMap((node) => node.warnings),
  };
}

function mString(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function recordField(name: string): string {
  return `Record.FieldOrDefault(_, ${mString(name)}, null)`;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "[") {
      const start = index;
      index += 1;
      let value = "";
      while (index < input.length) {
        if (input[index] === "]" && input[index + 1] === "]") {
          value += "]";
          index += 2;
          continue;
        }
        if (input[index] === "]") {
          index += 1;
          break;
        }
        value += input[index++];
      }
      tokens.push({ kind: "field", value: value.trim(), position: start });
      continue;
    }
    if (char === "$" && input[index + 1] === "(") {
      const start = index;
      index += 2;
      let depth = 1;
      let value = "";
      while (index < input.length && depth > 0) {
        const next = input[index++];
        if (next === "(") depth += 1;
        else if (next === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        if (depth > 0) value += next;
      }
      tokens.push({ kind: "variable", value: value.trim(), position: start });
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      const start = index;
      index += 1;
      let value = "";
      while (index < input.length) {
        const next = input[index++];
        if (next === quote) {
          if (input[index] === quote) {
            value += quote;
            index += 1;
            continue;
          }
          break;
        }
        value += next;
      }
      tokens.push({ kind: "string", value, position: start });
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(input[index + 1] || ""))) {
      const start = index;
      let value = "";
      while (index < input.length && /[0-9.eE+-]/.test(input[index])) {
        const next = input[index];
        if ((next === "+" || next === "-") && !/[eE]/.test(value[value.length - 1] || "")) break;
        value += next;
        index += 1;
      }
      tokens.push({ kind: "number", value, position: start });
      continue;
    }
    if (/[A-Za-z_@]/.test(char)) {
      const start = index;
      let value = "";
      while (index < input.length && /[A-Za-z0-9_.$#@]/.test(input[index])) value += input[index++];
      tokens.push({ kind: "identifier", value, position: start });
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "lparen", value: char, position: index++ });
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rparen", value: char, position: index++ });
      continue;
    }
    if (char === ",") {
      tokens.push({ kind: "comma", value: char, position: index++ });
      continue;
    }
    const pair = input.slice(index, index + 2);
    if (["<=", ">=", "<>", "!=", "=="].includes(pair)) {
      tokens.push({ kind: "operator", value: pair, position: index });
      index += 2;
      continue;
    }
    if (["=", "<", ">", "+", "-", "*", "/", "&"].includes(char)) {
      tokens.push({ kind: "operator", value: char, position: index++ });
      continue;
    }
    throw new Error(`Unsupported token '${char}' at position ${index + 1}.`);
  }
  tokens.push({ kind: "eof", value: "", position: input.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: QlikMCompilerContext,
  ) {}

  parse(): CompiledNode {
    const result = this.parseOr();
    if (this.current().kind !== "eof") {
      throw new Error(`Unexpected token '${this.current().value}' at position ${this.current().position + 1}.`);
    }
    return result;
  }

  private current(): Token {
    return this.tokens[this.index];
  }

  private consume(): Token {
    return this.tokens[this.index++];
  }

  private match(kind: TokenKind, value?: string): boolean {
    const token = this.current();
    if (token.kind !== kind) return false;
    if (value !== undefined && token.value.toLowerCase() !== value.toLowerCase()) return false;
    this.index += 1;
    return true;
  }

  private parseOr(): CompiledNode {
    let left = this.parseAnd();
    while (this.current().kind === "identifier" && this.current().value.toLowerCase() === "or") {
      this.consume();
      const right = this.parseAnd();
      left = { code: `(${left.code} or ${right.code})`, ...merge(left, right) };
    }
    return left;
  }

  private parseAnd(): CompiledNode {
    let left = this.parseComparison();
    while (this.current().kind === "identifier" && this.current().value.toLowerCase() === "and") {
      this.consume();
      const right = this.parseComparison();
      left = { code: `(${left.code} and ${right.code})`, ...merge(left, right) };
    }
    return left;
  }

  private parseComparison(): CompiledNode {
    let left = this.parseConcat();
    while (this.current().kind === "operator" && ["=", "==", "<>", "!=", ">", "<", ">=", "<="].includes(this.current().value)) {
      const op = this.consume().value;
      const right = this.parseConcat();
      const mapped = op === "!=" || op === "<>" ? "<>" : op === "==" ? "=" : op;
      
      // Attempt to cast both sides to numbers for comparison to emulate Qlik's dual-type logic.
      // This prevents "We cannot apply operator < to types Number and Text" when 
      // comparing CSV text columns to numeric literals (e.g. SalesAmount > 1000).
      const letExpr = `(let _l = ${left.code}, _r = ${right.code}, _nl = try Number.From(_l) otherwise _l, _nr = try Number.From(_r) otherwise _r in _nl ${mapped} _nr)`;
      left = { code: letExpr, ...merge(left, right) };
    }
    return left;
  }

  private parseConcat(): CompiledNode {
    let left = this.parseAdditive();
    while (this.current().kind === "operator" && this.current().value === "&") {
      this.consume();
      const right = this.parseAdditive();
      left = { code: `(Text.From(${left.code}) & Text.From(${right.code}))`, ...merge(left, right) };
    }
    return left;
  }

  private parseAdditive(): CompiledNode {
    let left = this.parseMultiplicative();
    while (this.current().kind === "operator" && ["+", "-"].includes(this.current().value)) {
      const op = this.consume().value;
      const right = this.parseMultiplicative();
      // Wrap both sides in Number.From() — CSV sources load everything as Text,
      // and M cannot apply + / - to Text types.
      const safeLeft = `(try Number.From(${left.code}) otherwise null)`;
      const safeRight = `(try Number.From(${right.code}) otherwise null)`;
      left = { code: `(${safeLeft} ${op} ${safeRight})`, ...merge(left, right) };
    }
    return left;
  }

  private parseMultiplicative(): CompiledNode {
    let left = this.parseUnary();
    while (this.current().kind === "operator" && ["*", "/"].includes(this.current().value)) {
      const op = this.consume().value;
      const right = this.parseUnary();
      // Wrap both sides in Number.From() — CSV sources load everything as Text.
      const safeLeft = `(try Number.From(${left.code}) otherwise null)`;
      const safeRight = `(try Number.From(${right.code}) otherwise null)`;
      if (op === "/") {
        // Guard against divide-by-zero to prevent Expression.Error in Power Query.
        left = {
          code: `(if ${safeRight} = null or ${safeRight} = 0 then null else ${safeLeft} / ${safeRight})`,
          ...merge(left, right),
        };
      } else {
        left = { code: `(${safeLeft} ${op} ${safeRight})`, ...merge(left, right) };
      }
    }
    return left;
  }

  private parseUnary(): CompiledNode {
    if (this.current().kind === "identifier" && this.current().value.toLowerCase() === "not") {
      this.consume();
      const value = this.parseUnary();
      return { code: `(not ${value.code})`, ...merge(value) };
    }
    if (this.current().kind === "operator" && ["+", "-"].includes(this.current().value)) {
      const op = this.consume().value;
      const value = this.parseUnary();
      return { code: `(${op}${value.code})`, ...merge(value) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): CompiledNode {
    const token = this.current();
    if (this.match("lparen")) {
      const value = this.parseOr();
      if (!this.match("rparen")) throw new Error(`Missing ')' near position ${this.current().position + 1}.`);
      return { code: `(${value.code})`, ...merge(value) };
    }
    if (token.kind === "number") {
      this.consume();
      return { code: token.value, fields: [], variables: [], warnings: [] };
    }
    if (token.kind === "string") {
      this.consume();
      return { code: mString(token.value), fields: [], variables: [], warnings: [] };
    }
    if (token.kind === "field") {
      this.consume();
      return { code: recordField(token.value), fields: [token.value], variables: [], warnings: [] };
    }
    if (token.kind === "variable") {
      this.consume();
      const resolved = this.context.resolveVariable?.(token.value) ?? null;
      if (!resolved) throw new Error(`Qlik variable '$(${token.value})' could not be resolved for Power Query.`);
      return { code: resolved, fields: [], variables: [token.value], warnings: [] };
    }
    if (token.kind === "identifier") {
      this.consume();
      const low = token.value.toLowerCase();
      if (low === "null" || low === "null()") return { code: "null", fields: [], variables: [], warnings: [] };
      if (low === "true" || low === "false") return { code: low, fields: [], variables: [], warnings: [] };
      if (this.match("lparen")) return this.parseFunction(token.value);
      return { code: recordField(token.value), fields: [token.value], variables: [], warnings: [] };
    }
    throw new Error(`Expected an expression at position ${token.position + 1}.`);
  }

  private parseFunction(name: string): CompiledNode {
    const args: CompiledNode[] = [];
    if (!this.match("rparen")) {
      while (true) {
        args.push(this.parseOr());
        if (this.match("rparen")) break;
        if (!this.match("comma")) throw new Error(`Expected ',' or ')' near position ${this.current().position + 1}.`);
      }
    }
    const fn = name.toLowerCase();
    const all = merge(...args);
    const arg = (index: number, fallback = "null") => args[index]?.code ?? fallback;
    if (fn === "if") {
      if (args.length < 2) throw new Error("If() requires a condition and a true expression.");
      return { code: `if ${arg(0, "false")} then ${arg(1)} else ${arg(2)}`, ...all };
    }
    if (fn === "abs" || fn === "fabs") return { code: `(try Number.Abs(Number.From(${arg(0, "0")})) otherwise null)`, ...all };
    if (fn === "round") return { code: `(try Number.Round(Number.From(${arg(0, "0")})${args[1] ? `, Int64.From(${arg(1)})` : ""}) otherwise null)`, ...all };
    if (fn === "floor") return { code: `(try Number.RoundDown(Number.From(${arg(0, "0")})) otherwise null)`, ...all };
    if (fn === "ceil" || fn === "ceiling") return { code: `(try Number.RoundUp(Number.From(${arg(0, "0")})) otherwise null)`, ...all };
    if (fn === "len") return { code: `(try Text.Length(Text.From(${arg(0, '""')})) otherwise null)`, ...all };
    if (fn === "trim") return { code: `(try Text.Trim(Text.From(${arg(0, '""')})) otherwise null)`, ...all };
    if (fn === "upper") return { code: `(try Text.Upper(Text.From(${arg(0, '""')})) otherwise null)`, ...all };
    if (fn === "lower") return { code: `(try Text.Lower(Text.From(${arg(0, '""')})) otherwise null)`, ...all };
    if (fn === "date" || fn === "date#") return { code: `(try Date.From(${arg(0)}) otherwise try Date.FromText(Text.From(${arg(0)}), [Culture="en-US"]) otherwise null)`, ...all };
    if (fn === "num" || fn === "num#") return { code: `(try Number.From(${arg(0)}) otherwise null)`, ...all };
    if (fn === "year") return { code: `let _d = try Date.From(${arg(0)}) otherwise null in if _d = null then null else Date.Year(_d)`, ...all };
    if (fn === "month") return { code: `let _d = try Date.From(${arg(0)}) otherwise null in if _d = null then null else Date.Month(_d)`, ...all };
    if (fn === "day") return { code: `let _d = try Date.From(${arg(0)}) otherwise null in if _d = null then null else Date.Day(_d)`, ...all };
    if (fn === "week") return { code: `let _d = try Date.From(${arg(0)}) otherwise null in if _d = null then null else Date.WeekOfYear(_d, Day.Monday)`, ...all };
    if (fn === "monthname") return { code: `let _d = try Date.From(${arg(0)}) otherwise null in if _d = null then null else Date.ToText(_d, "MMM yyyy", "en-US")`, ...all };
    if (fn === "quartername") return { code: `let _d = try Date.From(${arg(0)}) otherwise null in if _d = null then null else "Q" & Text.From(Date.QuarterOfYear(_d)) & " " & Text.From(Date.Year(_d))`, ...all };
    if (fn === "today") return { code: "Date.From(DateTime.LocalNow())", ...all };
    if (fn === "now") return { code: "DateTime.LocalNow()", ...all };
    if (fn === "isnull") return { code: `(${arg(0)} = null)`, ...all };
    if (fn === "alt") return { code: `List.First(List.RemoveNulls({${args.map((item) => item.code).join(", ")}}), null)`, ...all };
    if (fn === "applymap") {
      if (args.length < 2) throw new Error("ApplyMap() requires a map name and lookup expression.");
      const mapToken = this.tokens[Math.max(0, this.index - 1)];
      const mapNameCode = args[0].code;
      const mapName = mapNameCode.startsWith('"') && mapNameCode.endsWith('"')
        ? mapNameCode.slice(1, -1).replace(/""/g, '"')
        : "";
      if (!mapName) throw new Error("ApplyMap() map name must be a text literal.");
      const resolved = this.context.resolveApplyMap?.(mapName, arg(1), arg(2)) ?? null;
      if (!resolved) throw new Error(`ApplyMap('${mapName}', ...) could not be resolved to a mapping query.`);
      return { code: `(${resolved})`, ...all, warnings: [...all.warnings, ...(mapToken ? [] : [])] };
    }
    throw new Error(`Unsupported Qlik row function '${name}()'.`);
  }
}

export function compileQlikMExpression(
  expression: string,
  context: QlikMCompilerContext = {},
): CompiledQlikMExpression {
  const source = String(expression || "").trim();
  if (!source) return { code: null, fields: [], variables: [], warnings: ["Expression is empty."] };
  try {
    const compiled = new Parser(tokenize(source), context).parse();
    return {
      code: compiled.code,
      fields: unique(compiled.fields),
      variables: unique(compiled.variables),
      warnings: compiled.warnings,
    };
  } catch (error) {
    return {
      code: null,
      fields: [],
      variables: [],
      warnings: [(error as Error).message],
    };
  }
}
