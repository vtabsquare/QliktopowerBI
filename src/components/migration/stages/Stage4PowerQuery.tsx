import { useEffect, useState } from "react";
import { useMigration } from "@/lib/migration/store";
import { generatePowerQueriesFromMigrationMetadata } from "@/lib/migration/generators";
import { AlertCircle, ArrowRight, Check, Copy, Download, GitBranch, Loader2, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FinalTable } from "@/lib/migration/types";

import { generatePowerQueryViaAi } from "@/lib/migration/gemini";

export function Stage4PowerQuery({ onNext }: { onNext: () => void }) {
  const { businessMetadata, technicalMetadata, finalTables = [], ruleBookMd, validationReport, sourceQvsText, etlQvsText, setStageStatus } = useMigration();

  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [queries, setQueries] = useState<{ table: FinalTable; code: string }[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  // Requirement Validation Guard: Disable processing if Stage 3 metadata isn't ready
  if (!businessMetadata || !technicalMetadata) {
    return (
      <div className="surface-card p-12 text-center border border-warning/20 bg-warning/5 rounded-2xl">
        <AlertCircle className="h-10 w-10 mx-auto text-warning mb-3" />
        <div className="font-semibold text-base text-foreground">AI Ingestion Analysis Missing</div>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          Please return to Stage 3 and complete the script analysis pass. Generation requires a validated metadata schema graph.
        </p>
      </div>
    );
  }

  const runGenerate = async () => {
    if (validationReport?.blockingErrors) return;
    setGenerating(true);
    setGenerationError(null);
    try {
      let compiledQueries: { table: FinalTable; code: string }[] = [];
      try {
        console.info("[Stage4] Initiating rule-driven AI Power Query generation...");
        // Provide a fallback if ruleBookMd is missing due to bypass
        const safeRb = ruleBookMd || "# Rule Book\n- Extract metadata\n- Convert scripts\n";
        const aiOutput = await generatePowerQueryViaAi(businessMetadata, technicalMetadata, safeRb, sourceQvsText, etlQvsText);
        
        // Map AI output strings back to FinalTable objects
        compiledQueries = aiOutput.map(aiQuery => {
          const matchedTable = finalTables.find(t => t.name === aiQuery.table) || {
            id: `ai_${aiQuery.table}`, name: aiQuery.table, type: "Fact",
            columns: [], sourceTables: [], isFinal: true, steps: [], keys: [], lineage: []
          };
          return { table: matchedTable, code: aiQuery.code };
        });
      } catch (aiErr) {
        console.info("[Stage4] AI generation failed or rate limited. Falling back to local offline Power Query compiler.");
        const fallbackResult = generatePowerQueriesFromMigrationMetadata(businessMetadata, technicalMetadata);
        compiledQueries = fallbackResult.queries;
      }

      setQueries(compiledQueries);
      setGenerated(true);
      
      const score = compiledQueries.length
        ? Math.round((compiledQueries.filter((x) => !/Table\.FromRows\(\{\}\)|Unknown Source|Source\s*=\s*\/\//i.test(x.code)).length / compiledQueries.length) * 100)
        : 0;
      setStageStatus(4, "complete", score);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Power Query generation failed processing validation.");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (queries.length && active >= queries.length) setActive(0);
  }, [queries.length, active]);

  const current = queries[active];

  const downloadAll = () => {
    const blob = new Blob(
      [queries.map((q) => `// === ${q.table.name} ===\n${q.code}\n\n`).join("")],
      { type: "text/plain" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "power-query.m";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="surface-card p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface-elevated/40 border border-border">
        <div>
          <h3 className="font-display text-xl font-semibold">Script to Power Query M Compiler</h3>
          <p className="text-sm text-muted-foreground">
            Unroll mapped lineage structures into production-ready Power Query scripts. No templates are utilized.
          </p>
        </div>
        <button
          onClick={runGenerate}
          disabled={generating || !!validationReport?.blockingErrors}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 shadow-sm"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />}
          {generating ? "Compiling M Code..." : "Generate Power Query"}
        </button>
      </div>

      {validationReport && (
        <div className={cn("surface-card p-5 border rounded-xl", validationReport.blockingErrors ? "border-destructive/30 bg-destructive/5" : "border-success/20 bg-success/5")}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-display font-semibold text-base">Migration Validation Status</h4>
              <p className="text-xs text-muted-foreground mt-0.5">Lineage state profile checked against compiled rule criteria constraints.</p>
            </div>
            <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", validationReport.blockingErrors ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
              {validationReport.blockingErrors ? "Blocked" : "Validated Passed"}
            </span>
          </div>
          
          {validationReport.issues && validationReport.issues.length > 0 && (
            <div className={cn("mt-4 space-y-2 pt-4 border-t", validationReport.blockingErrors ? "border-destructive/20" : "border-success/20")}>
              {validationReport.issues.map((issue) => (
                <div key={issue.id} className="flex items-start gap-2 text-sm">
                  <AlertCircle className={cn("h-4 w-4 shrink-0 mt-0.5", issue.severity === "error" ? "text-destructive" : "text-warning")} />
                  <div>
                    <span className="font-semibold text-foreground">{issue.area}:</span> <span className="text-muted-foreground">{issue.message}</span>
                    {issue.detail && <div className="text-xs text-muted-foreground/80 mt-0.5">{issue.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {generationError && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-sm flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div><span className="font-semibold">Compiler Exception:</span> {generationError}</div>
        </div>
      )}

      {generated && queries.length > 0 && (
        <>
          <div className="surface-card p-6 flex items-center justify-between border border-border rounded-xl">
            <div>
              <h3 className="font-display text-xl font-semibold">Compiled M Outputs</h3>
              <p className="text-sm text-muted-foreground">Generated clean coverage files for {queries.length} surviving tables.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={downloadAll} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface text-sm font-medium">
                <Download className="h-4 w-4" /> Download scripts
              </button>
              <button onClick={onNext} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
                Continue to Semantic Model <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="surface-card overflow-hidden border border-border rounded-xl">
            <div className="flex border-b border-border overflow-x-auto bg-surface-elevated">
              {queries.map((q, i) => (
                <button
                  key={q.table.id}
                  onClick={() => setActive(i)}
                  className={cn(
                    "px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition flex items-center gap-2",
                    active === i ? "border-primary text-foreground bg-surface" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  {q.table.name}
                </button>
              ))}
            </div>
            {current && (
              <div className="relative">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(current.code);
                    setCopied(true); setTimeout(() => setCopied(false), 1500);
                  }}
                  className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs font-medium z-10 hover:bg-surface-elevated"
                >
                  {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                </button>
                <pre className="p-6 text-xs font-mono leading-relaxed overflow-auto max-h-[28rem] bg-surface-elevated text-foreground">
{current.code}
                </pre>
              </div>
            )}
          </div>
        </>
      )}

      {generated && queries.length === 0 && (
        <div className="surface-card p-6 flex flex-col items-center justify-center text-center border border-border rounded-xl mt-6">
          <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="font-display text-xl font-semibold">No Queries Generated</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            No valid final tables were detected to generate Power Query scripts for.
          </p>
          <button onClick={onNext} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
            Skip to Semantic Model <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}