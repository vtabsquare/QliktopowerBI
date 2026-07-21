export function escapeDaxName(value: string): string {
  return value.replace(/]/g, "]]" ).trim();
}

export function quoteTable(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function daxColumn(table: string, column: string): string {
  return `${quoteTable(table)}[${escapeDaxName(column)}]`;
}

export function sanitizeMeasureName(value: string, fallback = "Converted Measure"): string {
  const cleaned = value.replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}
