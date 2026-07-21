import { ExpressionTokenizer } from "./ExpressionTokenizer";
import type {
  ExpressionAstNode,
  ExpressionIssue,
  ExpressionToken,
  FunctionNode,
  SetAnalysisNode,
  SetModifier,
} from "./ExpressionTypes";

const PRECEDENCE: Record<string, number> = {
  OR: 1, XOR: 1, AND: 2,
  "=": 3, "==": 3, "<>": 3, "!=": 3, ">": 3, "<": 3, ">=": 3, "<=": 3,
  "&": 4, "+": 5, "-": 5, "*": 6, "/": 6, "^": 7,
};

function splitTopLevel(value: string, separator = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote && value[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

export function parseSetAnalysis(raw: string, span?: { start: number; end: number; line: number; column: number }): SetAnalysisNode {
  const body = raw.replace(/^\{/, "").replace(/\}$/, "").trim();
  const lt = body.indexOf("<");
  const gt = body.lastIndexOf(">");
  const identifier = (lt >= 0 ? body.slice(0, lt) : body).trim() || "$";
  const modifierText = lt >= 0 && gt > lt ? body.slice(lt + 1, gt) : "";
  const modifiers: SetModifier[] = splitTopLevel(modifierText).flatMap((part) => {
    const match = part.match(/^\s*(?:\[([^\]]+)\]|([^+\-*/=]+?))\s*(\+=|-=|\*=|\/=|=)\s*(.*)$/s);
    if (!match) return [];
    const field = (match[1] || match[2] || "").trim();
    const valuesRaw = match[4].trim().replace(/^\{/, "").replace(/\}$/, "");
    return [{ field, operator: match[3] as SetModifier["operator"], values: splitTopLevel(valuesRaw), raw: part }];
  });
  return {
    kind: "set-analysis",
    identifier,
    modifiers,
    raw,
    span: span ?? { start: 0, end: raw.length, line: 1, column: 1 },
  };
}

export interface ParseExpressionResult {
  ast?: ExpressionAstNode;
  diagnostics: ExpressionIssue[];
}

export class ExpressionParser {
  private tokens: ExpressionToken[] = [];
  private index = 0;
  private diagnostics: ExpressionIssue[] = [];

  parse(source: string): ParseExpressionResult {
    this.tokens = new ExpressionTokenizer().tokenize(source);
    this.index = 0;
    this.diagnostics = [];
    try {
      const ast = this.parseBinary(0);
      if (this.peek().kind !== "eof" && this.peek().kind !== "rparen") {
        this.diagnostics.push({ severity: "warning", code: "UNCONSUMED_TOKENS", message: `Expression contains unparsed content near '${this.peek().value}'.`, recommendation: "Review the generated DAX before approval." });
      }
      return { ast, diagnostics: this.diagnostics };
    } catch (error) {
      return {
        diagnostics: [{ severity: "error", code: "EXPRESSION_PARSE_FAILED", message: error instanceof Error ? error.message : String(error), recommendation: "Retain the original Qlik expression and complete manual conversion." }],
      };
    }
  }

  private peek(offset = 0) { return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]; }
  private consume() { return this.tokens[this.index++]; }

  private parseBinary(minPrecedence: number): ExpressionAstNode {
    let left = this.parseUnary();
    while (true) {
      const next = this.peek();
      const op = next.kind === "operator" ? next.value.toUpperCase() : next.kind === "identifier" && /^(AND|OR|XOR)$/i.test(next.value) ? next.value.toUpperCase() : "";
      const precedence = PRECEDENCE[op];
      if (!precedence || precedence < minPrecedence) break;
      this.consume();
      const right = this.parseBinary(precedence + (op === "^" ? 0 : 1));
      left = { kind: "binary", operator: op, left, right, span: { start: left.span.start, end: right.span.end, line: left.span.line, column: left.span.column } };
    }
    return left;
  }

  private parseUnary(): ExpressionAstNode {
    const next = this.peek();
    if ((next.kind === "operator" && ["+", "-"].includes(next.value)) || (next.kind === "identifier" && /^NOT$/i.test(next.value))) {
      const op = this.consume();
      const operand = this.parseUnary();
      return { kind: "unary", operator: op.value.toUpperCase(), operand, span: { start: op.start, end: operand.span.end, line: op.line, column: op.column } };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionAstNode {
    const current = this.consume();
    if (current.kind === "number") return { kind: "literal", value: Number(current.value), valueType: "number", span: current };
    if (current.kind === "string") return { kind: "literal", value: current.value.slice(1, -1).replace(/''/g, "'"), valueType: "string", span: current };
    if (current.kind === "variable") return { kind: "variable", name: current.value.replace(/^\$\(\s*=?\s*/, "").replace(/\)$/, "").trim().split(/[ ,]/)[0], expansion: current.value, span: current };
    if (current.kind === "field") {
      const [table, name] = current.value.includes(".") ? current.value.split(/\.(.+)/) : [undefined, current.value];
      return { kind: "field", name: name ?? current.value, table, span: current };
    }
    if (current.kind === "set-analysis") return parseSetAnalysis(current.value, current);
    if (current.kind === "lparen") {
      const inner = this.parseBinary(0);
      if (this.peek().kind === "rparen") this.consume();
      return inner;
    }
    if (current.kind === "identifier") {
      const name = current.value.trim();
      if (/^(true|false)$/i.test(name)) return { kind: "literal", value: /^true$/i.test(name), valueType: "boolean", span: current };
      if (/^null$/i.test(name)) return { kind: "literal", value: null, valueType: "null", span: current };
      if (this.peek().kind === "lparen") return this.parseFunction(current);
      const [table, field] = name.includes(".") ? name.split(/\.(.+)/) : [undefined, name];
      return { kind: "field", name: field ?? name, table, span: current };
    }
    return { kind: "raw", value: current.value, span: current };
  }

  private parseFunction(nameToken: ExpressionToken): FunctionNode {
    this.consume(); // lparen
    const node: FunctionNode = { kind: "function", name: nameToken.value.trim(), args: [], distinct: false, total: false, span: { ...nameToken } };
    if (this.peek().kind === "set-analysis") node.setAnalysis = parseSetAnalysis(this.consume().value, this.tokens[this.index - 1]);
    if (this.peek().kind === "identifier" && /^DISTINCT(?:\s|$)/i.test(this.peek().value)) {
      const distinctToken = this.consume();
      node.distinct = true;
      const remainder = distinctToken.value.replace(/^DISTINCT\s*/i, "").trim();
      if (remainder) node.args.push({ kind: "field", name: remainder, span: distinctToken });
    }
    if (this.peek().kind === "identifier" && /^TOTAL$/i.test(this.peek().value)) {
      node.total = true; this.consume();
      if (this.peek().kind === "operator" && this.peek().value === "<") {
        while (this.peek().kind !== "eof" && !(this.peek().kind === "operator" && this.peek().value === ">")) this.consume();
        if (this.peek().value === ">") this.consume();
      }
    }
    while (this.peek().kind !== "rparen" && this.peek().kind !== "eof") {
      node.args.push(this.parseBinary(0));
      if (this.peek().kind === "comma") this.consume();
      else if (this.peek().kind !== "rparen") {
        // Qlik permits a set expression immediately before the aggregation argument.
        if (node.args.length > 0) break;
      }
    }
    const end = this.peek().kind === "rparen" ? this.consume() : this.peek();
    node.span.end = end.end;
    return node;
  }
}

export function expressionDepth(node?: ExpressionAstNode): number {
  if (!node) return 0;
  if (node.kind === "binary") return 1 + Math.max(expressionDepth(node.left), expressionDepth(node.right));
  if (node.kind === "unary") return 1 + expressionDepth(node.operand);
  if (node.kind === "function") return 1 + Math.max(0, ...node.args.map(expressionDepth));
  return 1;
}

export function walkExpression(node: ExpressionAstNode | undefined, visit: (node: ExpressionAstNode) => void): void {
  if (!node) return;
  visit(node);
  if (node.kind === "binary") { walkExpression(node.left, visit); walkExpression(node.right, visit); }
  if (node.kind === "unary") walkExpression(node.operand, visit);
  if (node.kind === "function") {
    if (node.setAnalysis) visit(node.setAnalysis);
    node.args.forEach((arg) => walkExpression(arg, visit));
  }
}
