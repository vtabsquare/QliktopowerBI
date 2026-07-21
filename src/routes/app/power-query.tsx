import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMigration } from "@/lib/migration/store";
import { AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
// Re-use the full TabMQueryDataTypes, TabFinalTables from EnterpriseAnalysisPanel internals
// by rendering the EnterpriseAnalysisPanel with a forced active tab prop
import { EnterprisePowerQueryPage } from "@/components/migration/EnterprisePowerQueryPage";
import { applyDataTypeOverrides } from "@/lib/migration/enterprise-parser";
import { RepairFocusNotice } from "@/components/migration/RepairFocusNotice";

export const Route = createFileRoute("/app/power-query")({
  component: PowerQueryPage,
});

function PowerQueryPage() {
  const navigate = useNavigate();
  const { enterpriseAnalysis, enterpriseColumnTypeEdits, setEnterpriseColumnTypeEdits, setEnterpriseAnalysis } = useMigration();

  if (!enterpriseAnalysis) {
    return (
      <div className="surface-card p-8 flex flex-col items-center text-center gap-4">
        <AlertCircle className="h-10 w-10 text-warning" />
        <div>
          <h3 className="font-display text-xl font-semibold">No Analysis Data</h3>
          <p className="text-sm text-muted-foreground mt-1">Please run the Enterprise Analysis first.</p>
        </div>
        <button onClick={() => navigate({ to: "/app/analysis" })} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
          <ArrowLeft className="h-4 w-4" /> Go to Analysis
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <RepairFocusNotice areas={["power-query", "data-types"]} />
      <EnterprisePowerQueryPage
        analysis={enterpriseAnalysis}
        columnTypeEdits={enterpriseColumnTypeEdits}
        onTypeChange={(k, v) => {
          const nextEdits = { ...enterpriseColumnTypeEdits, [k]: v };
          setEnterpriseColumnTypeEdits(nextEdits);
          setEnterpriseAnalysis(applyDataTypeOverrides(enterpriseAnalysis, nextEdits));
        }}
        onAnalysisUpdate={(a) => setEnterpriseAnalysis(a)}
      />
      <div className="flex justify-between items-center pt-2">
        <button onClick={() => navigate({ to: "/app/analysis" })} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-elevated">
          <ArrowLeft className="h-4 w-4" /> Back to Analysis
        </button>
        <button onClick={() => navigate({ to: "/app/dax-measures" })} className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg hover:opacity-90 transition-all">
          DAX Measures <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
