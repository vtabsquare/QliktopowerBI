// EnterpriseExportPage - used in /app/semantic-model dedicated route
import type { EnterpriseAnalysis } from "@/lib/migration/enterprise-parser";
import { TabSemanticModel, TabValidation, TabPbipExport } from "./EnterpriseAnalysisPanel";
import { Stage6Model } from "./stages/Stage6Model";
interface Props {
  analysis: EnterpriseAnalysis;
}

export function EnterpriseExportPage({ analysis }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <Stage6Model analysis={analysis} />
      </div>
      
      <div className="surface-card p-4">
        <TabSemanticModel analysis={analysis} />
      </div>
      <div className="surface-card p-4">
        <h3 className="font-display font-semibold text-lg text-foreground mb-1">Validation Report</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Pre-flight checks validating the generated solution before Power BI export.
        </p>
        <TabValidation analysis={analysis} />
      </div>
      <div className="surface-card p-4">
        <h3 className="font-display font-semibold text-lg text-foreground mb-1">PBIP Export</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Export the migration-ready Power BI PBIP project as a ZIP file.
        </p>
        <TabPbipExport analysis={analysis} />
      </div>
    </div>
  );
}
