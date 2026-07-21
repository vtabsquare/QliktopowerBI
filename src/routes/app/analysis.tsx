import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useMigration } from "@/lib/migration/store";
import { runEnterpriseAnalysis, rowsToUpdates } from "@/lib/migration/enterprise-parser";
import type { EnterpriseAnalysis } from "@/lib/migration/enterprise-parser";
import { Database, Loader2, AlertCircle, RefreshCw, ArrowRight, Check, ArrowLeft } from "lucide-react";
import { TabSourceMapping } from "@/components/migration/EnterpriseAnalysisPanel";
import { RepairFocusNotice } from "@/components/migration/RepairFocusNotice";

export const Route = createFileRoute("/app/analysis")({
  component: AnalysisPage,
});

function AnalysisPage() {
  const navigate = useNavigate();
  const {
    enterpriseFiles,
    enterpriseAnalysis,
    enterpriseMappingRows,
    enterpriseMappingUpdates,
    enterpriseColumnTypeEdits,
    setEnterpriseAnalysis,
    setEnterpriseMappingRows,
    setEnterpriseMappingUpdates,
  } = useMigration();

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const files = enterpriseFiles;

  function toProjectFiles(files: typeof enterpriseFiles) {
    return files
      .filter(f => f.parsedAsText)
      .map(f => ({
        path: f.path || f.name,
        ext: f.extension || "",
        size: Math.round((f.sizeKb || 0) * 1024),
        isText: true,
        content: f.text || "",
        note: "",
      }));
  }

  const runAnalysis = useCallback(async (
    mupdates = enterpriseMappingUpdates,
    typeEdits = enterpriseColumnTypeEdits
  ) => {
    const projectFiles = toProjectFiles(files);
    if (!projectFiles.length) {
      setError("No text files found. Go back and upload your Qlik script files.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const result = runEnterpriseAnalysis(projectFiles, mupdates, typeEdits);
      setEnterpriseAnalysis(result);
      setEnterpriseMappingRows(result.sourceMappings.map(m => ({
        originalRef: m.originalRef, mappedRef: m.mappedRef, connectorType: m.connectorType,
        status: m.status, notes: m.notes, table: m.table, sourceRole: m.sourceRole,
        bypassQvd: m.bypassQvd, effectiveRef: m.effectiveRef, qvdProducerTable: m.qvdProducerTable,
      })));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enterprise analysis failed.");
    } finally {
      setRunning(false);
    }
  }, [files, enterpriseMappingUpdates, enterpriseColumnTypeEdits]);

  const handleApplyMapping = useCallback(async () => {
    setApplying(true);
    const newUpdates = rowsToUpdates(enterpriseMappingRows.map(r => ({
      original_ref: r.originalRef, mapped_ref: r.mappedRef,
      connector_type: r.connectorType, status: r.status, notes: r.notes,
      bypass_qvd: r.bypassQvd ? "true" : "false",
    })));
    setEnterpriseMappingUpdates(newUpdates);
    await runAnalysis(newUpdates, enterpriseColumnTypeEdits);
    setApplying(false);
  }, [enterpriseMappingRows, enterpriseColumnTypeEdits, runAnalysis]);

  const analysis = enterpriseAnalysis;

  if (!files.length) {
    return (
      <div className="surface-card p-8 flex flex-col items-center text-center gap-4">
        <AlertCircle className="h-10 w-10 text-warning" />
        <div>
          <h3 className="font-display text-xl font-semibold">No files uploaded</h3>
          <p className="text-sm text-muted-foreground mt-1">Please go back and upload your Qlik script files first.</p>
        </div>
        <button onClick={() => navigate({ to: "/app" })} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
          <ArrowLeft className="h-4 w-4" /> Back to Upload
        </button>
      </div>
    );
  }

  if (!analysis && !running && !error) {
    return (
      <div className="surface-card p-8 flex flex-col items-center text-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent">
          <Database className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h3 className="font-display text-xl font-semibold">Enterprise Migration Workbench</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Run the full 10-stage Qlik → Power BI enterprise analysis engine. Parses your QVS scripts,
            detects final tables, maps sources, generates Power Query M, infers relationships, and validates for PBIP export.
          </p>
        </div>
        <button
          onClick={() => runAnalysis()}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm shadow-lg hover:opacity-90 transition-opacity"
        >
          <Database className="h-4 w-4" /> Run Enterprise Analysis
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="surface-card p-12 flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <div className="text-center">
          <h3 className="font-display text-lg font-semibold">Running Enterprise Pipeline…</h3>
          <p className="text-sm text-muted-foreground mt-1">Parsing QVS, classifying tables, generating M queries, inferring relationships…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-card p-6 border border-destructive/30 bg-destructive/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-sm">Analysis Failed</div>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        </div>
        <button onClick={() => runAnalysis()} className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Retry</button>
      </div>
    );
  }

  if (!analysis) return null;

  const val = analysis.validation;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="surface-card p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-base">Enterprise Analysis Complete</h3>
            <p className="text-xs text-muted-foreground">
              {analysis.finalTables.length} final tables · {analysis.sourceMappings.length} sources · {val.isReadyForPbipExport ? "✓ PBIP Ready" : "✗ Blocked"}
            </p>
          </div>
        </div>
        <button onClick={() => runAnalysis()} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-surface-elevated">
          <RefreshCw className="h-3.5 w-3.5" /> Re-run
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Files", value: analysis.inventory.totalFiles },
          { label: "Text Parsed", value: analysis.inventory.textFiles },
          { label: "Operations", value: analysis.operations.length },
          { label: "Final Tables", value: analysis.finalTables.length },
          { label: "DAX Measures", value: analysis.daxMeasures.length },
          { label: "PBIP Ready", value: val.isReadyForPbipExport ? "✓ Ready" : "✗ Blocked" },
        ].map(m => (
          <div key={m.label} className="surface-card p-4 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{m.label}</span>
            <span className="text-2xl font-bold text-foreground">{m.value}</span>
          </div>
        ))}
      </div>

      {/* Pipeline Logs */}
      <div className="surface-card p-4">
        <h4 className="font-display font-semibold text-base text-foreground mb-3">Pipeline Logs</h4>
        <div className="space-y-1">
          {analysis.logs.map((l, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />{l}
            </div>
          ))}
        </div>
      </div>

      {/* Source Mapping Editor */}
      <RepairFocusNotice areas={["source-mapping"]} />
      <TabSourceMapping
        analysis={analysis}
        mappingRows={enterpriseMappingRows}
        onMappingChange={setEnterpriseMappingRows}
        onApply={handleApplyMapping}
        applying={applying}
      />

      {/* Final Tables List */}
      <div className="surface-card p-4">
        <h4 className="font-display font-semibold text-base text-foreground mb-3">Final Tables Detected ({analysis.finalTables.length})</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {analysis.finalTables.map(t => (
            <div key={t.table} className="px-3 py-2 rounded-lg border border-border bg-surface-elevated/50 text-sm font-medium text-foreground/80">
              {t.table}
              <div className="text-[10px] text-muted-foreground mt-0.5">{t.fields.length} columns</div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-2">
        <button onClick={() => navigate({ to: "/app" })} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-elevated">
          <ArrowLeft className="h-4 w-4" /> Back to Upload
        </button>
        <button
          onClick={() => navigate({ to: "/app/power-query" })}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg hover:opacity-90 transition-all"
        >
          Power Query &amp; M Code <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
