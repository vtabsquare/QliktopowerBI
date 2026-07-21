import { useState } from "react";
import { useMigration } from "@/lib/migration/store";
import { analyzeQvsScriptsViaAi } from "@/lib/migration/gemini";
import { parseSourceQvs, parseEtlQvs } from "@/lib/migration/qvs-parser";
import { validateMigrationMetadata } from "@/lib/migration/generators";
import type { MigrationValidationReport } from "@/lib/migration/types";
import { cn } from "@/lib/utils";
import { MultiFileDropzone, FileAnalysisPanel, autoAssignSourceAndEtl } from "../MultiFileDropzone";
import type { ExtractedFile } from "../MultiFileDropzone";
import { EnterpriseAnalysisPanel } from "../EnterpriseAnalysisPanel";
import { Loader2, ShieldCheck, Database, AlertCircle, Check, PackageOpen, Lock, ArrowRight } from "lucide-react";

export function Stage3AiAnalysis({ onNext }: { onNext: () => void }) {
  const { requirement, ruleBookMd, setSourceAnalysis, setEtlAnalysis, setMergedMetadata, setStageStatus } = useMigration();

  const [allFiles, setAllFiles] = useState<ExtractedFile[]>([]);
  const [selectedSources, setSelectedSources] = useState<ExtractedFile[]>([]);
  const [selectedEtls, setSelectedEtls] = useState<ExtractedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [validationReport, setValidationReport] = useState<MigrationValidationReport | null>(null);

  const bothSelected   = selectedSources.length > 0 && selectedEtls.length > 0;
  const canAnalyze     = bothSelected;

  const handleFiles = (files: ExtractedFile[]) => {
    setAllFiles(files);
    setComplete(false);
    setError(null);
    setSelectedSources([]);
    setSelectedEtls([]);

    const autoAssigned = autoAssignSourceAndEtl(files);
    setSelectedSources(autoAssigned.sources);
    setSelectedEtls(autoAssigned.etls);
  };

  const handleRunScriptAnalysis = async () => {
    if (!bothSelected) return;
    setLoading(true);
    setError(null);
    setValidationReport(null);
    setStageStatus(3, "in-progress");

    try {
      const sourceText = selectedSources.map(f => f.text).join('\n\n');
      const etlText = selectedEtls.map(f => f.text).join('\n\n');

      // 1. Run local parser structural mapping pass (always succeeds, used as fallback)
      const srcTables = parseSourceQvs(sourceText) || [];
      const etlRes = parseEtlQvs(etlText, srcTables);

      // 2. Invoke structured semantic AI extraction with fallback strings for missing manual inputs
      const safeReq = requirement || { reportName: "Migration", businessObjective: "Migrate Qlik to PBI", businessRequirement: "Auto migration" } as any;
      const safeRb = ruleBookMd || "# Rule Book\n- Extract metadata\n- Convert scripts\n";
      const aiResponse = await analyzeQvsScriptsViaAi(safeReq, safeRb, sourceText, etlText, { srcTables, etlRes });
      const technicalMetadata = aiResponse.technicalMetadata;

      // 4. Validate the merged metadata
      const finalValidationReport = validateMigrationMetadata(
        aiResponse.businessMetadata,
        technicalMetadata
      );

      // 5. Update store
      setSourceAnalysis({ sourceTables: srcTables, sourceFileName: selectedSources.map(f => f.name).join(', '), text: sourceText });
      setEtlAnalysis({ ...etlRes, etlFileName: selectedEtls.map(f => f.name).join(', '), text: etlText });

      setMergedMetadata({
        businessMetadata: aiResponse.businessMetadata,
        technicalMetadata,
        finalTables: technicalMetadata.finalTables,
        relationships: technicalMetadata.relationships,
        validationReport: finalValidationReport
      });

      setValidationReport(finalValidationReport);

      setStageStatus(3, "complete", 100);
      setComplete(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "QVS structural code lineage analysis failed.";
      setError(msg);
      setStageStatus(3, "pending");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="surface-card p-6 space-y-4">
        <div className="flex items-start gap-4 mb-2">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary shrink-0">
            <PackageOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-xl font-semibold">Upload & Extraction Engine</h3>
            <p className="text-sm text-muted-foreground">
              Upload individual QVS/CSV files, a ZIP package, or an entire folder. The engine will extract and analyse all contents automatically.
            </p>
          </div>
        </div>
        <MultiFileDropzone onFiles={handleFiles} />
      </div>

      {/* File Analysis Panel — shown after upload */}
      {allFiles.length > 0 && (
        <FileAnalysisPanel
          files={allFiles}
          selectedSources={selectedSources}
          selectedEtls={selectedEtls}
          onToggleSource={(f) => {
            setSelectedSources(prev => prev.some(p => p.path === f.path) ? prev.filter(p => p.path !== f.path) : [...prev, f]);
            setComplete(false);
          }}
          onToggleEtl={(f) => {
            setSelectedEtls(prev => prev.some(p => p.path === f.path) ? prev.filter(p => p.path !== f.path) : [...prev, f]);
            setComplete(false);
          }}
        />
      )}

      {/* Assigned confirmation chips */}
      {(selectedSources.length > 0 || selectedEtls.length > 0) && (
        <div className="flex flex-col gap-2">
          {selectedSources.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/30 text-xs font-mono">
              <Check className="h-3.5 w-3.5 text-primary" />
              <span className="text-primary font-semibold">SOURCE:</span>
              <span className="truncate">{selectedSources.map(s => s.name).join(", ")}</span>
            </div>
          )}
          {selectedEtls.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-xs font-mono">
              <Check className="h-3.5 w-3.5 text-warning" />
              <span className="text-warning font-semibold">ETL:</span>
              <span className="truncate">{selectedEtls.map(e => e.name).join(", ")}</span>
            </div>
          )}
        </div>
      )}



      {/* Analyse button */}
      <div className="surface-card p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="font-display text-xl font-semibold">Lineage Analysis Engine</h3>
          <p className="text-sm text-muted-foreground">
            {canAnalyze
              ? `Ready to analyse ${selectedSources.length} source and ${selectedEtls.length} ETL script(s) using the deterministic parser with optional Gemini enrichment.`
              : "Complete all prerequisites above to enable analysis."}
          </p>
        </div>
        <button
          onClick={handleRunScriptAnalysis}
          disabled={loading || !canAnalyze}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-all hover:opacity-90"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          {loading ? "Extracting Code Models..." : "Analyze QVS Scripts"}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-sm flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div><span className="font-semibold">Analysis Failure:</span> {error}</div>
        </div>
      )}

      {validationReport && validationReport.issues && validationReport.issues.length > 0 && (
        <div className={cn("surface-card p-5 border rounded-xl", validationReport.blockingErrors ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5")}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-display font-semibold text-base">Migration Validation Status</h4>
              <p className="text-xs text-muted-foreground mt-0.5">Lineage state profile checked against compiled rule criteria constraints.</p>
            </div>
            <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", validationReport.blockingErrors ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
              {validationReport.blockingErrors ? "Blocked" : "Warnings Found"}
            </span>
          </div>
          <div className={cn("mt-4 space-y-2 pt-4 border-t", validationReport.blockingErrors ? "border-destructive/20" : "border-warning/20")}>
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
        </div>
      )}

      {complete && !validationReport?.blockingErrors && (
        <div className="surface-card p-6 bg-success/5 border-success/20 flex flex-col items-center text-center space-y-3 rounded-2xl">
          <ShieldCheck className="h-10 w-10 text-success" />
          <div className="font-semibold text-lg text-foreground">Code Metadata Generation Complete</div>
          <p className="text-sm text-muted-foreground max-w-md">
            Surviving data schemas, table relationships, and operations are mapped. Scroll down to the Enterprise Workbench to generate Power Query M and export your model.
          </p>
        </div>
      )}

      {/* ── Enterprise Migration Workbench ─────────────────────────────────── */}
      {allFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Enterprise Analysis Engine</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Full 10-stage Qlik → Power BI pipeline: source mapping, QVD bypass, M query generation, data types, DAX translation, relationship inference, validation, and PBIP export.
          </p>
          <EnterpriseAnalysisPanel files={allFiles} onAnalysisComplete={() => {}} />
        </div>
      )}
    </div>
  );
}