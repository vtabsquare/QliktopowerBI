import { useRef, useState } from "react";
import { FileUp, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  accept: string;
  maxSizeMB?: number;
  onFile: (file: File, text: string) => void;
  label: string;
  description: string;
}

export function FileDropzone({ accept, maxSizeMB = 20, onFile, label, description }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handle = async (file: File) => {
    if (file.size > maxSizeMB * 1024 * 1024) return alert(`Max ${maxSizeMB} MB`);
    const text = await file.text();
    setFileName(file.name);
    onFile(file, text);
  };

  return (
    <div className="surface-card p-8">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
        Source Script
      </div>
      <h3 className="font-display text-2xl font-semibold mb-2">{label}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl mb-6">
        {description}
      </p>

      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handle(f);
        }}
        className={cn(
          "block rounded-2xl border-2 border-dashed transition-all px-6 py-12 text-center cursor-pointer",
          dragging ? "border-primary bg-accent/30" : "border-border bg-surface-elevated hover:border-primary/50"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])}
        />
        <div className="grid place-items-center h-14 w-14 rounded-xl bg-surface border border-border mx-auto mb-4 shadow-sm">
          <FileUp className="h-6 w-6 text-primary" />
        </div>
        <div className="font-semibold text-lg mb-1">
          {fileName ? fileName : "Drag and drop your file here"}
        </div>
        <div className="text-xs text-muted-foreground font-mono mb-5">
          Accepts {accept}  •  Max {maxSizeMB} MB per file
        </div>
        <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-medium">
          <Upload className="h-4 w-4" /> Browse files
        </span>
      </label>
    </div>
  );
}
