import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MapPin, MousePointerClick, X } from "lucide-react";
import { repairDomId, type RepairArea } from "@/lib/migration/autofix";
import { useMigration } from "@/lib/migration/store";

function openParents(element: HTMLElement): void {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    if (current instanceof HTMLDetailsElement) current.open = true;
    current = current.parentElement;
  }
}

function focusEditor(element: HTMLElement): void {
  const preferred = element.matches("select,textarea,input,[contenteditable='true'],button")
    ? element
    : element.querySelector<HTMLElement>("[data-repair-editor], textarea, select, input, [contenteditable='true'], button");
  if (!preferred) return;
  preferred.focus({ preventScroll: true });
  if (preferred instanceof HTMLTextAreaElement || preferred instanceof HTMLInputElement) {
    const end = preferred.value.length;
    preferred.setSelectionRange?.(end, end);
  }
}

export function RepairFocusNotice({ areas }: { areas: RepairArea[] }) {
  const navigate = useNavigate();
  const { repairFocus, setRepairFocus } = useMigration();
  const active = repairFocus && areas.includes(repairFocus.area) ? repairFocus : null;

  useEffect(() => {
    if (!active) return;
    let attempts = 0;
    let cancelled = false;
    const locate = () => {
      if (cancelled) return;
      const ids = [
        repairDomId(active.area, active.objectName, active.objectId),
        active.tableName && active.fieldName ? repairDomId(active.area, `${active.tableName}.${active.fieldName}`) : "",
        active.objectId ? repairDomId(active.area, undefined, active.objectId) : "",
      ].filter(Boolean);
      const element = ids.map((id) => document.getElementById(id)).find(Boolean)
        || document.querySelector<HTMLElement>(`[data-repair-id="${CSS.escape(String(active.objectId || ""))}"]`)
        || document.querySelector<HTMLElement>(`[data-repair-object="${CSS.escape(String(active.objectName || ""))}"]`)
        || (active.tableName && active.fieldName
          ? document.querySelector<HTMLElement>(`[data-repair-table="${CSS.escape(active.tableName)}"][data-repair-field="${CSS.escape(active.fieldName)}"]`)
          : null);
      if (element) {
        openParents(element);
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        element.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        window.setTimeout(() => {
          focusEditor(element);
          element.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        }, 350);
        return;
      }
      attempts += 1;
      if (attempts < 30) window.setTimeout(locate, 180);
    };
    window.setTimeout(locate, 120);
    return () => { cancelled = true; };
  }, [active]);

  if (!active) return null;
  return (
    <div className="sticky top-2 z-40 mb-4 rounded-xl border border-primary/30 bg-background/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><MapPin className="h-4 w-4" /></span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span>Exact fix location</span>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">{active.objectKind || active.area.replace(/-/g, " ")}</span>
            <span>{active.objectName || active.area.replace(/-/g, " ")}</span>
          </div>
          {(active.tableName || active.fieldName) && <div className="mt-1 font-mono text-[11px] text-primary">Target: {active.tableName || "table"}[{active.fieldName || "field"}]</div>}
          <div className="mt-1 text-[11px] text-muted-foreground">The exact editor is highlighted and focused below. Make the correction, save it, then return to Auto-Fix; the resolved card will be removed after revalidation.</div>
          {active.message && <div className="mt-1 text-[11px] text-foreground/80">{active.message}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => navigate({ to: "/app/semantic-model" })} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted"><ArrowLeft className="h-3.5 w-3.5" />Auto-Fix</button>
          <button onClick={() => setRepairFocus(null)} className="rounded-lg p-2 hover:bg-muted" title="Close fix guidance"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-[10px] text-primary"><MousePointerClick className="h-3.5 w-3.5" />The highlighted control is ready for editing.</div>
    </div>
  );
}
