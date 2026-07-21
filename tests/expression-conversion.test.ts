import { describe, expect, it } from "vitest";
import { ExpressionParser, ExpressionTokenizer } from "../src/lib/migration/expression";
import { DaxTranslator } from "../src/lib/migration/dax";

const context = {
  homeTable: "FactSales",
  fieldToTable: {
    sales: "FactSales",
    customerid: "FactSales",
    year: "Calendar",
    region: "DimRegion",
    orderdate: "FactSales",
    customer: "DimCustomer",
    month: "Calendar",
  },
  variables: {
    vSelectedYear: { definition: "2025", evaluatedValue: "2025", isCalculated: false },
    vStartDate: { definition: "DATE(2025,1,1)", isCalculated: true },
    vEndDate: { definition: "DATE(2025,12,31)", isCalculated: true },
  },
};

describe("Qlik expression parser", () => {
  it("tokenizes set analysis and variables as structured tokens", () => {
    const tokens = new ExpressionTokenizer().tokenize("Sum({<Year={$(vSelectedYear)}>} Sales)");
    expect(tokens.some((token) => token.kind === "set-analysis")).toBe(true);
    expect(tokens.some((token) => token.kind === "identifier" && token.value === "Sum")).toBe(true);
  });

  it("parses nested conditional aggregations", () => {
    const result = new ExpressionParser().parse("If(Sum(Sales) > 100000, 'High', 'Low')");
    expect(result.ast?.kind).toBe("function");
    expect(result.diagnostics.filter((item) => item.severity === "error")).toHaveLength(0);
  });
});

describe("Qlik to DAX translation", () => {
  const translator = new DaxTranslator();

  it("converts basic aggregation", () => {
    const result = translator.translate("Sum(Sales)", context);
    expect(result.dax).toContain("SUM('FactSales'[Sales])");
    expect(result.status).toBe("automatic");
  });

  it("converts distinct count", () => {
    const result = translator.translate("Count(DISTINCT CustomerID)", context);
    expect(result.dax).toContain("DISTINCTCOUNT");
  });

  it("converts set analysis to CALCULATE", () => {
    const result = translator.translate("Sum({<Year={$(vSelectedYear)}>} Sales)", context);
    expect(result.dax).toContain("CALCULATE");
    expect(result.dax).toContain("Calendar");
  });

  it("preserves unsupported inter-record functions as review items", () => {
    const result = translator.translate("RangeSum(Above(Sum(Sales), 0, RowNo()))", context);
    expect(["warning", "manual"]).toContain(result.status);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("converts common date formatting with an explicit review explanation", () => {
    const result = translator.translate("Date(OrderDate, 'yyyy-MM-dd')", context);
    expect(result.dax).toContain("FORMAT");
    expect(result.explanation.join(" ")).toContain("dual date value");
  });

  it("converts GetSelectedCount to VALUES row count", () => {
    const result = translator.translate("GetSelectedCount(Region)", context);
    expect(result.dax).toContain("COUNTROWS(VALUES");
  });
});
