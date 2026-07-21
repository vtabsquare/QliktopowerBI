import type {
  TmdlFolderResult,
  TomAnnotation,
  TomColumn,
  TomDatabaseSpec,
  TomHierarchy,
  TomMeasure,
  TomPartition,
  TomRelationship,
  TomTable,
} from "./TomModelTypes";
import { validateTomModelSpec } from "./TmdlValidator";
import { descriptionLines, indentExpression, quoteTmdlName, quoteTmdlText, safeTmdlFileName } from "./TmdlUtils";

const NL = "\n";

function serializeAnnotations(values: TomAnnotation[] | undefined, depth: number): string[] {
  const indent = "\t".repeat(depth);
  return (values || []).map((annotation) => `${indent}annotation ${quoteTmdlName(annotation.name)} = ${quoteTmdlText(annotation.value)}`);
}

function serializeExpressionObject(header: string, expression: string, depth: number): string[] {
  const indent = "\t".repeat(depth);
  const lines = expression.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 1 && lines[0].trim() && !/[\r\n]/.test(lines[0])) return [`${indent}${header} = ${lines[0].trim()}`];
  return [
    `${indent}${header} = `,
    `${indent}\t\`\`\``,
    ...indentExpression(expression, depth + 1),
    `${indent}\t\`\`\``
  ];
}

function serializeNamedExpression(name: string, expression: string): string[] {
  const lines = expression.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 1 && lines[0].trim()) return [`expression ${quoteTmdlName(name)} = ${lines[0].trim()}`];
  return [`expression ${quoteTmdlName(name)} =`, ...indentExpression(expression, 1)];
}

function serializeColumn(column: TomColumn): string[] {
  const lines: string[] = [];
  lines.push(...descriptionLines(column.description, 1));
  if (column.kind === "calculated") {
    lines.push(...serializeExpressionObject(`calculatedColumn ${quoteTmdlName(column.name)}`, column.expression, 1));
  } else {
    lines.push(`\tcolumn ${quoteTmdlName(column.name)}`);
  }
  // Calculated columns: always declare "string" as dataType.
  // Power BI Desktop re-infers the real type from the DAX expression at
  // refresh; any other inferred type that doesn't match triggers a
  // datatype-mismatch error in the semantic model.
  const declaredDataType = column.kind === "calculated" ? "string" : column.dataType;
  lines.push(`\t\tdataType: ${declaredDataType}`);
  if (column.kind === "data") lines.push(`\t\tsourceColumn: ${quoteTmdlText(column.sourceColumn)}`);
  if (column.formatString) lines.push(`\t\tformatString: ${quoteTmdlText(column.formatString)}`);
  if (column.dataCategory) lines.push(`\t\tdataCategory: ${quoteTmdlText(column.dataCategory)}`);
  if (column.sortByColumn) lines.push(`\t\tsortByColumn: ${quoteTmdlName(column.sortByColumn)}`);
  lines.push(`\t\tsummarizeBy: ${column.summarizeBy || "none"}`);
  if (column.isKey) lines.push("\t\tisKey");
  if (column.isHidden) lines.push("\t\tisHidden");
  if (column.lineageTag) lines.push(`\t\tlineageTag: ${column.lineageTag}`);
  lines.push(...serializeAnnotations(column.annotations, 2));
  return lines;
}

function serializeMeasure(measure: TomMeasure): string[] {
  const lines: string[] = [];
  lines.push(...descriptionLines(measure.description, 1));
  lines.push(...serializeExpressionObject(`measure ${quoteTmdlName(measure.name)}`, measure.expression, 1));
  if (measure.formatString) lines.push(`\t\tformatString: ${quoteTmdlText(measure.formatString)}`);
  if (measure.displayFolder) lines.push(`\t\tdisplayFolder: ${quoteTmdlText(measure.displayFolder)}`);
  if (measure.isHidden) lines.push("\t\tisHidden");
  if (measure.lineageTag) lines.push(`\t\tlineageTag: ${measure.lineageTag}`);
  lines.push(...serializeAnnotations(measure.annotations, 2));
  return lines;
}

function serializeHierarchy(hierarchy: TomHierarchy): string[] {
  const lines: string[] = [];
  lines.push(...descriptionLines(hierarchy.description, 1));
  lines.push(`\thierarchy ${quoteTmdlName(hierarchy.name)}`);
  if (hierarchy.lineageTag) lines.push(`\t\tlineageTag: ${hierarchy.lineageTag}`);
  for (const level of [...hierarchy.levels].sort((a, b) => a.ordinal - b.ordinal)) {
    lines.push(`\t\tlevel ${quoteTmdlName(level.name)}`);
    lines.push(`\t\t\tordinal: ${level.ordinal}`);
    lines.push(`\t\t\tcolumn: ${quoteTmdlName(level.column)}`);
    if (level.lineageTag) lines.push(`\t\t\tlineageTag: ${level.lineageTag}`);
  }
  return lines;
}

function serializePartition(partition: TomPartition): string[] {
  const lines = [`\tpartition ${quoteTmdlName(partition.name)} = ${partition.sourceType}`];
  lines.push(`\t\tmode: ${partition.mode}`);
  const prop = partition.sourceType === "calculated" ? "expression" : "source";
  const expressionLines = partition.expression.replace(/\r\n/g, "\n").split("\n");
  if (expressionLines.length === 1 && expressionLines[0].trim() && !/[\r\n]/.test(expressionLines[0])) {
    lines.push(`\t\t${prop} = ${expressionLines[0].trim()}`);
  } else {
    lines.push(`\t\t${prop} = `);
    lines.push("\t\t\t```");
    lines.push(...indentExpression(partition.expression, 3));
    lines.push("\t\t\t```");
  }
  lines.push(...serializeAnnotations(partition.annotations, 2));
  return lines;
}

function serializeTable(table: TomTable): string {
  const lines: string[] = [];
  lines.push(...descriptionLines(table.description, 0));
  lines.push(`table ${quoteTmdlName(table.name)}`);
  if (table.lineageTag) lines.push(`\tlineageTag: ${table.lineageTag}`);
  if (table.isHidden) lines.push("\tisHidden");
  lines.push(...serializeAnnotations(table.annotations, 1));
  for (const column of table.columns) {
    lines.push("");
    lines.push(...serializeColumn(column));
  }
  for (const measure of table.measures) {
    lines.push("");
    lines.push(...serializeMeasure(measure));
  }
  for (const hierarchy of table.hierarchies) {
    lines.push("");
    lines.push(...serializeHierarchy(hierarchy));
  }
  for (const partition of table.partitions) {
    lines.push("");
    lines.push(...serializePartition(partition));
  }
  return `${lines.join(NL)}${NL}`;
}

function serializeRelationship(relationship: TomRelationship): string[] {
  const lines = [`relationship ${quoteTmdlName(relationship.name)}`];
  lines.push(`\tfromColumn: ${quoteTmdlName(relationship.fromTable)}.${quoteTmdlName(relationship.fromColumn)}`);
  lines.push(`\ttoColumn: ${quoteTmdlName(relationship.toTable)}.${quoteTmdlName(relationship.toColumn)}`);
  if (relationship.fromCardinality !== "many") lines.push(`\tfromCardinality: ${relationship.fromCardinality}`);
  if (relationship.toCardinality !== "one") lines.push(`\ttoCardinality: ${relationship.toCardinality}`);
  if (relationship.crossFilteringBehavior !== "oneDirection") lines.push(`\tcrossFilteringBehavior: ${relationship.crossFilteringBehavior}`);
  if (!relationship.isActive) lines.push("\tisActive: false");
  lines.push(...serializeAnnotations(relationship.annotations, 1));
  return lines;
}

export function serializeTmdlFolder(spec: TomDatabaseSpec): TmdlFolderResult {
  const diagnostics = validateTomModelSpec(spec);
  const files: Record<string, string> = {};
  files["database.tmdl"] = `database ${quoteTmdlName(spec.name)}${NL}\tcompatibilityLevel: ${spec.compatibilityLevel}${NL}`;
  const modelLines = [
    `model ${quoteTmdlName(spec.model.name)}`,
    `\tculture: ${spec.model.culture}`,
    `\tdefaultPowerBIDataSourceVersion: ${spec.model.defaultPowerBIDataSourceVersion}`,
    `\tsourceQueryCulture: ${spec.model.sourceQueryCulture}`,
    ...serializeAnnotations(spec.model.annotations, 1),
  ];
  files["model.tmdl"] = `${modelLines.join(NL)}${NL}`;
  if (spec.model.relationships.length) {
    files["relationships.tmdl"] = `${spec.model.relationships.flatMap((relationship, index) => [
      ...(index ? [""] : []),
      ...serializeRelationship(relationship),
    ]).join(NL)}${NL}`;
  }
  if (spec.model.expressions.length) {
    files["expressions.tmdl"] = `${spec.model.expressions.flatMap((expression, index) => [
      ...(index ? [""] : []),
      ...serializeNamedExpression(expression.name, expression.expression),
    ]).join(NL)}${NL}`;
  }
  const usedFileNames = new Set<string>();
  for (const table of spec.model.tables) {
    let base = safeTmdlFileName(table.name);
    let fileName = `${base}.tmdl`;
    let suffix = 2;
    while (usedFileNames.has(fileName.toLowerCase())) fileName = `${base}_${suffix++}.tmdl`;
    usedFileNames.add(fileName.toLowerCase());
    files[`tables/${fileName}`] = serializeTable(table);
  }
  return { engine: "typescript-tmdl", files, diagnostics, modelSpec: spec };
}
