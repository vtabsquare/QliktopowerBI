import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, FileJson, ScrollText, ShieldCheck } from "lucide-react";
import { dedupePipelineLogs, useMigration } from "@/lib/migration/store";

export const Route = createFileRoute("/app/logs")({
  component: PipelineLogsPage,
});

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="surface-card p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function PipelineLogsPage() {
  const navigate = useNavigate();
  const { enterpriseFiles, enterpriseAnalysis, qvwAnalysis, expressionInventory, powerBiModel, pipelineLogs, projectWorkspace } = useMigration();
  const combinedLogs = dedupePipelineLogs([
    ...pipelineLogs,
    ...(enterpriseAnalysis?.logs || []),
  ]);

  const exportStatus = !enterpriseAnalysis
    ? "Analysis required"
    : !powerBiModel && qvwAnalysis
      ? "Model required"
      : powerBiModel?.readiness === "not-ready" || !enterpriseAnalysis.validation.isReadyForPbipExport
        ? "Not ready"
        : powerBiModel?.readiness === "ready-with-warnings" || enterpriseAnalysis.validation.warningCount
          ? "Ready with warnings"
          : "Ready";

  return (
    <div className="space-y-5">
      <div className="surface-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
            <ScrollText className="h-4 w-4" /> Pipeline observability
          </div>
          <h2 className="font-display text-2xl font-bold mt-1">Migration Logs &amp; Readiness</h2>
          <p className="text-sm text-muted-foreground mt-1">Trace extraction, conversion, model validation and PBIP export state without losing the current workspace.</p>
        </div>
        <button onClick={() => navigate({ to: "/app/semantic-model" })} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface-elevated">
          Validation &amp; Export
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Files extracted" value={enterpriseFiles.length} />
        <Metric label="QVW expressions" value={expressionInventory?.metrics.total ?? qvwAnalysis?.metrics.expressionCount ?? 0} />
        <Metric label="Model relationships" value={powerBiModel?.relationships.filter((item) => !item.deleted).length ?? 0} />
        <Metric label="PBIP status" value={exportStatus} />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_0.65fr] gap-5">
        <div className="surface-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold">Pipeline event log</h3>
            <span className="text-xs text-muted-foreground">{combinedLogs.length} events</span>
          </div>
          {combinedLogs.length ? (
            <div className="max-h-[520px] overflow-auto rounded-xl border border-border/70">
              {combinedLogs.map((line, index) => (
                <div key={`${index}-${line}`} className="flex items-start gap-3 px-4 py-3 text-xs border-b border-border/50 last:border-b-0">
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground whitespace-pre-wrap">{line}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Upload and analyse a Qlik package to populate the pipeline log.</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="surface-card p-5">
            <div className="flex items-center gap-2 mb-3"><FileJson className="h-4 w-4 text-primary" /><h3 className="font-display font-semibold">Workspace</h3></div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Project</dt><dd className="text-right">{projectWorkspace?.name || "Not initialized"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Project ID</dt><dd className="text-right font-mono">{projectWorkspace?.id || "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Parser</dt><dd>{projectWorkspace?.parserVersion || "2.0.0"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Model</dt><dd>{projectWorkspace?.modelVersion || powerBiModel?.version || "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Last modified</dt><dd className="text-right">{projectWorkspace?.lastModifiedAt ? new Date(projectWorkspace.lastModifiedAt).toLocaleString() : "—"}</dd></div>
            </dl>
          </div>

          <div className="surface-card p-5">
            <div className="flex items-center gap-2 mb-3"><ShieldCheck className="h-4 w-4 text-primary" /><h3 className="font-display font-semibold">Diagnostics</h3></div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Expression warnings</span><span>{expressionInventory?.metrics.warning ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Manual expressions</span><span>{expressionInventory?.metrics.manual ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Unsupported expressions</span><span>{expressionInventory?.metrics.unsupported ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Model warnings</span><span>{powerBiModel?.warningCount ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Blocking errors</span><span>{powerBiModel?.blockingErrorCount ?? 0}</span></div>
            </div>
            {(powerBiModel?.blockingErrorCount || enterpriseAnalysis?.validation.errorCount) ? (
              <div className="mt-4 flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400"><AlertCircle className="h-4 w-4 shrink-0" />Resolve blocking diagnostics before PBIP export.</div>
            ) : null}
          </div>
        </div>
      </div>

      <button onClick={() => navigate({ to: "/app/semantic-model" })} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface-elevated">
        <ArrowLeft className="h-4 w-4" /> Back to Validation &amp; Export
      </button>
    </div>
  );
}
