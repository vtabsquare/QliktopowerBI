import { Check } from "lucide-react";
import { useMigration } from "@/lib/migration/store";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";

export const STAGES = [
  { id: 0, label: "Instructions", path: "/app/instructions" },
  { id: 1, label: "Upload", path: "/app" },
  { id: 2, label: "QVW Analysis", path: "/app/qvw-analysis" },
  { id: 3, label: "Expression Conversion", path: "/app/expression-conversion" },
  { id: 4, label: "ETL Analysis", path: "/app/analysis" },
  { id: 5, label: "Power Query", path: "/app/power-query" },
  { id: 6, label: "DAX Measures", path: "/app/dax-measures" },
  { id: 7, label: "Power BI Model", path: "/app/powerbi-model" },
  { id: 8, label: "Relationships", path: "/app/relationships" },
  { id: 9, label: "Validation & Export", path: "/app/semantic-model" },
  { id: 10, label: "Logs", path: "/app/logs" },
] as const;

export function StageNav() {
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const { enterpriseAnalysis, enterpriseFiles, qvwAnalysis, expressionInventory, powerBiModel } = useMigration();

  const normalizedPath = currentPath === "/app/" ? "/app" : currentPath;
  const activeIndex = STAGES.findIndex((stage) => stage.path === normalizedPath);

  const isStageComplete = (stage: (typeof STAGES)[number], index: number) => {
    if (stage.path === "/app/instructions") return activeIndex > index;
    if (stage.path === "/app") return enterpriseFiles.length > 0 && activeIndex > index;
    if (stage.path === "/app/qvw-analysis")
      return Boolean(qvwAnalysis?.intake.readyForVisualizationAnalysis) && activeIndex > index;
    if (stage.path === "/app/expression-conversion") return Boolean(expressionInventory) && activeIndex > index;
    if (stage.path === "/app/analysis") return Boolean(enterpriseAnalysis) && activeIndex > index;
    if (stage.path === "/app/powerbi-model" || stage.path === "/app/relationships")
      return Boolean(powerBiModel) && activeIndex > index;
    return activeIndex > index;
  };

  return (
    <div id="migration-stage-menu" className="surface-card p-5 mb-8 overflow-hidden scroll-mt-24">
      <div className="flex items-center justify-between mb-5 gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Migration Pipeline
          </div>
          <div className="font-display text-lg font-semibold mt-0.5">
            {activeIndex >= 0 ? `Stage ${activeIndex + 1} of ${STAGES.length}` : "Migration Engine"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Status</div>
          <div className="font-display text-lg font-bold gradient-text">
            {enterpriseAnalysis
              ? `${enterpriseAnalysis.finalTables.length} Tables Ready`
              : qvwAnalysis
                ? `${qvwAnalysis.metrics.objectCount} QVW Objects`
                : enterpriseFiles.length
                  ? `${enterpriseFiles.length} Files Loaded`
                  : "Awaiting Package"}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="relative min-w-[1380px] px-2">
          <div className="absolute top-5 left-7 right-7 h-[2px] bg-border" />
          <div
            className="absolute top-5 left-7 h-[2px] bg-primary transition-all duration-500"
            style={{
              width:
                activeIndex > 0
                  ? `calc(${(activeIndex / (STAGES.length - 1)) * 100}% - 28px)`
                  : "0%",
            }}
          />
          <div className="relative flex justify-between">
            {STAGES.map((stage, index) => {
              const isActive = stage.path === normalizedPath;
              const isPast = isStageComplete(stage, index);
              const qvwOptional = stage.path === "/app/qvw-analysis" && !qvwAnalysis;

              return (
                <Link
                  key={stage.id}
                  to={stage.path}
                  className="flex flex-col items-center gap-2 group w-[112px]"
                >
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full grid place-items-center border-2 transition font-semibold text-sm bg-surface",
                      isPast && "bg-primary border-primary text-primary-foreground",
                      isActive && !isPast && "border-primary text-primary",
                      !isActive && !isPast && "border-border text-muted-foreground",
                    )}
                  >
                    {isPast ? <Check className="h-4 w-4" /> : stage.id + 1}
                  </div>
                  <div className="text-center">
                    <div
                      className={cn(
                        "text-[11px] font-medium leading-tight",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      {stage.label}
                    </div>
                    {qvwOptional && (
                      <div className="text-[9px] text-muted-foreground mt-1">
                        optional for QVS-only
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
