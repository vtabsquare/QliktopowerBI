import { useRef, useState, useEffect } from "react";
import JSZip from "jszip";
import {
  FileUp,
  Upload,
  FolderOpen,
  Archive,
  FileCode2,
  FileText,
  Database,
  BarChart3,
  Layers,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Eye,
  ArrowRight,
  Package,
  Sparkles,
  TrendingUp,
  Shield,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExtractedFile {
  path: string;
  name: string;
  extension: string;
  sizeKb: number;
  text: string | null;
  parsedAsText: boolean;
  /** Temporary upload payload used only by the local Windows QVW extraction bridge. */
  binaryBase64?: string;
  originPackage?: string;
}

export interface AutoAssignedFiles {
  sources: ExtractedFile[];
  etls: ExtractedFile[];
}

interface Props {
  onFiles: (files: ExtractedFile[]) => void | Promise<void>;
}

const TEXT_EXTENSIONS = new Set([
  ".qvs",
  ".txt",
  ".csv",
  ".tsv",
  ".md",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".sql",
  ".js",
  ".ts",
  ".py",
  ".ps1",
  ".properties",
]);

function isTextFile(ext: string) {
  return TEXT_EXTENSIONS.has(ext.toLowerCase());
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function getFileColor(ext: string): string {
  switch (ext) {
    case ".qvw":
      return "from-fuchsia-600 to-violet-700";
    case ".qvs":
      return "from-violet-500 to-purple-600";
    case ".qvd":
      return "from-teal-500 to-emerald-700";
    case ".csv":
      return "from-emerald-500 to-green-600";
    case ".txt":
      return "from-blue-500 to-cyan-600";
    case ".json":
      return "from-amber-500 to-orange-600";
    case ".xml":
      return "from-rose-500 to-pink-600";
    case ".sql":
      return "from-sky-500 to-blue-600";
    default:
      return "from-slate-500 to-slate-600";
  }
}

function getFileIcon(ext: string) {
  switch (ext) {
    case ".qvw":
      return LayoutDashboard;
    case ".qvs":
      return FileCode2;
    case ".qvd":
      return Database;
    case ".csv":
      return Database;
    case ".sql":
      return Database;
    default:
      return FileText;
  }
}

function getSourceScore(file: ExtractedFile) {
  const path = file.path.toLowerCase();
  const text = (file.text ?? "").slice(0, 12000).toLowerCase();
  let score = 0;
  if (
    /(^|[/\\])(source|sources|extract|extraction|input|inputs|landing|raw|qvd|connector|connectors|metadata)([/\\]|_|-|\.|$)/i.test(
      file.path,
    )
  )
    score += 6;
  if (
    /\b(from|lib connect to|odbc connect|ole db|sql select|load\s+\*\s+from|resident)\b/i.test(text)
  )
    score += 3;
  if (/\.(csv|tsv|json|xml|xlsx?)$/.test(path)) score += 4;
  if (
    /\b(transform|transformation|etl|model|fact|dim|calendar|mapping|aggregate|join|concatenate|applymap|intervalmatch)\b/i.test(
      file.path,
    )
  )
    score -= 3;
  return score;
}

function getEtlScore(file: ExtractedFile) {
  const path = file.path.toLowerCase();
  const text = (file.text ?? "").slice(0, 12000).toLowerCase();
  let score = 0;
  if (
    /\b(etl|transform|transformation|model|fact|dimension|dim|calendar|mapping|aggregate|mart|staging|final)\b/i.test(
      file.path,
    )
  )
    score += 6;
  if (
    /\b(resident|join|left join|inner join|concatenate|applymap|group by|where exists|intervalmatch|drop table|store\s+.+into)\b/i.test(
      text,
    )
  )
    score += 4;
  if (/\.(qvs|sql|py|js|ts)$/.test(path)) score += 2;
  if (/\b(source|sources|extract|extraction|input|raw|connector|metadata)\b/i.test(file.path))
    score -= 2;
  return score;
}

export function autoAssignSourceAndEtl(files: ExtractedFile[]): AutoAssignedFiles {
  const assignableFiles = files.filter((file) => file.parsedAsText);
  const scriptCandidates = assignableFiles.filter((file) => {
    const extension = file.extension?.toLowerCase();
    const name = file.name.toLowerCase();
    return (
      [".qvs", ".sql"].includes(extension) ||
      name === "loadscript.txt" ||
      /(?:^|[/\\])(load|etl|extract|transform|model|script)[^/\\]*\.txt$/i.test(file.path)
    );
  });
  const qvsFiles = scriptCandidates.filter((file) => file.extension?.toLowerCase() === ".qvs");
  const candidates = qvsFiles.length > 0 ? qvsFiles : scriptCandidates;

  if (candidates.length === 0) return { sources: [], etls: [] };
  if (candidates.length === 1) return { sources: [candidates[0]], etls: [candidates[0]] };

  const sources = candidates.filter((file) => {
    const text = (file.text ?? "").slice(0, 12000);
    return (
      /(^|[/\\]|_|-|\.)(extract|extraction|config|configuration)([/\\]|_|-|\.|$)/i.test(
        file.path,
      ) ||
      /\b(extract|extraction|config|configuration|lib connect to|odbc connect|ole db|sql select|load\s+\*\s+from)\b/i.test(
        text,
      )
    );
  });
  const etls = candidates.filter((file) => !sources.some((source) => source.path === file.path));

  if (sources.length > 0 && etls.length > 0) return { sources, etls };

  const scored = candidates.map((file, index) => ({
    file,
    index,
    sourceScore: getSourceScore(file),
    etlScore: getEtlScore(file),
  }));

  const rankedSources = [...scored].sort(
    (a, b) => b.sourceScore - a.sourceScore || a.index - b.index,
  );
  const source = rankedSources[0].file;
  const remaining = candidates.filter((file) => file.path !== source.path);

  return { sources: [source], etls: remaining };
}

// Animated counter hook
function useCounter(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        setValue(target);
        clearInterval(timer);
      } else setValue(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return value;
}

export function MultiFileDropzone({ onFiles }: Props) {
  const inputFileRef = useRef<HTMLInputElement>(null);
  const inputFolderRef = useRef<HTMLInputElement>(null);
  const inputZipRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);

  const processFiles = async (rawFiles: File[]) => {
    setProcessing(true);
    const result: ExtractedFile[] = [];
    try {
      for (const file of rawFiles) {
      const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
      if (ext === ".zip") {
        try {
          const zip = await JSZip.loadAsync(file);
          for (const [path, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const entryExt = "." + path.split(".").pop()!.toLowerCase();
            const entryWithSize = zipEntry as unknown as {
              _data?: { uncompressedSize?: number };
            };
            const sizeKb = parseFloat(
              ((entryWithSize._data?.uncompressedSize ?? 0) / 1024).toFixed(2),
            );
            const text = isTextFile(entryExt) ? await zipEntry.async("text") : null;
            const binaryBase64 = entryExt === ".qvw" ? await zipEntry.async("base64") : undefined;
            result.push({
              path,
              name: path.split("/").pop()!,
              extension: entryExt,
              sizeKb,
              text,
              parsedAsText: text !== null,
              binaryBase64,
              originPackage: file.name,
            });
          }
        } catch (e) {
          console.warn("ZIP parse failed:", file.name, e);
        }
      } else {
        const sizeKb = parseFloat((file.size / 1024).toFixed(2));
        const text = isTextFile(ext) ? await file.text() : null;
        const binaryBase64 = ext === ".qvw" ? await blobToBase64(file) : undefined;
        result.push({
          path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          name: file.name,
          extension: ext,
          sizeKb,
          text,
          parsedAsText: text !== null,
          binaryBase64,
        });
      }
      }
      await onFiles(result);
    } finally {
      setProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) processFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "relative rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden",
        dragging
          ? "border-primary scale-[1.01] bg-primary/5"
          : "border-border bg-surface-elevated hover:border-primary/50",
      )}
    >
      {/* Animated background glow on drag */}
      {dragging && (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-violet-500/10 pointer-events-none animate-pulse" />
      )}

      <div className="px-6 py-10 text-center relative z-10">
        <div
          className={cn(
            "grid place-items-center h-16 w-16 rounded-2xl mx-auto mb-4 shadow-lg transition-all duration-300",
            processing ? "bg-primary/20" : "bg-gradient-to-br from-primary to-violet-600",
          )}
        >
          {processing ? (
            <div className="h-7 w-7 rounded-full border-[3px] border-white/30 border-t-white animate-spin" />
          ) : (
            <Package className="h-7 w-7 text-white" />
          )}
        </div>
        <div className="font-display font-bold text-xl mb-1">
          {processing ? "Extracting & Analysing Package…" : "Drop your Qlik project here"}
        </div>
        <div className="text-xs text-muted-foreground font-mono mb-7">
          Single QVS · QVW + PRJ folder · ZIP package · Entire folder
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          {[
            {
              icon: Upload,
              label: "Browse Files",
              ref: inputFileRef,
              cls: "bg-accent text-accent-foreground",
            },
            {
              icon: FolderOpen,
              label: "Upload Folder",
              ref: inputFolderRef,
              cls: "bg-accent text-accent-foreground",
            },
            {
              icon: Archive,
              label: "Upload ZIP",
              ref: inputZipRef,
              cls: "bg-gradient-to-r from-primary to-violet-600 text-white shadow-md",
            },
          ].map(({ icon: Icon, label, ref, cls }) => (
            <button
              key={label}
              onClick={() => ref.current?.click()}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-all active:scale-95",
                cls,
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Hidden inputs */}
      <input
        ref={inputFileRef}
        type="file"
        className="hidden"
        multiple
        accept=".qvw,.qvs,.qvd,.qvx,.txt,.csv,.tsv,.json,.xml,.sql,.py,.ts,.js,.yaml,.yml,.md,.xlsx,.xls,.parquet,.png,.jpg,.jpeg,.webp,.pdf,.ps1,.properties"
        onChange={(e) => {
          const f = Array.from(e.target.files || []);
          if (f.length) processFiles(f);
          e.target.value = "";
        }}
      />
      <input
        ref={inputFolderRef}
        type="file"
        className="hidden"
        multiple
        {...({ webkitdirectory: "" } as { webkitdirectory: string })}
        onChange={(e) => {
          const f = Array.from(e.target.files || []);
          if (f.length) processFiles(f);
          e.target.value = "";
        }}
      />
      <input
        ref={inputZipRef}
        type="file"
        className="hidden"
        accept=".zip"
        onChange={(e) => {
          const f = Array.from(e.target.files || []);
          if (f.length) processFiles(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Animated stat card ───────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  value,
  label,
  gradient,
  delay = 0,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  gradient: string;
  delay?: number;
}) {
  const count = useCounter(value, 900 + delay);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 text-white shadow-lg",
        `bg-gradient-to-br ${gradient}`,
      )}
    >
      <div className="absolute top-0 right-0 h-24 w-24 rounded-full bg-white/10 -translate-y-8 translate-x-8 blur-xl" />
      <Icon className="h-6 w-6 mb-3 opacity-90" />
      <div className="font-display font-black text-4xl tracking-tight">{count}</div>
      <div className="text-[11px] font-medium opacity-80 mt-1 uppercase tracking-widest">
        {label}
      </div>
    </div>
  );
}

// ─── File type breakdown bar ──────────────────────────────────────────────────
function TypeBreakdown({ files }: { files: ExtractedFile[] }) {
  const groups = files.reduce<Record<string, number>>((acc, f) => {
    acc[f.extension] = (acc[f.extension] ?? 0) + 1;
    return acc;
  }, {});
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const colors = [
    "bg-violet-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-sky-500",
    "bg-rose-500",
    "bg-slate-400",
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {sorted.map(([ext, cnt], i) => (
          <div
            key={ext}
            className={cn("transition-all duration-700", colors[i % colors.length])}
            style={{ width: `${(cnt / files.length) * 100}%` }}
            title={`${ext}: ${cnt}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px]">
        {sorted.map(([ext, cnt], i) => (
          <span key={ext} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", colors[i % colors.length])} />
            <span className="font-mono font-medium">{ext}</span>
            <span className="text-muted-foreground">({cnt})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Proactive insight card ───────────────────────────────────────────────────
function InsightCard({
  icon: Icon,
  title,
  body,
  type = "info",
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  type?: "info" | "warn" | "success";
}) {
  const styles = {
    info: "border-primary/20 bg-primary/5 text-primary",
    warn: "border-amber-400/30 bg-amber-400/5 text-amber-500",
    success: "border-emerald-400/30 bg-emerald-400/5 text-emerald-500",
  };
  return (
    <div className={cn("flex gap-3 p-4 rounded-xl border", styles[type])}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold text-xs mb-0.5">{title}</div>
        <div className="text-xs opacity-80">{body}</div>
      </div>
    </div>
  );
}

// ─── File Analysis Panel ──────────────────────────────────────────────────────
interface FileAnalysisPanelProps {
  files: ExtractedFile[];
  onToggleSource: (f: ExtractedFile) => void;
  onToggleEtl: (f: ExtractedFile) => void;
  selectedSources: ExtractedFile[];
  selectedEtls: ExtractedFile[];
}

export function FileAnalysisPanel({
  files,
  onToggleSource,
  onToggleEtl,
  selectedSources,
  selectedEtls,
}: FileAnalysisPanelProps) {
  const qvsFiles = files.filter((f) => f.extension === ".qvs");
  const csvFiles = files.filter((f) => f.extension === ".csv");
  const assignableFiles = files.filter((f) => f.parsedAsText); // any text file can be assigned
  const totalSize = files.reduce((s, f) => s + f.sizeKb, 0);
  const textCount = files.filter((f) => f.parsedAsText).length;

  // Build smart insights
  const insights: {
    icon: React.ElementType;
    title: string;
    body: string;
    type: "info" | "warn" | "success";
  }[] = [];
  if (qvsFiles.length >= 2)
    insights.push({
      icon: CheckCircle2,
      title: "Source + ETL scripts detected",
      body: `${qvsFiles.length} QVS files found. Auto-assigned below — verify before running analysis.`,
      type: "success",
    });
  else if (assignableFiles.length >= 2)
    insights.push({
      icon: CheckCircle2,
      title: `${assignableFiles.length} text files ready for assignment`,
      body: "Assign any two files as Source and ETL to begin analysis.",
      type: "info",
    });
  if (qvsFiles.length === 1)
    insights.push({
      icon: CheckCircle2,
      title: "Single-QVS conversion mode enabled",
      body: "The same QVS is analysed for source extraction, transformations, final tables, variables, DAX candidates and Power Query generation. No second script is required.",
      type: "success",
    });
  if (assignableFiles.length < 2 && qvsFiles.length !== 1)
    insights.push({
      icon: AlertTriangle,
      title: "No supported migration script found",
      body: "Upload one .qvs file, LoadScript.txt, or a complete ZIP/folder package.",
      type: "warn",
    });
  if (csvFiles.length > 0)
    insights.push({
      icon: Database,
      title: `${csvFiles.length} CSV data files included`,
      body: "These will be referenced as source connectors in the generated Power Query M code.",
      type: "info",
    });
  if (textCount > 0 && textCount === files.length)
    insights.push({
      icon: Shield,
      title: "All files parsed successfully",
      body: "100% of uploaded files are readable as text and ready for analysis.",
      type: "success",
    });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Layers}
          value={files.length}
          label="Total Files"
          gradient="from-violet-600 to-purple-700"
          delay={0}
        />
        <StatCard
          icon={FileCode2}
          value={qvsFiles.length}
          label="QVS Scripts"
          gradient="from-sky-600 to-blue-700"
          delay={100}
        />
        <StatCard
          icon={Database}
          value={csvFiles.length}
          label="Data Files"
          gradient="from-emerald-600 to-green-700"
          delay={200}
        />
        <StatCard
          icon={BarChart3}
          value={textCount}
          label="Text Parsed"
          gradient="from-amber-500 to-orange-600"
          delay={300}
        />
      </div>

      {/* ── Type breakdown ── */}
      <div className="surface-card p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" /> File type distribution
          <span className="ml-auto text-xs text-muted-foreground font-normal font-mono">
            {totalSize.toFixed(1)} KB total
          </span>
        </div>
        <TypeBreakdown files={files} />
      </div>

      {/* ── Proactive insights ── */}
      {insights.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" /> Proactive Analysis
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {insights.map((ins, i) => (
              <InsightCard
                key={i}
                icon={ins.icon}
                title={ins.title}
                body={ins.body}
                type={ins.type}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Script assignment — shows ALL text-parseable files ── */}
      {assignableFiles.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Script Assignment</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              Assign Source and ETL from any text file below
            </span>
          </div>
          <div className="divide-y divide-border">
            {assignableFiles.map((f) => {
              const isSource = selectedSources.some((s) => s.path === f.path);
              const isEtl = selectedEtls.some((e) => e.path === f.path);
              const Icon = getFileIcon(f.extension);
              return (
                <div
                  key={f.path}
                  className={cn(
                    "flex items-center gap-4 px-5 py-3.5 transition-all",
                    isSource ? "bg-primary/5" : isEtl ? "bg-violet-500/5" : "hover:bg-accent/20",
                  )}
                >
                  <div
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br shrink-0",
                      getFileColor(f.extension),
                    )}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-semibold truncate">{f.path}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.extension} · {f.sizeKb} KB
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => onToggleSource(f)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                        isSource
                          ? "bg-primary text-white shadow-md"
                          : "bg-accent text-accent-foreground hover:bg-primary/20",
                      )}
                    >
                      {isSource ? "✓ Source" : "+ Source"}
                    </button>
                    <button
                      onClick={() => onToggleEtl(f)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                        isEtl
                          ? "bg-violet-500 text-white shadow-md"
                          : "bg-accent text-accent-foreground hover:bg-violet-500/20",
                      )}
                    >
                      {isEtl ? "✓ ETL" : "+ ETL"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Full file table ── */}
      <div className="surface-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Files available in uploaded package</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {files.length} entries
          </span>
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-elevated">
                {["Path", "Extension", "Size KB", "Parsed", "Note"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-muted-foreground font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {files.map((f) => {
                const Icon = getFileIcon(f.extension);
                const isSource = selectedSources.some((s) => s.path === f.path);
                const isEtl = selectedEtls.some((e) => e.path === f.path);
                return (
                  <tr
                    key={f.path}
                    className={cn(
                      "transition-colors",
                      isSource ? "bg-primary/5" : isEtl ? "bg-violet-500/5" : "hover:bg-accent/10",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={cn(
                            "grid h-5 w-5 shrink-0 place-items-center rounded bg-gradient-to-br",
                            getFileColor(f.extension),
                          )}
                        >
                          <Icon className="h-2.5 w-2.5 text-white" />
                        </div>
                        <span className="font-mono truncate max-w-[240px] text-foreground">
                          {isSource && <span className="text-primary font-bold mr-1">[SRC]</span>}
                          {isEtl && <span className="text-violet-500 font-bold mr-1">[ETL]</span>}
                          {f.path}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "font-mono px-2 py-0.5 rounded-full text-[10px] font-semibold text-white bg-gradient-to-r",
                          getFileColor(f.extension),
                        )}
                      >
                        {f.extension}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{f.sizeKb}</td>
                    <td className="px-4 py-2.5">
                      {f.parsedAsText ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="inline-block h-3 w-3 rounded-full bg-muted border border-border" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground/60 italic">
                      {!f.parsedAsText ? "Binary — retained in inventory" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
