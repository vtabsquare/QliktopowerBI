/**
 * DAX safety helpers used by both the expression translator and the final
 * semantic-model repair pass.
 *
 * Qlik exposes RGB()/ARGB() and named colour functions. DAX does not expose an
 * RGB function, while Power BI conditional formatting expects a text colour
 * such as "#008000". These helpers translate Qlik colour expressions into
 * valid DAX text expressions.
 */

const NAMED_QLIK_COLOURS: Record<string, string> = {
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  yellow: "#FFFF00",
  black: "#000000",
  white: "#FFFFFF",
  gray: "#808080",
  grey: "#808080",
  lightgray: "#D3D3D3",
  lightgrey: "#D3D3D3",
  darkgray: "#A9A9A9",
  darkgrey: "#A9A9A9",
  lightgreen: "#90EE90",
  darkgreen: "#006400",
  lightblue: "#ADD8E6",
  darkblue: "#00008B",
  lightred: "#FF7F7F",
  darkred: "#8B0000",
  orange: "#FFA500",
  purple: "#800080",
  brown: "#A52A2A",
  pink: "#FFC0CB",
};

function daxText(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function clampComponent(expression: string): string {
  return `MAX(0, MIN(255, INT(${expression})))`;
}

function dynamicHexPair(expression: string): string {
  const value = clampComponent(expression);
  return `MID("0123456789ABCDEF", QUOTIENT(${value}, 16) + 1, 1) & MID("0123456789ABCDEF", MOD(${value}, 16) + 1, 1)`;
}

function numericLiteral(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.trunc(n))) : null;
}

function toHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

export function qlikNamedColour(name: string): string | undefined {
  return NAMED_QLIK_COLOURS[name.toLowerCase().replace(/\s+/g, "")];
}

export function qlikRgbToDax(args: string[], includeAlpha = false): string {
  const rgbArgs = includeAlpha ? args.slice(1, 4) : args.slice(0, 3);
  while (rgbArgs.length < 3) rgbArgs.push("0");
  const numeric = rgbArgs.map(numericLiteral);
  if (numeric.every((value): value is number => value !== null)) {
    return daxText(`#${numeric.map(toHex).join("")}`);
  }
  return `("#" & ${rgbArgs.map(dynamicHexPair).join(" & ")})`;
}

function splitTopLevel(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (quote) {
      current += ch;
      if (ch === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim() || value.trim().endsWith(",")) result.push(current.trim());
  return result;
}

function replaceBalancedFunction(
  source: string,
  functionName: string,
  replacer: (args: string[]) => string,
): string {
  const pattern = new RegExp(`\\b${functionName}\\s*\\(`, "gi");
  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const start = match.index;
    const openParen = start + match[0].lastIndexOf("(");
    let depth = 1;
    let quote: string | null = null;
    let index = openParen + 1;
    for (; index < source.length && depth > 0; index += 1) {
      const ch = source[index];
      if (quote) {
        if (ch === quote && source[index - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (depth !== 0) break;
    const inner = source.slice(openParen + 1, index - 1);
    output += source.slice(cursor, start) + replacer(splitTopLevel(inner));
    cursor = index;
    pattern.lastIndex = index;
  }
  return output + source.slice(cursor);
}

/**
 * Repairs Qlik colour functions that may survive older saved conversion state.
 * This runs again immediately before semantic-model export.
 */
export function rewriteQlikColourFunctions(expression: string): string {
  let result = expression;
  result = replaceBalancedFunction(result, "ARGB", (args) => qlikRgbToDax(args, true));
  result = replaceBalancedFunction(result, "RGB", (args) => qlikRgbToDax(args, false));
  for (const [name, hex] of Object.entries(NAMED_QLIK_COLOURS)) {
    result = result.replace(new RegExp(`\\b${name}\\s*\\(\\s*\\)`, "gi"), daxText(hex));
  }
  return result;
}

export function containsUnsupportedQlikColourFunction(expression: string): boolean {
  return /\b(?:RGB|ARGB|ColorMix1|ColorMix2|ColorMapJet|ColorMapHue)\s*\(/i.test(expression);
}
