import type { ParsedOperation, ParserContextLike, ParserDiagnostic } from "./ParserTypes";

function cleanVariableName(value: string): string {
  return value
    .trim()
    .replace(/^\$\(|\)$/g, "")
    .trim();
}

export class ParserContext implements ParserContextLike {
  readonly fileName?: string;
  readonly variables = new Map<string, string>();
  readonly connections = new Map<string, string>();
  readonly operations: ParsedOperation[] = [];
  readonly diagnostics: ParserDiagnostic[] = [];
  lastCreatedTable?: string;

  private operationSequence = 0;

  constructor(fileName?: string) {
    this.fileName = fileName;
  }

  nextOperationId(prefix = "op"): string {
    this.operationSequence += 1;
    return `${prefix}_${String(this.operationSequence).padStart(5, "0")}`;
  }

  resolveVariables(value: string): string {
    let resolved = value;
    let previous = "";
    let pass = 0;

    while (resolved !== previous && pass < 10) {
      previous = resolved;
      resolved = resolved.replace(/\$\(\s*([^)]+?)\s*\)/g, (match, rawName: string) => {
        const name = cleanVariableName(rawName);
        const stored = this.variables.get(name) ?? this.variables.get(name.toLowerCase());
        if (stored === undefined) return match;
        const trimmed = stored.trim();
        if (
          (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
          (trimmed.startsWith('"') && trimmed.endsWith('"'))
        ) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      });
      pass += 1;
    }

    return resolved;
  }

  addDiagnostic(diagnostic: ParserDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  registerVariable(name: string, value: string): void {
    const cleaned = cleanVariableName(name);
    this.variables.set(cleaned, value);
    this.variables.set(cleaned.toLowerCase(), value);
  }

  registerConnection(name: string, value: string): void {
    this.connections.set(name, value);
  }

  registerOperation(operation: ParsedOperation): void {
    this.operations.push(operation);
  }

  setLastCreatedTable(tableName: string | undefined): void {
    this.lastCreatedTable = tableName;
  }
}
