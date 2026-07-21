import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/migration/AppHeader";
import { StageNav } from "@/components/migration/StageNav";
import { useMigration } from "@/lib/migration/store";
import { Outlet } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { FloatingWorkflowNav } from "@/components/migration/FloatingWorkflowNav";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "VTAB Square — Qlik to Power BI Migration" },
      { name: "description", content: "AI-assisted Qlik to Power BI migration." },
    ],
  }),
  component: AuthGuard,
});

function AuthGuard() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth" });
    }
  }, [session, loading, navigate]);

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="h-4 w-4 rounded-full bg-primary animate-pulse" />
      </div>
    );
  }

  return <MigrationLayout />;
}

function MigrationLayout() {
  const { enterpriseAnalysis } = useMigration();
  const tableCount = enterpriseAnalysis?.finalTables.length ?? 0;

  return (
    <div className="min-h-screen" id="app-top">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-6 pt-10 pb-20">
        <Hero tableCount={tableCount} />
        <StageNav />
        <Outlet />
        <FooterSteps />
      </main>
      <FloatingWorkflowNav />
    </div>
  );
}

function Hero({ tableCount }: { tableCount: number }) {
  return (
    <section className="mb-10">
      <span className="chip mb-6 text-primary">
        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
        AI MIGRATION ENGINE ACTIVE
      </span>
      <h1 className="font-display font-black text-6xl md:text-7xl tracking-tight leading-[0.95] mb-5">
        <span className="text-foreground">Qlik</span>
        <span className="mx-5 text-muted-foreground font-light">→</span>
        <span className="gradient-text">Power BI</span>
      </h1>
      <p className="text-muted-foreground max-w-2xl leading-relaxed">
        Enterprise-grade migration. Upload your Qlik scripts, run the analysis engine, and export a deployment-ready Power BI PBIP project.
      </p>
      <div className="grid grid-cols-3 gap-4 mt-8 max-w-2xl">
        <Metric icon="◎" value="100%" label="Conversion accuracy" />
        <Metric icon="⚡" value="10x" label="Faster than manual" />
        <Metric icon="❒" value={tableCount ? `${tableCount}` : "5"} label={tableCount ? "Final tables detected" : "Pipeline stages"} />
      </div>
    </section>
  );
}

function Metric({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="surface-card p-4 flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary text-lg">{icon}</div>
      <div className="leading-tight">
        <div className="font-display font-bold text-xl">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FooterSteps() {
  const steps = [
    { n: "01", k: "CAPTURE", title: "Requirement → Rule Book", body: "Capture business intent and auto-generate a Markdown Rule Book that drives the rest of the migration." },
    { n: "02", k: "CONVERT", title: "Script to Power Query M", body: "Source &amp; ETL QVS parsed, then Power Query produced only for the final surviving tables." },
    { n: "03", k: "DEPLOY", title: "Semantic Model &amp; DAX", body: "Star-schema model auto-built for review, then variables resolved and Set Analysis translated to DAX." },
  ];
  return (
    <section className="grid md:grid-cols-3 gap-px bg-border mt-16 rounded-2xl overflow-hidden border border-border">
      {steps.map((s) => (
        <div key={s.n} className="bg-background p-6">
          <div className="font-mono text-xs text-muted-foreground mb-3">{s.n} — {s.k}</div>
          <div className="font-display font-semibold text-lg mb-2" dangerouslySetInnerHTML={{ __html: s.title }} />
          <div className="text-sm text-muted-foreground leading-relaxed mb-4" dangerouslySetInnerHTML={{ __html: s.body }} />
          <div className="text-primary">→</div>
        </div>
      ))}
    </section>
  );
}

