import { useState } from "react";
import { useMigration } from "@/lib/migration/store";
import type { Requirement } from "@/lib/migration/types";
import { ArrowRight, ClipboardList } from "lucide-react";

const FIELDS: { key: keyof Requirement; label: string; placeholder: string; rows?: number; optional?: boolean }[] = [
  { key: "reportName", label: "Report Name", placeholder: "e.g. Sales Performance Dashboard" },
  { key: "businessObjective", label: "Business Objective", placeholder: "What is the goal of this report?", rows: 3 },
  { key: "businessRequirement", label: "Business Requirement", placeholder: "Describe the business need, KPIs, audience, frequency…", rows: 5 },
  { key: "sourceTableNames", label: "Source Table Names", placeholder: "Sales, Customers, Products (comma or newline separated)", rows: 2 },
  { key: "sourceColumnNames", label: "Source Column Names", placeholder: "OrderID, CustomerID, ProductID, Revenue, OrderDate…", rows: 3 },
  { key: "expectedOutput", label: "Expected Output", placeholder: "List the expected measures, slicers, totals…", rows: 3 },
  { key: "sampleData", label: "Sample / Dummy Data", placeholder: "Optional — paste a CSV/sample rows", rows: 4, optional: true },
];

export function Stage1Requirement({ onNext }: { onNext: () => void }) {
  const { requirement, setRequirement, setStageStatus } = useMigration();
  const [form, setForm] = useState<Requirement>(
    requirement ?? {
      reportName: "", businessRequirement: "", businessObjective: "",
      sourceTableNames: "", sourceColumnNames: "", sampleData: "", expectedOutput: "",
    },
  );

  const required: (keyof Requirement)[] = ["reportName", "businessObjective", "businessRequirement", "sourceTableNames", "sourceColumnNames", "expectedOutput"];
  const filled = required.filter((k) => form[k]?.trim()).length;
  const accuracy = Math.round((filled / required.length) * 100);
  const canSubmit = filled === required.length;

  const save = () => {
    setRequirement(form);
    setStageStatus(1, "complete", accuracy);
    onNext();
  };

  const loadSample = () => {
    setForm({
      reportName: "Sales Performance Dashboard",
      businessObjective: "Provide regional sales leaders with daily visibility into revenue, margin and YoY growth.",
      businessRequirement: "Track revenue, units and average order value by region, category and product. Compare against prior year and YTD targets. Refresh daily.",
      sourceTableNames: "Sales\nCustomers\nProducts",
      sourceColumnNames: "OrderID, CustomerID, ProductID, OrderDate, Quantity, Revenue, Cost\nCustomerName, Country, Segment\nProductName, Category, Price",
      sampleData: "OrderID,CustomerID,Revenue,OrderDate\n1001,42,250.00,2024-01-12",
      expectedOutput: "Total Revenue, Revenue YTD, Revenue PY, Units sold, Avg Order Value — by Region/Category/Month.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="surface-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-xl font-semibold">Capture the business requirement</h3>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The AI engine uses this to build the Rule Book and seed the migration metadata. No Power Query, DAX or model is generated in this stage.
              </p>
            </div>
          </div>
          <button onClick={loadSample} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
            → Load sample
          </button>
        </div>
      </div>

      <div className="surface-card p-6 grid md:grid-cols-2 gap-5">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.rows && f.rows > 2 ? "md:col-span-2" : ""}>
            <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
              {f.label} {f.optional && <span className="text-muted-foreground/60 normal-case">(optional)</span>}
            </label>
            {f.rows ? (
              <textarea
                rows={f.rows}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full text-sm px-3 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:border-primary"
              />
            ) : (
              <input
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full text-sm px-3 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:border-primary"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between surface-card p-4">
        <div className="text-xs text-muted-foreground">
          {filled} of {required.length} required fields filled • {accuracy}% complete
        </div>
        <button
          onClick={save}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40"
        >
          Generate Rule Book <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
