import { describe, expect, it } from "vitest";
import { autoAssignSourceAndEtl, type ExtractedFile } from "../src/components/migration/MultiFileDropzone";

const qvs: ExtractedFile = {
  path: "Migration.qvs",
  name: "Migration.qvs",
  extension: ".qvs",
  sizeKb: 2,
  parsedAsText: true,
  text: "Sales: LOAD CustomerID, Amount FROM [sales.csv]; SalesFinal: LOAD CustomerID, Sum(Amount) AS Total RESIDENT Sales GROUP BY CustomerID;",
};

describe("single QVS mode", () => {
  it("assigns one QVS to both source and ETL roles", () => {
    const assigned = autoAssignSourceAndEtl([qvs]);
    expect(assigned.sources).toHaveLength(1);
    expect(assigned.etls).toHaveLength(1);
    expect(assigned.sources[0].path).toBe(qvs.path);
    expect(assigned.etls[0].path).toBe(qvs.path);
  });
});
