import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  Layers,
  FileCode2,
  Database,
  ArrowDownToLine,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ServerCog,
  Wand2,
  FileBox,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden selection:bg-primary/20">
      {/* Background gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-50">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px]" />
      </div>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center min-h-[90vh] px-6 text-center pt-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Next-Gen Migration Engine
          </div>

          <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[1.1] mb-6">
            Migrate{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-700">
              Qlik
            </span>{" "}
            to{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-600">
              Power BI
            </span>{" "}
            faster than ever.
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed">
            Automate the heavy lifting of extracting scripts, analyzing data models, and generating
            optimized Power Query (M) & DAX.
          </p>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate({ to: "/app/instructions" })}
            className="group relative inline-flex items-center gap-3 px-8 py-4 bg-primary text-primary-foreground rounded-2xl font-bold text-lg overflow-hidden shadow-2xl shadow-primary/20 transition-all hover:shadow-primary/40"
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <span className="relative z-10">Next: Launch Migration Engine</span>
            <ArrowRight className="relative z-10 h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </motion.button>
        </motion.div>
      </section>

      {/* Architecture Flow */}
      <section className="relative z-10 py-24 px-6 bg-surface-elevated/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <SectionTitle
            title="Architecture Flow"
            subtitle="How the AI Migration Engine works end-to-end"
          />

          <div className="grid md:grid-cols-5 gap-6 mt-16">
            <ArchitectureStep
              delay={0.1}
              icon={<FileBox className="h-6 w-6" />}
              title="1. Upload & Extract"
              desc="Upload Qlik project files (QVS, QVW, QVF, ZIP). Extracts and inventories scripts and metadata."
            />
            <ArchitectureStep
              delay={0.2}
              icon={<FileCode2 className="h-6 w-6" />}
              title="2. Script Analysis"
              desc="Parse Qlik scripts (LOAD, RESIDENT, JOIN, MAPPING) to build the complete data flow."
            />
            <ArchitectureStep
              delay={0.3}
              icon={<Database className="h-6 w-6" />}
              title="3. Model Discovery"
              desc="Detect source files, connectors, keys, and complete data lineage."
            />
            <ArchitectureStep
              delay={0.4}
              icon={<Wand2 className="h-6 w-6" />}
              title="4. PBI Conversion"
              desc="Generate optimized Power Query (M), DAX measures, and semantic model."
            />
            <ArchitectureStep
              delay={0.5}
              icon={<ArrowDownToLine className="h-6 w-6" />}
              title="5. Validate & Export"
              desc="Validate issues and export a PBIP project for further development."
            />
          </div>
        </div>
      </section>

      {/* Achievements & Capabilities */}
      <section className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <SectionTitle
            title="Achievements"
            subtitle="What the engine successfully automates today"
          />

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
            <AchievementCard
              title="Automatic Extraction"
              desc="Upload QVS, QVF, QVW, and ZIP projects seamlessly."
            />
            <AchievementCard
              title="Dynamic Parsing"
              desc="Understands LOAD, RESIDENT, JOIN, CONCATENATE, MAPPING, INLINE & STORE."
            />
            <AchievementCard
              title="Source Detection"
              desc="Auto-detects source files, connectors, tables, columns, and field aliases."
            />
            <AchievementCard
              title="Complete Lineage"
              desc="Traces data from raw files through all transformations to final output."
            />
            <AchievementCard
              title="Smart Filtering"
              desc="Identifies final business tables; excludes temporary, mapping, and dropped tables."
            />
            <AchievementCard
              title="Data Model Building"
              desc="Detects relationships and keys for the Power BI star-schema data model."
            />
            <AchievementCard
              title="Power Query (M)"
              desc="Generates full M code with transformation logic and datatype handling."
            />
            <AchievementCard
              title="DAX & Semantic Model"
              desc="Generates DAX measures and semantic metadata for Power BI."
            />
            <AchievementCard
              title="Validation & Export"
              desc="Provides readiness reports and exports migration artifacts (PBIP-ready)."
            />
          </div>
        </div>
      </section>

      {/* Current Limitations */}
      <section className="relative z-10 py-24 px-6 bg-red-500/5 border-y border-red-500/10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-4">
            <ShieldAlert className="h-8 w-8 text-red-500" />
            <h2 className="text-3xl md:text-4xl font-bold">Current Limitations</h2>
          </div>
          <p className="text-center text-muted-foreground mb-12">
            While powerful, the engine requires human review for highly complex or proprietary edge
            cases.
          </p>

          <div className="space-y-4">
            <LimitationItem text="Cannot guarantee 100% automatic conversion of every Qlik feature, custom connector, macro, or proprietary extension." />
            <LimitationItem text="Does not recreate Qlik dashboards with pixel-perfect visual formatting inside Power BI." />
            <LimitationItem text="Unsupported or highly customized Qlik expressions may require manual review before conversion." />
            <LimitationItem text="Cannot connect to secured databases, APIs, or enterprise systems without valid credentials or user-provided connection details." />
          </div>
        </div>
      </section>

      {/* User Guidance */}
      <section className="relative z-10 py-32 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <SectionTitle
            title="User Guidance"
            subtitle="Follow these steps once you launch the app"
          />

          <div className="mt-16 space-y-6 text-left">
            <GuideStep
              num={1}
              title="Upload Project"
              desc="Upload one or more QVS, QVF, QVW, or ZIP files containing the Qlik application."
            />
            <GuideStep
              num={2}
              title="Analyze Sources"
              desc="Review detected source files, connectors, tables, and update missing paths."
            />
            <GuideStep
              num={3}
              title="Review Data Model"
              desc="Inspect detected tables, columns, keys, relationships, and data lineage."
            />
            <GuideStep
              num={4}
              title="Generate Conversion"
              desc="Generate Power Query (M), DAX measures, semantic model, and validate."
            />
            <GuideStep
              num={5}
              title="Validate & Export"
              desc="Resolve validation issues, review the report, and export the PBIP project."
            />
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate({ to: "/app/instructions" })}
            className="mt-16 inline-flex items-center gap-2 px-8 py-4 bg-foreground text-background rounded-2xl font-bold text-lg hover:bg-foreground/90 transition-colors"
          >
            Launch Application <ArrowRight className="h-5 w-5" />
          </motion.button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 text-center text-sm text-muted-foreground border-t border-border relative z-10">
        <p>VTAB Square © {new Date().getFullYear()} — Qlik to Power BI Migration</p>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="text-center"
    >
      <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">{title}</h2>
      <p className="text-lg text-muted-foreground">{subtitle}</p>
    </motion.div>
  );
}

function ArchitectureStep({
  title,
  desc,
  icon,
  delay,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay }}
      className="relative flex flex-col items-center text-center group"
    >
      <div className="h-16 w-16 rounded-2xl bg-surface border border-border flex items-center justify-center text-primary shadow-sm group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all duration-300 mb-4 z-10 relative">
        {icon}
      </div>
      <h3 className="font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </motion.div>
  );
}

function AchievementCard({ title, desc }: { title: string; desc: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      whileHover={{ y: -5 }}
      className="p-6 rounded-2xl bg-surface border border-border shadow-sm hover:shadow-md transition-all"
    >
      <CheckCircle2 className="h-6 w-6 text-success mb-4" />
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </motion.div>
  );
}

function LimitationItem({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      className="flex gap-4 p-4 rounded-xl bg-background border border-red-500/20 shadow-sm"
    >
      <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
      <p className="text-foreground/90">{text}</p>
    </motion.div>
  );
}

function GuideStep({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="flex gap-6 items-start p-6 rounded-2xl bg-surface border border-border hover:border-primary/30 transition-colors group"
    >
      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-black text-xl border border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        {num}
      </div>
      <div>
        <h3 className="text-xl font-bold mb-2">{title}</h3>
        <p className="text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  );
}
