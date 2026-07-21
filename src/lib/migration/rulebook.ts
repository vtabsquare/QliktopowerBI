import type { Requirement, BusinessMetadata, FinalTable } from "./types";

/**
 * Generates a structured Markdown migration guide based on provided requirements.
 */
export function generateMarkdownRuleBook(requirement: Requirement): string {
  const template = `# Migration Rule Book: {{ReportName}}
  
## Strategic Objective
{{Objective}}

## Technical Core Requirements
{{Requirements}}

## Sample Context Reference Traces
{{SampleData}}`;

  return template
    .replace("{{ReportName}}", requirement.reportName || "Unnamed Migration Workspace")
    .replace("{{Objective}}", requirement.businessObjective || "No clear parameters provided.")
    .replace("{{Requirements}}", requirement.businessRequirement || "No rules assigned.")
    .replace("{{SampleData}}", requirement.sampleData || "No testing arrays populated.");
}

/**
 * Compiles metadata rules into a standardized BusinessMetadata layout shape.
 */
export function compileRuleBookBusinessMetadata(requirement: Requirement, markdownContent: string): BusinessMetadata {
  return {
    reportName: requirement.reportName || "Unnamed Migration Workspace",
    businessObjective: requirement.businessObjective || "",
    businessRequirement: requirement.businessRequirement || "",
    expectedOutput: requirement.expectedOutput || "",
    businessRules: [markdownContent],
    expectedTables: (requirement.sourceTableNames || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    expectedColumns: (requirement.sourceColumnNames || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    generatedRuleBook: markdownContent,
    analysisConfidence: 1.0,
    expectedRelationships: []
  };
}

/**
 * Sanitizes and fills structural defaults for a final target data model table.
 */
export function sanitizeRuleBookFinalTable(table: Partial<FinalTable>): FinalTable {
  return {
    id: table.id || `ft_gen_${Date.now()}`,
    name: table.name || "TargetTable",
    type: table.type || "Dimension",
    sourceTables: table.sourceTables || [],
    isFinal: table.isFinal !== false,
    steps: table.steps || [],
    keys: table.keys || [],
    lineage: table.lineage || [],
    columns: (table.columns || []).map((col: any) => ({
      name: col.name || "UnknownField",
      dataType: (col.dataType === "String" || col.dataType === "Integer" || col.dataType === "Decimal" || col.dataType === "Date" || col.dataType === "Boolean") ? col.dataType : "Unknown",
      derived: !!col.derived,
      expression: col.expression || "",
      nullable: col.nullable !== false,
      isKey: !!col.isKey
    })),
    sourcePlatform: table.sourcePlatform || "Unknown",
    sourceConnection: table.sourceConnection || ""
  };
}

/**
 * ✅ FIX: Added the exact named export requested by Stage5Dax.tsx
 * Parses raw script contents or file expressions to extract Qlik variable logic formulas.
 */
export function parseVariableLogicFile(content: string): Record<string, string> {
  const expressionsMap: Record<string, string> = {};
  if (!content) return expressionsMap;

  // Scans for classic variable logic assignment blocks down the file pipeline
  const assignmentMatches = content.matchAll(/([A-Za-z0-9_]+)\s*=\s*([^\n;]+)/g);
  for (const match of assignmentMatches) {
    const variableName = match[1].trim();
    const rawFormula = match[2].trim();
    
    // Safely capture expressions and Set Analysis assignments
    if (rawFormula) {
      expressionsMap[variableName] = rawFormula;
    }
  }
  
  return expressionsMap;
}

/**
 * Convenience alias to maintain compatibility with legacy metadata references.
 */
export const parseSetAnalysisFile = parseVariableLogicFile;