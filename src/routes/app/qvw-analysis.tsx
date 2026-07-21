import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMigration } from "@/lib/migration/store";
import type {
  QvwAction,
  QvwAnalysis,
  QvwDiagnostic,
  QvwExpression,
  QvwMigrationStatus,
  QvwVisualizationObject,
} from "@/lib/migration/qvw";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  Box,
  Braces,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileWarning,
  FunctionSquare,
  Gauge,
  LayoutDashboard,
  ListTree,
  MousePointerClick,
  PackageOpen,
  Search,
  ShieldAlert,
  Sparkles,
  Variable,
  Workflow,
} from "lucide-react";

export const Route = createFileRoute("/app/qvw-analysis")({
  component: QvwAnalysisPage,
});

function QvwAnalysisPage() {
  const { qvwAnalysis } = useMigration();
  const [objectSearch, setObjectSearch] = useState("");
  const [expressionSearch, setExpressionSearch] = useState("");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  if (!qvwAnalysis) {
    return (
      <div className="surface-card p-10 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary mx-auto mb-5">
          <LayoutDashboard className="h-8 w-8" />
        </div>
        <h2 className="font-display text-2xl font-bold">No QVW project analysis is available</h2>
        <p className="text-sm text-muted-foreground mt-3 max-w-2xl mx-auto">
          Upload a QVW with its PRJ folder, or upload the PRJ folder by itself. The analysis is
          generated immediately from the supplied XML and text files.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/app/instructions"
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent/30"
          >
            Review instructions
          </Link>
          <Link
            to="/app"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Upload package <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const objectTerm = objectSearch.trim().toLowerCase();
  const filteredObjects = objectTerm
    ? qvwAnalysis.objects.filter((object) =>
        [object.id, object.title, object.type, object.sheetId, object.file, object.powerBiVisual]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(objectTerm)),
      )
    : qvwAnalysis.objects;

  const expressionTerm = expressionSearch.trim().toLowerCase();
  const filteredExpressions = expressionTerm
    ? qvwAnalysis.expressions.filter((expression) =>
        [
          expression.expression,
          expression.label,
          expression.objectId,
          expression.role,
          ...expression.variables,
          ...expression.fields,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(expressionTerm)),
      )
    : qvwAnalysis.expressions;

  const selectedObject =
    qvwAnalysis.objects.find((object) => object.id === selectedObjectId) ?? null;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(qvwAnalysis, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${qvwAnalysis.document.title || "qvw"}-analysis.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <div className="flex flex-col xl:flex-row xl:items-center gap-5">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-600 to-violet-700 text-white shadow-lg shrink-0">
            <LayoutDashboard className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-2xl font-bold">
                {qvwAnalysis.document.title || "QlikView Application"}
              </h2>
              <StatusBadge
                status={
                  qvwAnalysis.intake.readyForVisualizationAnalysis
                    ? "auto-convertible"
                    : "missing-dependency"
                }
                label={
                  qvwAnalysis.intake.readyForVisualizationAnalysis
                    ? "Visual metadata extracted"
                    : "Package incomplete"
                }
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Generated from {qvwAnalysis.sourceFiles.length} uploaded files · mode:{" "}
              <span className="font-mono text-foreground">{qvwAnalysis.intake.mode}</span> ·
              completeness {qvwAnalysis.intake.completenessScore}%
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadJson}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent/30"
            >
              <Download className="h-4 w-4" /> Download metadata JSON
            </button>
            <Link
              to="/app/expression-conversion"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Convert expressions <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard icon={LayoutDashboard} value={qvwAnalysis.metrics.sheetCount} label="Sheets" />
        <MetricCard icon={Gauge} value={qvwAnalysis.metrics.objectCount} label="Objects" />
        <MetricCard
          icon={FunctionSquare}
          value={qvwAnalysis.metrics.expressionCount}
          label="Expressions"
        />
        <MetricCard icon={Variable} value={qvwAnalysis.metrics.variableCount} label="Variables" />
        <MetricCard icon={Bookmark} value={qvwAnalysis.metrics.bookmarkCount} label="Bookmarks" />
        <MetricCard
          icon={MousePointerClick}
          value={qvwAnalysis.metrics.actionCount}
          label="Actions"
        />
      </section>

      {qvwAnalysis.diagnostics.length > 0 && <Diagnostics diagnostics={qvwAnalysis.diagnostics} />}

      <Tabs defaultValue="overview" className="space-y-5">
        <div className="surface-card p-2 overflow-x-auto">
          <TabsList className="h-auto min-w-max bg-transparent gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sheets">Sheets</TabsTrigger>
            <TabsTrigger value="objects">Visualizations</TabsTrigger>
            <TabsTrigger value="expressions">Expressions</TabsTrigger>
            <TabsTrigger value="variables">Variables</TabsTrigger>
            <TabsTrigger value="actions">Actions &amp; Triggers</TabsTrigger>
            <TabsTrigger value="bookmarks">Bookmarks</TabsTrigger>
            <TabsTrigger value="macros">Macros &amp; Extensions</TabsTrigger>
            <TabsTrigger value="package">Package</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <Overview analysis={qvwAnalysis} />
        </TabsContent>

        <TabsContent value="sheets" className="space-y-4">
          {qvwAnalysis.sheets.map((sheet) => {
            const objects = qvwAnalysis.objects.filter((object) => object.sheetId === sheet.id);
            return (
              <div key={sheet.id} className="surface-card overflow-hidden">
                <div className="p-5 border-b border-border flex flex-wrap items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
                    <LayoutDashboard className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{sheet.name}</h3>
                    <div className="text-xs text-muted-foreground font-mono">
                      {sheet.id} · {objects.length} objects · order {sheet.order}
                    </div>
                  </div>
                  {sheet.alternateState && (
                    <span className="rounded-full bg-violet-500/10 text-violet-600 px-3 py-1 text-xs">
                      State: {sheet.alternateState}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  {objects.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No object XML was linked to this sheet.
                    </p>
                  ) : (
                    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {objects.map((object) => (
                        <ObjectMiniCard
                          key={object.id}
                          object={object}
                          onOpen={() => setSelectedObjectId(object.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="objects" className="space-y-4">
          <SearchBox
            value={objectSearch}
            onChange={setObjectSearch}
            placeholder="Search by object ID, title, type, sheet or Power BI mapping..."
          />
          <div className="grid lg:grid-cols-2 gap-4">
            {filteredObjects.map((object) => (
              <ObjectCard
                key={object.id}
                object={object}
                onOpen={() => setSelectedObjectId(object.id)}
              />
            ))}
          </div>
          {filteredObjects.length === 0 && (
            <EmptyResult message="No visualization objects match the search." />
          )}
        </TabsContent>

        <TabsContent value="expressions" className="space-y-4">
          <SearchBox
            value={expressionSearch}
            onChange={setExpressionSearch}
            placeholder="Search expression text, object, variable or field..."
          />
          <div className="space-y-3">
            {filteredExpressions.map((expression) => (
              <ExpressionCard key={expression.id} expression={expression} />
            ))}
          </div>
          {filteredExpressions.length === 0 && (
            <EmptyResult message="No expressions match the search." />
          )}
        </TabsContent>

        <TabsContent value="variables" className="space-y-3">
          {qvwAnalysis.variables.map((variable) => (
            <div key={variable.name} className="surface-card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Variable className="h-5 w-5 text-primary" />
                <div className="font-mono font-bold">{variable.name}</div>
                <StatusBadge status={variable.migrationStatus} />
                <span className="ml-auto rounded-full bg-accent px-3 py-1 text-xs">
                  {variable.proposedPowerBiType}
                </span>
              </div>
              <pre className="mt-4 rounded-xl bg-slate-950 p-4 text-xs text-slate-200 overflow-x-auto">
                {variable.definition || "Definition not found in supplied files"}
              </pre>
              <div className="grid md:grid-cols-3 gap-3 mt-4 text-xs">
                <Property label="Calculated" value={variable.isCalculated ? "Yes" : "No"} />
                <Property
                  label="Used by objects"
                  value={variable.usedByObjects.join(", ") || "—"}
                />
                <Property
                  label="Used by actions"
                  value={variable.usedByActions.join(", ") || "—"}
                />
              </div>
            </div>
          ))}
          {qvwAnalysis.variables.length === 0 && (
            <EmptyResult message="No variables were detected in LoadScript.txt/QVS or project XML." />
          )}
        </TabsContent>

        <TabsContent value="actions" className="space-y-6">
          <div>
            <SectionTitle
              icon={MousePointerClick}
              title="Actions"
              count={qvwAnalysis.actions.length}
            />
            <div className="space-y-3 mt-4">
              {qvwAnalysis.actions.map((action) => (
                <ActionCard key={action.id} action={action} />
              ))}
              {qvwAnalysis.actions.length === 0 && (
                <EmptyResult message="No actions were detected." />
              )}
            </div>
          </div>
          <div>
            <SectionTitle icon={Workflow} title="Triggers" count={qvwAnalysis.triggers.length} />
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              {qvwAnalysis.triggers.map((trigger) => (
                <div key={trigger.id} className="surface-card p-5">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-violet-500" />
                    <div className="font-semibold text-sm">{trigger.event}</div>
                    <StatusBadge status={trigger.migrationStatus} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-3">
                    Scope: {trigger.scope} · Owner: {trigger.ownerId || "Document"}
                  </div>
                </div>
              ))}
              {qvwAnalysis.triggers.length === 0 && (
                <EmptyResult message="No triggers were detected." />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="bookmarks" className="space-y-3">
          {qvwAnalysis.bookmarks.map((bookmark) => (
            <div key={bookmark.id} className="surface-card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Bookmark className="h-5 w-5 text-primary" />
                <div>
                  <div className="font-semibold">{bookmark.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {bookmark.id} · {bookmark.kind}
                  </div>
                </div>
                <StatusBadge status={bookmark.migrationStatus} />
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                {bookmark.description || "No description"}
              </p>
              <div className="mt-4 space-y-2">
                {bookmark.selections.map((selection, index) => (
                  <div
                    key={`${selection.field}-${index}`}
                    className="rounded-lg bg-accent/40 p-3 text-xs"
                  >
                    <span className="font-semibold">{selection.field}</span>:{" "}
                    {selection.values.join(", ") || "Selection value not exported"}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {qvwAnalysis.bookmarks.length === 0 && (
            <EmptyResult message="No document bookmarks were detected. Personal/server bookmarks may require a server-side export." />
          )}
        </TabsContent>

        <TabsContent value="macros" className="space-y-6">
          <div>
            <SectionTitle icon={Code2} title="Macros" count={qvwAnalysis.macros.length} />
            <div className="space-y-4 mt-4">
              {qvwAnalysis.macros.map((macro) => (
                <div key={macro.name} className="surface-card p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Code2 className="h-5 w-5 text-red-500" />
                    <div className="font-mono font-bold">{macro.name}</div>
                    <StatusBadge status={macro.migrationStatus} />
                    <span
                      className={cn(
                        "ml-auto rounded-full px-3 py-1 text-xs",
                        macro.riskLevel === "high"
                          ? "bg-red-500/10 text-red-500"
                          : macro.riskLevel === "medium"
                            ? "bg-amber-500/10 text-amber-600"
                            : "bg-emerald-500/10 text-emerald-600",
                      )}
                    >
                      {macro.riskLevel} risk
                    </span>
                  </div>
                  <div className="grid lg:grid-cols-2 gap-4 mt-4">
                    <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-200">
                      {macro.body}
                    </pre>
                    <div className="space-y-3 text-sm">
                      <Property label="Language" value={macro.language} />
                      <Property
                        label="Called by"
                        value={macro.calledBy.join(", ") || "No direct caller resolved"}
                      />
                      <Property
                        label="Operations"
                        value={macro.operations.join("; ") || "No known operation classified"}
                      />
                      <Property
                        label="Power BI replacement"
                        value={macro.powerBiReplacement.join(" ")}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {qvwAnalysis.macros.length === 0 && (
                <EmptyResult message="Module.txt was not supplied or no macro procedures were detected." />
              )}
            </div>
          </div>
          <div>
            <SectionTitle icon={Box} title="Extensions" count={qvwAnalysis.extensions.length} />
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              {qvwAnalysis.extensions.map((extension) => (
                <div key={extension.objectId} className="surface-card p-5">
                  <div className="font-semibold">{extension.extensionName}</div>
                  <div className="font-mono text-xs text-muted-foreground mt-1">
                    {extension.objectId}
                  </div>
                  <StatusBadge status={extension.migrationStatus} />
                  <p className="text-xs text-muted-foreground mt-3">{extension.notes.join(" ")}</p>
                </div>
              ))}
              {qvwAnalysis.extensions.length === 0 && (
                <EmptyResult message="No extension objects were detected." />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="package" className="space-y-4">
          <PackageReadiness analysis={qvwAnalysis} />
        </TabsContent>
      </Tabs>

      {selectedObject && (
        <ObjectDetail object={selectedObject} onClose={() => setSelectedObjectId(null)} />
      )}
    </div>
  );
}

function Overview({ analysis }: { analysis: QvwAnalysis }) {
  const statusCounts = analysis.objects.reduce<Record<QvwMigrationStatus, number>>(
    (acc, object) => {
      acc[object.migrationStatus] = (acc[object.migrationStatus] ?? 0) + 1;
      return acc;
    },
    {
      "auto-convertible": 0,
      "review-required": 0,
      "manual-redesign": 0,
      unsupported: 0,
      "missing-dependency": 0,
    },
  );
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="surface-card p-6">
        <SectionTitle icon={ListTree} title="Document metadata" />
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <Property label="QVW file" value={analysis.document.fileName || "Not supplied"} />
          <Property label="Document ID" value={analysis.document.documentId || "—"} />
          <Property label="Author" value={analysis.document.author || "—"} />
          <Property label="Qlik version" value={analysis.document.qlikVersion || "—"} />
          <Property label="Last reload" value={analysis.document.lastReloadAt || "—"} />
          <Property
            label="Section Access"
            value={analysis.document.sectionAccessDetected ? "Detected" : "Not detected"}
          />
          <Property
            label="Alternate states"
            value={analysis.document.alternateStates.join(", ") || "Default only"}
          />
          <Property
            label="Load script"
            value={
              analysis.loadScript
                ? `${analysis.loadScript.length.toLocaleString()} characters`
                : "Missing"
            }
          />
        </div>
      </div>
      <div className="surface-card p-6">
        <SectionTitle icon={Sparkles} title="Power BI migration classification" />
        <div className="space-y-3 mt-5">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="flex items-center gap-3">
              <StatusBadge status={status as QvwMigrationStatus} />
              <div className="h-2 flex-1 rounded-full bg-accent overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{
                    width: `${analysis.objects.length ? (count / analysis.objects.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="font-mono text-sm w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="surface-card p-6 lg:col-span-2">
        <SectionTitle icon={Braces} title="Extraction coverage" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          <Coverage
            label="Visual objects"
            value={analysis.metrics.objectCount > 0}
            detail={`${analysis.metrics.objectCount} objects`}
          />
          <Coverage
            label="Expressions"
            value={analysis.metrics.expressionCount > 0}
            detail={`${analysis.metrics.expressionCount} expressions`}
          />
          <Coverage
            label="Variables"
            value={analysis.metrics.variableCount > 0}
            detail={`${analysis.metrics.variableCount} variables`}
          />
          <Coverage
            label="Interactions"
            value={analysis.metrics.actionCount + analysis.metrics.triggerCount > 0}
            detail={`${analysis.metrics.actionCount} actions / ${analysis.metrics.triggerCount} triggers`}
          />
        </div>
      </div>
    </div>
  );
}

function PackageReadiness({ analysis }: { analysis: QvwAnalysis }) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="p-6 border-b border-border flex flex-wrap items-center gap-4">
        <PackageOpen className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h3 className="font-display text-xl font-semibold">Upload package readiness</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {analysis.intake.completenessScore}% completeness · {analysis.intake.mode}
          </p>
        </div>
        <StatusBadge
          status={
            analysis.intake.readyForFullMigration
              ? "auto-convertible"
              : analysis.intake.readyForVisualizationAnalysis
                ? "review-required"
                : "missing-dependency"
          }
          label={
            analysis.intake.readyForFullMigration
              ? "Full migration ready"
              : analysis.intake.readyForVisualizationAnalysis
                ? "Visual analysis ready"
                : "Missing mandatory files"
          }
        />
      </div>
      <div className="divide-y divide-border">
        {analysis.intake.requirements.map((requirement) => (
          <div key={requirement.id} className="p-5 flex gap-4">
            {requirement.present ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            ) : (
              <FileWarning
                className={cn(
                  "h-5 w-5 shrink-0",
                  requirement.category === "mandatory" ? "text-red-500" : "text-amber-500",
                )}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-sm">{requirement.label}</div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] uppercase font-semibold",
                    requirement.category === "mandatory"
                      ? "bg-red-500/10 text-red-500"
                      : requirement.category === "recommended"
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-sky-500/10 text-sky-600",
                  )}
                >
                  {requirement.category}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{requirement.reason}</p>
              {requirement.matchedFiles.length > 0 && (
                <div className="font-mono text-[11px] text-primary mt-2 break-all">
                  {requirement.matchedFiles.slice(0, 6).join(" · ")}
                  {requirement.matchedFiles.length > 6
                    ? ` · +${requirement.matchedFiles.length - 6} more`
                    : ""}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: QvwDiagnostic[] }) {
  return (
    <div className="space-y-2">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.code}-${index}`}
          className={cn(
            "surface-card p-4 flex gap-3 border",
            diagnostic.severity === "error"
              ? "border-red-500/30 bg-red-500/5"
              : diagnostic.severity === "warning"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-sky-500/30 bg-sky-500/5",
          )}
        >
          {diagnostic.severity === "error" ? (
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          ) : diagnostic.severity === "warning" ? (
            <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0" />
          ) : (
            <Eye className="h-5 w-5 text-sky-500 shrink-0" />
          )}
          <div>
            <div className="font-semibold text-sm">{diagnostic.message}</div>
            <div className="font-mono text-[10px] text-muted-foreground mt-1">
              {diagnostic.code}
              {diagnostic.file ? ` · ${diagnostic.file}` : ""}
            </div>
            {diagnostic.recommendation && (
              <p className="text-xs text-muted-foreground mt-2">{diagnostic.recommendation}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ObjectCard({ object, onOpen }: { object: QvwVisualizationObject; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="surface-card p-5 text-left hover:border-primary/40 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
          <Gauge className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{object.title || object.id}</div>
          <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
            {object.id} · {object.type} · {object.sheetId || "Unassigned"}
          </div>
        </div>
        <StatusBadge status={object.migrationStatus} compact />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
        <Property label="Dimensions" value={String(object.dimensions.length)} />
        <Property label="Measures" value={String(object.measures.length)} />
        <Property label="Actions" value={String(object.actions.length)} />
      </div>
      <div className="rounded-lg bg-primary/5 text-primary p-3 mt-4 text-xs">
        <span className="font-semibold">Power BI:</span> {object.powerBiVisual}
      </div>
      {object.warnings.length > 0 && (
        <p className="text-xs text-amber-600 mt-3 line-clamp-2">{object.warnings.join(" ")}</p>
      )}
    </button>
  );
}

function ObjectMiniCard({
  object,
  onOpen,
}: {
  object: QvwVisualizationObject;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="rounded-xl border border-border p-4 text-left hover:border-primary/40 hover:bg-accent/20 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm truncate">{object.title || object.id}</span>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground mt-2">
        {object.id} · {object.type}
      </div>
      <div className="text-xs text-primary mt-3">{object.powerBiVisual}</div>
    </button>
  );
}

function ExpressionCard({ expression }: { expression: QvwExpression }) {
  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <FunctionSquare className="h-5 w-5 text-primary" />
        <div className="font-semibold text-sm">{expression.label || expression.id}</div>
        <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] uppercase">
          {expression.role}
        </span>
        <StatusBadge status={expression.migrationStatus} />
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {expression.objectId || "Document"}
        </span>
      </div>
      <pre className="mt-4 rounded-xl bg-slate-950 p-4 text-xs text-slate-200 whitespace-pre-wrap break-words overflow-x-auto">
        {expression.expression}
      </pre>
      <div className="grid md:grid-cols-3 gap-3 mt-4">
        <Property label="Variables" value={expression.variables.join(", ") || "—"} />
        <Property label="Fields" value={expression.fields.join(", ") || "—"} />
        <Property label="Functions" value={expression.functions.join(", ") || "—"} />
      </div>
      {expression.proposedDax && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="text-[10px] uppercase tracking-widest text-emerald-600 font-semibold">
            Initial DAX candidate
          </div>
          <code className="text-xs mt-2 block">{expression.proposedDax}</code>
        </div>
      )}
      {expression.notes.length > 0 && (
        <div className="mt-3 text-xs text-amber-600">{expression.notes.join(" ")}</div>
      )}
    </div>
  );
}

function ActionCard({ action }: { action: QvwAction }) {
  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <MousePointerClick className="h-5 w-5 text-primary" />
        <div className="font-semibold text-sm">{action.type}</div>
        <StatusBadge status={action.migrationStatus} />
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {action.objectId || "Document"} · #{action.order}
        </span>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mt-4">
        <Property label="Target" value={action.target || "—"} />
        <Property label="Value" value={action.value || "—"} />
        <Property label="Trigger" value={action.trigger || "—"} />
      </div>
      <div className="rounded-lg bg-primary/5 text-primary p-3 mt-4 text-xs">
        <span className="font-semibold">Power BI mapping:</span> {action.powerBiMapping}
      </div>
    </div>
  );
}

function ObjectDetail({
  object,
  onClose,
}: {
  object: QvwVisualizationObject;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm p-4 md:p-8" onClick={onClose}>
      <div
        className="ml-auto h-full max-w-3xl overflow-y-auto rounded-2xl bg-background border border-border shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border p-5 flex items-center gap-3">
          <div className="flex-1">
            <h3 className="font-display text-xl font-bold">{object.title || object.id}</h3>
            <div className="font-mono text-xs text-muted-foreground">
              {object.id} · {object.type} · {object.file}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Close
          </button>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid md:grid-cols-2 gap-3">
            <Property label="Power BI visual" value={object.powerBiVisual} />
            <Property label="Migration status" value={object.migrationStatus} />
            <Property label="Sheet" value={object.sheetId || "Unassigned"} />
            <Property label="Alternate state" value={object.alternateState || "Default"} />
            <Property
              label="Position"
              value={`x=${object.layout.x ?? "?"}, y=${object.layout.y ?? "?"}`}
            />
            <Property
              label="Size"
              value={`${object.layout.width ?? "?"} × ${object.layout.height ?? "?"}`}
            />
          </div>
          <div>
            <SectionTitle
              icon={FunctionSquare}
              title="Expressions"
              count={
                object.dimensions.length +
                object.measures.length +
                object.conditionalExpressions.length
              }
            />
            <div className="space-y-3 mt-3">
              {[...object.dimensions, ...object.measures, ...object.conditionalExpressions].map(
                (expression) => (
                  <ExpressionCard key={expression.id} expression={expression} />
                ),
              )}
            </div>
          </div>
          <div>
            <SectionTitle icon={MousePointerClick} title="Actions" count={object.actions.length} />
            <div className="space-y-3 mt-3">
              {object.actions.map((action) => (
                <ActionCard key={action.id} action={action} />
              ))}
              {object.actions.length === 0 && (
                <EmptyResult message="No actions detected on this object." />
              )}
            </div>
          </div>
          {object.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600">
              {object.warnings.join(" ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="surface-card p-3 flex items-center gap-3">
      <Search className="h-4 w-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-sm"
      />
    </div>
  );
}

function StatusBadge({
  status,
  label,
  compact = false,
}: {
  status: QvwMigrationStatus;
  label?: string;
  compact?: boolean;
}) {
  const cls = {
    "auto-convertible": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "review-required": "bg-amber-500/10 text-amber-600 border-amber-500/20",
    "manual-redesign": "bg-violet-500/10 text-violet-600 border-violet-500/20",
    unsupported: "bg-red-500/10 text-red-500 border-red-500/20",
    "missing-dependency": "bg-red-500/10 text-red-500 border-red-500/20",
  }[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold whitespace-nowrap",
        compact ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
        cls,
      )}
    >
      {label || status.replace(/-/g, " ")}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
}) {
  return (
    <div className="surface-card p-4">
      <Icon className="h-5 w-5 text-primary mb-3" />
      <div className="font-display text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-accent/30 p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-xs font-medium mt-1 break-words">{value}</div>
    </div>
  );
}

function Coverage({ label, value, detail }: { label: string; value: boolean; detail: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        {value ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" />
        )}
        <span className="font-semibold text-sm">{label}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-2">{detail}</div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  count,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-primary" />
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {count !== undefined && (
        <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-mono">{count}</span>
      )}
    </div>
  );
}

function EmptyResult({ message }: { message: string }) {
  return (
    <div className="surface-card p-8 text-center text-sm text-muted-foreground">{message}</div>
  );
}
