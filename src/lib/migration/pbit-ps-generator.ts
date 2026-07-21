import { EnterpriseAnalysis } from "./enterprise-parser";

/**
 * Generates a PowerShell script (.ps1) that, when run by the user,
 * creates a valid Power BI Template (.pbit) file on their machine.
 *
 * Why PowerShell instead of direct browser PBIT generation?
 * Power BI Desktop validates PBIT ZIP files using specific OPC requirements
 * that JSZip cannot reliably replicate. Using .NET's System.IO.Compression
 * (via PowerShell) creates a ZIP that Power BI Desktop accepts.
 *
 * The script uses:
 *   - System.IO.Compression.ZipArchive with DEFLATE compression
 *   - System.Text.Encoding.Unicode for UTF-16 LE file content
 *   - Proper _rels/.rels OPC relationship manifest
 *   - DataMashup ZIP-in-ZIP with all M queries in Section1.m
 */
export function generatePbitScript(
  analysis: EnterpriseAnalysis,
  projectName: string = "QLIK2PBI_Migration_Project"
): string {
  const mQueriesMap: Record<string, string> = analysis.mQueries || {};
  const smTablesMap = new Map((analysis.semanticModel?.tables || []).map((t: any) => [t.name, t]));
  const typeCols = analysis.columnTypes || {};
  const allMeasures = analysis.daxMeasures || [];
  const relationships = analysis.semanticModel?.relationships || [];

  const tables = Object.keys(mQueriesMap).map((tName: string) => {
    const mQuery = mQueriesMap[tName];
    const smTable: any = smTablesMap.get(tName);
    
    let columns;
    if (smTable && smTable.columns) {
      columns = smTable.columns.map((c: any) => {
        const col: any = { name: c.name, dataType: mapDT(c.data_type || c.dataType || "string"), sourceColumn: c.name };
        if (c.formatString) col.formatString = c.formatString;
        return col;
      });
    } else {
      const tCols = typeCols[tName];
      if (tCols && Object.keys(tCols).length > 0) {
        columns = Object.keys(tCols).map(colName => ({
          name: colName,
          dataType: mapDT(tCols[colName]),
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
        expression: m.expression || "",
        ...(m.formatString ? { formatString: m.formatString } : {})
      }));
    } else {
      const tMeasures = allMeasures.filter((m: any) => m.table === tName);
      measures = tMeasures.map((m: any) => ({
        name: m.measureName,
        expression: m.dax || ""
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

  const tmslRelationships = relationships.map((r: any) => ({
    name: `${r.fromTable}_${r.fromColumn}_to_${r.toTable}_${r.toColumn}`,
    fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn,
    crossFilteringBehavior: r.direction === "Both" ? "bothDirections" : "oneDirection",
    joinOnDateBehavior: "datePartOnly", isActive: r.active !== false
  }));

  const schema = {
    name: projectName,
    compatibilityLevel: 1550,
    model: {
      culture: "en-US",
      dataAccessOptions: { legacyRedirects: true, returnErrorValuesAsNull: true },
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      tables,
      relationships: tmslRelationships,
      annotations: [{ name: "PBI_QueryOrder", value: JSON.stringify(tables.map((t: any) => t.name)) }]
    }
  };
  const schemaJson = JSON.stringify(schema, null, 2).replace(/'/g, "''"); // escape single quotes for PS

  // ── Build Section1.m M query file content ─────────────────────────────
  const sectionLines = ["section Section1;", ""];
  for (const [tbl, mq] of Object.entries(mQueriesMap)) {
    sectionLines.push(`shared #"${tbl}" =`);
    sectionLines.push(mq.trim() + ";");
    sectionLines.push("");
  }
  const section1m = sectionLines.join("\r\n").replace(/'/g, "''");

  // ── Build Report/Layout JSON ───────────────────────────────────────────
  const layout = JSON.stringify({
    id: 0,
    resourcePackages: [],
    sections: [{
      id: 0,
      name: "ReportSection",
      displayName: "Page 1",
      filters: "[]",
      ordinal: 0,
      visualContainers: [],
      config: JSON.stringify({ layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: 1280, height: 720 } }] }),
      displayOption: 1,
      height: 720,
      width: 1280,
      layoutOptimization: 0
    }],
    config: JSON.stringify({ version: "5.55", themeCollection: { baseTheme: { name: "CY24SU02", version: "5.55", type: "SharedResources" } }, activeSectionIndex: 0 }),
    layoutOptimization: 0
  }, null, 2).replace(/'/g, "''");

  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");

  // ── Generate the PowerShell script ────────────────────────────────────
  return `# ═══════════════════════════════════════════════════════════════════════════════
# Qlik-Shine Bridge — Power BI Template Generator
# Generated on: ${new Date().toISOString()}
#
# HOW TO USE:
#   Right-click this file → "Run with PowerShell"
#   The .pbit file will be created in your Downloads folder.
#   Then double-click the .pbit to open it in Power BI Desktop.
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectName = '${safeName}'
$outPath     = Join-Path ([Environment]::GetFolderPath('UserProfile')) "Downloads\\$projectName.pbit"
$enc16       = [System.Text.Encoding]::Unicode   # UTF-16 LE
$enc8        = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "Qlik-Shine Bridge — Generating Power BI Template..." -ForegroundColor Cyan
Write-Host ""

# ── File content ──────────────────────────────────────────────────────────────

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/DataMashup" ContentType="application/octet-stream" /><Override PartName="/DataModelSchema" ContentType="application/json;charset=utf-16le" /><Override PartName="/DiagramLayout" ContentType="application/json;charset=utf-16le" /><Override PartName="/Report/Layout" ContentType="application/json;charset=utf-16le" /><Override PartName="/Report/LinguisticSchema" ContentType="application/json;charset=utf-16le" /><Override PartName="/Settings" ContentType="application/json;charset=utf-16le" /><Override PartName="/Metadata" ContentType="application/json;charset=utf-16le" /><Override PartName="/SecurityBindings" ContentType="application/octet-stream" /><Override PartName="/Version" ContentType="application/octet-stream" /></Types>
'@

$relsContent = @'
<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/DataMashup" Target="/DataMashup" Id="rId1" /><Relationship Type="http://schemas.microsoft.com/DataModelSchema" Target="/DataModelSchema" Id="rId2" /><Relationship Type="http://schemas.microsoft.com/DiagramLayout" Target="/DiagramLayout" Id="rId3" /><Relationship Type="http://schemas.microsoft.com/ReportLayout" Target="/Report/Layout" Id="rId4" /><Relationship Type="http://schemas.microsoft.com/ReportMetadata" Target="/Metadata" Id="rId5" /><Relationship Type="http://schemas.microsoft.com/ReportSettings" Target="/Settings" Id="rId6" /><Relationship Type="http://schemas.microsoft.com/ReportVersion" Target="/Version" Id="rId7" /><Relationship Type="http://schemas.microsoft.com/SecurityBindings" Target="/SecurityBindings" Id="rId8" /></Relationships>
'@

$dataModelSchema = @'
${schemaJson}
'@

$reportLayout = @'
${layout}
'@

$section1m = @'
${section1m}
'@

$diagramLayout    = '{"version":"0","diagrams":[]}'
$metadata         = '{"version":"3.0","cultures":[{"name":"en-US"}]}'
$settings         = '{"Version":3,"QueryGroups":[],"parameterQueries":[],"reportConnections":[],"slowDataSourceSettings":{}}'
$linguisticSchema = '{"Version":"1.0.0","Language":"en-US","DynamicImprovement":"HighConfidence","Entities":[]}'

# ── Build DataMashup inner ZIP (contains M queries) ───────────────────────────
$mashupStream = New-Object System.IO.MemoryStream
$mashupArchive = New-Object System.IO.Compression.ZipArchive($mashupStream, [System.IO.Compression.ZipArchiveMode]::Create, $true)

$mashupCT = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /><Override PartName="/Formulas/Section1.m" ContentType="application/x-ms-powerquery" /><Override PartName="/Config/Package.json" ContentType="application/json" /></Types>'
$e = $mashupArchive.CreateEntry('[Content_Types].xml', [System.IO.Compression.CompressionLevel]::Fastest)
$w = New-Object System.IO.StreamWriter($e.Open())
$w.Write($mashupCT); $w.Close()

$e = $mashupArchive.CreateEntry('Formulas/Section1.m', [System.IO.Compression.CompressionLevel]::Fastest)
$w = New-Object System.IO.StreamWriter($e.Open(), [System.Text.Encoding]::UTF8)
$w.Write($section1m); $w.Close()

$pkgJson = '{"AllowedValues":[],"IsParameterQuery":false,"IsParameterQueryRequired":false,"IsDirectQuery":false}'
$e = $mashupArchive.CreateEntry('Config/Package.json', [System.IO.Compression.CompressionLevel]::Fastest)
$w = New-Object System.IO.StreamWriter($e.Open())
$w.Write($pkgJson); $w.Close()

$mashupArchive.Dispose()
$mashupBytes = $mashupStream.ToArray()
$mashupStream.Dispose()

# ── Build outer PBIT ZIP ──────────────────────────────────────────────────────
$pbitStream  = New-Object System.IO.MemoryStream
$pbitArchive = New-Object System.IO.Compression.ZipArchive($pbitStream, [System.IO.Compression.ZipArchiveMode]::Create, $true)

function Add-Utf8Entry {
  param($archive, $entryName, $content)
  $e = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Fastest)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
  $s = $e.Open(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
}

function Add-Utf16Entry {
  param($archive, $entryName, $content)
  $e = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Fastest)
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($content)
  $s = $e.Open(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
}

function Add-BinaryEntry {
  param($archive, $entryName, $bytes)
  $e = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::NoCompression)
  $s = $e.Open(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
}

Add-Utf8Entry   $pbitArchive '[Content_Types].xml'       $contentTypes
Add-Utf8Entry   $pbitArchive '_rels/.rels'               $relsContent
Add-Utf8Entry   $pbitArchive 'Version'                   '3.0'
Add-BinaryEntry $pbitArchive 'SecurityBindings'          (New-Object byte[] 0)
Add-BinaryEntry $pbitArchive 'DataMashup'                $mashupBytes
Add-Utf16Entry  $pbitArchive 'Settings'                  $settings
Add-Utf16Entry  $pbitArchive 'Metadata'                  $metadata
Add-Utf16Entry  $pbitArchive 'DiagramLayout'             $diagramLayout
Add-Utf16Entry  $pbitArchive 'DataModelSchema'           $dataModelSchema
Add-Utf16Entry  $pbitArchive 'Report/Layout'             $reportLayout
Add-Utf16Entry  $pbitArchive 'Report/LinguisticSchema'   $linguisticSchema

$pbitArchive.Dispose()

[System.IO.File]::WriteAllBytes($outPath, $pbitStream.ToArray())
$pbitStream.Dispose()

Write-Host "✅ Done! File created:" -ForegroundColor Green
Write-Host "   $outPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "Double-click the .pbit file to open it in Power BI Desktop." -ForegroundColor Cyan
Write-Host "All M Queries and DAX measures are pre-loaded." -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Enter to close..." -ForegroundColor Gray
[void][System.Console]::ReadLine()
`;
}

function mapDT(raw: string): string {
  const t = (raw || "").toLowerCase();
  if (t.includes("int")) return "int64";
  if (t.includes("decimal") || t.includes("float") || t.includes("double") || t.includes("numeric")) return "double";
  if (t.includes("datetime") || (t.includes("date") && t.includes("time"))) return "dateTime";
  if (t.includes("date")) return "dateTime";
  if (t.includes("bool")) return "boolean";
  if (t.includes("currency") || t.includes("money")) return "decimal";
  return "string";
}
