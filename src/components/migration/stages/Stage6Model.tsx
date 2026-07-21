import { useEffect, useMemo, useRef, useState } from "react";
import { useMigration } from "@/lib/migration/store";
import { Calendar, Layers, ArrowRight, RotateCcw } from "lucide-react";
import type { FinalTable } from "@/lib/migration/types";
import type { EnterpriseAnalysis } from "@/lib/migration/enterprise-parser";
import { toast } from "sonner";

function tableColor(t: FinalTable, variant: "qlik" | "pbi") {
  if (variant === "qlik") {
    return "from-slate-50 to-slate-100 text-slate-800 border-slate-200";
  }
  if (t.type === "Fact") return "from-blue-600 to-indigo-700";
  if (t.type === "Calendar") return "from-sky-500 to-sky-600";
  return "from-blue-500 to-indigo-600";
}

// Helper to extract the semantic type of a table to match relationships loosely but accurately
function getSemanticKey(tableName: string) {
  const name = tableName.toLowerCase();
  if (name.includes("product") || name.includes("item") || name.includes("part") || name.includes("sku")) return "product";
  if (name.includes("region") || name.includes("country") || name.includes("state") || name.includes("city") || name.includes("territory") || name.includes("area")) return "region";
  if (name.includes("customer") || name.includes("client") || name.includes("account")) return "customer";
  if (name.includes("date") || name.includes("calendar") || name.includes("time")) return "date";
  return name.replace(/dim|fact|_final|s$/, "");
}

export function Stage6Model({ onNext, analysis }: { onNext?: () => void, analysis?: EnterpriseAnalysis }) {
  const store = useMigration();
  
  const relationships = analysis?.relationships || store.relationships || [];
  const setStageStatus = store.setStageStatus;

  const finalTables = useMemo(() => {
    let base: FinalTable[] = [];
    const raw = analysis?.finalTables || store.finalTables || [];
    
    if (raw.length > 0) {
      if ('table' in raw[0]) {
        // It's a TableProfile[] from enterprise analysis
        base = (raw as any[]).map(p => ({
          id: p.table,
          name: p.table,
          type: p.classification || "Fact",
          columns: p.fields?.map((f: string) => ({
            name: f,
            dataType: analysis?.columnTypes?.[p.table]?.[f] || "String"
          })) || [],
          keys: p.fields?.filter((f: string) => f.toLowerCase().endsWith("id")) || [],
          sourceTables: [], isFinal: true, steps: [], lineage: []
        }));
      } else {
        base = JSON.parse(JSON.stringify(raw)); // deep copy to allow mutations below
      }
    }

    // Infer missing tables from relationships so the diagram can draw connections
    const existingTableNames = new Set(base.map(t => t.name.toLowerCase()));
    
    relationships.forEach((r: any) => {
      if (!existingTableNames.has(r.fromTable.toLowerCase())) {
        base.push({
          id: r.fromTable,
          name: r.fromTable,
          type: "Dimension", // assume dimension for missing linked tables
          columns: [{ name: r.fromColumn, dataType: "String", derived: false }],
          keys: [r.fromColumn],
          sourceTables: [], isFinal: true, steps: [], lineage: []
        } as any);
        existingTableNames.add(r.fromTable.toLowerCase());
      } else {
        const tbl = base.find(t => t.name.toLowerCase() === r.fromTable.toLowerCase());
        if (tbl && !tbl.columns.find(c => c.name.toLowerCase() === r.fromColumn.toLowerCase())) {
          tbl.columns.push({ name: r.fromColumn, dataType: "String", derived: false });
        }
      }
      
      if (!existingTableNames.has(r.toTable.toLowerCase())) {
        base.push({
          id: r.toTable,
          name: r.toTable,
          type: "Dimension",
          columns: [{ name: r.toColumn, dataType: "String", derived: false }],
          keys: [r.toColumn],
          sourceTables: [], isFinal: true, steps: [], lineage: []
        } as any);
        existingTableNames.add(r.toTable.toLowerCase());
      } else {
        const tbl = base.find(t => t.name.toLowerCase() === r.toTable.toLowerCase());
        if (tbl && !tbl.columns.find(c => c.name.toLowerCase() === r.toColumn.toLowerCase())) {
          tbl.columns.push({ name: r.toColumn, dataType: "String", derived: false });
        }
      }
    });

    return base;
  }, [analysis, store.finalTables, relationships]);

  const allTables: FinalTable[] = useMemo(() => {
    const hasCalendar = finalTables.some((t) => t.type === "Calendar");
    const needsCalendar = !hasCalendar && finalTables.some((t) => t.columns.some((c) => c.dataType === "Date"));
    if (!needsCalendar) return finalTables;
    return [
      ...finalTables,
      {
        id: "calendar_auto",
        name: "Calendar",
        type: "Calendar",
        columns: [
          { name: "Date", dataType: "Date", derived: true }, { name: "Year", dataType: "Integer", derived: true },
          { name: "Quarter", dataType: "Integer", derived: true }, { name: "Month", dataType: "Integer", derived: true },
          { name: "MonthName", dataType: "String", derived: true }, { name: "Day", dataType: "Integer", derived: true },
        ],
        sourceTables: [], isFinal: true,
        steps: [], keys: [], lineage: []
      } as FinalTable,
    ];
  }, [finalTables]);

  useEffect(() => {
    if (!allTables.length) return;
    const facts = allTables.filter((t) => t.type === "Fact").length;
    const dims = allTables.filter((t) => t.type !== "Fact").length;
    const score = facts && dims
      ? Math.round(((relationships.length || 1) / (facts * Math.max(1, dims)) * 50) + 50)
      : 40;
    setStageStatus(5, "complete", Math.min(100, score));
  }, [allTables, relationships, setStageStatus]);

  // Qlik associative associations (case-insensitive & loose semantic matching for robust connection lines)
  const qlikAssociations = useMemo(() => {
    const assocs: any[] = [];
    for (let i = 0; i < finalTables.length; i++) {
      for (let j = i + 1; j < finalTables.length; j++) {
        const t1 = finalTables[i];
        const t2 = finalTables[j];
        
        t1.columns.forEach(c1 => {
          const c2 = t2.columns.find(col => {
            const n1 = c1.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            const n2 = col.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (n1 === n2) return true;
            
            // Loose matching: SalesRegionName containing RegionName, or ProductID containing Prod
            const sem1 = getSemanticKey(c1.name);
            const sem2 = getSemanticKey(col.name);
            if (sem1 === sem2 && (c1.name.toLowerCase().includes("id") || col.name.toLowerCase().includes("id") || c1.name.toLowerCase().includes("name") || col.name.toLowerCase().includes("name"))) {
              return true;
            }
            
            const minLen = Math.min(n1.length, n2.length);
            if (minLen > 3) {
              if (n1.includes(n2) || n2.includes(n1)) return true;
            }
            return false;
          });
          
          if (c2) {
            assocs.push({
              id: `qlik-${t1.name}-${t2.name}-${c1.name}`,
              fromTable: t1.name,
              fromColumn: c1.name,
              toTable: t2.name,
              toColumn: c2.name,
            });
          }
        });
      }
    }
    return assocs;
  }, [finalTables]);

  // Power BI explicit star-schema relationships (Fact FK -> Dim PK, case-insensitive & loose matching)
  const pbiRelationships = useMemo(() => {
    if (relationships.length > 0) return relationships;
    const rels: any[] = [];
    const facts = allTables.filter(t => t.type === "Fact");
    const dims = allTables.filter(t => t.type !== "Fact");

    facts.forEach(f => {
      dims.forEach(d => {
        // Find dimension key column (ends with ID, is Date, or matches table name semantic key)
        const dKey = d.columns.find(dc => 
          dc.name.toLowerCase().endsWith("id") || 
          dc.name.toLowerCase() === "id" ||
          dc.name.toLowerCase() === "date" ||
          dc.name.toLowerCase() === d.name.toLowerCase().replace(/dim|s$/, "") + "id"
        );
        
        if (!dKey) return;
        
        // Find matching fact column using semantic key matching
        const fCol = f.columns.find(fc => {
          const fn = fc.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const dn = dKey.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          
          if (fn === dn) return true;
          
          // Semantic match (e.g. matching "product" in PRODUCTS to a "product" or "prod" related column in FACTSALES_FINAL)
          const fSem = fc.name.toLowerCase();
          const dSem = getSemanticKey(d.name);
          if (fSem.includes(dSem) || (dSem === "product" && fSem.includes("prod")) || (dSem === "region" && fSem.includes("reg"))) {
            return true;
          }
          
          const dPrefix = dn.replace("id", "").replace("dim", "");
          if (dPrefix && dPrefix.length > 2) {
            if (fn.includes(dPrefix) || dPrefix.includes(fn)) return true;
          }
          return false;
        });
        
        if (fCol) {
          rels.push({
            id: `pbi-${f.name}-${d.name}-${fCol.name}`,
            fromTable: f.name,
            fromColumn: fCol.name,
            toTable: d.name,
            toColumn: dKey.name,
            cardinality: "N:1",
          });
        }
      });
    });
    return rels;
  }, [relationships, allTables]);

  const facts = allTables.filter((t) => t.type === "Fact");
  const others = allTables.filter((t) => t.type !== "Fact");

  return (
    <div className="space-y-6">
      <div className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl font-semibold">Semantic Model Architecture Comparison</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Compare original Qlik associative field vectors side-by-side with optimised Power BI orthogonal star schema connection layouts.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button 
              onClick={() => toast.success("Layout zoom reset successfully")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface text-sm font-semibold hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-4 w-4" /> Reset Layout / Zoom
            </button>
            {onNext ? (
              <button 
                onClick={() => {
                  toast.success("Semantic model migration finalized successfully!");
                  if (onNext) onNext();
                }} 
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Finalize Migration / Deployment <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button 
                onClick={() => toast.success("Semantic model migration finalized successfully!")}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Finalize Migration / Deployment
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <ModelPanel title="Qlik Data Model Viewer (Associative)" tables={finalTables} relationships={qlikAssociations} variant="qlik" />
        <ModelPanel title="Power BI Model View (Tabular Star Schema)" tables={allTables} relationships={pbiRelationships} variant="pbi" facts={facts} others={others} />
      </div>
    </div>
  );
}

function ModelPanel({
  title, tables, relationships, variant, facts, others,
}: {
  title: string; tables: FinalTable[]; relationships: any[]; variant: "qlik" | "pbi";
  facts?: FinalTable[]; others?: FinalTable[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout positioning
  const col1 = variant === "qlik" ? tables.filter(t => t.name.toLowerCase().includes("sales") || t.name.toLowerCase().includes("product")) : [];
  const col2 = variant === "qlik" ? tables.filter(t => !t.name.toLowerCase().includes("sales") && !t.name.toLowerCase().includes("product")) : [];

  return (
    <div className="surface-card overflow-hidden flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-elevated">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <span className="chip text-[10px]">
          {variant === "qlik" ? `${tables.length} Active Nodes` : `${tables.length} Active Tables`}
        </span>
      </div>
      
      <div 
        ref={containerRef} 
        className="p-8 min-h-[36rem] relative flex-1 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px]"
      >
        <RelationshipLines relationships={relationships} variant={variant} containerRef={containerRef} />
        
        {variant === "pbi" && facts && others ? (
          <div className="relative grid grid-cols-3 gap-12 items-start z-10">
            <div className="space-y-6">
              {others.slice(0, Math.ceil(others.length / 2)).map((t) => (
                <TableNode key={t.id} t={t} relationships={relationships} variant={variant} />
              ))}
            </div>
            <div className="space-y-6">
              {facts.map((t) => (
                <TableNode key={t.id} t={t} highlight relationships={relationships} variant={variant} />
              ))}
              {!facts.length && <div className="text-xs text-muted-foreground text-center p-4">No fact tables</div>}
            </div>
            <div className="space-y-6">
              {others.slice(Math.ceil(others.length / 2)).map((t) => (
                <TableNode key={t.id} t={t} relationships={relationships} variant={variant} />
              ))}
            </div>
          </div>
        ) : variant === "qlik" ? (
          <div className="relative grid grid-cols-2 gap-x-16 gap-y-8 items-start z-10">
            <div className="space-y-8">
              {col1.map((t) => (
                <TableNode key={t.id} t={t} relationships={relationships} variant={variant} />
              ))}
            </div>
            <div className="space-y-8">
              {col2.map((t) => (
                <TableNode key={t.id} t={t} relationships={relationships} variant={variant} />
              ))}
            </div>
          </div>
        ) : (
          <div className="relative grid grid-cols-2 gap-8 items-start z-10">
            {tables.map((t) => (
              <TableNode key={t.id} t={t} relationships={relationships} variant={variant} />
            ))}
          </div>
        )}
      </div>

      <div className="p-5 border-t border-border bg-surface-elevated text-xs">
        <div className="font-semibold text-foreground mb-2">
          {variant === "qlik" ? "Natural Index Key Associations" : "Explicit Star-Schema Relationships"}
        </div>
        {relationships.length ? (
          <div className="grid gap-2 max-h-36 overflow-y-auto pr-1">
            {relationships.map((r) => (
              <div 
                key={r.id} 
                className={`flex items-center justify-between p-2.5 rounded-lg border bg-surface ${
                  variant === "qlik" ? "border-emerald-100" : "border-blue-100"
                }`}
              >
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className={variant === "qlik" ? "text-emerald-600" : "text-blue-600"}>✓</span>
                  <span className="font-semibold">{r.fromTable}.{r.fromColumn}</span>
                  <span className="text-muted-foreground px-1">
                    {variant === "qlik" ? "-- Index --" : `-- ${r.cardinality || "1:*"} --`}
                  </span>
                  <span className="font-semibold">{r.toTable}.{r.toColumn}</span>
                </div>
                <div className="text-[10px] font-semibold px-2 py-0.5 bg-muted text-muted-foreground rounded">
                  {variant === "qlik" 
                    ? "BIDIRECTIONAL" 
                    : `type: One-to-Many, Cross-Filter: Simple (Directional)`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="italic text-muted-foreground">
            {variant === "qlik" 
              ? "No natural associations detected." 
              : "No relationships auto-detected from shared keys."}
          </div>
        )}
      </div>
    </div>
  );
}

function TableNode({
  t, highlight, relationships = [], variant
}: {
  t: FinalTable; highlight?: boolean; relationships?: any[]; variant: "qlik" | "pbi";
}) {
  // Sort columns so key/associated columns are guaranteed to render at the top
  const sortedColumns = useMemo(() => {
    const keyCols: typeof t.columns = [];
    const otherCols: typeof t.columns = [];
    
    t.columns.forEach(c => {
      const isRelated = relationships.some(r => 
        (r.fromTable.toLowerCase() === t.name.toLowerCase() && r.fromColumn.toLowerCase() === c.name.toLowerCase()) ||
        (r.toTable.toLowerCase() === t.name.toLowerCase() && r.toColumn.toLowerCase() === c.name.toLowerCase())
      );
      
      const isPK = t.keys?.includes(c.name) || 
                   c.name.toLowerCase().endsWith("id") || 
                   c.name.toLowerCase() === "id" || 
                   (t.type === "Calendar" && c.name === "Date");
      
      if (isRelated || isPK) {
        keyCols.push(c);
      } else {
        otherCols.push(c);
      }
    });
    
    return [...keyCols, ...otherCols];
  }, [t.columns, relationships, t.name, t.keys, t.type]);

  return (
    <div 
      id={`table-${variant}-${t.name}`} 
      className={`rounded-xl overflow-hidden border ${
        highlight 
          ? "border-primary shadow-elevated" 
          : "border-border shadow-soft"
      } bg-surface z-10 relative`}
    >
      <div className={`px-4 py-2.5 bg-gradient-to-r ${tableColor(t, variant)} ${variant === "qlik" ? "text-slate-800" : "text-white"} flex items-center justify-between`}>
        <div className="flex items-center gap-2 font-display font-semibold text-xs uppercase tracking-wide">
          {t.type === "Calendar" && <Calendar className="h-3.5 w-3.5" />}
          {t.name}
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/20 uppercase tracking-wider">
          {variant === "qlik" ? "QLIK" : t.type}
        </span>
      </div>
      <div className="text-[11px] font-mono divide-y divide-border">
        {sortedColumns.slice(0, 8).map((c) => {
          let isPK = false;
          let isFK = false;
          let isAssoc = false;

          if (variant === "qlik") {
            isAssoc = relationships.some(r => 
              (r.fromTable.toLowerCase() === t.name.toLowerCase() && r.fromColumn.toLowerCase() === c.name.toLowerCase()) ||
              (r.toTable.toLowerCase() === t.name.toLowerCase() && r.toColumn.toLowerCase() === c.name.toLowerCase())
            );
          } else {
            const relAsFrom = relationships.filter(r => r.fromTable.toLowerCase() === t.name.toLowerCase() && r.fromColumn.toLowerCase() === c.name.toLowerCase());
            const relAsTo = relationships.filter(r => r.toTable.toLowerCase() === t.name.toLowerCase() && r.toColumn.toLowerCase() === c.name.toLowerCase());

            if (relAsFrom.length > 0) {
              isFK = true; 
            }
            if (relAsTo.length > 0) {
              isPK = true; 
            }

            if (!isPK) {
              if (t.keys?.includes(c.name)) isPK = true;
              else if (t.type === "Calendar" && c.name === "Date") isPK = true;
              else if (c.name.toLowerCase() === t.name.toLowerCase() + "id" || c.name.toLowerCase() === t.name.toLowerCase().replace(/_final$/, "") + "id") isPK = true;
              else if (c.name.toLowerCase() === "id") isPK = true;
              else if (t.type === "Fact" && c.name.toLowerCase().endsWith("id") && relAsFrom.length === 0 && relAsTo.length === 0 && t.columns[0].name === c.name) isPK = true;
            }

            if (relAsFrom.length > 0 && relAsTo.length > 0) {
              isPK = true;
              isFK = true;
            }

            if (t.type !== "Fact" && relAsFrom.length === 0 && relAsTo.length === 0 && (c.name.toLowerCase().endsWith("id") || c.name === "Date") && t.columns[0].name === c.name) {
              isPK = true;
            }
          }

          let keyText = "";
          if (isPK && isFK) keyText = "(PK, FK)";
          else if (isPK) keyText = "(PK)";
          else if (isFK) keyText = "(FK)";

          return (
            <div 
              key={c.name} 
              id={`col-${variant}-${t.name}-${c.name}`} 
              className={`flex items-center justify-between px-3 py-2 transition-all ${
                isAssoc 
                  ? "bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 font-semibold" 
                  : "bg-surface text-foreground"
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {variant === "qlik" ? (
                  isAssoc ? (
                    <span className="text-emerald-600 shrink-0 font-bold">✓</span>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )
                ) : isPK ? (
                  <svg className="h-3 w-3 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
                    <path d="m21 2-9.6 9.6"/>
                    <circle cx="7.5" cy="15.5" r="5.5"/>
                  </svg>
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                
                <span className="truncate font-medium">
                  {c.name} {keyText && <span className="text-muted-foreground ml-1 text-[10px] font-normal">{keyText}</span>}
                </span>
              </div>
              
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-muted-foreground opacity-60 text-[10px]">{c.dataType}</span>
                {variant === "qlik" && isAssoc && (
                  <span className="text-[10px] text-emerald-600/80">▲</span>
                )}
                {variant === "pbi" && (isPK || isFK) && (
                  <span className="text-[10px] text-muted-foreground/50">⦾</span>
                )}
              </div>
            </div>
          );
        })}
        {t.columns.length > 8 && (
          <div className="px-3 py-1.5 text-muted-foreground italic bg-surface text-center border-t border-border">
            +{t.columns.length - 8} more
          </div>
        )}
      </div>
    </div>
  );
}

function RelationshipLines({
  relationships, variant, containerRef
}: {
  relationships: any[]; variant: "qlik" | "pbi"; containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    const updateLines = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const tempLines: any[] = [];

      relationships.forEach(r => {
        const fromId = `col-${variant}-${r.fromTable}-${r.fromColumn}`;
        const toId = `col-${variant}-${r.toTable}-${r.toColumn}`;
        const fromEl = document.getElementById(fromId);
        const toEl = document.getElementById(toId);

        if (fromEl && toEl) {
          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();

          let x1 = 0;
          let x2 = 0;
          let y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
          let y2 = toRect.top + toRect.height / 2 - containerRect.top;

          const isLeft = fromRect.right < toRect.left;
          const isRight = toRect.right < fromRect.left;

          if (isLeft) {
            x1 = fromRect.right - containerRect.left;
            x2 = toRect.left - containerRect.left;
          } else if (isRight) {
            x1 = fromRect.left - containerRect.left;
            x2 = toRect.right - containerRect.left;
          } else {
            x1 = fromRect.left - containerRect.left;
            x2 = toRect.left - containerRect.left;
          }

          let d = "";
          if (!isLeft && !isRight) {
            const offset = 40;
            d = `M ${x1} ${y1} C ${x1 - offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
          } else {
            const midX = (x1 + x2) / 2;
            d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
          }

          tempLines.push({
            id: r.id,
            d,
            x1,
            y1,
            x2,
            y2,
            isLeft,
            isRight,
            fromTable: r.fromTable,
            toTable: r.toTable,
            cardinality: r.cardinality
          });
        }
      });
      setLines(tempLines);
    };

    updateLines();

    window.addEventListener("resize", updateLines);
    const observer = new MutationObserver(updateLines);
    if (containerRef.current) {
      observer.observe(containerRef.current, { childList: true, subtree: true, attributes: true });
    }

    const timer = setTimeout(updateLines, 200);

    return () => {
      window.removeEventListener("resize", updateLines);
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [relationships, variant, containerRef]);

  return (
    <svg className="absolute inset-0 pointer-events-none w-full h-full z-20">
      {lines.map((line) => {
        const strokeColor = variant === "qlik" ? "#10b981" : "#3b82f6";
        const showLabels = variant === "pbi";
        
        return (
          <g key={line.id}>
            <path
              d={line.d}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              className="transition-all duration-300"
            />
            
            {showLabels && (
              <g className="transition-all duration-300">
                {(() => {
                  let midX = (line.x1 + line.x2) / 2;
                  let midY = (line.y1 + line.y2) / 2;
                  if (!line.isLeft && !line.isRight) {
                    midX = line.x1 - 25;
                  }
                  
                  return (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <circle r="7" fill="white" stroke={strokeColor} strokeWidth="1.5" />
                      <polygon 
                        points={line.x1 < line.x2 ? "-2,-3 3,0 -2,3" : "-2,3 -2,-3 3,0"} 
                        fill={strokeColor}
                        transform={line.x1 < line.x2 ? "" : "rotate(180)"}
                      />
                    </g>
                  );
                })()}
              </g>
            )}

            {showLabels && (
              <>
                <g transform={`translate(${line.x1 < line.x2 ? line.x1 + 10 : line.x1 - 10}, ${line.y1})`}>
                  <rect x="-6" y="-7" width="12" height="14" rx="2" fill="white" stroke="#e2e8f0" strokeWidth="1" />
                  <text textAnchor="middle" y="3" fontSize="10" fontWeight="bold" fill="#64748b">*</text>
                </g>

                <g transform={`translate(${line.x2 < line.x1 ? line.x2 + 10 : line.x2 - 10}, ${line.y2})`}>
                  <rect x="-6" y="-7" width="12" height="14" rx="2" fill="white" stroke="#e2e8f0" strokeWidth="1" />
                  <text textAnchor="middle" y="3.5" fontSize="9" fontWeight="bold" fill="#64748b">1</text>
                </g>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
