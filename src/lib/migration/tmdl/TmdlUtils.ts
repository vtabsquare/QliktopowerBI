import type { TomDataType, TomSummarizeBy } from "./TomModelTypes";

export function mapTomDataType(raw: string | undefined): TomDataType {
  const type = (raw || "string").trim().toLowerCase();
  if (/int|whole|integer/.test(type)) return "int64";
  if (/currency|money|fixed|decimal/.test(type)) return "decimal";
  if (/float|double|numeric|number|real/.test(type)) return "double";
  if (/datetime|date|time/.test(type)) return "dateTime";
  if (/bool/.test(type)) return "boolean";
  return "string";
}

export function mapSummarizeBy(raw: string | undefined, dataType: TomDataType): TomSummarizeBy {
  const value = (raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (["sum", "count", "min", "max", "average", "distinctcount", "none"].includes(value)) {
    return value === "distinctcount" ? "distinctCount" : value as TomSummarizeBy;
  }
  return ["int64", "double", "decimal"].includes(dataType) ? "sum" : "none";
}

/** Stable UUID-shaped identifier used for lineage tags and relationship names. */
export function stableGuid(seed: string): string {
  const values = [2166136261, 2246822519, 3266489917, 668265263];
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    for (let j = 0; j < values.length; j += 1) {
      values[j] ^= code + j * 97;
      values[j] = Math.imul(values[j], 16777619 + j * 2) >>> 0;
      values[j] ^= values[j] >>> 13;
    }
  }
  const hex = values.map((value) => value.toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function quoteTmdlName(value: string): string {
  const normalized = value || "Unnamed";
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(normalized)) return normalized;
  return `'${normalized.replace(/'/g, "''")}'`;
}

export function quoteTmdlText(value: string): string {
  return `"${String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

export function safeTmdlFileName(value: string): string {
  const cleaned = (value || "Table")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || "Table").slice(0, 120);
}

export function normalizeExpression(value: string | undefined, fallback: string): string {
  const normalized = (value || "").replace(/\r\n/g, "\n").trimEnd();
  return normalized.trim() ? normalized : fallback;
}

export function indentExpression(expression: string, depth: number): string[] {
  const indent = "\t".repeat(depth);
  return expression.replace(/\r\n/g, "\n").split("\n").map((line) => `${indent}${line}`);
}

export function descriptionLines(value: string | undefined, depth: number): string[] {
  if (!value?.trim()) return [];
  const indent = "\t".repeat(depth);
  return value.replace(/\r?\n/g, " ").trim().match(/.{1,100}(?:\s|$)/g)?.map((line) => `${indent}/// ${line.trim()}`) ?? [];
}
