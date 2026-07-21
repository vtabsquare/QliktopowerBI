import type { ExtractedFile } from "@/components/migration/MultiFileDropzone";
import type { QvwPackageIntake, QvwPackageRequirement } from "./types";

const baseName = (path: string) => path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";

function matching(files: ExtractedFile[], predicate: (file: ExtractedFile) => boolean) {
  return files.filter(predicate).map((file) => file.path);
}

export function analyzeQvwPackageIntake(files: ExtractedFile[]): QvwPackageIntake {
  const qvwFiles = matching(files, (file) => file.extension.toLowerCase() === ".qvw");
  const qlikProject = matching(files, (file) => baseName(file.path) === "qlikviewproject.xml");
  const documentProperties = matching(files, (file) =>
    ["docproperties.xml", "allproperties.xml", "docinternals.xml"].includes(baseName(file.path)),
  );
  const topLayout = matching(files, (file) => baseName(file.path) === "toplayout.xml");
  const loadScript = matching(
    files,
    (file) => baseName(file.path) === "loadscript.txt" || file.extension.toLowerCase() === ".qvs",
  );
  const objectXml = matching(files, (file) => {
    const name = baseName(file.path);
    return (
      file.extension.toLowerCase() === ".xml" &&
      /^(sh|ch|lb|tx|bu|ib|sl|cs|mb|ct|tb|rp|sc|gu|pi|st|pv|ln|bc|cc|co|ext)[-_a-z0-9]*\.xml$/i.test(
        name,
      )
    );
  });
  const prjEvidence = [...qlikProject, ...documentProperties, ...topLayout, ...objectXml];
  const sourceData = matching(files, (file) =>
    [".qvd", ".qvx", ".csv", ".xlsx", ".xls", ".parquet", ".json", ".xml"].includes(
      file.extension.toLowerCase(),
    ),
  );
  const sourceManifest = matching(files, (file) =>
    /source[-_ ]?(connections?|inventory|manifest)|connection[-_ ]?details/i.test(file.path),
  );
  const requirementDocs = matching(files, (file) =>
    /requirement|rule[-_ ]?book|mapping[-_ ]?document|functional[-_ ]?spec/i.test(file.path),
  );
  const screenshots = matching(files, (file) =>
    [".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(file.extension.toLowerCase()),
  );

  const requirements: QvwPackageRequirement[] = [
    {
      id: "project-definition",
      label: "QVW project definition (PRJ XML/TXT files)",
      category: "mandatory",
      present: prjEvidence.length > 0,
      matchedFiles: prjEvidence,
      reason:
        "Required to extract sheets, visual objects, expressions, variables, actions, triggers, bookmarks and layout in a browser-safe way.",
    },
    {
      id: "load-script",
      label: "LoadScript.txt or QVS load scripts",
      category: "mandatory",
      present: loadScript.length > 0,
      matchedFiles: loadScript,
      reason:
        "Required to combine visual metadata with the ETL, variables, tables and source lineage.",
    },
    {
      id: "object-xml",
      label: "Sheet/object XML files",
      category: "mandatory",
      present: objectXml.length > 0,
      matchedFiles: objectXml,
      reason:
        "Required for visualization type, dimensions, measures, formatting, actions and object placement.",
    },
    {
      id: "qvw-artifact",
      label: "Original QVW file",
      category: "recommended",
      present: qvwFiles.length > 0,
      matchedFiles: qvwFiles,
      reason:
        "Retained as the original audit artifact and used by the optional Windows extraction utility.",
    },
    {
      id: "document-properties",
      label: "Document property XML files",
      category: "recommended",
      present: documentProperties.length > 0,
      matchedFiles: documentProperties,
      reason:
        "Improves extraction of document metadata, variables, bookmarks, alternate states and security settings.",
    },
    {
      id: "source-connections",
      label: "Source connection inventory",
      category: "recommended",
      present: sourceManifest.length > 0,
      matchedFiles: sourceManifest,
      reason:
        "Needed to replace Qlik connection strings, credentials and file paths with Power BI parameters.",
    },
    {
      id: "source-data",
      label: "Sample source/QVD files",
      category: "optional",
      present: sourceData.length > 0,
      matchedFiles: sourceData,
      reason: "Enables data previews, type inference and reconciliation testing.",
    },
    {
      id: "requirements",
      label: "Business requirement and mapping documents",
      category: "optional",
      present: requirementDocs.length > 0,
      matchedFiles: requirementDocs,
      reason: "Improves validation of business intent, measures and report behaviour.",
    },
    {
      id: "screenshots",
      label: "Original dashboard screenshots or PDFs",
      category: "optional",
      present: screenshots.length > 0,
      matchedFiles: screenshots,
      reason:
        "Supports visual comparison where exact fonts, colours or extension rendering are not available in project XML.",
    },
  ];

  const mandatory = requirements.filter((item) => item.category === "mandatory");
  const recommended = requirements.filter((item) => item.category === "recommended");
  const mandatoryComplete = mandatory.filter((item) => item.present).length;
  const recommendedComplete = recommended.filter((item) => item.present).length;
  const completenessScore = Math.round(
    ((mandatoryComplete * 2 + recommendedComplete) / (mandatory.length * 2 + recommended.length)) *
      100,
  );

  let mode: QvwPackageIntake["mode"] = "unknown";
  if (qvwFiles.length && prjEvidence.length) mode = "qvw-with-prj";
  else if (prjEvidence.length) mode = "prj-only";
  else if (qvwFiles.length) mode = "qvw-only";
  else if (loadScript.length) mode = "script-only";

  return {
    mode,
    completenessScore,
    readyForVisualizationAnalysis: objectXml.length > 0 && prjEvidence.length > 0,
    readyForFullMigration: mandatory.every((item) => item.present) && sourceManifest.length > 0,
    requirements,
    missingMandatory: mandatory.filter((item) => !item.present).map((item) => item.label),
    qvwFiles,
    projectFiles: files
      .filter(
        (file) =>
          file.parsedAsText && [".xml", ".txt", ".qvs"].includes(file.extension.toLowerCase()),
      )
      .map((file) => file.path),
  };
}
