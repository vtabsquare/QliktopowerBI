import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FolderTree,
  Info,
  LayoutDashboard,
  PackageCheck,
  ServerCog,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/app/instructions")({
  component: InstructionsPage,
});

const mandatory = [
  {
    title: "QVW project definition folder",
    examples:
      "<ApplicationName>-prj/ with QlikViewProject.xml, DocProperties.xml, DocInternals.xml, TopLayout.xml and object XML files",
    reason:
      "This is the machine-readable source for sheets, charts, dimensions, measures, variables, actions, triggers, bookmarks, layout and document properties.",
    icon: FolderTree,
  },
  {
    title: "Load script",
    examples: "LoadScript.txt and/or all referenced .qvs files",
    reason:
      "Required to reconstruct the ETL sequence, variables, connections, tables, joins, QVD lineage and calculated fields.",
    icon: FileCode2,
  },
  {
    title: "Sheet and object XML files",
    examples:
      "SH*.xml, CH*.xml, LB*.xml, TX*.xml, BU*.xml, IB*.xml, SL*.xml, CT*.xml and extension-object XML",
    reason:
      "Required to identify the actual visual design, object placement, expressions, sort rules, number formats and actions.",
    icon: LayoutDashboard,
  },
];

const recommended = [
  [
    "Original QVW",
    "Keep the .qvw in the package as the original audit artifact and for optional Windows extraction.",
  ],
  [
    "Source connection inventory",
    "Provide server, database, schema, file paths, connector type and replacement Power BI parameters. Never include passwords in the ZIP.",
  ],
  [
    "Document property files",
    "AllProperties.xml, DocProperties.xml and DocInternals.xml improve variables, bookmarks, alternate states, triggers and security analysis.",
  ],
];

const optional = [
  [
    "Sample QVD/source files",
    "Useful for preview, data-type inference and row-count reconciliation.",
  ],
  [
    "Dashboard screenshots/PDF",
    "Useful for visual comparison, especially for custom extensions, fonts and colours.",
  ],
  [
    "Business requirement document",
    "Useful for validating KPI meaning, expected interactions and acceptance criteria.",
  ],
  [
    "NPrinting / extension assets",
    "Include extension names, configuration files and any dependent images or JavaScript where permitted.",
  ],
  [
    "Bookmarks exported from server",
    "Personal or server bookmarks may not be fully present in a local QVW project folder.",
  ],
];

function InstructionsPage() {
  return (
    <div className="space-y-8">
      <section className="surface-card overflow-hidden">
        <div className="p-7 md:p-9 bg-gradient-to-br from-primary/10 via-background to-violet-500/10 border-b border-border">
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white shadow-lg shrink-0">
              <PackageCheck className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-primary mb-2">
                Before you upload
              </div>
              <h2 className="font-display text-3xl font-bold">
                Prepare a complete QlikView migration package
              </h2>
              <p className="text-muted-foreground mt-3 max-w-4xl leading-relaxed">
                A QVW is a binary document. The browser application retains it, but complete
                visualization extraction requires the associated QlikView project (PRJ) XML/TXT
                files. Upload the original QVW and its generated{" "}
                <span className="font-mono text-foreground">-prj</span> folder together whenever
                possible.
              </p>
            </div>
            <Link
              to="/app"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:opacity-90"
            >
              Continue to Upload <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-px bg-border">
          <div className="bg-background p-7">
            <div className="flex items-center gap-2 font-semibold mb-4">
              <ServerCog className="h-5 w-5 text-primary" /> Supported extraction modes
            </div>
            <div className="space-y-4">
              <ModeCard
                title="Mode A — QVW + PRJ folder"
                status="Recommended"
                description="Upload the QVW and the complete <ApplicationName>-prj folder as one ZIP or one folder. This enables the best available document, visual and script analysis."
              />
              <ModeCard
                title="Mode B — PRJ folder only"
                status="Supported"
                description="Use this when policy prevents uploading the QVW. Visual and script metadata can still be analysed from the exported project files."
              />
              <ModeCard
                title="Mode C — Single QVS file"
                status="Fully supported for ETL conversion"
                description="Upload one .qvs file directly. The application analyses the same script for source extraction, variables, resident loads, joins, final tables, DAX candidates, Power Query and PBIP generation. A second script is not required."
              />
              <ModeCard
                title="Mode D — QVW only"
                status="Not enough for browser extraction"
                description="The file remains in inventory, but the application will show a blocking diagnostic until PRJ files are supplied or the Windows extraction utility is used."
                warning
              />
            </div>
          </div>

          <div className="bg-background p-7">
            <div className="flex items-center gap-2 font-semibold mb-4">
              <ShieldCheck className="h-5 w-5 text-emerald-500" /> Security preparation
            </div>
            <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              <p>
                Remove credentials, tokens, certificates and personal data before uploading. Replace
                secrets with placeholders such as{" "}
                <span className="font-mono text-foreground">&lt;SQL_PASSWORD&gt;</span>.
              </p>
              <p>
                Include connection names, server/database/schema and required gateway type, but do
                not include passwords.
              </p>
              <p>
                Where Section Access is used, include only the script definition needed for
                migration assessment and mask user identifiers when required.
              </p>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3 text-amber-600">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="text-xs">
                  Macros and custom extensions are extracted for assessment, but they are normally
                  classified for manual Power BI or Power Automate redesign.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card border border-emerald-500/25 bg-emerald-500/5 p-6">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600"><FileCode2 className="h-5 w-5" /></div>
          <div>
            <h3 className="font-display text-xl font-semibold">Minimum input: one QVS file</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              For load-script migration, a single <span className="font-mono text-foreground">.qvs</span> file is sufficient. It is processed end-to-end for source logic, transformations, variables, final tables, Power Query, DAX, relationships and PBIP. QVW/PRJ files are additional requirements only when visual objects, sheets, bookmarks and actions must also be migrated.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-red-500">
              Scope-dependent requirements
            </div>
            <h3 className="font-display text-2xl font-bold mt-1">
              Additional files for complete QVW visual analysis
            </h3>
          </div>
          <span className="rounded-full border border-red-500/30 bg-red-500/5 px-3 py-1 text-xs font-medium text-red-500">
            3 requirement groups
          </span>
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {mandatory.map((item) => (
            <div key={item.title} className="surface-card p-6 border-t-4 border-t-red-500/70">
              <item.icon className="h-6 w-6 text-red-500 mb-4" />
              <h4 className="font-semibold text-lg">{item.title}</h4>
              <div className="font-mono text-xs text-primary mt-3 break-words">{item.examples}</div>
              <p className="text-sm text-muted-foreground mt-4 leading-relaxed">{item.reason}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="surface-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <CheckCircle2 className="h-5 w-5 text-amber-500" />
            <h3 className="font-display text-xl font-semibold">Recommended files</h3>
          </div>
          <div className="space-y-4">
            {recommended.map(([title, body]) => (
              <RequirementRow key={title} title={title} body={body} tone="recommended" />
            ))}
          </div>
        </div>
        <div className="surface-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Info className="h-5 w-5 text-sky-500" />
            <h3 className="font-display text-xl font-semibold">Optional supporting files</h3>
          </div>
          <div className="space-y-4">
            {optional.map(([title, body]) => (
              <RequirementRow key={title} title={title} body={body} tone="optional" />
            ))}
          </div>
        </div>
      </section>

      <section className="surface-card p-7">
        <div className="grid lg:grid-cols-[1fr_0.8fr] gap-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileArchive className="h-5 w-5 text-primary" />
              <h3 className="font-display text-xl font-semibold">Expected ZIP/folder structure</h3>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-5 text-xs leading-6 text-slate-200 border border-slate-800">{`SalesDashboard_Migration/
├── SalesDashboard.qvw
├── SalesDashboard-prj/
│   ├── QlikViewProject.xml
│   ├── AllProperties.xml
│   ├── DocProperties.xml
│   ├── DocInternals.xml
│   ├── TopLayout.xml
│   ├── LoadScript.txt
│   ├── Module.txt
│   ├── SH01.xml
│   ├── CH01.xml
│   ├── LB01.xml
│   ├── BU01.xml
│   └── ...
├── scripts/
│   └── included_script.qvs
├── source-connections.template.csv
├── screenshots/
│   └── ExecutiveDashboard.png
└── business-requirements.md`}</pre>
          </div>
          <div className="space-y-4">
            <h3 className="font-display text-xl font-semibold">Preparation utilities</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The package includes a Windows PowerShell helper. It creates the expected{" "}
              <span className="font-mono text-foreground">-prj</span> folder next to the QVW and
              asks QlikView Desktop to save the project definition.
            </p>
            <a
              href="/tools/qvw-extract-prj.ps1"
              download
              className="flex items-center justify-between rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Download className="h-5 w-5 text-primary" />
                <div>
                  <div className="font-semibold text-sm">Windows PRJ extraction helper</div>
                  <div className="text-xs text-muted-foreground">qvw-extract-prj.ps1</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/templates/sample-qvw-prj-package.zip"
              download
              className="flex items-center justify-between rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileArchive className="h-5 w-5 text-fuchsia-500" />
                <div>
                  <div className="font-semibold text-sm">Sample QVW PRJ test package</div>
                  <div className="text-xs text-muted-foreground">
                    Upload this ZIP to validate the new analysis page
                  </div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/templates/source-connections.template.csv"
              download
              className="flex items-center justify-between rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
                <div>
                  <div className="font-semibold text-sm">Source connection template</div>
                  <div className="text-xs text-muted-foreground">CSV without passwords</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/templates/business-requirements.template.md"
              download
              className="flex items-center justify-between rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileImage className="h-5 w-5 text-violet-500" />
                <div>
                  <div className="font-semibold text-sm">Migration requirement template</div>
                  <div className="text-xs text-muted-foreground">
                    Business intent and acceptance criteria
                  </div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function ModeCard({
  title,
  status,
  description,
  warning = false,
}: {
  title: string;
  status: string;
  description: string;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${warning ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-surface"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-sm">{title}</div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${warning ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary"}`}
        >
          {status}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{description}</p>
    </div>
  );
}

function RequirementRow({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "recommended" | "optional";
}) {
  return (
    <div className="flex gap-3">
      <span
        className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${tone === "recommended" ? "bg-amber-500" : "bg-sky-500"}`}
      />
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
