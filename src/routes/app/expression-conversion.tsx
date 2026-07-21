import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMigration } from "@/lib/migration/store";
import type { ExpressionArtifact, ExpressionArtifactType, ExpressionConversionStatus } from "@/lib/migration/expression";
import { AlertCircle, ArrowLeft, ArrowRight, Braces, Check, CircleAlert, Code2, Filter, FunctionSquare, RefreshCw, Save, Search, Variable, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/expression-conversion")({ component: ExpressionConversionPage });

const artifactTypes: ExpressionArtifactType[] = [
  "measure", "existing-column", "calculated-column", "calculated-table", "field-parameter", "what-if-parameter",
  "disconnected-parameter-table", "calculation-group-candidate", "dynamic-format-string",
  "visual-filter", "page-filter", "report-filter", "conditional-formatting",
  "dynamic-title-measure", "bookmark-navigation", "manual-redesign",
];

function ExpressionConversionPage() {
  const navigate = useNavigate();
  const { qvwAnalysis, expressionInventory, initializeExpressionConversion, updateExpressionArtifact, approveExpressionArtifact, excludeExpressionArtifact, resetExpressionArtifact } = useMigration();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [artifactType, setArtifactType] = useState("all");
  const [sheet, setSheet] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [excludeReason, setExcludeReason] = useState("");

  useEffect(() => { if (qvwAnalysis && !expressionInventory) initializeExpressionConversion(); }, [qvwAnalysis, expressionInventory, initializeExpressionConversion]);

  if (!qvwAnalysis) return <EmptyState />;
  if (!expressionInventory) return <div className="surface-card p-10 text-center"><div className="h-4 w-4 rounded-full bg-primary animate-pulse mx-auto"/><p className="mt-4 text-sm text-muted-foreground">Building the centralized expression inventory…</p></div>;

  const sheets = Array.from(new Set(expressionInventory.artifacts.flatMap((item) => item.usages.map((usage) => usage.sheetName).filter(Boolean) as string[]))).sort();
  const term = search.trim().toLowerCase();
  const filtered = expressionInventory.artifacts.filter((item) => {
    const searchMatch = !term || [item.name, item.label, item.originalExpression, item.generatedDax, item.role, ...item.functions, ...item.referencedVariables, ...item.referencedFields, ...item.usages.flatMap((usage) => [usage.objectId, usage.objectTitle, usage.sheetName])].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    const statusMatch = status === "all" || item.status === status;
    const typeMatch = artifactType === "all" || item.artifactType === artifactType;
    const sheetMatch = sheet === "all" || item.usages.some((usage) => usage.sheetName === sheet);
    return searchMatch && statusMatch && typeMatch && sheetMatch;
  });
  const selected = expressionInventory.artifacts.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  const saveSelected = (patch: Partial<ExpressionArtifact>) => {
    if (!selected) return;
    updateExpressionArtifact(selected.id, patch);
    toast.success("Expression conversion saved");
  };

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <div className="flex flex-col xl:flex-row xl:items-center gap-5">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-700 text-white"><FunctionSquare className="h-7 w-7"/></div>
          <div className="flex-1">
            <h2 className="font-display text-2xl font-bold">Qlik Expressions → Power BI Logic</h2>
            <p className="text-sm text-muted-foreground mt-2">Every QVW expression is normalized, parsed, classified, translated and retained with traceability to its sheet and object.</p>
          </div>
          <div className="text-right text-xs text-muted-foreground"><div>Parser version</div><div className="font-mono text-foreground">{expressionInventory.parserVersion}</div></div>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric label="Total expressions" value={expressionInventory.metrics.total} icon={Braces}/>
        <Metric label="Automatic" value={expressionInventory.metrics.automatic} icon={Check}/>
        <Metric label="Warnings" value={expressionInventory.metrics.warning} icon={CircleAlert}/>
        <Metric label="Manual" value={expressionInventory.metrics.manual + expressionInventory.metrics.unsupported} icon={AlertCircle}/>
        <Metric label="Measures" value={expressionInventory.metrics.measures} icon={FunctionSquare}/>
        <Metric label="Parameters" value={expressionInventory.metrics.parameters} icon={Variable}/>
      </section>

      <section className="surface-card p-4">
        <div className="grid lg:grid-cols-[1fr_190px_220px_190px] gap-3">
          <label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expression, DAX, object, field or variable…" className="w-full rounded-xl border border-border bg-background pl-10 pr-3 py-2.5 text-sm"/></label>
          <FilterSelect value={sheet} onChange={setSheet} label="All sheets" options={sheets}/>
          <FilterSelect value={artifactType} onChange={setArtifactType} label="All artifact types" options={artifactTypes}/>
          <FilterSelect value={status} onChange={setStatus} label="All statuses" options={["automatic", "warning", "manual", "unsupported", "missing-dependency", "approved", "excluded"]}/>
        </div>
      </section>

      <section className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,.8fr)] gap-5 items-start">
        <div className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between"><div><h3 className="font-semibold">Expression inventory</h3><p className="text-xs text-muted-foreground">{filtered.length} of {expressionInventory.artifacts.length} artifacts</p></div><Filter className="h-4 w-4 text-muted-foreground"/></div>
          <div className="max-h-[760px] overflow-auto divide-y divide-border">
            {filtered.map((item) => <ExpressionRow key={item.id} item={item} selected={selected?.id === item.id} onClick={() => setSelectedId(item.id)}/>) }
            {!filtered.length && <div className="p-10 text-center text-sm text-muted-foreground">No expressions match the current filters.</div>}
          </div>
        </div>

        {selected ? <ExpressionEditor key={`${selected.id}-${selected.updatedAt}`} item={selected} onSave={saveSelected} onApprove={(approved) => { approveExpressionArtifact(selected.id, approved); toast.success(approved ? "Expression approved" : "Approval removed"); }} onReset={() => { resetExpressionArtifact(selected.id); toast.success("Generated conversion restored"); }} excludeReason={excludeReason} setExcludeReason={setExcludeReason} onExclude={() => { if (!excludeReason.trim()) { toast.error("Provide a reason before excluding this expression"); return; } excludeExpressionArtifact(selected.id, excludeReason.trim()); setExcludeReason(""); toast.success("Expression excluded with traceability retained"); }}/>: <div className="surface-card p-10 text-center text-sm text-muted-foreground">Select an expression to review.</div>}
      </section>

      <div className="flex flex-wrap justify-between gap-3">
        <button onClick={() => navigate({ to: "/app/qvw-analysis" })} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent/30"><ArrowLeft className="h-4 w-4"/> Back to QVW Analysis</button>
        <button onClick={() => navigate({ to: "/app/powerbi-model" })} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Review Power BI Data Model <ArrowRight className="h-4 w-4"/></button>
      </div>
    </div>
  );
}

function ExpressionEditor({ item, onSave, onApprove, onReset, excludeReason, setExcludeReason, onExclude }: { item: ExpressionArtifact; onSave: (patch: Partial<ExpressionArtifact>) => void; onApprove: (approved: boolean) => void; onReset: () => void; excludeReason: string; setExcludeReason: (value: string) => void; onExclude: () => void }) {
  const [name, setName] = useState(item.name);
  const [type, setType] = useState<ExpressionArtifactType>(item.artifactType);
  const [homeTable, setHomeTable] = useState(item.homeTable);
  const [folder, setFolder] = useState(item.displayFolder);
  const [format, setFormat] = useState(item.formatString || "");
  const [description, setDescription] = useState(item.description);
  const [dax, setDax] = useState(item.editedDax || item.generatedDax);
  const [astOpen, setAstOpen] = useState(false);
  return <div className="surface-card p-5 sticky top-24 space-y-5 max-h-[820px] overflow-auto">
    <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Code2 className="h-5 w-5"/></div><div className="flex-1 min-w-0"><h3 className="font-semibold truncate">{item.label}</h3><div className="font-mono text-[10px] text-muted-foreground">{item.id} · {item.confidence}% confidence</div></div><StatusPill status={item.status}/></div>
    <div><Label>Original Qlik expression</Label><pre className="rounded-xl bg-slate-950 text-slate-100 p-4 text-xs whitespace-pre-wrap max-h-36 overflow-auto">{item.originalExpression}</pre></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Power BI name" value={name} onChange={setName}/><div><Label>Artifact type</Label><select value={type} onChange={(e) => setType(e.target.value as ExpressionArtifactType)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{artifactTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></div><Field label="Home table" value={homeTable} onChange={setHomeTable}/><Field label="Display folder" value={folder} onChange={setFolder}/><Field label="Format string" value={format} onChange={setFormat}/><Field label="Description" value={description} onChange={setDescription}/></div>
    <div><Label>Generated / edited DAX</Label><textarea value={dax} onChange={(e) => setDax(e.target.value)} rows={10} className="w-full rounded-xl border border-border bg-slate-950 text-slate-100 p-4 font-mono text-xs"/></div>
    <div className="flex flex-wrap gap-2"><button onClick={() => onSave({ name, artifactType: type, homeTable, displayFolder: folder, formatString: format || undefined, description, editedDax: dax, status: item.status === "automatic" ? "warning" : item.status })} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"><Save className="h-3.5 w-3.5"/> Save</button><button onClick={() => onApprove(!item.approved)} className={cn("inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-semibold", item.approved ? "border-emerald-500/50 text-emerald-600 bg-emerald-500/10" : "border-border")}><Check className="h-3.5 w-3.5"/>{item.approved ? "Approved" : "Approve"}</button><button onClick={onReset} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-semibold"><RefreshCw className="h-3.5 w-3.5"/> Reset generated</button></div>
    <div className="rounded-xl border border-border p-4 space-y-3"><button onClick={() => setAstOpen((value) => !value)} className="flex w-full items-center justify-between text-sm font-semibold"><span>Parsed AST and dependencies</span><span>{astOpen ? "−" : "+"}</span></button>{astOpen && <div className="space-y-3"><Property label="Fields" value={item.referencedFields.join(", ") || "None"}/><Property label="Variables" value={item.referencedVariables.join(", ") || "None"}/><Property label="Functions" value={item.functions.join(", ") || "None"}/><pre className="max-h-60 overflow-auto rounded-lg bg-accent/30 p-3 text-[10px]">{item.astJson || "AST unavailable"}</pre></div>}</div>
    {(item.issues.length > 0 || item.explanation.length > 0) && <div className="space-y-2">{item.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className={cn("rounded-lg border p-3 text-xs", issue.severity === "error" || issue.severity === "blocking-error" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5")}><div className="font-semibold">{issue.code}</div><div className="text-muted-foreground mt-1">{issue.message}</div>{issue.recommendation && <div className="mt-2">Fix: {issue.recommendation}</div>}</div>)}{item.explanation.map((line, index) => <div key={index} className="text-xs text-muted-foreground">• {line}</div>)}</div>}
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4"><Label>Exclude with mandatory reason</Label><div className="flex gap-2"><input value={excludeReason} onChange={(e) => setExcludeReason(e.target.value)} placeholder="Reason for exclusion…" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs"/><button onClick={onExclude} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-600"><X className="h-4 w-4"/></button></div></div>
  </div>;
}

function ExpressionRow({ item, selected, onClick }: { item: ExpressionArtifact; selected: boolean; onClick: () => void }) { return <button onClick={onClick} className={cn("w-full text-left p-4 hover:bg-accent/25 transition", selected && "bg-accent/40 border-l-2 border-primary")}><div className="flex items-start gap-3"><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm truncate">{item.name}</span><StatusPill status={item.status}/><span className="rounded-full bg-accent px-2 py-0.5 text-[10px]">{item.artifactType}</span></div><div className="mt-2 font-mono text-[11px] text-muted-foreground line-clamp-2">{item.originalExpression}</div><div className="mt-2 text-[10px] text-muted-foreground">{item.usages.map((usage) => [usage.sheetName, usage.objectId].filter(Boolean).join(" / ")).join(", ") || "Document expression"}</div></div><div className="font-mono text-xs text-muted-foreground">{item.confidence}%</div></div></button>; }
function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Braces }) { return <div className="surface-card p-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Icon className="h-4 w-4"/></div><div><div className="font-display text-xl font-bold">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div></div>; }
function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) { return <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"><option value="all">{label}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>; }
function StatusPill({ status }: { status: ExpressionConversionStatus }) { const classes: Record<string, string> = { automatic: "bg-emerald-500/10 text-emerald-600", approved: "bg-emerald-500/10 text-emerald-600", warning: "bg-amber-500/10 text-amber-600", manual: "bg-orange-500/10 text-orange-600", unsupported: "bg-red-500/10 text-red-600", "missing-dependency": "bg-red-500/10 text-red-600", excluded: "bg-slate-500/10 text-slate-500" }; return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", classes[status] || classes.warning)}>{status}</span>; }
function Label({ children }: { children: React.ReactNode }) { return <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>; }
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label><Label>{label}</Label><input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/></label>; }
function Property({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="text-xs mt-1 break-words">{value}</div></div>; }
function EmptyState() { return <div className="surface-card p-10 text-center"><AlertCircle className="h-10 w-10 text-amber-500 mx-auto"/><h2 className="font-display text-xl font-bold mt-4">QVW analysis is required</h2><p className="text-sm text-muted-foreground mt-2">Upload a QVW project package and complete QVW UI Analysis before converting expressions.</p><Link to="/app" className="inline-flex mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Go to Upload</Link></div>; }
