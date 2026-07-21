import JSZip from "jszip";
import { EnterpriseAnalysis } from "./enterprise-parser";

/**
 * Encodes a JS string as UTF-16 LE bytes (no BOM).
 */
function utf16le(str: string): Uint8Array {
  const buf = new ArrayBuffer(str.length * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < str.length; i++) {
    dv.setUint16(i * 2, str.charCodeAt(i), true);
  }
  return new Uint8Array(buf);
}

/**
 * Builds the DataMashup binary for Power Query.
 */
async function buildDataMashup(mQueries: Record<string, string>): Promise<Uint8Array> {
  const inner = new JSZip();

  inner.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml" />' +
    '<Override PartName="/Formulas/Section1.m" ContentType="application/x-ms-powerquery" />' +
    '<Override PartName="/Config/Package.json" ContentType="application/json" />' +
    "</Types>"
  );

  const tableNames = Object.keys(mQueries);
  const sectionLines: string[] = ["section Section1;", ""];
  for (const tbl of tableNames) {
    const mCode = mQueries[tbl] || `let\n    Source = "No M Query"\nin\n    Source`;
    sectionLines.push(`shared #"${tbl}" =`);
    sectionLines.push(mCode.trim() + ";");
    sectionLines.push("");
  }
  inner.file("Formulas/Section1.m", sectionLines.join("\r\n"));

  inner.file(
    "Config/Package.json",
    JSON.stringify({
      AllowedValues: [],
      IsParameterQuery: false,
      IsParameterQueryRequired: false,
      IsDirectQuery: false
    })
  );

  return await inner.generateAsync({
    type: "uint8array",
    compression: "STORE" // Crucial: Power BI rejects unknown deflate flags
  });
}

/**
 * Generates a valid Power BI Template (.pbix/.pbit) directly in the browser.
 * Uses STORE compression (no compression) because JSZip's DEFLATE 
 * headers are often rejected by Power BI Desktop's strict OPC parser.
 */
export async function generatePbixFile(
  analysis: EnterpriseAnalysis,
  projectName: string = "QLIK2PBI_Migration_Project"
): Promise<Blob> {
  const zip = new JSZip();

  const rels =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Type="http://schemas.microsoft.com/DataMashup" Target="/DataMashup" Id="rId1" />' +
    '<Relationship Type="http://schemas.microsoft.com/DataModelSchema" Target="/DataModelSchema" Id="rId2" />' +
    '<Relationship Type="http://schemas.microsoft.com/DiagramLayout" Target="/DiagramLayout" Id="rId3" />' +
    '<Relationship Type="http://schemas.microsoft.com/ReportLayout" Target="/Report/Layout" Id="rId4" />' +
    '<Relationship Type="http://schemas.microsoft.com/ReportMetadata" Target="/Metadata" Id="rId5" />' +
    '<Relationship Type="http://schemas.microsoft.com/ReportSettings" Target="/Settings" Id="rId6" />' +
    '<Relationship Type="http://schemas.microsoft.com/ReportVersion" Target="/Version" Id="rId7" />' +
    '<Relationship Type="http://schemas.microsoft.com/SecurityBindings" Target="/SecurityBindings" Id="rId8" />' +
    "</Relationships>";
  zip.file("_rels/.rels", rels);

  const contentTypes =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml" />' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />' +
    '<Override PartName="/DataMashup" ContentType="application/octet-stream" />' +
    '<Override PartName="/DataModelSchema" ContentType="application/json;charset=utf-16le" />' +
    '<Override PartName="/DiagramLayout" ContentType="application/json;charset=utf-16le" />' +
    '<Override PartName="/Report/Layout" ContentType="application/json;charset=utf-16le" />' +
    '<Override PartName="/Report/LinguisticSchema" ContentType="application/json;charset=utf-16le" />' +
    '<Override PartName="/Settings" ContentType="application/json;charset=utf-16le" />' +
    '<Override PartName="/Metadata" ContentType="application/json;charset=utf-16le" />' +
    '<Override PartName="/SecurityBindings" ContentType="application/octet-stream" />' +
    '<Override PartName="/Version" ContentType="application/octet-stream" />' +
    "</Types>";
  zip.file("[Content_Types].xml", contentTypes);

  zip.file("Version", "3.0");
  zip.file("SecurityBindings", new Uint8Array(0));

  zip.file("Settings", utf16le(JSON.stringify({
    Version: 3, QueryGroups: [], parameterQueries: [], reportConnections: [], slowDataSourceSettings: {}
  })));

  zip.file("Metadata", utf16le(JSON.stringify({
    version: "3.0", cultures: [{ name: "en-US" }]
  })));

  zip.file("DiagramLayout", utf16le(JSON.stringify({ version: "0", diagrams: [] })));

  zip.file("Report/LinguisticSchema", utf16le(JSON.stringify({
    Version: "1.0.0", Language: "en-US", DynamicImprovement: "HighConfidence", Entities: []
  })));

  const mQueriesMap: Record<string, string> = analysis.mQueries || {};
  const smTablesMap = new Map((analysis.semanticModel?.tables || []).map((t: any) => [t.name, t]));
  const typeCols = analysis.columnTypes || {};
  const allMeasures = analysis.daxMeasures || [];

  const tables = Object.keys(mQueriesMap).map((tName: string) => {
    const mQuery = mQueriesMap[tName];
    const smTable: any = smTablesMap.get(tName);
    
    let columns;
    if (smTable && smTable.columns) {
      columns = smTable.columns.map((c: any) => {
        const col: any = { name: c.name, dataType: mapDataType(c.data_type || c.dataType || "string"), sourceColumn: c.name };
        if (c.formatString) col.formatString = c.formatString;
        return col;
      });
    } else {
      const tCols = typeCols[tName];
      if (tCols && Object.keys(tCols).length > 0) {
        columns = Object.keys(tCols).map(colName => ({
          name: colName,
          dataType: mapDataType(tCols[colName]),
          sourceColumn: colName
        }));
      } else {
        const profile = analysis.profiles?.[tName];
        if (profile && profile.fields && profile.fields.length > 0) {
          columns = profile.fields.map((f: string) => ({
            name: f,
            dataType: "string",
            sourceColumn: f
          }));
        } else {
          columns = [{ name: "Column1", dataType: "string", sourceColumn: "Column1" }];
        }
      }
    }

    let measures;
    if (smTable && smTable.measures) {
      measures = smTable.measures.map((m: any) => ({
        name: m.name,
        expression: m.expression ? [m.expression] : [""],
        ...(m.formatString ? { formatString: m.formatString } : {})
      }));
    } else {
      const tMeasures = allMeasures.filter((m: any) => m.table === tName);
      measures = tMeasures.map((m: any) => ({
        name: m.measureName,
        expression: m.dax ? m.dax.split("\n") : [""]
      }));
    }

    const tableObj: any = {
      name: tName,
      columns: columns.length > 0 ? columns : [{ name: "Column1", dataType: "string", sourceColumn: "Column1" }],
      partitions: [{
        name: `${tName}-partition`,
        mode: "import",
        source: { type: "m", expression: mQuery.split("\n") }
      }]
    };
    if (measures && measures.length > 0) tableObj.measures = measures;
    return tableObj;
  });

  const relationships = (analysis.semanticModel?.relationships || []).map((r: any) => ({
    name: `${r.fromTable}_${r.fromColumn}_to_${r.toTable}_${r.toColumn}`,
    fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn,
    crossFilteringBehavior: r.direction === "Both" ? "bothDirections" : "oneDirection",
    joinOnDateBehavior: "datePartOnly", isActive: r.active !== false
  }));

  const tableNames = new Set(tables.map((t: any) => t.name));
  const expressions = [];
  for (const [name, query] of Object.entries(mQueriesMap)) {
    if (!tableNames.has(name)) {
      expressions.push({
        name,
        kind: "m",
        expression: query.split("\n")
      });
    }
  }

  const dataModelSchema = {
    name: projectName,
    compatibilityLevel: 1550,
    model: {
      culture: "en-US",
      dataAccessOptions: { legacyRedirects: true, returnErrorValuesAsNull: true },
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      tables,
      relationships,
      expressions,
      annotations: [{ name: "PBI_QueryOrder", value: JSON.stringify(tables.map((t: any) => t.name)) }]
    }
  };
  zip.file("DataModelSchema", utf16le(JSON.stringify(dataModelSchema)));

  const dataMashup = await buildDataMashup(mQueriesMap);
  zip.file("DataMashup", dataMashup);

  zip.file("Report/Layout", utf16le(JSON.stringify({
    id: 0, resourcePackages: [],
    sections: [{
      id: 0, name: "ReportSection", displayName: "Page 1", filters: "[]", ordinal: 0, visualContainers: [],
      config: JSON.stringify({ layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: 1280, height: 720 } }], singleVisualGroup: [] }),
      displayOption: 1, height: 720, width: 1280, defaultDisplayOption: 0, layoutOptimization: 0
    }],
    config: JSON.stringify({ version: "5.55", themeCollection: { baseTheme: { name: "CY24SU02", version: "5.55", type: "SharedResources" } }, activeSectionIndex: 0 }),
    layoutOptimization: 0
  })));

  // Use STORE compression (uncompressed) to bypass Power BI Desktop's strict ZIP parser issues
  return await zip.generateAsync({
    type: "blob",
    compression: "STORE"
  });
}

function mapDataType(raw: string): string {
  const t = (raw || "").toLowerCase();
  if (t.includes("int") || t.includes("integer")) return "int64";
  if (t.includes("decimal") || t.includes("float") || t.includes("double") || t.includes("numeric")) return "double";
  if (t.includes("datetime") || (t.includes("date") && t.includes("time"))) return "dateTime";
  if (t.includes("date")) return "dateTime";
  if (t.includes("bool")) return "boolean";
  if (t.includes("currency") || t.includes("money")) return "decimal";
  return "string";
}
