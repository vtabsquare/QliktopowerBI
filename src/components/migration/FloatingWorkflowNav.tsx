import { useState } from "react";
import { ArrowUp, Check, Menu, X } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { STAGES } from "./StageNav";
import { useMigration } from "@/lib/migration/store";

export function FloatingWorkflowNav() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { enterpriseFiles, enterpriseAnalysis, qvwAnalysis, expressionInventory, powerBiModel } = useMigration();
  const ready = (stagePath: string) => {
    if (["/app/instructions", "/app"].includes(stagePath)) return true;
    if (stagePath === "/app/qvw-analysis") return enterpriseFiles.length > 0;
    if (stagePath === "/app/expression-conversion") return Boolean(qvwAnalysis || enterpriseAnalysis);
    if (stagePath === "/app/analysis") return enterpriseFiles.length > 0;
    if (["/app/power-query", "/app/dax-measures"].includes(stagePath)) return Boolean(enterpriseAnalysis);
    if (["/app/powerbi-model", "/app/relationships", "/app/semantic-model"].includes(stagePath)) return Boolean(powerBiModel || enterpriseAnalysis);
    return true;
  };
  return <>
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="h-11 px-4 rounded-full border border-border bg-background/95 shadow-xl flex items-center gap-2 text-sm font-medium hover:bg-muted" title="Go to top"><ArrowUp className="h-4 w-4" /> Top</button>
      <button onClick={() => setOpen((value) => !value)} className="h-11 px-4 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center gap-2 text-sm font-semibold" title="Go to migration menu">{open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} Menu</button>
    </div>
    {open && <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)}><aside className="absolute right-5 bottom-20 w-[340px] max-h-[70vh] overflow-auto rounded-2xl border border-border bg-background shadow-2xl p-4" onClick={(event) => event.stopPropagation()}>
      <div className="font-display font-semibold text-lg mb-1">Migration menu</div><p className="text-xs text-muted-foreground mb-4">Jump to any completed or available stage.</p>
      <div className="space-y-1">{STAGES.map((stage, index) => { const available = ready(stage.path); const active = path === stage.path || (path === "/app/" && stage.path === "/app"); return available ? <Link key={stage.id} to={stage.path} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><span className="grid h-7 w-7 place-items-center rounded-full border border-current/20">{active ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>{stage.label}</Link> : <div key={stage.id} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground opacity-50"><span className="grid h-7 w-7 place-items-center rounded-full border">{index + 1}</span>{stage.label}<span className="ml-auto text-[10px]">locked</span></div>; })}</div>
    </aside></div>}
  </>;
}
