import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Columns3, FunctionSquare, Table2, Variable } from "lucide-react";
import {
  applyDaxCompletion,
  getDaxCompletions,
  type DaxCompletionCatalog,
  type DaxCompletionItem,
} from "@/lib/migration/dax/DaxAutocomplete";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  catalog: DaxCompletionCatalog;
  autoFocus?: boolean;
  ariaLabel: string;
}

function CompletionIcon({ item }: { item: DaxCompletionItem }) {
  if (item.kind === "column") return <Columns3 className="h-4 w-4 text-sky-500" />;
  if (item.kind === "measure") return <FunctionSquare className="h-4 w-4 text-violet-500" />;
  if (item.kind === "variable") return <Variable className="h-4 w-4 text-amber-500" />;
  return <Table2 className="h-4 w-4 text-emerald-500" />;
}

export function DaxCodeEditor({ id, value, onChange, catalog, autoFocus, ariaLabel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const completion = useMemo(() => getDaxCompletions(value, cursor, catalog), [value, cursor, catalog]);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => {
      ref.current?.focus();
      const end = ref.current?.value.length || 0;
      ref.current?.setSelectionRange(end, end);
      setCursor(end);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [autoFocus, id]);

  useEffect(() => {
    if (!completion.items.length) setOpen(false);
    setActiveIndex(0);
  }, [completion.context?.query, completion.items.length]);

  const updateCursor = () => {
    const next = ref.current?.selectionStart || 0;
    setCursor(next);
    setOpen(Boolean(getDaxCompletions(ref.current?.value || value, next, catalog).items.length));
  };

  const choose = (item: DaxCompletionItem) => {
    if (!completion.context) return;
    const applied = applyDaxCompletion(value, completion.context, item);
    onChange(applied.value);
    setOpen(false);
    window.requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(applied.cursor, applied.cursor);
      setCursor(applied.cursor);
    });
  };

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Braces className="h-3.5 w-3.5" />DAX editor with table, column, measure and variable autocomplete</span>
        <span>Type a name, <kbd className="rounded border px-1">[</kbd>, or <kbd className="rounded border px-1">'Table'[</kbd></span>
      </div>
      <textarea
        ref={ref}
        id={id}
        value={value}
        aria-label={ariaLabel}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
          const next = event.target.selectionStart || event.target.value.length;
          setCursor(next);
          setOpen(true);
        }}
        onClick={updateCursor}
        onKeyUp={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
          updateCursor();
        }}
        onKeyDown={(event) => {
          if (!open || !completion.items.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % completion.items.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + completion.items.length) % completion.items.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            choose(completion.items[activeIndex]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onFocus={updateCursor}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
        className="min-h-[170px] w-full resize-y rounded-xl border border-slate-700 bg-[#0B1120] p-4 font-mono text-xs leading-6 text-slate-50 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      />

      {open && completion.items.length > 0 && (
        <div className="absolute left-2 right-2 top-[calc(100%-8px)] z-50 max-h-72 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Suggestions for “{completion.context?.query || "all objects"}”
          </div>
          {completion.items.map((item, index) => (
            <button
              type="button"
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                index === activeIndex ? "bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              <CompletionIcon item={item} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs font-semibold">{item.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{item.detail}</span>
              </span>
              {item.table && <span className="max-w-44 truncate rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">{item.table}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
