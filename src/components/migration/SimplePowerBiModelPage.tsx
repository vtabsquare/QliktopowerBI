import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Database,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Link2,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Table2,
  Trash2,
  TriangleAlert,
  WandSparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useMigration } from "@/lib/migration/store";
import { repairDomId } from "@/lib/migration/autofix";
import { RepairFocusNotice } from "./RepairFocusNotice";
import {
  cardinalitySymbols,
  recommendRelationship,
  recommendTableKey,
  type CrossFilterDirection,
  type ModelTableKind,
  type PowerBiColumn,
  type PowerBiRelationship,
  type PowerBiTable,
  type RelationshipCardinality,
} from "@/lib/migration/model";
import { cn } from "@/lib/utils";

type ModelTab = "overview" | "tables" | "relationships" | "checks";

export function SimplePowerBiModelPage() {
  const navigate = useNavigate();
  const {
    powerBiModel,
    initializePowerBiModel,
    updateModelTable,
    updateModelColumn,
    updateModelMeasure,
    setModelTableKey,
    setModelBuildMode,
    addRelationship,
    updateRelationship,
    deleteRelationship,
    restoreRelationship,
    applySmartModel,
    validateModel,
    repairFocus,
  } = useMigration();
  const [tab, setTab] = useState<ModelTab>("overview");
  const [search, setSearch] = useState("");
  const [tableFilter, setTableFilter] = useState<ModelTableKind | "all">("all");

  useEffect(() => {
    if (!powerBiModel) initializePowerBiModel();
  }, [powerBiModel, initializePowerBiModel]);

  useEffect(() => {
    if (!repairFocus || repairFocus.route !== "/app/powerbi-model") return;
    if (repairFocus.tab) setTab(repairFocus.tab);
    if (repairFocus.tab === "tables" && repairFocus.objectName) {
      const table = powerBiModel?.tables.find((item) =>
        item.id === repairFocus.objectId
        || item.name.toLowerCase() === repairFocus.objectName?.toLowerCase()
        || item.measures.some((measure) => measure.id === repairFocus.objectId || measure.name.toLowerCase() === repairFocus.objectName?.toLowerCase()),
      );
      if (table) { setSearch(table.name); setTableFilter("all"); }
    }
  }, [repairFocus, powerBiModel]);

  if (!powerBiModel || !powerBiModel.tables.length) return <EmptyModel />;

  const activeRelationships = powerBiModel.relationships.filter((item) => !item.deleted && item.active);
  const reviewRelationships = powerBiModel.relationships.filter((item) => !item.deleted && !item.active && item.recommendationStatus !== "exclude");
  const excludedRelationships = powerBiModel.relationships.filter((item) => item.deleted || item.recommendationStatus === "exclude");
  const tablesWithMultipleKeys = powerBiModel.tables.filter((table) => table.columns.filter((column) => column.isKey).length > 1);
  const modelReady = powerBiModel.blockingErrorCount === 0;

  const applyRecommended = () => {
    setModelBuildMode("automatic");
    applySmartModel();
    toast.success("Recommended Power BI model applied", {
      description: "Valid low-risk relationships were activated and table keys were normalized.",
    });
  };

  return (
    <div className="space-y-6">
      <RepairFocusNotice areas={["model-tables", "relationships"]} />
      <section className="surface-card overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 via-background to-emerald-500/10 p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <Network className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-bold">Simple Power BI Data Model</h2>
                <ReadinessBadge readiness={powerBiModel.readiness} />
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                The application identifies safe relationships, chooses one row identifier per lookup table, and sends only approved connections to the Power BI TMDL model.
              </p>
            </div>
            <button
              type="button"
              onClick={applyRecommended}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:opacity-90"
            >
              <WandSparkles className="h-4 w-4" />
              Build recommended model
            </button>
          </div>
        </div>
        <div className="grid gap-0 border-t border-border md:grid-cols-3">
          <GuideStep number="1" title="Review summary" text="See facts, dimensions and model readiness." active={tab === "overview"} onClick={() => setTab("overview")} />
          <GuideStep number="2" title="Confirm only exceptions" text="Recommended keys and relationships are already selected." active={tab === "tables" || tab === "relationships"} onClick={() => setTab("relationships")} />
          <GuideStep number="3" title="Validate and export" text="Blocking issues must be zero before PBIP export." active={tab === "checks"} onClick={() => setTab("checks")} />
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="flex-1">
            <h3 className="font-semibold">Choose how the Power BI model is completed</h3>
            <p className="mt-1 text-xs text-muted-foreground">This choice controls which relationships are written to the PBIP. Power Query tables, measures, composite keys and lineage remain available in every mode.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {([
              ["qlik-equivalent", "Qlik-equivalent", "Reproduce explicit Qlik joins and table grain as closely as Power BI permits."],
              ["powerbi-optimized", "Power BI optimized", "Prefer a governed fact/dimension model and remove redundant semantic tables."],
              ["desktop-review", "Review in Desktop", "Export relationship candidates inactive for Desktop review."],
              ["queries-only", "Tables only", "Export queries, keys and measures without relationships."],
            ] as const).map(([mode, title, detail]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setModelBuildMode(mode)}
                className={cn(
                  "rounded-xl border px-4 py-3 text-left transition",
                  powerBiModel.buildMode === mode || (mode === "powerbi-optimized" && powerBiModel.buildMode === "automatic")
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <span className="block text-xs font-semibold">{title}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">{detail}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Tables" value={powerBiModel.tables.length} hint={`${powerBiModel.tables.filter((table) => table.kind === "fact").length} fact`} />
        <Metric label="Ready relationships" value={activeRelationships.length} hint="Included in Power BI" good />
        <Metric label="Need review" value={reviewRelationships.length} hint="Not exported as active" warning={reviewRelationships.length > 0} />
        <Metric label="Key conflicts" value={tablesWithMultipleKeys.length} hint="Maximum one per table" warning={tablesWithMultipleKeys.length > 0} />
        <Metric label="Blocking errors" value={powerBiModel.blockingErrorCount} hint={modelReady ? "Ready to continue" : "Resolve before export"} warning={!modelReady} good={modelReady} />
      </section>

      <section className="surface-card p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<Network className="h-4 w-4" />} label="Model summary" />
          <TabButton active={tab === "tables"} onClick={() => setTab("tables")} icon={<Table2 className="h-4 w-4" />} label="Tables & keys" />
          <TabButton active={tab === "relationships"} onClick={() => setTab("relationships")} icon={<Link2 className="h-4 w-4" />} label="Relationships" />
          <TabButton active={tab === "checks"} onClick={() => setTab("checks")} icon={<ShieldAlert className="h-4 w-4" />} label="Validation" />
        </div>
      </section>

      {tab === "overview" && (
        <OverviewPanel
          tables={powerBiModel.tables}
          relationships={powerBiModel.relationships}
          onOpenTables={() => setTab("tables")}
          onOpenRelationships={() => setTab("relationships")}
          onApply={applyRecommended}
        />
      )}

      {tab === "tables" && (
        <TablesPanel
          tables={powerBiModel.tables}
          relationships={powerBiModel.relationships}
          search={search}
          setSearch={setSearch}
          filter={tableFilter}
          setFilter={setTableFilter}
          onTable={updateModelTable}
          onColumn={updateModelColumn}
          onMeasure={updateModelMeasure}
          onKey={setModelTableKey}
        />
      )}

      {tab === "relationships" && (
        <RelationshipsPanel
          tables={powerBiModel.tables}
          relationships={powerBiModel.relationships}
          onUpdate={(id, patch) => {
            const result = updateRelationship(id, patch);
            if (!result.ok) toast.error(result.messages.join(" "));
            return result;
          }}
          onDelete={deleteRelationship}
          onRestore={restoreRelationship}
          onAdd={(relationship) => {
            const result = addRelationship(relationship);
            result.ok ? toast.success("Relationship added") : toast.error(result.messages.join(" "));
            return result;
          }}
          onApply={applyRecommended}
        />
      )}

      {tab === "checks" && (
        <ValidationPanel
          diagnostics={powerBiModel.diagnostics}
          readiness={powerBiModel.readiness}
          visualValid={powerBiModel.visualBindings.filter((binding) => binding.status === "valid").length}
          visualTotal={powerBiModel.visualBindings.length}
          onValidate={() => {
            validateModel();
            toast.success("Power BI model validation completed");
          }}
          onGoToTables={() => setTab("tables")}
          onGoToRelationships={() => setTab("relationships")}
        />
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <button onClick={() => navigate({ to: "/app/expression-conversion" })} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium">
          <ArrowLeft className="h-4 w-4" /> Back to Expressions
        </button>
        <button
          onClick={() => navigate({ to: "/app/semantic-model" })}
          disabled={!modelReady}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue to Validation & Export <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function OverviewPanel({ tables, relationships, onOpenTables, onOpenRelationships, onApply }: { tables: PowerBiTable[]; relationships: PowerBiRelationship[]; onOpenTables: () => void; onOpenRelationships: () => void; onApply: () => void }) {
  const facts = tables.filter((table) => table.kind === "fact");
  const dimensions = tables.filter((table) => table.kind === "dimension" || table.kind === "date");
  const supporting = tables.filter((table) => !facts.includes(table) && !dimensions.includes(table));
  const active = relationships.filter((relationship) => relationship.active && !relationship.deleted);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Recommended star-schema view</h3>
            <p className="mt-1 text-xs text-muted-foreground">Fact tables are shown in the centre; lookup tables connect using validated one-to-many relationships.</p>
          </div>
          <button onClick={onApply} className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Rebuild recommendations
          </button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <TableGroup title="Lookup tables" tables={dimensions} tone="dimension" />
          <div className="hidden h-full min-h-48 items-center justify-center lg:flex">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Link2 className="h-6 w-6" />
              <span className="text-[10px] font-semibold uppercase">{active.length} validated links</span>
            </div>
          </div>
          <TableGroup title="Fact tables" tables={facts} tone="fact" />
        </div>
        {supporting.length > 0 && <div className="mt-5"><TableGroup title="Supporting tables" tables={supporting} tone="support" /></div>}
      </section>

      <section className="surface-card p-5">
        <h3 className="font-semibold">What the application decided</h3>
        <div className="mt-4 space-y-3">
          <Decision icon={<CheckCircle2 className="h-4 w-4" />} title={`${active.length} relationships included`} text="Only approved, validated relationships are written into Power BI." tone="good" />
          <Decision icon={<KeyRound className="h-4 w-4" />} title="One row identifier maximum" text="Fact tables can use None when no true unique row ID exists." tone="info" />
          <Decision icon={<ShieldAlert className="h-4 w-4" />} title="Risky paths stay inactive" text="Many-to-many, bidirectional and low-confidence matches require review." tone="warning" />
        </div>
        <div className="mt-5 grid gap-2">
          <button onClick={onOpenRelationships} className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Review relationship exceptions</button>
          <button onClick={onOpenTables} className="rounded-xl border border-border px-4 py-3 text-sm font-semibold">Review table roles and keys</button>
        </div>
      </section>
    </div>
  );
}

function TablesPanel({ tables, relationships, search, setSearch, filter, setFilter, onTable, onColumn, onMeasure, onKey }: {
  tables: PowerBiTable[];
  relationships: PowerBiRelationship[];
  search: string;
  setSearch: (value: string) => void;
  filter: ModelTableKind | "all";
  setFilter: (value: ModelTableKind | "all") => void;
  onTable: (tableId: string, patch: Partial<PowerBiTable>) => void;
  onColumn: (tableId: string, columnId: string, patch: Partial<PowerBiColumn>) => void;
  onMeasure: (tableId: string, measureId: string, patch: any) => void;
  onKey: (tableId: string, columnId: string | null) => void;
}) {
  const filtered = tables.filter((table) => {
    const term = search.trim().toLowerCase();
    return (filter === "all" || table.kind === filter) && (!term || [table.name, ...table.columns.map((column) => column.name)].some((value) => value.toLowerCase().includes(term)));
  });
  return (
    <section className="surface-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <h3 className="font-semibold">Tables and row identifiers</h3>
          <p className="mt-1 text-xs text-muted-foreground">Use one dropdown per table. There are no separate key icons to accidentally select more than once.</p>
        </div>
        <label className="relative min-w-64 flex-1 lg:max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search table or field…" className="w-full rounded-xl border border-border bg-background py-2 pl-10 pr-3 text-sm" />
        </label>
        <select value={filter} onChange={(event) => setFilter(event.target.value as ModelTableKind | "all")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All table roles</option>
          {(["fact", "dimension", "date", "bridge", "parameter", "calculated", "disconnected", "unknown"] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </div>
      <div className="mt-5 space-y-4">
        {filtered.map((table) => (
          <SimpleTableEditor
            key={table.id}
            table={table}
            relationships={relationships}
            onTable={(patch) => onTable(table.id, patch)}
            onColumn={(columnId, patch) => onColumn(table.id, columnId, patch)}
            onMeasure={(measureId, patch) => onMeasure(table.id, measureId, patch)}
            onKey={(columnId) => onKey(table.id, columnId)}
          />
        ))}
      </div>
    </section>
  );
}

function SimpleTableEditor({ table, relationships, onTable, onColumn, onMeasure, onKey }: {
  table: PowerBiTable;
  relationships: PowerBiRelationship[];
  onTable: (patch: Partial<PowerBiTable>) => void;
  onColumn: (columnId: string, patch: Partial<PowerBiColumn>) => void;
  onMeasure: (measureId: string, patch: any) => void;
  onKey: (columnId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedKey = table.columns.find((column) => column.isKey)?.id ?? "";
  const recommendation = recommendTableKey(table, relationships);
  const connections = relationships.filter((relationship) => !relationship.deleted && (relationship.fromTableId === table.id || relationship.toTableId === table.id));
  return (
    <article id={repairDomId("model-tables", table.name, table.id)} data-repair-object={table.name} className="overflow-hidden rounded-2xl border border-border bg-background">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(180px,0.8fr)_180px_minmax(260px,1fr)_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", tableTone(table.kind))} />
            <input defaultValue={table.name} onBlur={(event) => onTable({ name: event.target.value })} className="min-w-0 max-w-full border-0 bg-transparent p-0 font-semibold outline-none" />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{table.columns.length} fields · {table.measures.length} measures · {connections.length} connections</div>
        </div>
        <label>
          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Table role</span>
          <select value={table.kind} onChange={(event) => onTable({ kind: event.target.value as ModelTableKind })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs">
            {(["fact", "dimension", "date", "bridge", "parameter", "calculated", "disconnected", "unknown"] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
        <label>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Row identifier / key</span>
            {recommendation.columnId && <span className="text-[9px] text-emerald-600">Recommended: {table.columns.find((column) => column.id === recommendation.columnId)?.name}</span>}
          </div>
          <select value={selectedKey} onChange={(event) => onKey(event.target.value || null)} className={cn("w-full rounded-lg border bg-background px-3 py-2 text-xs", table.columns.filter((column) => column.isKey).length > 1 ? "border-red-500" : "border-border")}>
            <option value="">None — valid for fact tables</option>
            {table.columns.map((column) => <option key={column.id} value={column.id}>{column.name} ({column.dataType})</option>)}
          </select>
          <span className="mt-1 block text-[10px] text-muted-foreground">{table.keyRecommendationReason || recommendation.reason}</span>
        </label>
        <div className="flex items-center justify-end gap-2">
          {selectedKey === recommendation.columnId || (!selectedKey && !recommendation.columnId) ? <StatusPill tone="good" text="Key checked" /> : <button onClick={() => onKey(recommendation.columnId)} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-[10px] font-semibold text-emerald-600">Use recommendation</button>}
          <button onClick={() => setOpen((value) => !value)} className="rounded-lg border border-border p-2" title="Show fields and measures"><ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} /></button>
        </div>
      </div>
      {open && (
        <div className="grid gap-5 border-t border-border bg-muted/20 p-4 xl:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold">Fields</h4><span className="text-[10px] text-muted-foreground">Advanced edits</span></div>
            <div className="max-h-72 overflow-auto rounded-xl border border-border bg-background divide-y divide-border">
              {table.columns.map((column) => (
                <div key={column.id} id={repairDomId("model-tables", column.name, column.id)} data-repair-object={column.name} className="grid grid-cols-[minmax(140px,1fr)_110px_auto] items-center gap-2 p-2">
                  <div className="flex items-center gap-2"><span className="w-4">{column.isKey && <KeyRound className="h-3.5 w-3.5 text-amber-500" />}</span><input defaultValue={column.name} onBlur={(event) => onColumn(column.id, { name: event.target.value })} className="min-w-0 w-full rounded border border-border bg-background px-2 py-1 text-xs" /></div>
                  <select value={column.dataType} onChange={(event) => onColumn(column.id, { dataType: event.target.value })} className="rounded border border-border bg-background px-2 py-1 text-[10px]"><option>string</option><option>int64</option><option>double</option><option>dateTime</option><option>boolean</option><option>decimal</option></select>
                  <button title="Show or hide field" onClick={() => onColumn(column.id, { hidden: !column.hidden })} className="p-1">{column.hidden ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5" />}</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold">Measures</h4><span className="text-[10px] text-muted-foreground">Existing expression functionality retained</span></div>
            <div className="max-h-72 space-y-2 overflow-auto">
              {table.measures.length ? table.measures.map((measure) => <div key={measure.id} id={repairDomId("dax", measure.name, measure.id)} data-repair-object={measure.name} className="rounded-xl border border-border bg-background p-3"><input defaultValue={measure.name} onBlur={(event) => onMeasure(measure.id, { name: event.target.value })} className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-semibold" /><textarea defaultValue={measure.expression} onBlur={(event) => onMeasure(measure.id, { expression: event.target.value })} rows={3} className="mt-2 w-full rounded bg-slate-950 p-2 font-mono text-[10px] text-slate-100" /></div>) : <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No measures in this table.</div>}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function RelationshipsPanel({ tables, relationships, onUpdate, onDelete, onRestore, onAdd, onApply }: {
  tables: PowerBiTable[];
  relationships: PowerBiRelationship[];
  onUpdate: (id: string, patch: Partial<PowerBiRelationship>) => { ok: boolean; messages: string[] };
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onAdd: (relationship: Omit<PowerBiRelationship, "id" | "validationMessages">) => { ok: boolean; messages: string[] };
  onApply: () => void;
}) {
  const categorized = useMemo(() => relationships.map((relationship) => ({ relationship, recommendation: relationship.recommendationStatus ? { status: relationship.recommendationStatus, reason: relationship.recommendationReason || "" } : recommendRelationship(relationship, tables, relationships) })), [relationships, tables]);
  const ready = categorized.filter((item) => !item.relationship.deleted && item.relationship.active);
  const review = categorized.filter((item) => !item.relationship.deleted && !item.relationship.active && item.recommendation.status !== "exclude");
  const excluded = categorized.filter((item) => item.relationship.deleted || item.recommendation.status === "exclude");
  return (
    <div className="space-y-5">
      <section className="surface-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1"><h3 className="font-semibold">Relationship recommendations</h3><p className="mt-1 text-xs text-muted-foreground">Power BI receives only active relationships. Suggested or excluded items stay visible for traceability but do not become active model paths.</p></div>
          <button onClick={onApply} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><WandSparkles className="h-4 w-4" />Use recommended relationships</button>
        </div>
      </section>

      <RelationshipGroup title="Ready for Power BI" description="Validated and active" tone="good" items={ready} tables={tables} onUpdate={onUpdate} onDelete={onDelete} onRestore={onRestore} />
      <RelationshipGroup title="Needs your review" description="Not active until you approve" tone="warning" items={review} tables={tables} onUpdate={onUpdate} onDelete={onDelete} onRestore={onRestore} />
      <RelationshipGroup title="Excluded or unsafe" description="Not included as an active Power BI relationship" tone="muted" items={excluded} tables={tables} onUpdate={onUpdate} onDelete={onDelete} onRestore={onRestore} />

      <ManualRelationshipForm tables={tables} onAdd={onAdd} />
    </div>
  );
}

function RelationshipGroup({ title, description, tone, items, tables, onUpdate, onDelete, onRestore }: {
  title: string;
  description: string;
  tone: "good" | "warning" | "muted";
  items: Array<{ relationship: PowerBiRelationship; recommendation: { status: string; reason: string } }>;
  tables: PowerBiTable[];
  onUpdate: (id: string, patch: Partial<PowerBiRelationship>) => { ok: boolean; messages: string[] };
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [open, setOpen] = useState(tone !== "muted");
  return (
    <section className="surface-card overflow-hidden">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 p-5 text-left">
        <span className={cn("grid h-9 w-9 place-items-center rounded-xl", tone === "good" ? "bg-emerald-500/10 text-emerald-600" : tone === "warning" ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground")}>{tone === "good" ? <CheckCircle2 className="h-4 w-4" /> : tone === "warning" ? <TriangleAlert className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}</span>
        <div><h3 className="font-semibold">{title} <span className="ml-1 text-muted-foreground">({items.length})</span></h3><p className="text-xs text-muted-foreground">{description}</p></div>
        <ChevronDown className={cn("ml-auto h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 border-t border-border p-4">{items.length ? items.map(({ relationship, recommendation }) => <SimpleRelationshipCard key={relationship.id} relationship={relationship} recommendation={recommendation} tables={tables} onUpdate={onUpdate} onDelete={onDelete} onRestore={onRestore} />) : <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No relationships in this section.</div>}</div>}
    </section>
  );
}

function SimpleRelationshipCard({ relationship, recommendation, tables, onUpdate, onDelete, onRestore }: {
  relationship: PowerBiRelationship;
  recommendation: { status: string; reason: string };
  tables: PowerBiTable[];
  onUpdate: (id: string, patch: Partial<PowerBiRelationship>) => { ok: boolean; messages: string[] };
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const fromTable = tables.find((table) => table.id === relationship.fromTableId);
  const toTable = tables.find((table) => table.id === relationship.toTableId);
  const fromColumn = fromTable?.columns.find((column) => column.id === relationship.fromColumnId);
  const toColumn = toTable?.columns.find((column) => column.id === relationship.toColumnId);
  const symbols = cardinalitySymbols(relationship.cardinality);
  const activate = () => {
    const result = onUpdate(relationship.id, { active: true, userApproved: true, deleted: false });
    result.ok ? toast.success("Relationship included in Power BI") : toast.error(result.messages.join(" "));
  };
  const deactivate = () => {
    const result = onUpdate(relationship.id, { active: false, userApproved: false });
    result.ok && toast.success("Relationship made inactive");
  };
  return (
    <article id={repairDomId("relationships", `${fromTable?.name || "?"} → ${toTable?.name || "?"}`, relationship.id)} data-repair-object={`${fromTable?.name || "?"} → ${toTable?.name || "?"}`} className={cn("rounded-xl border p-4", relationship.active && !relationship.deleted ? "border-emerald-500/25 bg-emerald-500/[0.03]" : "border-border bg-background")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{fromTable?.name || "?"}[{fromColumn?.name || "?"}]</span>
            <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px]">{symbols.from} → {symbols.to}</span>
            <span className="truncate text-sm font-semibold">{toTable?.name || "?"}[{toColumn?.name || "?"}]</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground"><span>{relationship.confidence}% confidence</span><span>•</span><span>{relationship.source.replace(/-/g, " ")}</span><span>•</span><span>{relationship.crossFilterDirection === "single" ? "Single direction" : "Both directions"}</span></div>
          <p className="mt-2 text-xs text-muted-foreground">{recommendation.reason || relationship.evidence.join("; ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {relationship.deleted ? <button onClick={() => onRestore(relationship.id)} className="rounded-lg border border-border px-3 py-2 text-xs"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Restore</button> : relationship.active ? <button onClick={deactivate} className="rounded-lg border border-border px-3 py-2 text-xs">Make inactive</button> : <button onClick={activate} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><Check className="mr-1 inline h-3.5 w-3.5" />Include in Power BI</button>}
          {!relationship.deleted && <button onClick={() => onDelete(relationship.id)} className="rounded-lg border border-red-500/25 p-2 text-red-600" title="Exclude relationship"><Trash2 className="h-3.5 w-3.5" /></button>}
          <button onClick={() => setAdvanced((value) => !value)} className="rounded-lg border border-border p-2" title="Advanced relationship settings"><Settings2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {advanced && !relationship.deleted && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2 lg:grid-cols-4">
          <Select label="From table" value={relationship.fromTableId} options={tables.map((table) => [table.id, table.name])} onChange={(value) => onUpdate(relationship.id, { fromTableId: value, fromColumnId: tables.find((table) => table.id === value)?.columns[0]?.id || "" })} />
          <Select label="From field" value={relationship.fromColumnId} options={(fromTable?.columns ?? []).map((column) => [column.id, column.name])} onChange={(value) => onUpdate(relationship.id, { fromColumnId: value })} />
          <Select label="To table" value={relationship.toTableId} options={tables.map((table) => [table.id, table.name])} onChange={(value) => onUpdate(relationship.id, { toTableId: value, toColumnId: tables.find((table) => table.id === value)?.columns[0]?.id || "" })} />
          <Select label="To field" value={relationship.toColumnId} options={(toTable?.columns ?? []).map((column) => [column.id, column.name])} onChange={(value) => onUpdate(relationship.id, { toColumnId: value })} />
          <Select label="Cardinality" value={relationship.cardinality} options={["one-to-many", "many-to-one", "one-to-one", "many-to-many"].map((value) => [value, value])} onChange={(value) => onUpdate(relationship.id, { cardinality: value as RelationshipCardinality })} />
          <Select label="Filter direction" value={relationship.crossFilterDirection} options={[["single", "Single"], ["both", "Both"]]} onChange={(value) => onUpdate(relationship.id, { crossFilterDirection: value as CrossFilterDirection })} />
        </div>
      )}
    </article>
  );
}

function ManualRelationshipForm({ tables, onAdd }: { tables: PowerBiTable[]; onAdd: (relationship: Omit<PowerBiRelationship, "id" | "validationMessages">) => { ok: boolean; messages: string[] } }) {
  const [open, setOpen] = useState(false);
  const [fromTableId, setFromTableId] = useState(tables[0]?.id || "");
  const [toTableId, setToTableId] = useState(tables[1]?.id || tables[0]?.id || "");
  const fromTable = tables.find((table) => table.id === fromTableId);
  const toTable = tables.find((table) => table.id === toTableId);
  const [fromColumnId, setFromColumnId] = useState(fromTable?.columns[0]?.id || "");
  const [toColumnId, setToColumnId] = useState(toTable?.columns[0]?.id || "");
  return (
    <section className="surface-card overflow-hidden">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 p-5 text-left"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Plus className="h-4 w-4" /></span><div><h3 className="font-semibold">Add a custom relationship</h3><p className="text-xs text-muted-foreground">Use only when the automatic recommendation missed a genuine relationship.</p></div><ChevronDown className={cn("ml-auto h-4 w-4 transition", open && "rotate-180")} /></button>
      {open && <div className="grid gap-3 border-t border-border p-5 md:grid-cols-2 lg:grid-cols-4"><Select label="From table" value={fromTableId} options={tables.map((table) => [table.id, table.name])} onChange={(value) => { setFromTableId(value); setFromColumnId(tables.find((table) => table.id === value)?.columns[0]?.id || ""); }} /><Select label="From field" value={fromColumnId} options={(fromTable?.columns ?? []).map((column) => [column.id, column.name])} onChange={setFromColumnId} /><Select label="To table" value={toTableId} options={tables.map((table) => [table.id, table.name])} onChange={(value) => { setToTableId(value); setToColumnId(tables.find((table) => table.id === value)?.columns[0]?.id || ""); }} /><Select label="To field" value={toColumnId} options={(toTable?.columns ?? []).map((column) => [column.id, column.name])} onChange={setToColumnId} /><button onClick={() => onAdd({ fromTableId, fromColumnId, toTableId, toColumnId, cardinality: "one-to-many", crossFilterDirection: "single", active: true, source: "manual", confidence: 100, evidence: ["Created by user"], riskLevel: "low", userApproved: true })} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground md:col-span-2 lg:col-span-4">Add and validate relationship</button></div>}
    </section>
  );
}

function ValidationPanel({ diagnostics, readiness, visualValid, visualTotal, onValidate, onGoToTables, onGoToRelationships }: { diagnostics: any[]; readiness: string; visualValid: number; visualTotal: number; onValidate: () => void; onGoToTables: () => void; onGoToRelationships: () => void }) {
  const blocking = diagnostics.filter((item) => item.severity === "blocking-error");
  const warnings = diagnostics.filter((item) => item.severity === "warning" || item.severity === "error");
  return (
    <div className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
      <section className="surface-card p-5">
        <div className="flex items-center gap-3"><span className={cn("grid h-12 w-12 place-items-center rounded-2xl", blocking.length ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600")}>{blocking.length ? <ShieldAlert className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}</span><div><h3 className="font-semibold">{blocking.length ? "Model needs attention" : "Model can be exported"}</h3><p className="text-xs text-muted-foreground">Status: {readiness.replace(/-/g, " ")}</p></div></div>
        <div className="mt-5 space-y-3"><Checklist label="Maximum one row identifier per table" ok={!diagnostics.some((item) => item.code === "MULTIPLE_TABLE_KEYS")} /><Checklist label="All active relationships reference valid fields" ok={!diagnostics.some((item) => item.area === "relationship" && item.severity === "blocking-error")} /><Checklist label="Measures and DAX are present" ok={!diagnostics.some((item) => item.code === "EMPTY_DAX")} /><Checklist label={`Visual bindings ${visualValid}/${visualTotal}`} ok={visualValid === visualTotal} optional /></div>
        <button onClick={onValidate} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"><ShieldAlert className="mr-2 inline h-4 w-4" />Run model checks</button>
      </section>
      <section className="surface-card p-5">
        <div className="flex items-center justify-between"><div><h3 className="font-semibold">Items to review</h3><p className="text-xs text-muted-foreground">Blocking issues prevent export; warnings are guidance.</p></div><span className="font-mono text-xs">{blocking.length} blocking · {warnings.length} warnings</span></div>
        <div className="mt-4 max-h-[520px] space-y-3 overflow-auto">
          {diagnostics.length ? diagnostics.map((diagnostic) => <div key={diagnostic.id} id={repairDomId(diagnostic.area === "relationship" ? "relationships" : diagnostic.area === "measure" ? "dax" : "model-tables", diagnostic.objectName, diagnostic.objectId)} data-repair-object={diagnostic.objectName} className={cn("rounded-xl border p-4", diagnostic.severity === "blocking-error" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5")}><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{diagnostic.objectName}</span><span className="rounded-full bg-background px-2 py-1 text-[9px] uppercase">{diagnostic.severity}</span></div><p className="mt-2 text-xs text-muted-foreground">{diagnostic.message}</p><p className="mt-2 text-xs"><strong>Recommended fix:</strong> {diagnostic.recommendation}</p>{diagnostic.code === "MULTIPLE_TABLE_KEYS" && <button onClick={onGoToTables} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">Open Tables & Keys</button>}{diagnostic.area === "relationship" && <button onClick={onGoToRelationships} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">Open Relationships</button>}</div>) : <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><h4 className="mt-3 font-semibold text-emerald-700">No model diagnostics</h4><p className="mt-1 text-xs text-muted-foreground">The approved model is ready for TMDL/PBIP generation.</p></div>}
        </div>
      </section>
    </div>
  );
}

function TableGroup({ title, tables, tone }: { title: string; tables: PowerBiTable[]; tone: "fact" | "dimension" | "support" }) {
  return <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div><div className="grid gap-2">{tables.length ? tables.map((table) => <div key={table.id} className={cn("rounded-xl border p-3", tone === "fact" ? "border-blue-500/25 bg-blue-500/5" : tone === "dimension" ? "border-violet-500/25 bg-violet-500/5" : "border-border")}><div className="flex items-center gap-2"><Database className="h-3.5 w-3.5" /><span className="truncate text-xs font-semibold">{table.name}</span><span className="ml-auto text-[9px] uppercase text-muted-foreground">{table.kind}</span></div><div className="mt-1 text-[9px] text-muted-foreground">{table.columns.length} fields · key: {table.columns.find((column) => column.isKey)?.name || "None"}</div></div>) : <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">None detected</div>}</div></div>;
}

function GuideStep({ number, title, text, active, onClick }: { number: string; title: string; text: string; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={cn("flex items-start gap-3 p-4 text-left transition", active ? "bg-primary/5" : "hover:bg-muted/40")}><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{number}</span><span><span className="block text-xs font-semibold">{title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{text}</span></span></button>; }
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={cn("flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold transition", active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted")}>{icon}{label}</button>; }
function Metric({ label, value, hint, good, warning }: { label: string; value: number; hint: string; good?: boolean; warning?: boolean }) { return <div className="surface-card p-4"><div className={cn("font-display text-2xl font-bold", good && "text-emerald-600", warning && "text-amber-600")}>{value}</div><div className="text-xs font-semibold">{label}</div><div className="mt-1 text-[10px] text-muted-foreground">{hint}</div></div>; }
function Decision({ icon, title, text, tone }: { icon: React.ReactNode; title: string; text: string; tone: "good" | "warning" | "info" }) { return <div className={cn("flex gap-3 rounded-xl border p-3", tone === "good" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700" : tone === "warning" ? "border-amber-500/20 bg-amber-500/5 text-amber-700" : "border-blue-500/20 bg-blue-500/5 text-blue-700")}><span className="mt-0.5">{icon}</span><div><div className="text-xs font-semibold">{title}</div><div className="mt-1 text-[10px] text-muted-foreground">{text}</div></div></div>; }
function Checklist({ label, ok, optional }: { label: string; ok: boolean; optional?: boolean }) { return <div className="flex items-center gap-2 text-xs">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : optional ? <CircleHelp className="h-4 w-4 text-amber-600" /> : <XCircle className="h-4 w-4 text-red-600" />}<span>{label}</span>{optional && <span className="ml-auto text-[9px] text-muted-foreground">non-blocking</span>}</div>; }
function StatusPill({ tone, text }: { tone: "good" | "warning"; text: string }) { return <span className={cn("rounded-full px-2 py-1 text-[9px] font-semibold", tone === "good" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}>{text}</span>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <label><span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs">{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
function tableTone(kind: ModelTableKind) { return kind === "fact" ? "bg-blue-500" : kind === "dimension" ? "bg-violet-500" : kind === "date" ? "bg-emerald-500" : kind === "parameter" ? "bg-amber-500" : "bg-slate-400"; }
function ReadinessBadge({ readiness }: { readiness: string }) { return <span className={cn("rounded-full px-3 py-1 text-[10px] font-semibold uppercase", readiness === "ready" ? "bg-emerald-500/10 text-emerald-600" : readiness === "ready-with-warnings" ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600")}>{readiness.replace(/-/g, " ")}</span>; }
function EmptyModel() { return <div className="surface-card p-10 text-center"><AlertCircle className="mx-auto h-10 w-10 text-amber-500" /><h2 className="mt-4 font-display text-xl font-bold">No Power BI model is available</h2><p className="mt-2 text-sm text-muted-foreground">Run QVS analysis and expression conversion so tables, fields, measures and relationships can be assembled.</p><div className="mt-5 flex justify-center gap-3"><Link to="/app/analysis" className="rounded-xl border border-border px-4 py-2 text-sm">ETL Analysis</Link><Link to="/app/expression-conversion" className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">Expression Conversion</Link></div></div>; }
