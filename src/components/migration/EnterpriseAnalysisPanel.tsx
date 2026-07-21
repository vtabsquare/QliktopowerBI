import { useState, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  runEnterpriseAnalysis,
  applyDataTypeOverrides,
  applyReviewedTypesToMQuery,
  reviewEnterprisePowerQueries,
  deepReviewEnterprisePowerQueries,
  combinedMQueriesText,
  rowsToUpdates,
  TYPE_OPTIONS,
  connector,
  tableRole,
  type EnterpriseAnalysis,
  type ProjectFile,
} from "@/lib/migration/enterprise-parser";
import { cn } from "@/lib/utils";
import {
  Database, FileText, Table2, GitBranch, Layers, BarChart3,
  Network, ShieldCheck, Download, Braces, Loader2, AlertCircle,
  Check, ChevronDown, ChevronRight, RefreshCw, Info, X, Sparkles, Package, Save, Copy
} from "lucide-react";
import type { ExtractedFile } from "./MultiFileDropzone";
import { useMigration } from "@/lib/migration/store";
import { generatePowerQueryViaAi, translateBulkMeasuresViaAi } from "@/lib/migration/gemini";
import { AutoFixCenter } from "./AutoFixCenter";
import { repairDomId } from "@/lib/migration/autofix";
import { DaxCodeEditor } from "./DaxCodeEditor";
import { buildDaxCompletionCatalog } from "@/lib/migration/dax/DaxAutocomplete";

import { generatePbipZip } from "@/lib/migration/pbip-generator";
// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface MappingRow {
  originalRef: string;
  mappedRef: string;
  connectorType: string;
  status: string;
  notes: string;
  table: string;
  sourceRole: string;
  bypassQvd: boolean;
  effectiveRef: string;
  qvdProducerTable: string;
}

const CONNECTOR_OPTIONS = [
  "CSV/Text","Excel","SQL Server","PostgreSQL","MySQL","SharePoint","Parquet","JSON","XML","Web/API","Folder",
  "QVD bypassed via lineage","QVD - map to supported source","Unknown",
];
const STATUS_OPTIONS = ["Mapped","Needs review","Bypassed"];

// ────────────────────────────────────────────────────────────────
// Small Helpers
// ────────────────────────────────────────────────────────────────

function Badge({ label, variant = "default" }: { label: string | number; variant?: "default" | "success" | "error" | "warning" | "info" }) {
  const cls = {
    default: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-400",
    error: "bg-red-500/10 text-red-400",
    warning: "bg-amber-500/10 text-amber-400",
    info: "bg-sky-500/10 text-sky-400",
  }[variant];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="surface-card p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold text-foreground">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h4 className="font-display font-semibold text-base text-foreground">{title}</h4>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function CodeBlock({ code, lang = "powerquery" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl overflow-hidden border border-border bg-surface-elevated">
      <button
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-surface border border-border hover:bg-surface-elevated"
      >
        {copied ? <><Check className="h-3 w-3" /> Copied</> : "Copy"}
      </button>
      <pre className="p-4 text-xs font-mono overflow-auto max-h-72 text-foreground whitespace-pre-wrap">{code}</pre>
    </div>
  );
}

function DataTable({ rows, columns }: { rows: Record<string, unknown>[]; columns?: string[] }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-muted-foreground italic">No data.</p>;
  const cols = columns || Object.keys(rows[0]);
  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-elevated border-b border-border">
          <tr>{cols.map(c => <th key={c} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-surface" : "bg-surface-elevated/40"}>
              {cols.map(c => <td key={c} className="px-3 py-1.5 text-foreground/80 whitespace-nowrap max-w-[300px] truncate">{String(row[c] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// File-to-ProjectFile converter
// ────────────────────────────────────────────────────────────────

function toProjectFiles(files: ExtractedFile[]): ProjectFile[] {
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

// ────────────────────────────────────────────────────────────────
// TAB 1 — Upload & Summary (handled by parent, shown here as results)
// ────────────────────────────────────────────────────────────────

function TabSummary({ analysis }: { analysis: EnterpriseAnalysis }) {
  const inv = analysis.inventory;
  const val = analysis.validation;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Files" value={inv.totalFiles} />
        <MetricCard label="Text Parsed" value={inv.textFiles} />
        <MetricCard label="Operations" value={analysis.operations.length} />
        <MetricCard label="Final Tables" value={analysis.finalTables.length} />
        <MetricCard label="DAX Measures" value={analysis.daxMeasures.length} />
        <MetricCard label="PBIP Ready" value={val.isReadyForPbipExport ? "✓ Ready" : "✗ Blocked"} />
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="Files Inventory" />
        <DataTable rows={inv.files.map(f => ({ Path: f.path, Extension: f.ext, "Size KB": (f.size / 1024).toFixed(2), Parsed: f.isText ? "Yes" : "No", Note: f.note }))} />
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="Pipeline Logs" />
        <div className="space-y-1">
          {analysis.logs.map((l, i) => <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />{l}</div>)}
        </div>
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="Summary" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            ["Final tables", analysis.finalTables.map(p => p.table).join(", ") || "None"],
            ["Excluded tables", analysis.excludedTables.map(p => `${p.table} (${p.classification})`).join(", ") || "None"],
            ["Inline tables", Object.values(analysis.profiles).filter(p => p.classification === "inline/static").map(p => p.table).join(", ") || "None"],
            ["Columns typed", String(Object.values(analysis.columnTypes).reduce((s, v) => s + Object.keys(v).length, 0))],
            ["DAX measures", String(analysis.daxMeasures.length)],
            ["Source mapping needed", String(analysis.sourceMappings.filter(m => m.status !== "Mapped" && !m.bypassQvd).length)],
            ["QVD handoffs bypassed", String(analysis.sourceMappings.filter(m => m.bypassQvd).length)],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="font-semibold text-foreground/70 shrink-0">{k}:</span>
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 2 — Source Mapping Editor
// ────────────────────────────────────────────────────────────────

function parseMappedRef(mappedRef: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const piece of (mappedRef || '').split(/;|\n/)) {
    if (piece.includes('=')) {
      const [k, v] = piece.split('=', 2);
      parts[k.trim()] = v.trim();
    }
  }
  return parts;
}

function buildMappedRef(parts: Record<string, string>): string {
  return Object.entries(parts)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
}

function DynamicMappingInput({ connectorType, value, onChange }: { connectorType: string, value: string, onChange: (val: string) => void }) {
  const parts = parseMappedRef(value);
  
  if (["CSV/Text", "Excel", "Parquet", "JSON", "XML", "Folder"].includes(connectorType)) {
    const path = (!value.includes('=') ? value : parts['FilePath']) || '';
    return (
      <input
        value={path}
        onChange={e => onChange(e.target.value)}
        placeholder="File Path"
        className="w-full min-w-[200px] px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono"
      />
    );
  }

  if (connectorType === 'SharePoint') {
    const url = (!value.includes('=') ? value : parts['SiteURL']) || '';
    return (
      <input
        value={url}
        onChange={e => onChange(e.target.value)}
        placeholder="Site URL"
        className="w-full min-w-[200px] px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono"
      />
    );
  }

  if (["SQL Server", "PostgreSQL", "MySQL", "Database/SQL"].includes(connectorType)) {
    const updatePart = (k: string, v: string) => {
      const newParts = { ...parts, [k]: v };
      onChange(buildMappedRef(newParts));
    };
    
    // When we first switch from CSV to SQL Server, the 'value' is a raw file path, so parts is empty.
    // If parts is empty, we don't want to lose the existing value completely, but here it's fine.
    return (
      <div className="flex gap-2 min-w-[350px]">
        <input value={parts['Server'] || ''} onChange={e => updatePart('Server', e.target.value)} placeholder="Server" className="w-1/4 px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono" />
        <input value={parts['Database'] || ''} onChange={e => updatePart('Database', e.target.value)} placeholder="Database" className="w-1/4 px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono" />
        {connectorType !== "MySQL" && (
          <input value={parts['Schema'] || ''} onChange={e => updatePart('Schema', e.target.value)} placeholder="Schema" className="w-1/4 px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono" />
        )}
        <input value={parts['Table'] || ''} onChange={e => updatePart('Table', e.target.value)} placeholder="Table/View" className="w-1/4 px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono" />
      </div>
    );
  }

  return (
    <input value={value} onChange={e => onChange(e.target.value)}
      className="w-full min-w-[200px] px-2 py-1 rounded border border-border bg-surface text-xs text-foreground font-mono" />
  );
}

export function TabSourceMapping({
  analysis, mappingRows, onMappingChange, onApply, applying
}: {
  analysis: EnterpriseAnalysis;
  mappingRows: MappingRow[];
  onMappingChange: (rows: MappingRow[]) => void;
  onApply: () => void;
  applying: boolean;
}) {
  const [bulkFolder, setBulkFolder] = useState("");
  const [convertQvd, setConvertQvd] = useState(true);
  const editable = mappingRows.filter(m => !m.bypassQvd);
  const bypassed = mappingRows.filter(m => m.bypassQvd);
  const unresolved = editable.filter(m => m.status !== "Mapped").length;

  const handleCellChange = (idx: number, field: keyof MappingRow, value: string) => {
    const updated = mappingRows.map((r, i) => {
      if (i !== idx) return r;
      const newRow = { ...r, [field]: value };
      if (field === "mappedRef") newRow.connectorType = connector(value) || newRow.connectorType;
      return newRow;
    });
    onMappingChange(updated);
  };

  const handleBulkFill = () => {
    if (!bulkFolder.trim()) return;
    const updated = mappingRows.map(r => {
      if (r.bypassQvd || r.status === "Bypassed") return r;
      const rawPath = r.originalRef.replace(/^\$\([^)]+\)/, "");
      let basename = (rawPath.split("/").pop() || rawPath.split("\\").pop() || "").split("?")[0];
      if (!basename) return r;
      if (convertQvd && basename.toLowerCase().endsWith(".qvd")) {
        basename = basename.substring(0, basename.length - 4) + ".csv";
      }
      const sep = bulkFolder.includes("\\") || /^[A-Za-z]:/.test(bulkFolder) ? "\\" : "/";
      const mapped = bulkFolder.replace(/[/\\]+$/, "") + sep + basename;
      const ct = connector(mapped);
      return { ...r, mappedRef: mapped, connectorType: ct, status: ["Unknown","QVD - map to supported source"].includes(ct) ? "Needs review" : "Mapped" };
    });
    onMappingChange(updated);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Editable Physical Sources" value={editable.length} />
        <MetricCard label="QVDs Bypassed" value={bypassed.length} />
        <MetricCard label="Needs Review" value={unresolved} />
      </div>

      {analysis.sourceCatalog.length > 0 && (
        <div className="surface-card p-4">
          <SectionHeader title="Source Catalog" sub="Connector planning from Qlik script metadata" />
          <DataTable rows={analysis.sourceCatalog as Record<string, unknown>[]} />
        </div>
      )}

      <div className="surface-card p-4">
        <SectionHeader title="Bulk Alternate Folder" sub="Auto-fill all unresolved file sources by replacing path prefix" />
        <div className="flex gap-2">
          <input
            type="text"
            value={bulkFolder}
            onChange={e => setBulkFolder(e.target.value)}
            placeholder="C:\MigrationSources\Data"
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-foreground"
          />
          <button onClick={handleBulkFill} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Auto-fill</button>
        </div>
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="Source Mapping Editor" sub="Set mapped paths and connector types. Leave bypassed QVDs as-is." />
        <div className="overflow-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-elevated border-b border-border">
              <tr>
                {["Table","Source Role","Original Qlik Ref","Connector Type","Mapped Power BI Path","Status","Bypass","Notes"].map(h =>
                  <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {mappingRows.map((row, i) => (
                <tr key={i} id={repairDomId("source-mapping", row.originalRef)} data-repair-object={row.originalRef} className={cn("border-b border-border/30", row.bypassQvd && "opacity-60")}>
                  <td className="px-3 py-1.5 text-foreground/70 max-w-[120px] truncate">{row.table}</td>
                  <td className="px-3 py-1.5 text-muted-foreground max-w-[100px] truncate">{row.sourceRole}</td>
                  <td className="px-3 py-1.5 font-mono text-foreground/80 max-w-[180px] truncate" title={row.originalRef}>{row.originalRef}</td>
                  <td className="px-3 py-1.5">
                    {row.bypassQvd ? <Badge label={row.connectorType} variant="info" /> : (
                      <select value={row.connectorType} onChange={e => handleCellChange(i, "connectorType", e.target.value)}
                        className="px-2 py-1 rounded border border-border bg-surface text-xs text-foreground">
                        {CONNECTOR_OPTIONS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.bypassQvd ? <span className="text-muted-foreground text-[10px]">{row.effectiveRef}</span> : (
                      <DynamicMappingInput connectorType={row.connectorType} value={row.mappedRef} onChange={val => handleCellChange(i, "mappedRef", val)} />
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.bypassQvd ? <Badge label="Bypassed" variant="info" /> : (
                      <select value={row.status} onChange={e => handleCellChange(i, "status", e.target.value)}
                        className="px-2 py-1 rounded border border-border bg-surface text-xs text-foreground">
                        {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{row.bypassQvd ? <Check className="h-3.5 w-3.5 text-sky-400" /> : null}</td>
                  <td className="px-3 py-1.5">
                    <input value={row.notes} onChange={e => handleCellChange(i, "notes", e.target.value)}
                      className="w-full min-w-[120px] px-2 py-1 rounded border border-border bg-surface text-xs text-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={onApply}
            disabled={applying}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Apply Mapping & Re-run Conversion
          </button>
          <span className="text-xs text-muted-foreground">Applying will re-run the full enterprise pipeline with updated source paths.</span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 3 — All Tables / Inventory
// ────────────────────────────────────────────────────────────────

function TabAllTables({ analysis }: { analysis: EnterpriseAnalysis }) {
  const getMapped = (src: string) => {
    const map = analysis.sourceMappings.find(m => m.originalRef === src);
    return map ? map.mappedRef : src;
  };

  return (
    <div className="space-y-5">
      <div className="surface-card p-4">
        <SectionHeader title="Table Classification" />
        <DataTable rows={Object.values(analysis.profiles).map(p => ({
          Table: p.table, Classification: p.classification, Status: p.status,
          Confidence: p.confidence, Reason: p.reason,
          Fields: p.fields.length, Sources: p.sourceRefs.map(getMapped).join(", "), Dependencies: p.dependencies.join(", "),
        }))} />
      </div>
      <div className="surface-card p-4">
        <SectionHeader title="Parsed Operations" />
        <DataTable rows={analysis.operations.map(o => ({
          Operation: o.id, Table: o.table, Type: o.opType, Role: o.role,
          File: o.file, Lines: `${o.startLine}-${o.endLine}`,
          Sources: o.sourceRefs.map(getMapped).join(", "), Resident: o.resident.join(", "),
          "Join Target": o.joinTarget, "Concat Target": o.concatTarget,
        }))} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 4 — Final Table Review (per-table subtabs)
// ────────────────────────────────────────────────────────────────

export function TabFinalTables({ analysis }: { analysis: EnterpriseAnalysis }) {
  const [activeTable, setActiveTable] = useState(0);
  const finals = analysis.finalTables;
  if (!finals.length) return <div className="surface-card p-8 text-center text-muted-foreground">No final tables detected.</div>;
  const p = finals[activeTable];
  const mQuery = analysis.mQueries[p.table] || "";
  const typeCols = analysis.columnTypes[p.table] || {};
  const measures = analysis.daxMeasures.filter(m => m.table === p.table);
  const valIssues = analysis.validation.issues.filter(i => i.objectName === p.table);

  return (
    <div className="space-y-4">
      {/* Table selector */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {finals.map((t, i) => (
          <button key={t.table} onClick={() => setActiveTable(i)}
            className={cn("px-4 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-all",
              activeTable === i ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground hover:border-primary/50")}>
            {t.table}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left panel — details */}
        <div className="space-y-4 lg:col-span-1">
          <div className="surface-card p-4">
            <h4 className="font-display font-semibold text-base">{p.table}</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge label={p.status} variant={p.status === "generated" ? "success" : "warning"} />
              <Badge label={p.classification} variant="default" />
              <Badge label={`Confidence: ${p.confidence}`} variant="info" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{p.reason}</p>
          </div>

          <div className="surface-card p-4">
            <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">ETL Story</h5>
            <p className="text-xs text-muted-foreground leading-relaxed">{p.etlStory || "No ETL story generated."}</p>
          </div>

          {p.sourceRefs.length > 0 && (
            <div className="surface-card p-4">
              <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Sources</h5>
              {p.sourceRefs.map((s, i) => {
                const mapped = analysis.sourceMappings.find(m => m.originalRef === s)?.mappedRef || s;
                return <div key={`${i}-${s}`} className="text-xs font-mono text-muted-foreground">{mapped}</div>;
              })}
            </div>
          )}

          {p.flowSteps.length > 0 && (
            <div className="surface-card p-4">
              <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Transformation Flow</h5>
              <DataTable rows={p.flowSteps as Record<string, unknown>[]} />
            </div>
          )}

          {p.lineageScript && (
            <div className="surface-card p-4">
              <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Original Qlik Lineage</h5>
              <CodeBlock code={p.lineageScript} lang="sql" />
            </div>
          )}
        </div>

        {/* Right panel — types + DAX + validation */}
        <div className="space-y-4 lg:col-span-1">
          <div className="surface-card p-4">
            <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Column Types</h5>
            <DataTable rows={p.fields.map(f => ({ Column: f, "Power BI Type": typeCols[f] || "Text" }))} />
          </div>


          <div className="surface-card p-4">
            <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">DAX Measures</h5>
            {measures.length ? measures.map(m => (
              <div key={m.measureName} className="mb-2">
                <CodeBlock code={`${m.measureName} = ${m.dax}`} lang="dax" />
                <p className="text-[10px] text-muted-foreground mt-1">Confidence: {m.confidence} | Source: {m.qlikExpression}</p>
              </div>
            )) : <p className="text-xs text-muted-foreground">No DAX measures for this table.</p>}
          </div>
          <div className="surface-card p-4">
            <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Calculated Columns</h5>
            <p className="text-xs text-muted-foreground">{p.calculatedColumns.join(", ") || "None"}</p>
          </div>
          <div className="surface-card p-4">
            <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Filters</h5>
            <p className="text-xs text-muted-foreground">{p.filters.join(", ") || "None"}</p>
          </div>
          {valIssues.length > 0 && (
            <div className="surface-card p-4">
              <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Validation Issues</h5>
              {valIssues.map((iss, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-400 mb-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{iss.severity} | {iss.area}: {iss.message}
                </div>
              ))}
            </div>
          )}
          {p.reviewNotes.length > 0 && (
            <div className="surface-card p-4">
              <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Manual Review Notes</h5>
              {p.reviewNotes.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// M QUERY STEP EXPLANATION — deterministic parser
// ────────────────────────────────────────────────────────────────

interface MQueryStep {
  seq: number;
  stepName: string;
  stepType: string;
  isFinalOutputStep: boolean;
  explanation: string;
  columns: string[];
}

function inferStepType(name: string, body: string): string {
  const n = name.toLowerCase();
  const b = body.toLowerCase();
  if (n === 'typed_final' || b.includes('table.transformcolumntypes')) return 'Data type enforcement';
  if (b.includes('_alldefs') || b.includes('_existingcols') || b.includes('_safetypedefs')) return 'Safe type filter';
  if (b.includes('table.addcolumn')) return 'Calculated column';
  if (b.includes('csv.document') || b.includes('excel.workbook') || b.includes('file.contents') || b.includes('sql.database')) return 'Source connector';
  if (b.includes('table.promoteheaders')) return 'Header promotion';
  if (b.includes('table.combine') || b.includes('table.concatenate')) return 'Table combine / union';
  if (b.includes('table.nestedjoin') || b.includes('table.join')) return 'Table join';
  if (b.includes('table.expandtablecolumn') || b.includes('table.expandrecordcolumn')) return 'Column expansion';
  if (b.includes('table.replacevalue') || b.includes('table.filldown') || b.includes('replacer.')) return 'Null / value replacement';
  if (b.includes('table.selectrows') || b.includes('table.removerows')) return 'Row filter';
  if (b.includes('table.selectcolumns') || b.includes('table.removecolumns') || b.includes('table.renamecolumns')) return 'Column reshape';
  if (b.includes('table.fromrecords') || b.includes('#table') || b.includes('inline')) return 'Inline / static table';
  if (b.includes('list.select') || b.includes('list.contains')) return 'Defensive column preparation';
  if (b.includes('number.from') || b.includes('text.from') || b.includes('date.from')) return 'Safe value conversion';
  if (b.startsWith('{') || b.startsWith('[')) return 'Configuration list';
  return 'Transformation';
}

function inferExplanation(name: string, body: string, stepType: string): string {
  const b = body.toLowerCase();
  const n = name;
  if (stepType === 'Source connector') {
    if (b.includes('.csv') || b.includes('csv.document')) return `Loads a CSV file from disk into Power Query as a raw binary table.`;
    if (b.includes('.xlsx') || b.includes('excel.workbook')) return `Loads an Excel file from disk. Columns are available after header promotion.`;
    if (b.includes('sql.database')) return `Connects to a SQL Server database and retrieves a table or query result.`;
    return `Connects to an external data source and loads the raw data.`;
  }
  if (stepType === 'Header promotion') return `Promotes the first row of the table to column headers so the data is properly named.`;
  if (stepType === 'Table combine / union') return `Vertically combines multiple tables (UNION ALL equivalent). All rows from each source are stacked into one table.`;
  if (stepType === 'Table join') return `Performs a Left Outer Join to enrich the main table with matching rows from a lookup table.`;
  if (stepType === 'Column expansion') return `Expands nested table columns from the join result so the lookup fields become flat columns.`;
  if (stepType === 'Null / value replacement') return `Replaces null or missing values with a default fallback (e.g. "Unknown") to prevent blank handling issues downstream.`;
  if (stepType === 'Calculated column') return `Creates a calculated field translated from a Qlik expression where safe. Unsupported Qlik functions are approximated.`;
  if (stepType === 'Inline / static table') return `Creates a static table from Qlik INLINE rows using a safe #table expression. Columns in brackets below.`;
  if (stepType === 'Defensive column preparation') return `Ensures expected columns exist before joins or type conversion, preventing refresh failures on missing fields.`;
  if (stepType === 'Safe value conversion') return `Converts values using try/otherwise null so bad source values do not break refresh. Column list below.`;
  if (stepType === 'Data type enforcement') return `Applies the user-reviewed Power BI data types using Table.TransformColumnTypes. This is the authoritative typed output step.`;
  if (stepType === 'Safe type filter') return `Dynamically filters the type-cast list to only columns that actually exist in the table, preventing "column not found" errors.`;
  if (stepType === 'Configuration list') return `Defines a configuration list (type definitions or column metadata) used by a subsequent step.`;
  return `Applies a "${n}" transformation step to the data pipeline.`;
}

function extractColumnsFromBody(body: string): string[] {
  const cols: string[] = [];
  // Match {"ColName", ...} pattern used in TransformColumnTypes, ExpandTableColumn etc.
  const bracePattern = /\{\s*"([^"]+)"\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = bracePattern.exec(body)) !== null) cols.push(m[1]);
  // Match "ColName" used in NestedJoin key lists
  if (cols.length === 0) {
    const quotedPattern = /"([A-Za-z_][A-Za-z0-9_]*)"/g;
    while ((m = quotedPattern.exec(body)) !== null) cols.push(m[1]);
  }
  return [...new Set(cols)].slice(0, 10); // cap at 10
}

function parseMQuerySteps(mCode: string): MQueryStep[] {
  if (!mCode) return [];
  // Strip the outer let...in wrapper
  const letMatch = mCode.match(/^\s*let\s+([\s\S]+?)\s+in\s+(\w+)\s*$/i);
  if (!letMatch) return [];
  const body = letMatch[1];
  const finalStep = letMatch[2].trim();

  // Split on step boundaries: newline + identifier + " ="
  // We split cautiously to handle multi-line step bodies
  const stepBlocks: { name: string; body: string }[] = [];
  const stepSplitter = /\n\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
  const matches: { index: number; name: string }[] = [];

  // Find all step start positions
  let sm: RegExpExecArray | null;
  while ((sm = stepSplitter.exec('\n' + body)) !== null) {
    matches.push({ index: sm.index, name: sm[1] });
  }

  // Also handle the very first step (starts at pos 0)
  const firstStepMatch = body.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (firstStepMatch) {
    matches.unshift({ index: -1, name: firstStepMatch[1] });
  }

  // Extract body slices between step starts
  const fullText = '\n' + body;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + 1; // +1 skips the \n we prepended
    const end = i + 1 < matches.length ? matches[i + 1].index + 1 : fullText.length;
    const rawSlice = fullText.slice(start, end).trim();
    // Strip step name and leading "=" from rawSlice
    const eqIdx = rawSlice.indexOf('=');
    const stepBody = eqIdx !== -1 ? rawSlice.slice(eqIdx + 1).trim().replace(/,\s*$/, '') : rawSlice;
    stepBlocks.push({ name: matches[i].name, body: stepBody });
  }

  // Filter out internal helper steps starting with underscore (_AllTypeDefs etc.) — merge their column info into parent
  const steps: MQueryStep[] = [];
  let pendingCols: string[] = [];

  for (const { name, body: sb } of stepBlocks) {
    if (name.startsWith('_')) {
      pendingCols = [...pendingCols, ...extractColumnsFromBody(sb)];
      continue;
    }
    const isComment = sb.startsWith('//');
    if (isComment) continue;

    const stepType = inferStepType(name, sb);
    const cols = [...new Set([...extractColumnsFromBody(sb), ...pendingCols])].slice(0, 12);
    pendingCols = [];

    steps.push({
      seq: steps.length + 1,
      stepName: name,
      stepType,
      isFinalOutputStep: name === finalStep,
      explanation: inferExplanation(name, sb, stepType),
      columns: cols,
    });
  }

  return steps;
}

const STEP_TYPE_COLORS: Record<string, string> = {
  'Source connector': 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  'Header promotion': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  'Table combine / union': 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  'Table join': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Column expansion': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  'Calculated column': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Data type enforcement': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  'Safe type filter': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Defensive column preparation': 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  'Safe value conversion': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  'Null / value replacement': 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  'Configuration list': 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  'Inline / static table': 'bg-lime-500/10 text-lime-400 border-lime-500/20',
};

function StepTypeBadge({ type }: { type: string }) {
  const cls = STEP_TYPE_COLORS[type] || 'bg-primary/10 text-primary border-primary/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold tracking-wide whitespace-nowrap ${cls}`}>
      {type}
    </span>
  );
}

function MQueryStepTable({ mCode }: { mCode: string }) {
  const steps = parseMQuerySteps(mCode);
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState('');

  const [exportHover, setExportHover] = useState(false);

  const filtered = search
    ? steps.filter(s =>
        s.stepName.toLowerCase().includes(search.toLowerCase()) ||
        s.stepType.toLowerCase().includes(search.toLowerCase()) ||
        s.explanation.toLowerCase().includes(search.toLowerCase())
      )
    : steps;

  const handleExportCsv = () => {
    const header = 'Seq,Step Name,Step Type,Final Output Step,Explanation,Columns';
    const rows = steps.map(s =>
      [
        s.seq,
        `"${s.stepName}"`,
        `"${s.stepType}"`,
        s.isFinalOutputStep ? 'Yes' : 'No',
        `"${s.explanation.replace(/"/g, '""')}"`,
        `"${s.columns.join(', ')}"`,
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'mquery-step-explanation.csv';
    a.click();
  };

  if (steps.length === 0) return null;

  return (
    <div className="mt-4 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-elevated border-b border-border">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          M Query Step Explanation
          <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold">{steps.length} steps</span>
        </button>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search steps..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-border bg-surface focus:border-primary outline-none w-36"
          />
          <button
            onClick={handleExportCsv}
            onMouseEnter={() => setExportHover(true)}
            onMouseLeave={() => setExportHover(false)}
            title="Export as CSV"
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-elevated transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            {exportHover && <span>CSV</span>}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-surface-elevated sticky top-0 z-10">
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2.5 px-3 font-semibold text-left w-10">Seq</th>
                <th className="py-2.5 px-3 font-semibold text-left w-44">Step Name</th>
                <th className="py-2.5 px-3 font-semibold text-left w-44">Step Type</th>
                <th className="py-2.5 px-3 font-semibold text-center w-32">Final Output Step</th>
                <th className="py-2.5 px-3 font-semibold text-left">Explanation</th>
                <th className="py-2.5 px-3 font-semibold text-left w-52">Columns</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr
                  key={`${i}-${s.stepName}`}
                  className={cn(
                    'border-b border-border/50 transition-colors',
                    s.isFinalOutputStep
                      ? 'bg-amber-500/5 hover:bg-amber-500/10'
                      : i % 2 === 0 ? 'bg-surface hover:bg-surface-elevated/40' : 'bg-surface-elevated/20 hover:bg-surface-elevated/50'
                  )}
                >
                  <td className="py-2 px-3 text-muted-foreground font-mono">{s.seq}</td>
                  <td className="py-2 px-3">
                    <code className="font-mono text-[11px] text-foreground/90 bg-surface-elevated px-1.5 py-0.5 rounded">{s.stepName}</code>
                  </td>
                  <td className="py-2 px-3"><StepTypeBadge type={s.stepType} /></td>
                  <td className="py-2 px-3 text-center">
                    {s.isFinalOutputStep ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500/20 border border-amber-500/40">
                        <Check className="h-3 w-3 text-amber-500" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-border bg-surface" />
                    )}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground leading-relaxed max-w-xs">{s.explanation}</td>
                  <td className="py-2 px-3">
                    {s.columns.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.columns.map((c, ci) => (
                          <span key={`${ci}-${c}`} className="px-1.5 py-0.5 rounded bg-primary/8 border border-primary/15 text-primary/80 text-[10px] font-mono whitespace-nowrap">{c}</span>
                        ))}
                      </div>
                    ) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground italic px-4 py-3">No steps match your search.</p>
          )}
        </div>
      )}
    </div>
  );
}

function TablePreviewPanel({ preview }: { preview: EnterpriseAnalysis["tablePreviews"][string] | undefined }) {
  if (!preview) {
    return <div className="mt-4 rounded-xl border border-border p-4 text-xs text-muted-foreground">No preview metadata is available for this table.</div>;
  }
  const [view, setView] = useState<"source" | "output">("output");
  const rows = view === "source" ? preview.sourceRows : preview.outputRows;
  return (
    <div className="mt-4 rounded-xl border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-elevated border-b border-border">
        <div>
          <div className="text-sm font-semibold text-foreground">Uploaded source and locally reconstructed 10-row validation preview</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{preview.sourceName} · {preview.status}</div>
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1 bg-surface">
          <button onClick={() => setView("source")} className={cn("px-3 py-1.5 rounded-md text-xs", view === "source" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Source sample</button>
          <button onClick={() => setView("output")} className={cn("px-3 py-1.5 rounded-md text-xs", view === "output" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Validated output sample (up to 10 rows)</button>
        </div>
      </div>
      <div className="p-3">
        <DataTable rows={rows} columns={view === "output" && preview.outputColumns.length ? preview.outputColumns : undefined} />
        <div className="mt-3 space-y-1">
          {preview.notes.map((note, ni) => <p key={`${ni}-${note}`} className="text-[10px] text-muted-foreground">{note}</p>)}
        </div>
      </div>
    </div>
  );
}

function PowerQueryAiReviewCard({
  review,
  deepResult,
  onReview,
}: {
  review: EnterpriseAnalysis["powerQueryReviews"][string] | undefined;
  deepResult: EnterpriseAnalysis["deepPowerQueryValidation"] extends infer T ? T extends { queries: Record<string, infer R> } ? R | undefined : undefined : undefined;
  onReview: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">AI Power Query review</span>
            {review && <Badge label={`${review.score}%`} variant={review.status === "passed" ? "success" : review.status === "warning" ? "warning" : "error"} />}
            {deepResult && <Badge label={`M parser: ${deepResult.parserPassed ? "passed" : "failed"}`} variant={deepResult.parserPassed ? "success" : "error"} />}
            {deepResult && <Badge label={`Semantic: ${deepResult.semanticPassed ? "passed" : "failed"}`} variant={deepResult.semanticPassed ? "success" : "error"} />}
            {deepResult && <Badge label={`Preview: ${deepResult.previewRowCount}/10`} variant={deepResult.previewRowCount > 0 ? "success" : "warning"} />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Checks M syntax, Formula.Firewall risk, named-query dependencies, collision-safe expansions, Qlik-only syntax and authoritative data types.</p>
        </div>
        <button onClick={onReview} className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20">
          <Sparkles className="h-3.5 w-3.5" /> Review current scripts
        </button>
      </div>
      {review && (
        <div className="mt-3">
          {review.issues.length === 0 ? (
            <div className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-600">No blocking static Power Query issue was detected.</div>
          ) : (
            <div className="space-y-2">
              {review.issues.map((issue) => (
                <div key={issue.id} className={cn("rounded-lg border p-3 text-xs", issue.severity === "blocking-error" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5")}>
                  <div className="font-semibold">{issue.category.replace("-", " ")} · {issue.severity}</div>
                  <div className="mt-1">{issue.message}</div>
                  <div className="mt-1 text-muted-foreground">{issue.recommendation}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function aiQueryPreservesJoinPlan(query: string, plan: NonNullable<EnterpriseAnalysis["executionPlans"]>[string] | undefined): boolean {
  if (!plan?.joins?.length) return true;
  const normalized = query.toLowerCase();
  if (!normalized.includes("table.nestedjoin") || !normalized.includes("table.expandtablecolumn")) return false;
  if (!normalized.includes("table.transformcolumns") || !normalized.includes("text.from") || !normalized.includes("text.trim")) return false;
  return plan.joins.every((join) => {
    const sourceToken = join.sourceTable.toLowerCase();
    const expanded = join.outputColumns.length
      ? join.outputColumns.some((column) => normalized.includes(column.toLowerCase()))
      : true;
    return normalized.includes(sourceToken) && expanded;
  });
}

// ────────────────────────────────────────────────────────────────
// TAB 5 — M Query & Data Types
// ────────────────────────────────────────────────────────────────

export function TabMQueryDataTypes({
  analysis, columnTypeEdits, onTypeChange, onAnalysisUpdate
}: {
  analysis: EnterpriseAnalysis;
  columnTypeEdits: Record<string, string>;
  onTypeChange: (key: string, val: string) => void;
  onAnalysisUpdate: (newAnalysis: EnterpriseAnalysis) => void;
}) {
  const { businessMetadata, technicalMetadata, ruleBookMd, sourceQvsText, etlQvsText, repairFocus } = useMigration();
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiQueries, setAiQueries] = useState<Record<string, string> | null>(null);
  const [savedTypeEdits, setSavedTypeEdits] = useState<Record<string, string>>({ ...columnTypeEdits });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const handleTypeChange = (key: string, val: string) => {
    onTypeChange(key, val);
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  const handleSave = () => {
    const saved = { ...savedTypeEdits, ...columnTypeEdits };
    setSavedTypeEdits(saved);
    const updatedAnalysis = applyDataTypeOverrides(analysis, saved);

    // An earlier AI-generated query set is a snapshot and can otherwise mask
    // the newly regenerated, UI-typed M queries through `aiQueries ||
    // analysis.mQueries`. Clear it after a datatype save so the displayed and
    // exported query immediately reflects the authoritative reviewed types.
    setAiQueries(null);
    onAnalysisUpdate(updatedAnalysis);
    setHasUnsavedChanges(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const buildEffectiveColumnTypes = (edits: Record<string, string>) => {
    const effective: Record<string, Record<string, string>> = {};
    for (const t of analysis.finalTables) {
      effective[t.table] = {};
      // Start from inferred defaults for every field in the table
      for (const field of t.fields) {
        const key = `${t.table}.${field}`;
        // User saved override takes priority, then inferred analysis type, then default Text
        effective[t.table][field] =
          edits[key] ||
          analysis.columnTypes?.[t.table]?.[field] ||
          "Text";
      }
    }
    return effective;
  };

  const handleAiGenerate = async () => {
    if (!businessMetadata || !technicalMetadata) {
      setAiError("AI Lineage Analysis (Step 5 below) must be completed first to use the AI Query Engine.");
      return;
    }
    const safeRb = ruleBookMd || "# Rule Book\n- Extract metadata\n- Convert scripts\n";
    const effectiveTypes = buildEffectiveColumnTypes({ ...columnTypeEdits, ...savedTypeEdits });
    setGeneratingAi(true);
    setAiError(null);
    try {
      const aiOutput = await generatePowerQueryViaAi(
        businessMetadata,
        technicalMetadata,
        safeRb,
        sourceQvsText,
        etlQvsText,
        analysis.sourceMappings,
        analysis.finalTables.map(t => ({
          table: t.table,
          lineageScript: t.lineageScript,
          columnTypes: effectiveTypes[t.table]
        }))
      );
      const reviewedAnalysis = applyDataTypeOverrides(analysis, {
        ...savedTypeEdits,
        ...columnTypeEdits,
      });
      const newMQueries: Record<string, string> = {};
      let skippedJoinUnsafe = 0;
      aiOutput.forEach(q => {
        if (q.table && q.code) {
          if (!aiQueryPreservesJoinPlan(q.code, reviewedAnalysis.executionPlans?.[q.table])) {
            skippedJoinUnsafe += 1;
            return;
          }
          newMQueries[q.table] = applyReviewedTypesToMQuery(
            q.code,
            reviewedAnalysis.columnTypes[q.table] || {},
          );
        }
      });
      if (skippedJoinUnsafe > 0) {
        toast.success("Regenerated with merge-safe fallback", {
          description: `Used the fixed deterministic M for ${skippedJoinUnsafe} table(s) where AI output did not include safe source-table merge normalization.`,
        });
      }
      const mergedMQueries = { ...reviewedAnalysis.mQueries, ...newMQueries };
      const reviewedResult = reviewEnterprisePowerQueries({ ...reviewedAnalysis, mQueries: mergedMQueries });
      setAiQueries(reviewedResult.mQueries);
      onAnalysisUpdate(reviewedResult);
    } catch (e) {
      setAiError("Failed to generate M Query: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGeneratingAi(false);
    }
  };

  const mq = aiQueries || analysis.mQueries || {};
  const [activeTable, setActiveTable] = useState(0);
  const tables = Object.keys(mq).sort();
  const [tableFilter, setTableFilter] = useState("All");
  const diag = analysis.mQueryDiagnostics || [];
  const typeEditorTables = useMemo(() => {
    const names = [...new Set([
      ...analysis.finalTables.map((table) => table.table),
      ...Object.keys(analysis.columnTypes || {}),
    ])].sort();
    return names.map((tableName) => {
      const profile = analysis.finalTables.find((table) => table.table === tableName);
      const fields = [...new Set([
        ...(profile?.fields || []),
        ...Object.keys(analysis.columnTypes?.[tableName] || {}),
      ])];
      return {
        tableName,
        fields,
        role: profile ? tableRole(profile) : tableName === "Qlik Variables" ? "disconnected" : "support",
      };
    });
  }, [analysis.finalTables, analysis.columnTypes]);

  useEffect(() => {
    if (!repairFocus || !["power-query", "data-types"].includes(repairFocus.area)) return;
    const requestedObject = repairFocus.objectName || "";
    const requestedTable = repairFocus.tableName || requestedObject.split(".")[0] || requestedObject;
    const requestedField = repairFocus.fieldName || (requestedObject.includes(".") ? requestedObject.slice(requestedObject.indexOf(".") + 1) : "");
    const tableIndex = tables.findIndex((table) => table.toLowerCase() === requestedTable.toLowerCase());
    if (tableIndex >= 0) setActiveTable(tableIndex);
    const matchingEditorTable = typeEditorTables.find((table) => table.tableName.toLowerCase() === requestedTable.toLowerCase());
    if (matchingEditorTable) setTableFilter(matchingEditorTable.tableName);
    if (repairFocus.area === "data-types" && requestedTable && requestedField) {
      const timer = window.setTimeout(() => {
        const row = document.getElementById(repairDomId("data-types", `${requestedTable}.${requestedField}`));
        row?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        row?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
      }, 250);
      return () => window.clearTimeout(timer);
    }
  }, [repairFocus, tables.join("|"), typeEditorTables.map((table) => table.tableName).join("|")]);

  const downloadAll = () => {
    const txt = combinedMQueriesText(mq);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = "power-query.m";
    a.click();
  };

  const handleReviewCurrentQueries = async () => {
    const preliminary = reviewEnterprisePowerQueries({ ...analysis, mQueries: mq });
    onAnalysisUpdate(preliminary);
    toast.info("Running Microsoft M parser and semantic validation…");
    try {
      const reviewed = await deepReviewEnterprisePowerQueries(preliminary);
      onAnalysisUpdate(reviewed);
      const blocked = Object.values(reviewed.powerQueryReviews).filter((item) => item.status === "blocked").length;
      if (blocked) {
        toast.warning(`Deep Power Query validation found ${blocked} blocked query/queries.`, {
          description: "Each card now includes parser, semantic, dependency and preview diagnostics for the exact query.",
        });
      } else {
        toast.success("Deep Power Query validation completed", {
          description: "Generated M passed the Microsoft parser and QLIK2PBI semantic validation checks.",
        });
      }
    } catch (error) {
      toast.error("Deep Power Query validation could not complete", { description: (error as Error).message });
    }
  };


  const handleDownloadPbipZip = async () => {
    try {
      const blob = await generatePbipZip(analysis, "QLIK2PBI_M_Queries");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "QLIK2PBI_M_Queries_Workspace.zip";
      a.click();
    } catch (e) {
      alert("Failed to generate PBIP zip: " + (e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="surface-card p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div>
            <h3 className="font-display text-xl font-semibold">Generated Power Query M</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Unroll mapped lineage structures into production-ready Power Query scripts. No templates are utilized.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">

            {Object.keys(mq).length > 0 && (
              <>
                <button onClick={() => handleAiGenerate()} disabled={generatingAi} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 disabled:opacity-50">
                  {generatingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate
                </button>
                <button onClick={downloadAll} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-surface-elevated">
                  <Download className="h-3.5 w-3.5" /> Download (.txt)
                </button>

                <button onClick={handleDownloadPbipZip} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors">
                  <Package className="h-3.5 w-3.5" /> Download PBIP (.zip)
                </button>
              </>
            )}
          </div>
        </div>
        
        {aiError && (
          <div className="mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <div className="text-destructive/90">{aiError}</div>
          </div>
        )}

        {Object.keys(mq).length > 0 && (
          <>
            <div className="flex gap-1 overflow-x-auto pb-3 border-b border-border mb-3">
              {tables.map((t, i) => (
                <button key={t} onClick={() => setActiveTable(i)}
                  className={cn("px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all",
                    activeTable === i ? "bg-primary text-primary-foreground shadow-sm" : "border border-border text-muted-foreground hover:text-foreground hover:bg-surface-elevated")}>
                  {t}
                </button>
              ))}
            </div>
            {tables[activeTable] && (() => {
              const tableName = tables[activeTable];
              const tableDef = analysis.finalTables.find(t => t.table === tableName);
              const effectiveTypes = buildEffectiveColumnTypes(savedTypeEdits)[tableName] || {};
              return (
                <div id={repairDomId("power-query", tableName)} data-repair-object={tableName} className="space-y-3">
                  <PowerQueryAiReviewCard
                    review={analysis.powerQueryReviews?.[tableName]}
                    deepResult={analysis.deepPowerQueryValidation?.queries?.[tableName]}
                    onReview={handleReviewCurrentQueries}
                  />
                  <CodeBlock code={mq[tableName] || ""} />
                  <MQueryStepTable mCode={mq[tableName] || ""} />
                  {tableDef && <TablePreviewPanel preview={analysis.tablePreviews?.[tableName]} />}
                </div>
              );
            })()}
          </>
        )}
      </div>

      <div className="surface-card p-6 border border-border">
        <SectionHeader title="Filter data type editor" />
        <div className="mb-4">
          <select 
            className="w-full min-w-[320px] max-w-xl px-4 py-2.5 bg-surface border border-border rounded-lg text-sm"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          >
            <option value="All">All final tables</option>
            {typeEditorTables.map((table) => <option key={table.tableName} value={table.tableName}>{table.tableName}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto max-h-[400px] border border-border rounded-lg">
          <table className="w-full min-w-[1380px] text-left text-sm border-collapse">
            <thead className="sticky top-0 bg-surface-elevated z-10">
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-3 px-4 font-medium">Table</th>
                <th className="py-3 px-4 font-medium">Column</th>
                <th className="min-w-[280px] py-3 px-4 font-medium">Power BI Data Type</th>
                <th className="py-3 px-4 font-medium">Detected Role</th>
                <th className="py-3 px-4 font-medium">Sample Values</th>
                <th className="py-3 px-4 font-medium">Inference Source</th>
                <th className="py-3 px-4 font-medium">Confidence</th>
                <th className="py-3 px-4 font-medium">Inference Reason</th>
              </tr>
            </thead>
            <tbody>
              {typeEditorTables
                .filter((table) => tableFilter === "All" || table.tableName === tableFilter)
                .flatMap((table) => table.fields.map((field) => {
                  const key = `${table.tableName}.${field}`;
                  const currentType = columnTypeEdits[key] || analysis.columnTypes?.[table.tableName]?.[field] || "Text";
                  const meta = analysis.columnTypeMeta?.[table.tableName]?.[field] || { source: "Unknown", confidence: 0, reason: "Unknown" };
                  const role = table.role;
                  return (
                    <tr key={key} id={repairDomId("data-types", key)} data-repair-object={key} data-repair-table={table.tableName} data-repair-field={field} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                      <td className="py-2 px-4 whitespace-nowrap">{table.tableName}</td>
                      <td className="py-2 px-4 whitespace-nowrap font-medium">{field}</td>
                      <td className="py-2 px-4">
                        <select
                          data-repair-editor="data-type"
                          className="w-[260px] min-w-[260px] px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary/30"
                          value={currentType}
                          onChange={(e) => handleTypeChange(key, e.target.value)}
                        >
                          {TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-4 whitespace-nowrap text-muted-foreground">{role}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground max-w-[260px] truncate" title={(meta.sampleValues || []).join(", ")}>{(meta.sampleValues || []).slice(0, 4).join(", ") || "—"}</td>
                      <td className="py-2 px-4 whitespace-nowrap text-muted-foreground">{meta.source}</td>
                      <td className="py-2 px-4 whitespace-nowrap text-muted-foreground">{meta.confidence}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground max-w-xs truncate" title={meta.reason}>{meta.reason}</td>
                    </tr>
                  );
                }))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-col md:flex-row items-start gap-3">
          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-medium shadow-sm hover:bg-surface-elevated disabled:opacity-40 transition-all shrink-0"
          >
            {saveSuccess
              ? <><Check className="h-4 w-4 text-success" /><span className="text-success">Saved!</span></>
              : <><Save className="h-4 w-4" />Save data types</>
            }
          </button>

          {/* Generate / Regenerate button */}
          <button
            onClick={() => handleAiGenerate()}
            disabled={generatingAi || hasUnsavedChanges}
            title={hasUnsavedChanges ? "Save your data type changes first" : undefined}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-90 disabled:opacity-50 transition-all shrink-0"
          >
            {generatingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generatingAi ? "Generating..." : (aiQueries ? "Regenerate M Query" : "Generate M Query")}
          </button>

          {/* Info tip */}
          {hasUnsavedChanges && (
            <div className="p-3 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-lg text-sm leading-relaxed border border-yellow-500/20">
              <strong>Unsaved changes:</strong> Click <em>Save data types</em> first, then generate.
            </div>
          )}
          {!hasUnsavedChanges && !saveSuccess && (
            <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg text-sm leading-relaxed border border-blue-500/20">
              <strong>Tip:</strong> Change types, click <em>Save</em>, then click <em>Generate M Query</em>.
            </div>
          )}
        </div>
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="M Query Static Diagnostics" sub="Pre-flight checks before Power BI Desktop open" />
        <DataTable rows={diag} />
      </div>


    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 6 — DAX Measures
// ────────────────────────────────────────────────────────────────

export function TabDaxMeasures({ analysis }: { analysis: EnterpriseAnalysis }) {
  const {
    powerBiModel,
    repairFocus,
    setEnterpriseAnalysis,
    saveAndValidateMeasure,
    setRepairFocus,
  } = useMigration();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [aiSuggestLoading, setAiSuggestLoading] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { dax: string; confidence: number; note: string }>>({});

  const { ruleBookMd } = useMigration();

  const handleAiSuggest = async (measure: { key: string; measureName: string; qlikExpression: string }) => {
    if (!measure.qlikExpression || /generated from/i.test(measure.qlikExpression)) {
      toast.error("No Qlik expression available", { description: "This measure has no original Qlik expression to translate." });
      return;
    }

    // Use the project rule book if available; otherwise fall back to a built-in Qlik→DAX guide
    const effectiveRuleBook = ruleBookMd || `
# Qlik to Power BI DAX Migration Rules

## Aggregation Functions
- Sum(Field) → SUM('Table'[Field])
- Count(Field) → COUNT('Table'[Field])
- Avg(Field) → AVERAGE('Table'[Field])
- Min(Field) → MIN('Table'[Field])
- Max(Field) → MAX('Table'[Field])

## Set Analysis
- Sum({<Year={2024}>}Sales) → CALCULATE(SUM('Sales'[Amount]), 'Date'[Year] = 2024)
- Sum({$<Field={Value}>}Expr) → CALCULATE(<expr>, 'Table'[Field] = "Value")

## Inter-Record & Rolling Functions
- RangeSum(Above(Sum(Field), 0, N)) → CALCULATE(SUM('Table'[Field]), DATESINPERIOD('Date'[Date], LASTDATE('Date'[Date]), -N, MONTH))
- Above(Sum(Field)) → CALCULATE(SUM('Table'[Field]), DATEADD('Date'[Date], -1, DAY))
- Peek(Field) → use EARLIER() or variables in DAX

## Variables
- $(vVariableName) → use a What-If parameter or a SELECTEDVALUE() measure
- Replace Qlik dollar-sign expansion variables with DAX measure references or fixed values

## If / Conditional
- If(Condition, TrueVal, FalseVal) → IF(<condition>, <true>, <false>)
- IF(ISNULL(x), y, x) → COALESCE(x, y)

## General Rules
- Always qualify column references as 'TableName'[ColumnName]
- Qlik field names map directly to Power BI column names in the same table
- Replace QVD/Resident logic with Power Query M transforms (not DAX)
    `.trim();

    setAiSuggestLoading(measure.key);
    try {
      const results = await translateBulkMeasuresViaAi(
        [{ name: measure.measureName, expression: measure.qlikExpression }],
        effectiveRuleBook
      );
      const result = results[0];
      if (result && result.status === "SUCCESS" && result.generatedDax?.trim()) {
        setAiSuggestions((prev) => ({
          ...prev,
          [measure.key]: {
            dax: result.generatedDax,
            confidence: result.confidence ?? 80,
            note: result.variablesUsed?.length
              ? `Variables detected: ${result.variablesUsed.join(", ")}`
              : "No Qlik variables referenced.",
          },
        }));
        // Pre-fill the draft so the user can review before saving
        setDrafts((prev) => ({ ...prev, [measure.key]: result.generatedDax }));
        setEditingKey(measure.key);
        toast.success("AI suggestion ready", {
          description: `Gemini translated "${measure.measureName}" (${result.confidence ?? 80}% confidence). Review and save when happy.`,
        });
      } else {
        toast.warning("AI could not fully translate this expression", {
          description: "The expression may be too complex. Try editing manually using the Qlik expression as a guide.",
        });
      }
    } catch (e) {
      toast.error("AI suggestion failed", { description: e instanceof Error ? e.message : "Gemini request failed." });
    } finally {
      setAiSuggestLoading(null);
    }
  };



  const catalog = useMemo(
    () => buildDaxCompletionCatalog(analysis, powerBiModel),
    [analysis, powerBiModel],
  );

  const measures = useMemo(() => {
    type Row = {
      key: string;
      measureName: string;
      dax: string;
      qlikExpression: string;
      confidence: number;
      table: string;
      source: string;
      modelMeasureId?: string;
      modelTableId?: string;
      displayFolder?: string;
      status?: string;
    };
    const rows: Row[] = [];
    const usedModelIds = new Set<string>();

    for (const measure of analysis.daxMeasures || []) {
      const modelMatch = powerBiModel?.tables
        .flatMap((table) => table.measures.map((item) => ({ item, table })))
        .find(({ item, table }) =>
          item.name.toLowerCase() === measure.measureName.toLowerCase()
          && (!measure.table || table.name.toLowerCase() === measure.table.toLowerCase()),
        );
      if (modelMatch) usedModelIds.add(modelMatch.item.id);
      rows.push({
        key: modelMatch?.item.id || `enterprise:${measure.table}:${measure.measureName}`,
        measureName: measure.measureName,
        dax: modelMatch?.item.expression || measure.dax,
        qlikExpression: modelMatch?.item.originalExpression || measure.qlikExpression,
        confidence: measure.confidence,
        table: modelMatch?.table.name || measure.table || "Qlik Measures",
        source: measure.source || "Qlik load script",
        modelMeasureId: modelMatch?.item.id,
        modelTableId: modelMatch?.table.id,
        displayFolder: modelMatch?.item.displayFolder,
        status: modelMatch?.item.status,
      });
    }

    for (const table of powerBiModel?.tables || []) {
      for (const measure of table.measures) {
        if (usedModelIds.has(measure.id)) continue;
        rows.push({
          key: measure.id,
          measureName: measure.name,
          dax: measure.expression,
          qlikExpression: measure.originalExpression || "Generated from QVW expression or variable",
          confidence: measure.approved ? 100 : 85,
          table: table.name,
          source: "QVW semantic model",
          modelMeasureId: measure.id,
          modelTableId: table.id,
          displayFolder: measure.displayFolder,
          status: measure.status,
        });
      }
    }

    return rows.sort((left, right) => left.table.localeCompare(right.table) || left.measureName.localeCompare(right.measureName));
  }, [analysis.daxMeasures, powerBiModel]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const measure of measures) {
        if (!(measure.key in next)) next[measure.key] = measure.dax;
      }
      return next;
    });
  }, [measures]);

  useEffect(() => {
    if (!repairFocus || repairFocus.area !== "dax") return;
    const requestedName = repairFocus.objectName?.toLowerCase();
    const requestedId = repairFocus.objectId;
    const match = measures.find((measure) =>
      (requestedId && measure.modelMeasureId === requestedId)
      || (requestedName && measure.measureName.toLowerCase() === requestedName),
    );
    if (!match) return;
    setEditingKey(match.key);
    const timer = window.setTimeout(() => {
      const card = document.getElementById(repairDomId("dax", match.measureName, match.modelMeasureId));
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(`${repairDomId("dax", match.measureName, match.modelMeasureId)}-editor`)?.focus();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [repairFocus, measures]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const saveMeasure = (measure: (typeof measures)[number]) => {
    const dax = drafts[measure.key] ?? measure.dax;
    if (measure.modelTableId && measure.modelMeasureId) {
      const result = saveAndValidateMeasure(measure.modelTableId, measure.modelMeasureId, dax);
      if (result.isValid) {
        toast.success(`${measure.measureName} validated successfully`, {
          description: `${result.resolvedCount} issue(s) resolved. The issue summary and PBIP readiness were refreshed.`,
        });
      } else {
        toast.warning(`${measure.measureName} was saved, but validation still found issues`, {
          description: `${result.resolvedCount} issue(s) resolved; ${result.remainingCount} current issue(s) remain.`,
        });
      }
    } else {
      const enterpriseExists = analysis.daxMeasures.some((item) =>
        item.measureName.toLowerCase() === measure.measureName.toLowerCase()
        && (!measure.table || item.table.toLowerCase() === measure.table.toLowerCase()),
      );
      if (enterpriseExists) {
        setEnterpriseAnalysis({
          ...analysis,
          daxMeasures: analysis.daxMeasures.map((item) =>
            item.measureName.toLowerCase() === measure.measureName.toLowerCase()
            && (!measure.table || item.table.toLowerCase() === measure.table.toLowerCase())
              ? { ...item, dax, notes: `${item.notes || ""} User-reviewed in DAX editor.`.trim() }
              : item,
          ),
        });
      }
      toast.info(`${measure.measureName} saved`, {
        description: "The enterprise inventory was updated. Initialize the semantic model to run complete validation.",
      });
    }
    setSavedKey(measure.key);
    setRepairFocus(null);
    window.setTimeout(() => setSavedKey(null), 2200);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Consolidated DAX Measures"
        sub="Edit generated DAX with IntelliSense-style suggestions for tables, columns, measures and reusable Qlik variables."
      />

      <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Autocomplete:</strong> type <code className="rounded bg-background px-1.5 py-0.5">S</code> to see matching columns with their tables, type <code className="rounded bg-background px-1.5 py-0.5">[</code> for measures and variables, or type <code className="rounded bg-background px-1.5 py-0.5">'Sales'[</code> for Sales columns. Use ↑/↓ and Enter or Tab to insert.
      </div>

      {measures.length === 0 ? (
        <p className="text-xs text-muted-foreground">No aggregation expressions converted.</p>
      ) : (
        <div className="space-y-3">
          {measures.map((measure) => {
            const open = editingKey === measure.key;
            const cardId = repairDomId("dax", measure.measureName, measure.modelMeasureId);
            const changed = (drafts[measure.key] ?? measure.dax) !== measure.dax;
            return (
              <article
                key={measure.key}
                id={cardId}
                data-repair-object={measure.measureName}
                data-repair-object-id={measure.modelMeasureId}
                className={cn(
                  "rounded-2xl border bg-surface transition",
                  repairFocus?.area === "dax"
                    && ((repairFocus.objectId && repairFocus.objectId === measure.modelMeasureId)
                      || repairFocus.objectName?.toLowerCase() === measure.measureName.toLowerCase())
                    ? "border-primary ring-2 ring-primary/25"
                    : "border-border",
                )}
              >
                <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
                  <button
                    type="button"
                    onClick={() => setEditingKey(open ? null : measure.key)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4 shrink-0 text-primary" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{measure.measureName}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{measure.table} • {measure.source}</span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    {measure.displayFolder && <span className="rounded-full bg-muted px-2 py-1">{measure.displayFolder}</span>}
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-600">{measure.status || "generated"}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">{measure.confidence}%</span>
                    <button type="button" onClick={() => setEditingKey(open ? null : measure.key)} className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-muted">{open ? "Close editor" : "Edit DAX"}</button>
                  </div>
                </div>

                <div className="grid gap-4 p-4 lg:grid-cols-[0.75fr_1.25fr]">
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Original Qlik expression</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">{measure.qlikExpression}</pre>
                    {repairFocus?.area === "dax"
                      && ((repairFocus.objectId && repairFocus.objectId === measure.modelMeasureId)
                        || repairFocus.objectName?.toLowerCase() === measure.measureName.toLowerCase()) && (
                      <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
                        <div className="font-semibold text-amber-700">Exact fix target</div>
                        <div className="mt-1 text-muted-foreground">{repairFocus.message}</div>
                        {repairFocus.tableName && repairFocus.fieldName && (
                          <div className="mt-2 font-mono text-[11px] text-foreground">Missing reference: '{repairFocus.tableName}'[{repairFocus.fieldName}]</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    {open ? (
                      <>
                        <DaxCodeEditor
                          id={`${cardId}-editor`}
                          value={drafts[measure.key] ?? measure.dax}
                          onChange={(value) => setDrafts((current) => ({ ...current, [measure.key]: value }))}
                          catalog={catalog}
                          autoFocus={repairFocus?.area === "dax"
                            && ((repairFocus.objectId && repairFocus.objectId === measure.modelMeasureId)
                              || repairFocus.objectName?.toLowerCase() === measure.measureName.toLowerCase())}
                          ariaLabel={`Edit DAX measure ${measure.measureName}`}
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleAiSuggest(measure)}
                            disabled={!!aiSuggestLoading}
                            className="mr-auto inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {aiSuggestLoading === measure.key
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Sparkles className="h-3.5 w-3.5" />}
                            {aiSuggestLoading === measure.key ? "Asking Gemini…" : "✨ AI Suggest"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDrafts((current) => ({ ...current, [measure.key]: measure.dax }));
                              setAiSuggestions((prev) => { const next = { ...prev }; delete next[measure.key]; return next; });
                            }}
                            disabled={!changed}
                            className="rounded-xl border border-border px-4 py-2 text-xs font-semibold disabled:opacity-40"
                          >
                            Reset
                          </button>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(drafts[measure.key] ?? measure.dax, measure.key)}
                            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs font-semibold"
                          >
                            {copiedKey === measure.key ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedKey === measure.key ? "Copied" : "Copy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => saveMeasure(measure)}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savedKey === measure.key ? "Saved" : "Save and validate"}
                          </button>
                        </div>
                        {aiSuggestions[measure.key] && (
                          <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span className="font-semibold text-primary">Gemini AI Suggestion applied to editor</span>
                              <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{aiSuggestions[measure.key].confidence}% confidence</span>
                            </div>
                            <p className="text-muted-foreground">{aiSuggestions[measure.key].note}</p>
                            <p className="text-muted-foreground/70 text-[11px]">The suggestion is pre-filled above. Edit if needed, then click <strong className="text-foreground">Save and validate</strong> to apply.</p>
                          </div>
                        )}

                      </>
                    ) : (
                      <div className="relative group">
                        <pre className="min-h-28 overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#0B1120] p-4 font-mono text-xs leading-6 text-slate-50"><code>{drafts[measure.key] ?? measure.dax}</code></pre>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(drafts[measure.key] ?? measure.dax, measure.key)}
                          className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/10 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          {copiedKey === measure.key ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          {copiedKey === measure.key ? "Copied" : "Copy DAX"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 7 — Semantic Model & Relationships
// ────────────────────────────────────────────────────────────────

export function TabSemanticModel({ analysis }: { analysis: EnterpriseAnalysis }) {
  const rels = analysis.relationships.map(r => ({
    Status: r.status, Active: r.active ? "Yes" : "No",
    From: `${r.fromTable}[${r.fromColumn}]`, To: `${r.toTable}[${r.toColumn}]`,
    Score: r.score, Confidence: r.confidence, Reason: r.reason,
  }));
  const tableRows = analysis.finalTables.map(p => ({
    Table: p.table, Role: tableRole(p), Classification: p.classification,
    Fields: p.fields.length, Confidence: p.confidence,
  }));
  const designRows = (analysis.reconstruction?.tableClassifications || []).map((item) => ({
    Table: item.table,
    Disposition: item.disposition,
    "Include in model": item.includeInModel ? "Yes" : "No",
    "Load enabled": item.loadEnabled ? "Yes" : "No",
    "Retained columns": item.retainedColumns.join(", "),
    "Pruned duplicates": item.prunedColumns.join(", "),
    Reason: item.reason,
    Confidence: item.confidence,
  }));
  const joinRows = (analysis.reconstruction?.joinReconstructions || []).map((item) => ({
    Target: item.targetTable,
    Source: item.sourceTable,
    Type: item.joinKind,
    Keys: item.keyColumns.join(", "),
    "Expanded columns": item.expandColumns.map((field) => item.qualifiedCollisions[field] || field).join(", "),
    Confidence: item.confidence,
    Reason: item.reason,
  }));
  const keyRows = (analysis.reconstruction?.compositeKeys || []).map((item) => ({
    Tables: `${item.leftTable} ↔ ${item.rightTable}`,
    Fields: item.columns.join(", "),
    "Generated key": item.keyColumn,
    Confidence: item.confidence,
    Reason: item.reason,
  }));
  return (
    <div className="space-y-5">
      <div className="surface-card p-4">
        <SectionHeader title="Model Tables" />
        <DataTable rows={tableRows} />
      </div>
      <div className="surface-card p-4">
        <SectionHeader title="Relationship Candidates" sub="Inferred from model metadata and shared keys. Active = included in the exported TOM/TMDL semantic model." />
        <DataTable rows={rels} />
      </div>
      <div className="surface-card p-4">
        <SectionHeader title="Model Design Decisions" sub="Backend reconstruction evidence used to include, stage, prune, or exclude each table." />
        <DataTable rows={designRows} />
      </div>
      <div className="surface-card p-4">
        <SectionHeader title="Qlik JOIN Reconstruction" sub="JOIN/KEEP operations are applied in Power Query script order. Keys are based on explicit common fields, not name-only guesses." />
        <DataTable rows={joinRows} />
      </div>
      <div className="surface-card p-4">
        <SectionHeader title="Composite-Key Decisions" sub="Keys are generated only for explicit multi-column associations where both tables remain in the model." />
        <DataTable rows={keyRows} />
      </div>
      <div className="surface-card p-4">
        <SectionHeader title="Semantic Model JSON" />
        <CodeBlock code={JSON.stringify(analysis.semanticModel, null, 2)} lang="json" />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 8 — Validation Report
// ────────────────────────────────────────────────────────────────

export function TabValidation({ analysis }: { analysis: EnterpriseAnalysis }) {
  const v = analysis.validation;
  const issueRows = v.issues.map(i => ({
    Severity: i.severity, Area: i.area, Object: i.objectName, Message: i.message, Fix: i.recommendation,
  }));
  const diagRows = (v.desktopDiagnostics || []);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="PBIP Readiness" value={v.isReadyForPbipExport ? "✓ Ready" : "✗ Blocked"} />
        <MetricCard label="Errors" value={v.errorCount} />
        <MetricCard label="Warnings" value={v.warningCount} />
      </div>

      <AutoFixCenter analysis={analysis} />

      {v.isReadyForPbipExport ? (
        <div className="surface-card p-4 border border-green-500/20 bg-green-500/5 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-green-400" />
          <p className="text-sm text-green-400">PBIP export validation passed. The generated project uses safe M queries and all source mappings are confirmed.</p>
        </div>
      ) : (
        <div className="surface-card p-4 border border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">PBIP export is blocked. The AI Auto-Fix Center will repair safe issues and route remaining exceptions to the exact editor.</p>
        </div>
      )}

      <div className="surface-card p-4">
        <SectionHeader title="Validation Issues" />
        {issueRows.length ? <DataTable rows={issueRows} /> : <p className="text-xs text-green-400">No validation issues found.</p>}
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="Power BI Desktop Openability Diagnostics" sub="Pre-flight checks simulating what Power BI Desktop verifies on open" />
        {diagRows.length ? <DataTable rows={diagRows as Record<string, unknown>[]} /> : <p className="text-xs text-muted-foreground">No diagnostics generated.</p>}
      </div>

      <div className="surface-card p-4">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Migration Report" />
          <button
            onClick={() => {
              const blob = new Blob([analysis.migrationReport], { type: "text/markdown" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
              a.download = "QLIK2PBI_migration_report.md"; a.click();
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-surface-elevated">
            <Download className="h-3.5 w-3.5" /> Download (.md)
          </button>
        </div>
        <pre className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-72 overflow-auto">{analysis.migrationReport.slice(0, 6000)}</pre>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 9 — PBIP Export (client-side JSON download)
// ────────────────────────────────────────────────────────────────

export function TabPbipExport({ analysis }: { analysis: EnterpriseAnalysis }) {
  const { expressionInventory, powerBiModel, qvwAnalysis, pipelineLogs } = useMigration();
  const modelRequired = Boolean(qvwAnalysis || expressionInventory?.artifacts.length);
  const modelReady = !modelRequired || Boolean(powerBiModel && powerBiModel.readiness !== "not-ready");
  const ready = analysis.validation.isReadyForPbipExport && modelReady;
  const readinessChecklist = [
    { label: "At least one final or imported table exists", passed: analysis.finalTables.length > 0 || Object.keys(analysis.mQueries || {}).length > 0 },
    { label: "Enterprise source and M-query validation passed", passed: analysis.validation.isReadyForPbipExport },
    { label: "Expression inventory is available when QVW metadata is present", passed: !qvwAnalysis || Boolean(expressionInventory) },
    { label: "Power BI model has no blocking diagnostics", passed: !modelRequired || Boolean(powerBiModel && powerBiModel.blockingErrorCount === 0) },
    { label: "All relationship endpoints resolve to model tables and columns", passed: !powerBiModel || !powerBiModel.diagnostics.some((item) => ["RELATIONSHIP_TABLE_MISSING", "RELATIONSHIP_COLUMN_MISSING", "RELATIONSHIP_TYPE_MISMATCH", "DUPLICATE_RELATIONSHIP"].includes(item.code) && item.severity === "blocking-error") },
    { label: "Visual bindings do not contain invalid references", passed: !powerBiModel || !powerBiModel.visualBindings.some((binding) => binding.status === "invalid") },
    { label: "Migration manifest and traceability files will be included", passed: true },
  ];
  const [name, setName] = useState("QLIK2PBI_Migration_Project");
  const [exporting, setExporting] = useState(false);
  const [requireMicrosoftTom, setRequireMicrosoftTom] = useState(true);
  const [tomStatus, setTomStatus] = useState<{ state: "checking" | "available" | "fallback"; detail?: string }>({ state: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tom/status", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.available) {
          setTomStatus({ state: "available", detail: payload.dotnetVersion ? `.NET ${payload.dotnetVersion}` : "Microsoft TOM bridge ready" });
        } else {
          setTomStatus({ state: "fallback", detail: "Strict TypeScript TMDL serializer will be used" });
          setRequireMicrosoftTom(false);
        }
      })
      .catch(() => {
        setTomStatus({ state: "fallback", detail: "Strict TypeScript TMDL serializer will be used" });
        setRequireMicrosoftTom(false);
      });
    return () => controller.abort();
  }, []);

  const handleDownloadPbipZip = async () => {
    try {
      setExporting(true);
      const blob = await generatePbipZip(analysis, name, {
        expressionInventory,
        powerBiModel,
        qvwAnalysis,
        pipelineLogs,
        requireMicrosoftTom,
        daxMeasures: analysis.daxMeasures,
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}_Workspace.zip`;
      a.click();
    } catch (e) {
      alert("Failed to generate PBIP zip: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadJson = () => {
    const payload = {
      model: analysis.semanticModel,
      mQueries: analysis.mQueries,
      daxMeasures: analysis.daxMeasures,
      relationships: analysis.relationships,
      validation: analysis.validation,
      migrationReport: analysis.migrationReport,
      expressionInventory,
      powerBiModel,
      qvwAnalysis,
      pipelineLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${name}_full_analysis.json`; a.click();
  };

  const handleDownloadMQueries = () => {
    const txt = combinedMQueriesText(analysis.mQueries);
    const blob = new Blob([txt], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${name}_M_QUERIES.txt`; a.click();
  };

  return (
    <div className="space-y-5">
      {ready ? (
        <div className="surface-card p-4 border border-green-500/20 bg-green-500/5 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-green-400" />
          <p className="text-sm text-green-400">PBIP export validation passed. Download the migration package below.</p>
        </div>
      ) : (
        <div className="surface-card p-4 border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-400">PBIP export is blocked. Run AI Auto-Fix, then use the direct links for any remaining business decisions.</p>
        </div>
      )}

      {!ready && <AutoFixCenter analysis={analysis} compact />}

      <div className="surface-card p-4">
        <SectionHeader title="Export Readiness Checklist" sub="PBIP download is enabled only when blocking checks pass" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
          {readinessChecklist.map((item) => (
            <div key={item.label} className="flex items-start gap-2 rounded-lg border border-border/70 p-3 text-xs">
              {item.passed ? <Check className="h-4 w-4 text-green-400 shrink-0" /> : <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />}
              <span className={item.passed ? "text-muted-foreground" : "text-red-400"}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="surface-card p-4">
        <SectionHeader title="Export Settings" sub="Semantic model is generated as Microsoft TOM-aligned TMDL; model.bim and cache.abf are not emitted" />
        <label className="text-xs text-muted-foreground">Project Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-foreground" />
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/70 bg-surface-elevated/40 p-3 text-xs">
          {tomStatus.state === "checking" ? <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" /> : tomStatus.state === "available" ? <ShieldCheck className="h-4 w-4 text-green-400 shrink-0" /> : <Info className="h-4 w-4 text-sky-400 shrink-0" />}
          <div className="flex-1">
            <div className="font-medium text-foreground">
              {tomStatus.state === "checking" ? "Checking Microsoft TOM bridge..." : tomStatus.state === "available" ? "Microsoft TOM serializer available" : "Microsoft TOM bridge not available"}
            </div>
            <div className="text-muted-foreground mt-0.5">{tomStatus.detail || "The export automatically selects the strongest available serializer."}</div>
            <label className="mt-3 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requireMicrosoftTom}
                onChange={(event) => setRequireMicrosoftTom(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Require Microsoft TOM roundtrip validation</span>
                <span className="block text-muted-foreground">Recommended for production. When enabled, export fails instead of silently using the portable serializer.</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="surface-card p-4 space-y-3">
        <SectionHeader title="Downloads" sub="Export your migration artifacts" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

          
          <button onClick={handleDownloadPbipZip} disabled={exporting}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              ready 
                ? "border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary" 
                : "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600"
            }`}>
            <Package className={`h-5 w-5 ${ready ? "text-primary" : "text-amber-600"}`} />
            <div className="text-left">
              <div className={`font-semibold ${ready ? "text-primary" : "text-amber-600"}`}>
                {exporting ? "Generating..." : ready ? "Download PBIP (.zip)" : "Download Anyway (.zip)"}
              </div>
              <div className={`text-xs ${ready ? "text-primary/70" : "text-amber-600/70"}`}>
                {ready ? "Extract and open the .pbip file" : "Model has errors. Use at own risk."}
              </div>
            </div>
          </button>
          <button onClick={handleDownloadMQueries}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border text-sm font-medium hover:bg-surface-elevated">
            <FileText className="h-4 w-4 text-primary" />
            <div className="text-left"><div>Power Query M Scripts</div><div className="text-xs text-muted-foreground">All tables as .txt</div></div>
          </button>
          <button onClick={handleDownloadJson}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border text-sm font-medium hover:bg-surface-elevated">
            <Braces className="h-4 w-4 text-primary" />
            <div className="text-left"><div>Full Analysis JSON</div><div className="text-xs text-muted-foreground">Model + DAX + relationships</div></div>
          </button>
        </div>
        <p className="text-xs text-muted-foreground bg-surface-elevated/50 p-3 rounded-lg">
          💡 <strong>To use in Power BI Desktop:</strong> Download the <strong>PBIP (.zip)</strong>, extract the complete folder, enable <strong>Store semantic model using TMDL format</strong> in Power BI Desktop Preview features when required by your Desktop version, and open the <code>.pbip</code> file. Do not open the project from inside the ZIP.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TAB 10 — Logs / JSON
// ────────────────────────────────────────────────────────────────

function TabLogs({ analysis }: { analysis: EnterpriseAnalysis }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sections = [
    { key: "variables", label: "Variables", data: analysis.variables },
    { key: "connections", label: "Connections", data: analysis.connections },
    { key: "sourceCatalog", label: "Source Catalog", data: analysis.sourceCatalog },
    { key: "columnTypes", label: "Column Types", data: analysis.columnTypes },
    { key: "columnTypeMeta", label: "Column Type Inference Metadata", data: analysis.columnTypeMeta },
    { key: "semanticModel", label: "Semantic Model JSON", data: analysis.semanticModel },
  ];
  return (
    <div className="space-y-3">
      <div className="surface-card p-4">
        <h5 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Pipeline Logs</h5>
        {analysis.logs.map((l, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground py-1 border-b border-border/30">
            <Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />{l}
          </div>
        ))}
      </div>
      {sections.map(({ key, label, data }) => (
        <div key={key} className="surface-card overflow-hidden">
          <button onClick={() => setExpanded(expanded === key ? null : key)}
            className="w-full flex items-center justify-between p-4 text-sm font-medium text-foreground hover:bg-surface-elevated/50">
            {label}
            {expanded === key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {expanded === key && (
            <div className="border-t border-border p-4">
              <CodeBlock code={JSON.stringify(data, null, 2)} lang="json" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "summary",     label: "Summary",        icon: BarChart3 },
  { id: "mapping",     label: "Source Mapping", icon: Database },
  { id: "all-tables",  label: "All Tables",     icon: Table2 },
  { id: "final",       label: "Final Tables",   icon: Layers },
  { id: "mquery",      label: "M Query & Types",icon: FileText },
  { id: "dax",         label: "DAX Measures",   icon: GitBranch },
  { id: "model",       label: "Semantic Model", icon: Network },
  { id: "validation",  label: "Validation",     icon: ShieldCheck },
  { id: "export",      label: "PBIP Export",    icon: Download },
  { id: "logs",        label: "Logs / JSON",    icon: Braces },
];

export function EnterpriseAnalysisPanel({ files, onAnalysisComplete }: { files: ExtractedFile[], onAnalysisComplete: () => void }) {
  const [analysis, setAnalysis] = useState<EnterpriseAnalysis | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());

  // Mapping state
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
  const [mappingUpdates, setMappingUpdates] = useState<Record<string, { mappedRef?: string; connectorType?: string; status?: string; notes?: string }>>({});
  const [applying, setApplying] = useState(false);

  // Type edits
  const [columnTypeEdits, setColumnTypeEdits] = useState<Record<string, string>>({});
  const [applyingTypes, setApplyingTypes] = useState(false);

  const runAnalysis = useCallback(async (mupdates = mappingUpdates, typeEdits = columnTypeEdits) => {
    const projectFiles = toProjectFiles(files);
    if (!projectFiles.length) { setError("No text files could be extracted from the uploaded files."); return; }
    setRunning(true); setError(null);
    try {
      // Run in a microtask to allow UI to update
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const result = runEnterpriseAnalysis(projectFiles, mupdates, typeEdits);
      setAnalysis(result);
      setMappingRows(result.sourceMappings.map(m => ({
        originalRef: m.originalRef, mappedRef: m.mappedRef, connectorType: m.connectorType,
        status: m.status, notes: m.notes, table: m.table, sourceRole: m.sourceRole,
        bypassQvd: m.bypassQvd, effectiveRef: m.effectiveRef, qvdProducerTable: m.qvdProducerTable,
      })));
      onAnalysisComplete();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enterprise analysis failed.");
    } finally { setRunning(false); }
  }, [files, mappingUpdates, columnTypeEdits]);

  const handleApplyMapping = useCallback(async () => {
    setApplying(true);
    const newUpdates = rowsToUpdates(mappingRows.map(r => ({
      original_ref: r.originalRef, mapped_ref: r.mappedRef, connector_type: r.connectorType,
      status: r.status, notes: r.notes, bypass_qvd: r.bypassQvd ? "true" : "false",
    })));
    setMappingUpdates(newUpdates);
    await runAnalysis(newUpdates, columnTypeEdits);
    setApplying(false);
  }, [mappingRows, columnTypeEdits, runAnalysis]);

  const handleApplyTypes = useCallback(async () => {
    setApplyingTypes(true);
    const result = await runAnalysis(mappingUpdates, columnTypeEdits);
    setApplyingTypes(false);
    return result;
  }, [mappingUpdates, columnTypeEdits, runAnalysis]);

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
        <button onClick={() => runAnalysis()} className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          Retry
        </button>
      </div>
    );
  }

  if (!analysis) return null;

  const val = analysis.validation;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="surface-card p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-base">Enterprise Migration Workbench</h3>
            <p className="text-xs text-muted-foreground">
              {analysis.finalTables.length} final tables · {analysis.sourceMappings.length} sources · {val.isReadyForPbipExport ? "✓ PBIP Ready" : "✗ Blocked"}
            </p>
          </div>
        </div>
        <button onClick={() => runAnalysis()} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-surface-elevated">
          <RefreshCw className="h-3.5 w-3.5" /> Re-run
        </button>
      </div>

      {/* Vertical Stepper / Accordion Wizard */}
      <div className="flex flex-col gap-3">
        {TABS.map(({ id, label, icon: Icon }, index) => {
          const isExpanded = activeTab === id;
          const isCompleted = completedStages.has(id);
          
          return (
            <div key={id} className={cn("surface-card rounded-xl border transition-all", isExpanded ? "border-primary/50 shadow-md ring-1 ring-primary/20" : "border-border hover:border-border/80")}>
              {/* Accordion Header */}
              <button 
                onClick={() => setActiveTab(isExpanded ? "" : id)}
                className="w-full flex items-center justify-between p-4 focus:outline-none"
              >
                <div className="flex items-center gap-4">
                  <div className={cn("grid h-10 w-10 place-items-center rounded-full transition-colors", 
                    isCompleted ? "bg-success/15 text-success" : (isExpanded ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground")
                  )}>
                    {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">Stage {index + 1}</div>
                    <div className={cn("font-semibold text-sm transition-colors", isExpanded ? "text-foreground" : "text-foreground/80")}>{label}</div>
                  </div>
                </div>
                <div>
                  {isExpanded ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
                </div>
              </button>

              {/* Accordion Content */}
              {isExpanded && (
                <div className="border-t border-border bg-surface-elevated/20 p-4 rounded-b-xl animate-in slide-in-from-top-2 duration-200">
                  <div className="mb-6">
                    {id === "summary"    && <TabSummary analysis={analysis} />}
                    {id === "mapping"    && <TabSourceMapping analysis={analysis} mappingRows={mappingRows} onMappingChange={setMappingRows} onApply={handleApplyMapping} applying={applying} />}
                    {id === "all-tables" && <TabAllTables analysis={analysis} />}
                    {id === "final"      && <TabFinalTables analysis={analysis} />}
                    {id === "mquery"     && <TabMQueryDataTypes analysis={analysis} columnTypeEdits={columnTypeEdits} onTypeChange={(k, v) => { const next = { ...columnTypeEdits, [k]: v }; setColumnTypeEdits(next); setAnalysis(applyDataTypeOverrides(analysis, next)); }} onAnalysisUpdate={setAnalysis} />}
                    {id === "dax"        && <TabDaxMeasures analysis={analysis} />}
                    {id === "model"      && <TabSemanticModel analysis={analysis} />}
                    {id === "validation" && <TabValidation analysis={analysis} />}
                    {id === "export"     && <TabPbipExport analysis={analysis} />}
                    {id === "logs"       && <TabLogs analysis={analysis} />}
                  </div>
                  
                  {/* Footer Action */}
                  <div className="flex justify-end pt-4 border-t border-border mt-4">
                    <button 
                      onClick={() => {
                        const newCompleted = new Set(completedStages);
                        newCompleted.add(id);
                        setCompletedStages(newCompleted);
                        // Move to next tab if available
                        if (index < TABS.length - 1) {
                          setActiveTab(TABS[index + 1].id);
                        } else {
                          setActiveTab("");
                        }
                      }}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 shadow-sm transition-opacity"
                    >
                      <Check className="h-4 w-4" />
                      {index < TABS.length - 1 ? "Mark Complete & Continue" : "Finish Review"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
