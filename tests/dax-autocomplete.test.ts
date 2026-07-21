import { describe, expect, it } from "vitest";
import {
  applyDaxCompletion,
  getDaxCompletions,
  type DaxCompletionCatalog,
} from "../src/lib/migration/dax/DaxAutocomplete";

const catalog: DaxCompletionCatalog = {
  tables: [
    { name: "Sales", columns: ["SalesAmount", "SalesDate", "CustomerID"], measures: ["Sales Total"] },
    { name: "Calendar", columns: ["CalendarDate", "Currency"], measures: [] },
  ],
  variables: ["vTaxRate"],
};

describe("DAX autocomplete", () => {
  it("shows matching columns with their owning table for a plain prefix", () => {
    const result = getDaxCompletions("Total = S", 9, catalog);
    expect(result.items.some((item) => item.kind === "column" && item.name === "SalesAmount" && item.table === "Sales")).toBe(true);
  });

  it("limits qualified suggestions to the selected table", () => {
    const value = "Total = 'Calendar'[C";
    const result = getDaxCompletions(value, value.length, catalog);
    expect(result.items.map((item) => item.name)).toContain("Currency");
    expect(result.items.map((item) => item.name)).not.toContain("CustomerID");
  });

  it("inserts a fully-qualified column reference", () => {
    const value = "Total = S";
    const result = getDaxCompletions(value, value.length, catalog);
    const item = result.items.find((candidate) => candidate.name === "SalesAmount");
    expect(item).toBeDefined();
    const applied = applyDaxCompletion(value, result.context!, item!);
    expect(applied.value).toBe("Total = 'Sales'[SalesAmount]");
  });

  it("suggests reusable Qlik variable measures inside brackets", () => {
    const value = "Total = SUM('Sales'[SalesAmount]) * [v";
    const result = getDaxCompletions(value, value.length, catalog);
    expect(result.items.some((item) => item.kind === "variable" && item.name === "vTaxRate")).toBe(true);
  });
});
