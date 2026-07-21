import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { runEnterpriseAnalysis, type ProjectFile } from "@/lib/migration/enterprise-parser";
import { deepValidatePowerQueries } from "@/lib/migration/power-query/MQueryDeepValidator";
import { dedupePipelineLogs } from "@/lib/migration/store";

async function fixture(): Promise<ProjectFile[]> {
  const data = readFileSync(new URL("./fixtures/EnterpriseComplexQlikProject_With_QVW_PRJ_Visuals_Updated.zip", import.meta.url));
  const archive = await JSZip.loadAsync(data);
  const project: ProjectFile[] = [];
  for (const [path, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const ext = path.includes(".") ? `.${path.split(".").pop()!.toLowerCase()}` : "";
    if (![".xml", ".txt", ".qvs", ".csv", ".json", ".md"].includes(ext)) continue;
    const content = await entry.async("text");
    project.push({ path, ext, size: content.length, isText: true, content, note: "" });
  }
  return project;
}

describe("deep Power Query generation and validation", () => {
  it("compiles nested Qlik row expressions and removes unwanted staging tables", async () => {
    const analysis = runEnterpriseAnalysis(await fixture());
    expect(analysis.mQueries.Sales).toContain('Record.FieldOrDefault(_, "Quantity", null) > 0');
    expect(analysis.mQueries.Finance).toContain("Number.Abs");
    expect(analysis.mQueries.Finance).not.toMatch(/(?<!Number\.)\bAbs\s*\(/);
    expect(analysis.mQueries.Sales).toMatch(/NetSalesUSD[\s\S]*\*[\s\S]*Table\.SelectRows\(#"CurrencyMap"/);
    const staging = Object.keys(analysis.stagingQueries || {});
    expect(staging).toContain("CurrencyMap");
    expect(staging).not.toContain("Anonymous_00059_Staging");
    expect(staging).not.toContain("SalesAgg_Customer_Staging");
    expect(staging).not.toContain("SalesAgg_Product_Staging");
    expect(staging).not.toContain("JoinPayload_00026_Staging");
    expect(staging.some((name) => /^TempStage_/i.test(name))).toBe(false);
  });

  it("passes Microsoft M parsing and semantic lint for every generated query", async () => {
    const analysis = runEnterpriseAnalysis(await fixture());
    const result = await deepValidatePowerQueries(analysis.mQueries, analysis.stagingQueries || {}, analysis.columnTypes, analysis.tablePreviews);
    const blockers = Object.values(result.queries).flatMap((query) => query.issues).filter((issue) => issue.severity === "blocking-error");
    expect(blockers).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("produces at most ten locally reconstructed output rows for uploaded samples", async () => {
    const analysis = runEnterpriseAnalysis(await fixture());
    expect(analysis.tablePreviews.Sales.outputRows.length).toBeGreaterThan(0);
    expect(analysis.tablePreviews.Sales.outputRows.length).toBeLessThanOrEqual(10);
    expect(analysis.tablePreviews.Finance.outputRows.length).toBeGreaterThan(0);
  });

  it("deduplicates historical cache logs without losing latest unique entries", () => {
    expect(dedupePipelineLogs(["A", "B", " A  ", "C", "B"])).toEqual(["A", "C", "B"]);
  });
});
