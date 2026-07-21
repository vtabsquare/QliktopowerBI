import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import { parseQvwProject } from "../src/lib/migration/qvw/project-parser";
import { buildExpressionInventory } from "../src/lib/migration/expression";
import { buildPowerBiModel } from "../src/lib/migration/model";
import type { ExtractedFile } from "../src/components/migration/MultiFileDropzone";

beforeAll(() => {
  const window = new JSDOM("<!doctype html><html><body></body></html>").window;
  Object.assign(globalThis, {
    DOMParser: window.DOMParser,
    Document: window.Document,
    Element: window.Element,
  });
});

async function fixtureFiles(): Promise<ExtractedFile[]> {
  const data = readFileSync(
    new URL(
      "./fixtures/EnterpriseComplexQlikProject_With_QVW_PRJ_Visuals_Updated.zip",
      import.meta.url,
    ),
  );
  const archive = await JSZip.loadAsync(data);
  const files: ExtractedFile[] = [];
  for (const [path, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const extension = path.includes(".") ? `.${path.split(".").pop()!.toLowerCase()}` : "";
    const parsedAsText = [".xml", ".txt", ".qvs", ".csv", ".json", ".md"].includes(extension);
    const text = parsedAsText ? await entry.async("text") : null;
    const bytes = await entry.async("uint8array");
    files.push({
      path,
      name: path.split("/").pop() || path,
      extension,
      sizeKb: bytes.byteLength / 1024,
      text,
      parsedAsText,
    });
  }
  return files;
}

describe("QVW regression package", () => {
  it("extracts the expected minimum UI metadata without hardcoded parser logic", async () => {
    const analysis = parseQvwProject(await fixtureFiles());
    expect(analysis.metrics.sheetCount).toBeGreaterThanOrEqual(8);
    expect(analysis.metrics.objectCount).toBeGreaterThanOrEqual(64);
    expect(analysis.metrics.expressionCount).toBeGreaterThanOrEqual(40);
    expect(analysis.metrics.variableCount).toBeGreaterThanOrEqual(15);
    expect(analysis.metrics.bookmarkCount).toBeGreaterThanOrEqual(5);
    expect(analysis.metrics.actionCount).toBeGreaterThanOrEqual(12);
    expect(analysis.metrics.triggerCount).toBeGreaterThanOrEqual(10);
    expect(analysis.metrics.macroCount).toBeGreaterThanOrEqual(3);
    expect(analysis.metrics.extensionCount).toBeGreaterThanOrEqual(3);

    const inventory = buildExpressionInventory(analysis, null);
    const retainedSourceExpressions = inventory.artifacts.reduce((count, artifact) => count + artifact.sourceExpressionIds.length, 0);
    expect(retainedSourceExpressions).toBe(analysis.expressions.length);
    expect(inventory.artifacts.every((artifact) => Boolean(artifact.status))).toBe(true);

    const variableArtifacts = inventory.artifacts.filter((artifact) => artifact.usages.some((usage) => usage.role === "variable"));
    expect(variableArtifacts).toHaveLength(analysis.variables.length);
    expect(variableArtifacts.every((artifact) => artifact.artifactType === "measure")).toBe(true);
    expect(variableArtifacts.every((artifact) => artifact.homeTable === "Qlik Variables")).toBe(true);
    expect(variableArtifacts.every((artifact) => artifact.displayFolder?.startsWith("Qlik Variables\\"))).toBe(true);
    expect(variableArtifacts.every((artifact) => artifact.generatedDax.trim().length > 0)).toBe(true);

    const model = buildPowerBiModel(null, inventory, analysis, "QVW Regression");
    const variableTable = model.tables.find((table) => table.name === "Qlik Variables");
    expect(variableTable).toBeTruthy();
    expect(variableTable!.measures.length).toBeGreaterThanOrEqual(analysis.variables.length);
    const variableNames = new Set(analysis.variables.map((variable) => variable.name.toLowerCase()));
    const exportedVariableNames = new Set(variableTable!.measures.map((measure) => measure.name.toLowerCase()));
    expect([...variableNames].every((name) => exportedVariableNames.has(name))).toBe(true);
    expect(new Set(variableTable!.measures.map((measure) => measure.name.toLowerCase())).size).toBe(variableTable!.measures.length);
    expect(variableTable!.measures.every((measure) => measure.displayFolder?.startsWith("Qlik Measures\\Qlik Variables\\"))).toBe(true);
  });
});
