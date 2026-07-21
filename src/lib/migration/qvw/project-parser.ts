import type { ExtractedFile } from "@/components/migration/MultiFileDropzone";
import { analyzeQvwPackageIntake } from "./intake";
import type {
  QvwAction,
  QvwAnalysis,
  QvwBookmark,
  QvwDiagnostic,
  QvwDocumentMetadata,
  QvwExpression,
  QvwExtension,
  QvwLayout,
  QvwMacro,
  QvwMigrationStatus,
  QvwSheet,
  QvwTrigger,
  QvwVariable,
  QvwVisualizationObject,
} from "./types";

const basename = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;
const stem = (path: string) => basename(path).replace(/\.[^.]+$/, "");
const normalizedName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (value?: string | null) =>
  (value ?? "").split(String.fromCharCode(0)).join("").trim();

interface ParsedXmlFile {
  file: ExtractedFile;
  doc: Document;
  elements: Element[];
}

function parseXmlFiles(files: ExtractedFile[], diagnostics: QvwDiagnostic[]): ParsedXmlFile[] {
  const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  if (!parser) {
    diagnostics.push({
      severity: "error",
      code: "DOM_PARSER_UNAVAILABLE",
      message: "The XML parser is unavailable in this runtime.",
      recommendation: "Run QVW analysis from the browser UI rather than a server-only process.",
    });
    return [];
  }

  return files
    .filter((file) => file.extension.toLowerCase() === ".xml" && file.text)
    .flatMap((file) => {
      const doc = parser.parseFromString(file.text ?? "", "application/xml");
      const parseError = doc.querySelector("parsererror");
      if (parseError) {
        diagnostics.push({
          severity: "warning",
          code: "XML_PARSE_FAILED",
          message: `Could not parse ${file.path} as XML.`,
          file: file.path,
          recommendation: "Recreate the QlikView PRJ folder and upload the XML file again.",
        });
        return [];
      }
      return [{ file, doc, elements: Array.from(doc.getElementsByTagName("*")) }];
    });
}

function leafElements(root: ParentNode): Element[] {
  const all =
    root instanceof Document
      ? Array.from(root.getElementsByTagName("*"))
      : Array.from(root.querySelectorAll("*"));
  return all.filter(
    (element) => element.children.length === 0 && clean(element.textContent).length > 0,
  );
}

function findLeafValue(root: ParentNode, candidates: string[]): string | undefined {
  const wanted = new Set(candidates.map(normalizedName));
  const leaves = leafElements(root);
  const exact = leaves.find((element) => wanted.has(normalizedName(element.tagName)));
  return exact ? clean(exact.textContent) : undefined;
}

function findLeafValues(root: ParentNode, candidates: string[]): string[] {
  const wanted = new Set(candidates.map(normalizedName));
  return Array.from(
    new Set(
      leafElements(root)
        .filter((element) => wanted.has(normalizedName(element.tagName)))
        .map((element) => clean(element.textContent))
        .filter(Boolean),
    ),
  );
}

function collectProperties(root: ParentNode, limit = 160): Record<string, string> {
  const result: Record<string, string> = {};
  for (const element of leafElements(root).slice(0, limit)) {
    const key = element.tagName;
    const value = clean(element.textContent);
    if (!value || value.length > 2500) continue;
    if (!(key in result)) result[key] = value;
  }
  return result;
}

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBoolean(value?: string): boolean | undefined {
  if (!value) return undefined;
  if (/^(true|1|yes|-1)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  return undefined;
}

function extractLayout(root: ParentNode): QvwLayout {
  return {
    x: toNumber(findLeafValue(root, ["X", "Left", "PosX", "ObjectLeft"])),
    y: toNumber(findLeafValue(root, ["Y", "Top", "PosY", "ObjectTop"])),
    width: toNumber(findLeafValue(root, ["Width", "W", "ObjectWidth"])),
    height: toNumber(findLeafValue(root, ["Height", "H", "ObjectHeight"])),
    zIndex: toNumber(findLeafValue(root, ["Z", "ZOrder", "Layer", "ObjectLayer"])),
    minimized: toBoolean(findLeafValue(root, ["Minimized", "IsMinimized"])),
    hidden: toBoolean(findLeafValue(root, ["Hidden", "IsHidden", "ShowMode"])),
  };
}

function firstObjectId(root: ParentNode, fallback: string): string {
  return (
    findLeafValue(root, ["ObjectId", "ObjectID", "Id", "ID", "SheetObjectId", "SheetId"]) ||
    fallback
  );
}

function getFilePrefix(path: string): string {
  return (
    stem(path)
      .match(/^[A-Za-z]+/)?.[0]
      ?.toUpperCase() ?? ""
  );
}

const OBJECT_TYPE_MAP: Record<string, string> = {
  CH: "Chart",
  TB: "Straight Table",
  PT: "Pivot Table",
  PV: "Pivot Table",
  BC: "Bar Chart",
  LC: "Line Chart",
  LN: "Line Chart",
  PI: "Pie Chart",
  SC: "Scatter Chart",
  GU: "Gauge",
  ST: "Straight Table",
  LB: "List Box",
  MB: "Multi Box",
  CS: "Current Selections",
  TX: "Text Object",
  BU: "Button",
  IB: "Input Box",
  SL: "Slider/Calendar",
  CT: "Container",
  CO: "Container",
  RP: "Report Object",
  EXT: "Extension Object",
};

function inferChartSubtype(root: ParentNode, fallback: string): string {
  const chartType = findLeafValue(root, [
    "ChartType",
    "Type",
    "GraphType",
    "ObjectType",
    "VisualizationType",
  ]);
  if (chartType && chartType.length < 80 && !/^\d+$/.test(chartType)) return chartType;
  const xml = clean(root.textContent).toLowerCase();
  if (xml.includes("pivot")) return "Pivot Table";
  if (xml.includes("straight table")) return "Straight Table";
  if (xml.includes("combo")) return "Combo Chart";
  if (xml.includes("scatter")) return "Scatter Chart";
  if (xml.includes("gauge")) return "Gauge";
  if (xml.includes("mekko")) return "Mekko Chart";
  if (xml.includes("funnel")) return "Funnel Chart";
  if (xml.includes("radar")) return "Radar Chart";
  if (xml.includes("pie")) return "Pie Chart";
  if (xml.includes("line")) return "Line Chart";
  if (xml.includes("bar")) return "Bar Chart";
  return fallback;
}

function powerBiVisualFor(type: string): {
  visual: string;
  status: QvwMigrationStatus;
  warning?: string;
} {
  const value = type.toLowerCase();
  if (value.includes("straight table"))
    return { visual: "Table visual", status: "auto-convertible" };
  if (value.includes("pivot")) return { visual: "Matrix visual", status: "auto-convertible" };
  if (value.includes("bar"))
    return { visual: "Clustered/stacked bar or column chart", status: "auto-convertible" };
  if (value.includes("line")) return { visual: "Line chart", status: "auto-convertible" };
  if (value.includes("combo"))
    return { visual: "Line and clustered column chart", status: "review-required" };
  if (value.includes("pie")) return { visual: "Pie or donut chart", status: "auto-convertible" };
  if (value.includes("scatter")) return { visual: "Scatter chart", status: "auto-convertible" };
  if (value.includes("gauge")) return { visual: "Gauge or KPI visual", status: "review-required" };
  if (value.includes("list box") || value.includes("multi box"))
    return { visual: "Slicer", status: "auto-convertible" };
  if (value.includes("current selections"))
    return { visual: "Filter summary measure/page", status: "review-required" };
  if (value.includes("text"))
    return { visual: "Text box, card or button", status: "review-required" };
  if (value.includes("button"))
    return { visual: "Button with bookmark/page navigation", status: "review-required" };
  if (value.includes("input") || value.includes("slider"))
    return { visual: "What-if parameter or slicer", status: "review-required" };
  if (value.includes("container"))
    return {
      visual: "Bookmarks, field parameters or layered visuals",
      status: "manual-redesign",
      warning: "Qlik containers do not have a direct one-to-one Power BI equivalent.",
    };
  if (value.includes("extension"))
    return {
      visual: "Custom visual or manual redesign",
      status: "manual-redesign",
      warning: "Extension behaviour must be reviewed against an equivalent Power BI custom visual.",
    };
  return { visual: "Manual visual mapping", status: "review-required" };
}

function classifyExpressionRole(element: Element): QvwExpression["role"] {
  const context = [
    element.tagName,
    element.parentElement?.tagName,
    element.parentElement?.parentElement?.tagName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/dimension|fielddef|group/.test(context)) return "dimension";
  if (/sort|order/.test(context)) return "sort";
  if (/background|foreground|textcolor|colour|color/.test(context)) return "color";
  if (/show|visibility|conditionalshow|hide/.test(context)) return "visibility";
  if (/calculationcondition|calccondition/.test(context)) return "calculation-condition";
  if (/expression|measure|formula|definition|metric/.test(context)) return "measure";
  return "other";
}

function looksLikeExpression(value: string, element: Element): boolean {
  if (!value || value.length > 8000) return false;
  const tag = normalizedName(element.tagName);
  if (/expression|expr|formula|fielddef|dimension|measure|definition|condition/.test(tag))
    return true;
  return /(^=)|\$\([^)]*\)|\{<|\b(sum|count|avg|min|max|if|aggr|only|rangesum|above|below|peek|previous|num|date|year|month|match|pick)\s*\(/i.test(
    value,
  );
}

function extractVariableRefs(expression: string): string[] {
  return Array.from(
    new Set(
      Array.from(expression.matchAll(/\$\(\s*=?\s*([^)]+)\)/g))
        .map((match) => clean(match[1]).split(/[ ,]/)[0])
        .filter(Boolean),
    ),
  );
}

function extractFieldRefs(expression: string): string[] {
  const bracketed = Array.from(expression.matchAll(/\[([^\]]+)\]/g)).map((match) =>
    clean(match[1]),
  );
  const functionArgs = Array.from(
    expression.matchAll(
      /\b(?:sum|count|avg|min|max|only|firstsortedvalue)\s*\(\s*(?:distinct\s+)?([A-Za-z_][A-Za-z0-9_.$ ]*)/gi,
    ),
  ).map((match) => clean(match[1]));
  return Array.from(
    new Set([...bracketed, ...functionArgs].filter((field) => field && field.length < 160)),
  );
}

function extractFunctions(expression: string): string[] {
  return Array.from(
    new Set(
      Array.from(expression.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)).map((match) => match[1]),
    ),
  );
}

function basicDaxCandidate(expression: string): string | undefined {
  const trimmed = expression.replace(/^=/, "").trim();
  if (/\{<|\$\(|\bAggr\s*\(/i.test(trimmed)) return undefined;
  const distinct = trimmed.match(/^Count\s*\(\s*Distinct\s+(.+?)\s*\)$/i);
  if (distinct) return `DISTINCTCOUNT(${distinct[1].trim()})`;
  const aggregation = trimmed.match(/^(Sum|Count|Avg|Min|Max)\s*\(\s*(.+?)\s*\)$/i);
  if (!aggregation) return undefined;
  const fnMap: Record<string, string> = {
    sum: "SUM",
    count: "COUNT",
    avg: "AVERAGE",
    min: "MIN",
    max: "MAX",
  };
  return `${fnMap[aggregation[1].toLowerCase()]}(${aggregation[2].trim()})`;
}

function extractExpressions(
  root: ParentNode,
  objectId?: string,
  sheetId?: string,
): QvwExpression[] {
  const candidates = leafElements(root).filter((element) =>
    looksLikeExpression(clean(element.textContent), element),
  );
  const seen = new Set<string>();
  const expressions: QvwExpression[] = [];

  for (const element of candidates) {
    const expression = clean(element.textContent);
    const role = classifyExpressionRole(element);
    const key = `${role}|${expression}`;
    if (!expression || seen.has(key)) continue;
    seen.add(key);
    const setAnalysisDetected =
      /\{\s*<[^>]*>\s*\}/.test(expression) || /\{<[^>]+>\}/.test(expression);
    const aggrDetected = /\bAggr\s*\(/i.test(expression);
    const proposedDax = basicDaxCandidate(expression);
    const notes: string[] = [];
    if (setAnalysisDetected)
      notes.push(
        "Set Analysis requires filter-context translation to CALCULATE/TREATAS or a model redesign.",
      );
    if (aggrDetected) notes.push("Nested Aggr logic requires grain and evaluation-context review.");
    if (/\b(Above|Below|RangeSum|Before|After|Column|RowNo)\s*\(/i.test(expression))
      notes.push(
        "Inter-record chart function requires a Power BI visual calculation or DAX window-function review.",
      );

    expressions.push({
      id: `${objectId ?? "DOC"}-EXP-${expressions.length + 1}`,
      objectId,
      sheetId,
      label: findLeafValue(element.parentElement ?? element, [
        "Label",
        "ExpressionLabel",
        "Title",
        "Name",
      ]),
      role,
      expression,
      variables: extractVariableRefs(expression),
      fields: extractFieldRefs(expression),
      functions: extractFunctions(expression),
      setAnalysisDetected,
      aggrDetected,
      proposedDax,
      migrationStatus:
        proposedDax && !setAnalysisDetected && !aggrDetected
          ? "auto-convertible"
          : "review-required",
      notes,
    });
  }

  return expressions;
}

function actionMapping(type: string): { mapping: string; status: QvwMigrationStatus } {
  const value = type.toLowerCase();
  if (/activate.*sheet|sheet.*activate|navigation/.test(value))
    return { mapping: "Power BI page navigation button", status: "auto-convertible" };
  if (/bookmark/.test(value))
    return { mapping: "Power BI bookmark action", status: "review-required" };
  if (/select|clear|lock|unlock/.test(value))
    return {
      mapping: "Slicer/filter state, bookmark or drill-through filter",
      status: "review-required",
    };
  if (/variable/.test(value))
    return {
      mapping: "What-if parameter, disconnected table or field parameter",
      status: "review-required",
    };
  if (/url|launch/.test(value))
    return { mapping: "Web URL button action", status: "auto-convertible" };
  if (/print|export/.test(value))
    return {
      mapping: "Export data, paginated report or Power Automate",
      status: "manual-redesign",
    };
  if (/macro|reload|execute/.test(value))
    return {
      mapping: "Power Automate, Fabric/Data Factory pipeline or manual redesign",
      status: "manual-redesign",
    };
  return { mapping: "Manual action mapping", status: "review-required" };
}

function candidateContainers(root: ParentNode, pattern: RegExp): Element[] {
  const all =
    root instanceof Document
      ? Array.from(root.getElementsByTagName("*"))
      : Array.from(root.querySelectorAll("*"));
  const direct = all.filter(
    (element) => pattern.test(normalizedName(element.tagName)) && element.children.length > 0,
  );
  const leafParents = all
    .filter((element) => pattern.test(normalizedName(element.tagName)) && element.parentElement)
    .map((element) => element.parentElement as Element);
  return Array.from(new Set([...direct, ...leafParents]));
}

function extractActions(root: ParentNode, ownerId?: string, sheetId?: string): QvwAction[] {
  const containers = candidateContainers(
    root,
    /^(action|actionitem|actionentry|actioninfo|actiondefinition)$/,
  );
  const actions: QvwAction[] = [];
  const seen = new Set<string>();

  containers.forEach((container, index) => {
    const raw = collectProperties(container, 50);
    const type =
      findLeafValue(container, ["ActionType", "Type", "Action", "Name", "Command"]) ||
      container.tagName;
    const target = findLeafValue(container, [
      "Target",
      "Sheet",
      "SheetId",
      "ObjectId",
      "Field",
      "Url",
      "BookmarkId",
      "Variable",
    ]);
    const value = findLeafValue(container, [
      "Value",
      "Expression",
      "Selection",
      "Parameter",
      "VariableValue",
    ]);
    const signature = `${type}|${target ?? ""}|${value ?? ""}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    const mapped = actionMapping(type);
    actions.push({
      id: `${ownerId ?? "DOC"}-ACT-${index + 1}`,
      objectId: ownerId,
      sheetId,
      trigger: findLeafValue(container, ["Trigger", "Event", "EventType"]),
      type,
      target,
      value,
      order: toNumber(findLeafValue(container, ["Order", "Index", "Sequence"])) ?? index + 1,
      raw,
      powerBiMapping: mapped.mapping,
      migrationStatus: mapped.status,
    });
  });

  return actions;
}

function extractTriggers(
  root: ParentNode,
  ownerId?: string,
  knownActions: QvwAction[] = [],
): QvwTrigger[] {
  const containers = candidateContainers(
    root,
    /trigger|eventaction|onopen|onclose|onactivate|onchange|onselect/,
  );
  const triggers: QvwTrigger[] = [];
  const seen = new Set<string>();

  containers.forEach((container, index) => {
    const raw = collectProperties(container, 50);
    const event =
      findLeafValue(container, ["Event", "EventType", "Trigger", "Name", "Type"]) ||
      container.tagName;
    const signature = `${ownerId ?? "DOC"}|${event}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    const scopeText = `${container.tagName} ${ownerId ?? ""}`.toLowerCase();
    const scope: QvwTrigger["scope"] = ownerId?.toUpperCase().startsWith("SH")
      ? "sheet"
      : /field/.test(scopeText)
        ? "field"
        : /variable/.test(scopeText)
          ? "variable"
          : ownerId
            ? "object"
            : "document";
    triggers.push({
      id: `${ownerId ?? "DOC"}-TRG-${index + 1}`,
      scope,
      event,
      ownerId,
      actionIds: knownActions
        .filter((action) => action.trigger?.toLowerCase() === event.toLowerCase())
        .map((action) => action.id),
      raw,
      migrationStatus: /macro|reload|execute/i.test(JSON.stringify(raw))
        ? "manual-redesign"
        : "review-required",
    });
  });

  return triggers;
}

function parseMacroFile(file: ExtractedFile): QvwMacro[] {
  const text = file.text ?? "";
  const language: QvwMacro["language"] =
    /\bfunction\s+\w+\s*\(|\bvar\s+\w+/i.test(text) && !/\b(Sub|End Sub|Dim)\b/i.test(text)
      ? "JScript"
      : /\b(Sub|End Sub|Dim|Function|End Function)\b/i.test(text)
        ? "VBScript"
        : "Unknown";
  const regex =
    language === "JScript"
      ? /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{([\s\S]*?)(?=\n\s*function\s+|$)/gi
      : /(?:Sub|Function)\s+([A-Za-z_][A-Za-z0-9_]*)[^\r\n]*[\r\n]+([\s\S]*?)(?:End\s+(?:Sub|Function))/gi;
  const procedures = Array.from(text.matchAll(regex)).map((match) => ({
    name: match[1] || "DocumentModule",
    body: clean(match[2] || match[0]),
  }));
  if (procedures.length === 0 && clean(text))
    procedures.push({ name: "DocumentModule", body: clean(text) });

  return procedures.map(({ name, body }) => {
    const operations: string[] = [];
    if (/export/i.test(body)) operations.push("Exports data or a chart");
    if (/excel|workbook|worksheet/i.test(body)) operations.push("Automates Microsoft Excel");
    if (/sendmail|outlook|mail/i.test(body)) operations.push("Sends email");
    if (/reload/i.test(body)) operations.push("Reloads the QlikView document");
    if (/shellexecute|wscript\.shell|createobject|filesystemobject/i.test(body))
      operations.push("Accesses the operating system or file system");
    if (/getSheetObject|ActiveDocument|GetApplication/i.test(body))
      operations.push("Controls QlikView document objects");
    const highRisk =
      /shellexecute|wscript\.shell|createobject|filesystemobject|deletefile|run\s*\(/i.test(body);
    return {
      name,
      language,
      body,
      calledBy: [],
      operations,
      riskLevel: highRisk ? "high" : operations.length > 0 ? "medium" : "low",
      powerBiReplacement: [
        "Review the business outcome rather than translating the macro code directly.",
        ...(operations.some((item) => /export|email/i.test(item))
          ? ["Consider Power Automate or a paginated report subscription."]
          : []),
        ...(operations.some((item) => /reload/i.test(item))
          ? ["Move reload logic to the semantic-model refresh or an orchestration pipeline."]
          : []),
      ],
      migrationStatus: "manual-redesign" as const,
    };
  });
}

function parseScriptVariables(loadScript: string): QvwVariable[] {
  const variables = new Map<string, QvwVariable>();
  const regex = /^\s*(SET|LET)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*([\s\S]*?);\s*$/gim;
  for (const match of loadScript.matchAll(regex)) {
    const definition = clean(match[3]);
    const isCalculated =
      match[1].toUpperCase() === "LET" || /^=/.test(definition) || /\$\(/.test(definition);
    variables.set(match[2], {
      name: match[2],
      definition,
      isCalculated,
      references: extractVariableRefs(definition),
      usedByObjects: [],
      usedByActions: [],
      proposedPowerBiType: isCalculated
        ? "measure"
        : /^[-+]?\d+(\.\d+)?$/.test(definition)
          ? "what-if-parameter"
          : "disconnected-table",
      migrationStatus: isCalculated ? "review-required" : "auto-convertible",
    });
  }
  return Array.from(variables.values());
}

function parseXmlVariables(xmlFiles: ParsedXmlFile[]): QvwVariable[] {
  const variables = new Map<string, QvwVariable>();
  for (const xml of xmlFiles) {
    const containers = candidateContainers(
      xml.doc,
      /^(variable|variableitem|variableinfo|documentvariable)$/,
    );
    for (const container of containers) {
      const name = findLeafValue(container, ["Name", "VariableName", "VarName", "Id"]);
      if (!name || name.length > 160 || (/\s/.test(name) && !/^v/i.test(name))) continue;
      const definition = findLeafValue(container, [
        "Definition",
        "Expression",
        "Formula",
        "Value",
        "Content",
      ]);
      const existing = variables.get(name);
      variables.set(name, {
        name,
        definition: definition ?? existing?.definition,
        evaluatedValue:
          findLeafValue(container, ["EvaluatedValue", "CurrentValue", "Result"]) ??
          existing?.evaluatedValue,
        isCalculated: Boolean(
          definition && (/^=/.test(definition) || /\$\(|\w+\s*\(/.test(definition)),
        ),
        references: Array.from(
          new Set([...(existing?.references ?? []), ...extractVariableRefs(definition ?? "")]),
        ),
        usedByObjects: existing?.usedByObjects ?? [],
        usedByActions: existing?.usedByActions ?? [],
        proposedPowerBiType:
          definition && /^[-+]?\d+(\.\d+)?$/.test(definition)
            ? "what-if-parameter"
            : definition && !/[()=]/.test(definition)
              ? "disconnected-table"
              : "measure",
        migrationStatus: "review-required",
      });
    }
  }
  return Array.from(variables.values());
}

function parseBookmarks(xmlFiles: ParsedXmlFile[]): QvwBookmark[] {
  const result: QvwBookmark[] = [];
  const seen = new Set<string>();
  for (const xml of xmlFiles.filter(
    (item) =>
      /bookmark/i.test(item.file.path) ||
      /bookmark/i.test(item.doc.documentElement?.textContent ?? ""),
  )) {
    const containers = candidateContainers(
      xml.doc,
      /^(bookmark|bookmarkitem|bookmarkinfo|docbookmark)$/,
    );
    for (const container of containers) {
      const id =
        findLeafValue(container, ["BookmarkId", "ObjectId", "Id", "ID"]) ||
        `${stem(xml.file.path)}-${result.length + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const name = findLeafValue(container, ["Name", "Title", "BookmarkName", "Text"]) || id;
      const selectionContainers = candidateContainers(
        container,
        /selection|fieldvalue|selectedfield/,
      );
      const selections = selectionContainers
        .map((selection) => ({
          field: findLeafValue(selection, ["Field", "FieldName", "Name"]) || "Unknown field",
          values: findLeafValues(selection, ["Value", "SelectedValue", "Text", "FieldValue"]),
          state: findLeafValue(selection, ["State", "AlternateState"]),
        }))
        .filter((selection) => selection.field !== "Unknown field" || selection.values.length > 0);
      result.push({
        id,
        name,
        description: findLeafValue(container, ["Description", "Comment", "Info"]),
        kind: /server/i.test(xml.file.path)
          ? "server"
          : /user/i.test(xml.file.path)
            ? "user"
            : "document",
        selections,
        variableState: {},
        hidden: toBoolean(findLeafValue(container, ["Hidden", "IsHidden"])) ?? false,
        migrationStatus: "review-required",
        notes:
          selections.length === 0
            ? [
                "The bookmark definition was detected, but selected values may require QlikView engine export.",
              ]
            : [],
      });
    }
  }
  return result;
}

function mergeVariables(
  scriptVariables: QvwVariable[],
  xmlVariables: QvwVariable[],
  expressions: QvwExpression[],
  actions: QvwAction[],
): QvwVariable[] {
  const variables = new Map<string, QvwVariable>();
  for (const variable of [...scriptVariables, ...xmlVariables]) {
    const existing = variables.get(variable.name);
    variables.set(
      variable.name,
      existing
        ? {
            ...existing,
            ...variable,
            definition: variable.definition ?? existing.definition,
            evaluatedValue: variable.evaluatedValue ?? existing.evaluatedValue,
            references: Array.from(new Set([...existing.references, ...variable.references])),
          }
        : variable,
    );
  }

  for (const expression of expressions) {
    for (const name of expression.variables) {
      const variable = variables.get(name) ?? {
        name,
        isCalculated: true,
        references: [],
        usedByObjects: [],
        usedByActions: [],
        proposedPowerBiType: "manual" as const,
        migrationStatus: "missing-dependency" as const,
      };
      if (expression.objectId)
        variable.usedByObjects = Array.from(
          new Set([...variable.usedByObjects, expression.objectId]),
        );
      variables.set(name, variable);
    }
  }

  for (const action of actions) {
    const refs = extractVariableRefs(`${action.type} ${action.target ?? ""} ${action.value ?? ""}`);
    for (const name of refs) {
      const variable = variables.get(name) ?? {
        name,
        isCalculated: true,
        references: [],
        usedByObjects: [],
        usedByActions: [],
        proposedPowerBiType: "manual" as const,
        migrationStatus: "missing-dependency" as const,
      };
      variable.usedByActions = Array.from(new Set([...variable.usedByActions, action.id]));
      variables.set(name, variable);
    }
  }
  return Array.from(variables.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parseDocumentMetadata(
  files: ExtractedFile[],
  xmlFiles: ParsedXmlFile[],
  loadScript: string,
): QvwDocumentMetadata {
  const qvw = files.find((file) => file.extension.toLowerCase() === ".qvw");
  const docs = xmlFiles.filter((item) =>
    /docproperties|allproperties|docinternals|qlikviewproject|toplayout/i.test(item.file.path),
  );
  const value = (keys: string[]) => docs.map((doc) => findLeafValue(doc.doc, keys)).find(Boolean);
  const alternateStates = Array.from(
    new Set(docs.flatMap((doc) => findLeafValues(doc.doc, ["AlternateState", "StateName"]))),
  ).filter((state) => !/^(inherited|default)$/i.test(state));
  const customProperties: Record<string, string> = {};
  for (const doc of docs) Object.assign(customProperties, collectProperties(doc.doc, 80));
  return {
    fileName: qvw?.name,
    title:
      value(["DocumentTitle", "Title", "DocumentName", "Caption"]) ||
      qvw?.name?.replace(/\.qvw$/i, ""),
    documentId: value(["DocumentId", "DocId", "ID"]),
    author: value(["Author", "CreatedBy", "Owner"]),
    description: value(["Description", "Comment", "DocumentDescription"]),
    qlikVersion: value(["QlikViewVersion", "ProductVersion", "Version", "BuildVersion"]),
    createdAt: value(["Created", "CreateTime", "CreationDate"]),
    modifiedAt: value(["Modified", "ModifiedTime", "LastModified"]),
    lastReloadAt: value(["LastReloadTime", "ReloadTime", "LastReload"]),
    reloadMode: value(["ReloadMode", "ReloadType"]),
    sectionAccessDetected: /\bSECTION\s+ACCESS\b/i.test(loadScript),
    alternateStates,
    customProperties,
  };
}

function parseSheets(xmlFiles: ParsedXmlFile[]): QvwSheet[] {
  const sheets: QvwSheet[] = [];
  const sheetXml = xmlFiles.filter(
    (item) =>
      getFilePrefix(item.file.path) === "SH" ||
      /sheet/i.test(item.doc.documentElement?.tagName ?? ""),
  );
  sheetXml.forEach((xml, index) => {
    const id = firstObjectId(xml.doc, stem(xml.file.path));
    const descendantIds = leafElements(xml.doc)
      .map((element) => clean(element.textContent))
      .filter((value) =>
        /^(CH|LB|TX|BU|IB|SL|CS|MB|CT|TB|PT|PV|GU|PI|SC|EXT)[A-Za-z0-9_-]+$/i.test(value),
      );
    const actions = extractActions(xml.doc, id, id);
    sheets.push({
      id,
      name:
        findLeafValue(xml.doc, ["SheetName", "Title", "Caption", "Name", "Text"]) ||
        `Sheet ${index + 1}`,
      file: xml.file.path,
      order:
        toNumber(findLeafValue(xml.doc, ["Order", "Index", "SheetIndex", "Position"])) ?? index + 1,
      description: findLeafValue(xml.doc, ["Description", "Comment"]),
      alternateState: findLeafValue(xml.doc, ["AlternateState", "StateName"]),
      visibilityCondition: findLeafValue(xml.doc, [
        "ShowCondition",
        "VisibilityCondition",
        "ConditionalShow",
      ]),
      objectIds: Array.from(new Set(descendantIds)),
      triggers: extractTriggers(xml.doc, id, actions),
      layout: extractLayout(xml.doc),
    });
  });
  return sheets.sort((a, b) => a.order - b.order);
}

function parseObjects(xmlFiles: ParsedXmlFile[], sheets: QvwSheet[]): QvwVisualizationObject[] {
  const objectXml = xmlFiles.filter((item) => {
    const prefix = getFilePrefix(item.file.path);
    return (
      prefix !== "SH" &&
      (OBJECT_TYPE_MAP[prefix] ||
        /sheetobject|chart|listbox|button|textobject|container|extension/i.test(
          item.doc.documentElement?.tagName ?? "",
        ))
    );
  });

  const objects = objectXml.map((xml): QvwVisualizationObject => {
    const prefix = getFilePrefix(xml.file.path);
    const id = firstObjectId(xml.doc, stem(xml.file.path));
    const explicitSheetId = findLeafValue(xml.doc, [
      "SheetId",
      "ParentSheetId",
      "OwnerSheetId",
      "ParentId",
    ]);
    const sheet = sheets.find(
      (candidate) => candidate.id === explicitSheetId || candidate.objectIds.includes(id),
    );
    const baseType = OBJECT_TYPE_MAP[prefix] || "Visualization Object";
    const type = prefix === "CH" ? inferChartSubtype(xml.doc, baseType) : baseType;
    const expressions = extractExpressions(xml.doc, id, sheet?.id ?? explicitSheetId);
    const actions = extractActions(xml.doc, id, sheet?.id ?? explicitSheetId);
    const mapped = powerBiVisualFor(type);
    const extensionName = findLeafValue(xml.doc, [
      "ExtensionName",
      "ExtensionId",
      "ExtensionType",
      "CustomObjectName",
    ]);
    const warnings = mapped.warning ? [mapped.warning] : [];
    if (extensionName) warnings.push(`Custom extension detected: ${extensionName}`);
    if (expressions.some((expression) => expression.setAnalysisDetected))
      warnings.push("Contains Set Analysis expressions requiring DAX filter-context review.");
    if (actions.some((action) => action.migrationStatus === "manual-redesign"))
      warnings.push("Contains actions that require Power BI or Power Automate redesign.");
    const dimensions = expressions.filter((expression) => expression.role === "dimension");
    const measures = expressions.filter(
      (expression) => expression.role === "measure" || expression.role === "other",
    );
    const conditionalExpressions = expressions.filter((expression) =>
      ["sort", "color", "visibility", "calculation-condition"].includes(expression.role),
    );

    return {
      id,
      file: xml.file.path,
      sheetId: sheet?.id ?? explicitSheetId,
      type: extensionName ? "Extension Object" : type,
      title: findLeafValue(xml.doc, ["Title", "Caption", "ObjectTitle", "Text", "Name"]),
      subtitle: findLeafValue(xml.doc, ["SubTitle", "Subtitle", "FooterText"]),
      layout: extractLayout(xml.doc),
      dimensions,
      measures,
      conditionalExpressions,
      actions,
      alternateState: findLeafValue(xml.doc, ["AlternateState", "StateName"]),
      calculationCondition: findLeafValue(xml.doc, ["CalculationCondition", "CalcCondition"]),
      visibilityCondition: findLeafValue(xml.doc, [
        "ShowCondition",
        "VisibilityCondition",
        "ConditionalShow",
      ]),
      numberFormats: findLeafValues(xml.doc, [
        "NumberFormat",
        "NumFormat",
        "FormatPattern",
        "Format",
      ]),
      sortDefinitions: findLeafValues(xml.doc, ["SortExpression", "SortOrder", "SortBy"]),
      extensionName,
      powerBiVisual: mapped.visual,
      migrationStatus: extensionName ? "manual-redesign" : mapped.status,
      warnings,
      rawProperties: collectProperties(xml.doc),
    };
  });

  if (sheets.length === 1) {
    for (const object of objects) if (!object.sheetId) object.sheetId = sheets[0].id;
    sheets[0].objectIds = Array.from(
      new Set([...sheets[0].objectIds, ...objects.map((object) => object.id)]),
    );
  }
  return objects;
}

function createSyntheticSheet(objects: QvwVisualizationObject[]): QvwSheet | undefined {
  const unassigned = objects.filter((object) => !object.sheetId);
  if (unassigned.length === 0) return undefined;
  for (const object of unassigned) object.sheetId = "UNASSIGNED";
  return {
    id: "UNASSIGNED",
    name: "Unassigned / hidden objects",
    order: Number.MAX_SAFE_INTEGER,
    objectIds: unassigned.map((object) => object.id),
    triggers: [],
    layout: {},
    description: "Objects whose parent sheet could not be resolved from the supplied PRJ metadata.",
  };
}

export function parseQvwProject(files: ExtractedFile[]): QvwAnalysis {
  const diagnostics: QvwDiagnostic[] = [];
  const intake = analyzeQvwPackageIntake(files);
  const xmlFiles = parseXmlFiles(files, diagnostics);
  const loadScript = files
    .filter(
      (file) =>
        file.text &&
        (basename(file.path).toLowerCase() === "loadscript.txt" ||
          file.extension.toLowerCase() === ".qvs"),
    )
    .map((file) => `// FILE: ${file.path}\n${file.text}`)
    .join("\n\n");

  const sheets = parseSheets(xmlFiles);
  const objects = parseObjects(xmlFiles, sheets);
  const syntheticSheet = createSyntheticSheet(objects);
  if (syntheticSheet) sheets.push(syntheticSheet);

  const expressions = objects.flatMap((object) => [
    ...object.dimensions,
    ...object.measures,
    ...object.conditionalExpressions,
  ]);
  const objectActions = objects.flatMap((object) => object.actions);
  const sheetActions = sheets.flatMap((sheet) => {
    const source = xmlFiles.find((xml) => xml.file.path === sheet.file);
    return source ? extractActions(source.doc, sheet.id, sheet.id) : [];
  });
  const documentActions = xmlFiles
    .filter((xml) => /docproperties|docinternals|allproperties/i.test(xml.file.path))
    .flatMap((xml) => extractActions(xml.doc));
  const actions = Array.from(
    new Map(
      [...objectActions, ...sheetActions, ...documentActions].map((action) => [
        `${action.objectId ?? "DOC"}|${action.type}|${action.target ?? ""}|${action.value ?? ""}`,
        action,
      ]),
    ).values(),
  );

  const triggers = [
    ...sheets.flatMap((sheet) => sheet.triggers),
    ...objects.flatMap((object) => {
      const source = xmlFiles.find((xml) => xml.file.path === object.file);
      return source ? extractTriggers(source.doc, object.id, object.actions) : [];
    }),
    ...xmlFiles
      .filter((xml) => /docproperties|docinternals|allproperties/i.test(xml.file.path))
      .flatMap((xml) => extractTriggers(xml.doc, undefined, actions)),
  ];

  const macros = files
    .filter((file) => basename(file.path).toLowerCase() === "module.txt" && file.text)
    .flatMap(parseMacroFile);
  for (const macro of macros) {
    macro.calledBy = actions
      .filter((action) =>
        `${action.type} ${action.target ?? ""} ${action.value ?? ""}`
          .toLowerCase()
          .includes(macro.name.toLowerCase()),
      )
      .map((action) => action.id);
  }

  const variables = mergeVariables(
    parseScriptVariables(loadScript),
    parseXmlVariables(xmlFiles),
    expressions,
    actions,
  );
  const bookmarks = parseBookmarks(xmlFiles);
  const extensions: QvwExtension[] = objects
    .filter((object) => object.extensionName || object.type === "Extension Object")
    .map((object) => ({
      objectId: object.id,
      extensionName: object.extensionName || "Unknown extension",
      file: object.file,
      migrationStatus: "manual-redesign",
      notes: [
        "Validate licensing, API dependencies and an equivalent AppSource/custom visual before migration.",
      ],
    }));

  if (intake.mode === "qvw-only") {
    diagnostics.push({
      severity: "error",
      code: "QVW_BINARY_ONLY",
      message:
        "The QVW binary was uploaded without its PRJ project files, so visualization metadata cannot be read by the web application.",
      recommendation:
        "Run scripts/qvw-extract-prj.ps1 on a Windows machine with QlikView Desktop, then upload the QVW and generated -prj folder together.",
    });
  }
  if (!intake.readyForVisualizationAnalysis) {
    diagnostics.push({
      severity: "warning",
      code: "VISUAL_METADATA_INCOMPLETE",
      message: `Visualization analysis is incomplete. Missing: ${intake.missingMandatory.join(", ") || "required PRJ content"}.`,
      recommendation: "Review the Instructions page and upload the complete QVW project package.",
    });
  }
  if (objects.length === 0 && intake.projectFiles.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "NO_OBJECTS_DETECTED",
      message: "Project files were found, but no visualization object XML files were recognized.",
      recommendation:
        "Confirm that files such as CH*.xml, LB*.xml, TX*.xml and BU*.xml are included in the ZIP/folder.",
    });
  }
  for (const variable of variables.filter(
    (item) => item.migrationStatus === "missing-dependency",
  )) {
    diagnostics.push({
      severity: "warning",
      code: "VARIABLE_DEFINITION_MISSING",
      message: `Variable ${variable.name} is referenced but its definition was not found.`,
      recommendation: "Include DocInternals.xml, AllProperties.xml and the complete load script.",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    intake,
    document: parseDocumentMetadata(files, xmlFiles, loadScript),
    sheets,
    objects,
    expressions,
    variables,
    bookmarks,
    actions,
    triggers,
    macros,
    extensions,
    loadScript: loadScript || undefined,
    sourceFiles: files.map((file) => file.path),
    diagnostics,
    metrics: {
      sheetCount: sheets.filter((sheet) => sheet.id !== "UNASSIGNED").length,
      objectCount: objects.length,
      expressionCount: expressions.length,
      variableCount: variables.length,
      bookmarkCount: bookmarks.length,
      actionCount: actions.length,
      triggerCount: triggers.length,
      macroCount: macros.length,
      extensionCount: extensions.length,
    },
  };
}
