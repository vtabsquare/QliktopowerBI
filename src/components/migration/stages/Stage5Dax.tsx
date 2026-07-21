import { useState } from "react";
import type { MigrationValidationReport, Requirement } from "@/lib/migration/types";
import { useMigration } from "@/lib/migration/store";
import { generateDaxMeasures } from "@/lib/migration/generators";
import { generateDaxMeasuresWithGemini } from "@/lib/migration/gemini";
import { parseSetAnalysisFile, parseVariableLogicFile } from "@/lib/migration/rulebook";
import { FileDropzone } from "../FileDropzone";

import { AlertCircle, ArrowRight, Check, Download, FileCode2, Loader2, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Phase =
  | "waiting-upload"
  | "upload-complete"
  | "analyzing"
  | "analysis-complete"
  | "ready-to-generate"
  | "generating"
  | "completed";

const PHASE_LABEL: Record<Phase, string> = {
  "waiting-upload": "Waiting for Upload",
  "upload-complete": "Upload Complete",
  "analyzing": "Analyzing",
  "analysis-complete": "Analysis Complete",
  "ready-to-generate": "Ready to Generate",
  "generating": "Generating",
  "completed": "Completed",
};

export function Stage5Dax({ onNext }: { onNext?: () => void }) {
  const {
    finalTables, variables, setAnalysisRows,
    stageStatus,
    setSetAnalysis, setVariableLogic, setStageStatus,
  } = useMigration();

  const stage5Done = stageStatus[5] === "complete";

  const [engine, setEngine] = useState<"heuristic" | "gemini">("heuristic");
  const [setRaw, setSetRaw] = useState<{ name: string; text: string } | null>(null);
  const [varRaw, setVarRaw] = useState<{ name: string; text: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!stage5Done || !finalTables.length) {
    return (
      <div className="surface-card p-12 text-center">
        <AlertCircle className="h-10 w-10 mx-auto text-warning mb-3" />
        <div className="font-semibold">Review Semantic Model in Stage 5 before producing DAX.</div>
      </div>
    );
  }

  const phase: Phase = generated
    ? "completed"
    : generating
      ? "generating"
      : analyzed
        ? "ready-to-generate"
        : analyzing
          ? "analyzing"
          : setRaw
            ? "upload-complete"
            : "waiting-upload";

  const onSetAnalysisFile = (file: File, text: string) => {
    setSetRaw({ name: file.name, text });
    setAnalyzed(false); setGenerated(false); setCode(""); setError(null);
  };
  const onVariableLogicFile = (file: File, text: string) => {
    setVarRaw({ name: file.name, text });
    setAnalyzed(false); setGenerated(false); setCode(""); setError(null);
  };

  const runAnalysis = async () => {
    if (!setRaw) return;
    setAnalyzing(true);
    setError(null);
    setStageStatus(5, "in-progress");
    await new Promise((r) => setTimeout(r, 600));
    const rowsMap = parseSetAnalysisFile(setRaw.text);
    const rows = Object.entries(rowsMap).map(([name, expression]) => ({ name, expression }));
    setSetAnalysis({ rows, fileName: setRaw.name });
    if (varRaw) {
      const vars = parseVariableLogicFile(varRaw.text);
      setVariableLogic({ variables: vars, fileName: varRaw.name });
    }
    setAnalyzing(false);
    setAnalyzed(true);
  };

  const runGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const state = useMigration.getState();
      const combined: Record<string, string> = { ...state.variables };
      for (const r of state.setAnalysisRows) combined[r.name] = r.expression;

      let out = "";
      if (engine === "gemini") {
        const safeReq = state.requirement || { reportName: "Migration", businessObjective: "Migrate Qlik to PBI", businessRequirement: "Auto migration" };
        const safeRb = state.ruleBookMd || "# Rule Book\n- Convert script\n";
        
        out = await generateDaxMeasuresWithGemini(
          safeReq as Requirement,
          safeRb,
          state.technicalMetadata!
        );
      } else {
        await new Promise((r) => setTimeout(r, 400));
        out = generateDaxMeasures(state.finalTables, combined);
      }

      setCode(out);
      setGenerated(true);
      
      // Calculate completeness score
      const lines = out.split("\n");
      const todos = lines.filter((l) => l.includes("TODO") || l.includes("Review required")).length;
      const measures = (out.match(/^\[.+\] =$/gm) || []).length || 1;
      const score = Math.max(0, Math.round((1 - todos / measures) * 100));
      setStageStatus(6, "complete", Math.min(100, score));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "DAX generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "measures.dax";
    a.click();
  };

  const measureCount = (code.match(/^\[.+\] =$/gm) || []).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PhaseBadge phase={phase} />
        
        {/* Engine Selection */}
        <div className="flex items-center gap-2 bg-surface-elevated p-1 rounded-xl border border-border self-start sm:self-auto shrink-0">
          <button
            onClick={() => setEngine("heuristic")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              engine === "heuristic"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Local Translator
          </button>
          <button
            onClick={() => setEngine("gemini")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              engine === "gemini"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="h-3 w-3" /> Gemini AI
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <FileDropzone
            accept=".csv,.tsv,.txt,.xlsx"
            onFile={onSetAnalysisFile}
            label="Upload Set Analysis Excel"
            description="Required. CSV/TSV/XLSX with columns Name, Expression — or one 'Name: expression' per line."
          />
          {setRaw && (
            <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" /> {setRaw.name}
              {analyzed && <span className="ml-2">• {setAnalysisRows.length} expressions parsed</span>}
            </div>
          )}
        </div>
        <div>
          <FileDropzone
            accept=".csv,.tsv,.txt,.xlsx"
            onFile={onVariableLogicFile}
            label="Upload Variable Logic Excel (optional)"
            description="CSV/TSV/XLSX with columns Variable, Definition. Used to resolve nested variable references."
          />
          {varRaw && (
            <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" /> {varRaw.name}
              {analyzed && <span className="ml-2">• {Object.keys(variables).length} variables resolved</span>}
            </div>
          )}
        </div>
      </div>

      <div className="surface-card p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="font-display text-xl font-semibold">Analyze &amp; Generate</h3>
          <p className="text-sm text-muted-foreground">
            DAX is derived from analyzed expressions and resolved variables.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={runAnalysis}
            disabled={!setRaw || analyzing}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border bg-surface",
              (!setRaw || analyzing) && "opacity-50 cursor-not-allowed",
            )}
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {analyzing ? "Analyzing…" : analyzed ? "Re-analyze" : "Analyze Expressions"}
          </button>
          <button
            onClick={runGenerate}
            disabled={!analyzed || generating}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium",
              (!analyzed || generating) && "opacity-50 cursor-not-allowed",
            )}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />}
            {generating ? "Generating DAX..." : engine === "gemini" ? "Generate with Gemini" : "Generate DAX"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Generation failed</div>
            <div className="text-xs mt-0.5">{error}</div>
          </div>
        </div>
      )}

      <StateCard phase={phase} hasSet={!!setRaw} engine={engine} />

      {generated && code && !generating && (
        <>
          <div className="surface-card p-6 flex items-center justify-between">
            <div>
              <h3 className="font-display text-xl font-semibold">DAX measures</h3>
              <p className="text-sm text-muted-foreground">
                {measureCount || "Generated"} measures • mapped against {finalTables.length} final tables • {engine === "gemini" ? "✦ Gemini AI Engine" : "⚙ Local Regex Engine"}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={download} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface text-sm font-medium">
                <Download className="h-4 w-4" /> Download .dax
              </button>
              {onNext && (
                <button onClick={onNext} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
                  Next step <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="surface-card overflow-hidden">
            <pre className="p-6 text-xs font-mono leading-relaxed overflow-auto max-h-[32rem] bg-surface-elevated">
{code}
            </pre>
          </div>
        </>
      )}

      <div className="mt-12 pt-8 border-t border-border">
        
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const colors: Record<Phase, string> = {
    "waiting-upload": "bg-muted text-muted-foreground",
    "upload-complete": "bg-accent text-primary",
    "analyzing": "bg-warning/15 text-warning",
    "analysis-complete": "bg-accent text-primary",
    "ready-to-generate": "bg-accent text-primary",
    "generating": "bg-warning/15 text-warning",
    "completed": "bg-success/15 text-success",
  };
  return (
    <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold", colors[phase])}>
      {(phase === "analyzing" || phase === "generating") && <Loader2 className="h-3 w-3 animate-spin" />}
      Status: {PHASE_LABEL[phase]}
    </div>
  );
}

function StateCard({ phase, hasSet, engine }: { phase: Phase; hasSet: boolean; engine: "heuristic" | "gemini" }) {
  if (phase === "completed") return null;
  let icon = <Upload className="h-6 w-6 text-muted-foreground" />;
  let title = "Awaiting upload";
  let body = "Upload the Set Analysis Excel (and optionally the Variable Logic Excel) to begin.";

  if (phase === "upload-complete") {
    icon = <Sparkles className="h-6 w-6 text-primary" />;
    title = "Ready to analyze";
    body = "Click ‘Analyze Expressions’ to parse Set Analysis and resolve variables.";
  } else if (phase === "analyzing") {
    icon = <Loader2 className="h-6 w-6 text-warning animate-spin" />;
    title = "Analyzing expressions and variables…";
    body = "Parsing uploaded files and merging with Rule Book metadata.";
  } else if (phase === "ready-to-generate") {
    icon = engine === "gemini" ? <Sparkles className="h-6 w-6 text-primary animate-pulse" /> : <FileCode2 className="h-6 w-6 text-primary" />;
    title = engine === "gemini" ? "Analysis complete — ready to translate with Gemini" : "Analysis complete — ready to generate";
    body = engine === "gemini"
      ? "Click ‘Generate with Gemini’ to translate your Qlik Set Analysis into rich, fully-qualified Power BI DAX measures."
      : "Click ‘Generate DAX’ to produce measures derived from the analyzed expressions.";
  } else if (phase === "generating") {
    icon = <Loader2 className="h-6 w-6 text-warning animate-spin" />;
    title = engine === "gemini" ? "Gemini is translating expressions to DAX..." : "Generating DAX…";
    body = engine === "gemini"
      ? "Google Gemini is reviewing the semantic model layout and translating Set Analysis filters to CALCULATE and FILTER statements."
      : "Translating Set Analysis to DAX with resolved variables.";
  } else if (!hasSet) {
    body = "Set Analysis Excel is required. DAX is not generated from templates — only from analyzed files.";
  }

  return (
    <div className="surface-card p-8 flex items-start gap-4 bg-surface-elevated/60 border-dashed">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-surface border border-border shrink-0">{icon}</div>
      <div>
        <div className="font-display font-semibold text-lg">{title}</div>
        <div className="text-sm text-muted-foreground mt-1 max-w-2xl">{body}</div>
      </div>
    </div>
  );
}
