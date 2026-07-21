import type { ExpressionArtifactType, ExpressionAstNode, ExpressionIssue } from "../expression";

export interface DaxTranslationContext {
  homeTable: string;
  fieldToTable: Record<string, string>;
  variables: Record<string, { definition?: string; evaluatedValue?: string; isCalculated: boolean; proposedPowerBiType?: string }>;
  measureNames?: Record<string, string>;
}

export interface DaxTranslationResult {
  dax: string;
  artifactType: ExpressionArtifactType;
  confidence: number;
  status: "automatic" | "warning" | "manual" | "unsupported" | "missing-dependency";
  referencedTables: string[];
  referencedColumns: string[];
  referencedMeasures: string[];
  issues: ExpressionIssue[];
  explanation: string[];
  ast?: ExpressionAstNode;
}
