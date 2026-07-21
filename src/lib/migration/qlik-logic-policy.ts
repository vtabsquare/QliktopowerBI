import { splitQlikScriptStatements } from "./qlik-script-normalizer";
import type { Operation, ProjectFile } from "./enterprise-parser";

export type QlikLogicAction = "translate" | "preserve-metadata" | "ignore-runtime" | "manual-review";

export interface QlikLogicDecision {
  id: string;
  file: string;
  startLine: number;
  category: string;
  qlikConstruct: string;
  action: QlikLogicAction;
  target: "Power Query" | "DAX" | "Semantic Model" | "Migration Metadata" | "Manual";
  reason: string;
  handling: string;
  blocking: boolean;
}

const formattingSettings = /^(SET|LET)\s+(DecimalSep|ThousandSep|MoneyFormat|MoneyDecimalSep|MoneyThousandSep|DateFormat|TimestampFormat|TimeFormat|MonthNames|LongMonthNames|DayNames|LongDayNames|FirstWeekDay|BrokenWeeks|ReferenceDay|FirstMonthOfYear|CollationLocale)\b/i;

function decision(id: string, file: string, startLine: number, category: string, qlikConstruct: string, action: QlikLogicAction, target: QlikLogicDecision["target"], reason: string, handling: string, blocking = false): QlikLogicDecision {
  return { id, file, startLine, category, qlikConstruct, action, target, reason, handling, blocking };
}

export function buildQlikLogicDecisions(files: ProjectFile[], operations: Operation[]): QlikLogicDecision[] {
  const out: QlikLogicDecision[] = [];
  let sequence = 1;
  const add = (file: string, line: number, category: string, construct: string, action: QlikLogicAction, target: QlikLogicDecision["target"], reason: string, handling: string, blocking = false) => {
    out.push(decision(`QLIK-DEC-${String(sequence++).padStart(5, "0")}`, file, line, category, construct.slice(0, 240), action, target, reason, handling, blocking));
  };

  for (const file of files.filter((item) => item.isText)) {
    for (const statement of splitQlikScriptStatements(file.content)) {
      const raw = statement.cleaned.trim();
      const compact = raw.replace(/\s+/g, " ");
      if (!compact) continue;
      if (formattingSettings.test(compact)) {
        add(file.path, statement.startLine, "Environment formatting", compact, "preserve-metadata", "Migration Metadata", "Qlik document formatting settings are not ETL transformations.", "Store the value as model/report formatting metadata; do not emit a Power Query step.");
      } else if (/^(SET|LET)\s+/i.test(compact)) {
        add(file.path, statement.startLine, "Variable", compact, "translate", "DAX", "Qlik variables may affect expressions and user controls.", "Create a DAX measure or parameter artifact and resolve variable dependencies.");
      } else if (/^TRACE\b/i.test(compact)) {
        add(file.path, statement.startLine, "Diagnostics", compact, "ignore-runtime", "Migration Metadata", "TRACE writes only to the Qlik reload log.", "Keep it in lineage notes; do not generate M.");
      } else if (/^STORE\b/i.test(compact)) {
        add(file.path, statement.startLine, "Persistence side effect", compact, "preserve-metadata", "Migration Metadata", "STORE materializes a QVD/output file and is not part of the final in-memory table transformation.", "Use it only to resolve upstream QVD lineage; do not emit a Power Query output-write step.");
      } else if (/^DROP\s+(TABLE|FIELD)\b/i.test(compact)) {
        add(file.path, statement.startLine, "Cleanup", compact, "translate", "Power Query", "DROP affects surviving model objects or final fields.", "Apply it through final-table/column selection rather than a standalone duplicate step.");
      } else if (/^(QUALIFY|UNQUALIFY)\b/i.test(compact)) {
        add(file.path, statement.startLine, "Field qualification", compact, "manual-review", "Semantic Model", "Qlik qualification changes association names and can alter relationship semantics.", "Resolve field names deterministically and review relationship mappings before export.");
      } else if (/^(BINARY|SECTION\s+ACCESS)\b/i.test(compact)) {
        add(file.path, statement.startLine, "Security or binary dependency", compact, "manual-review", "Manual", "This construct cannot be reproduced safely from script text alone.", "Require explicit source/security mapping and block silent conversion.", true);
      } else if (/^(DIRECTORY|BUFFER)\b/i.test(compact)) {
        add(file.path, statement.startLine, "Reload optimization", compact, "ignore-runtime", "Migration Metadata", "The construct controls Qlik reload location or cache behavior, not business transformation logic.", "Use resolved source paths where available; omit the runtime directive from M.");
      } else if (/^(INCLUDE|MUST_INCLUDE)\b|\$\(Include=/i.test(compact)) {
        add(file.path, statement.startLine, "External script", compact, "manual-review", "Manual", "The referenced script must be present to reproduce complete logic.", "Process the included file when uploaded; otherwise report a missing dependency.", true);
      } else if (/^(ADD|REPLACE)\s+(LOAD|SELECT)\b/i.test(compact)) {
        add(file.path, statement.startLine, "Partial reload", compact, "preserve-metadata", "Migration Metadata", "ADD/REPLACE controls Qlik partial reload behavior.", "Convert the underlying LOAD/SELECT but omit partial-reload semantics unless an incremental refresh design is approved.");
      }
    }
  }

  for (const op of operations) {
    const construct = `${op.opType}: ${op.table}`;
    if (op.opType === "join_load") add(op.file, op.startLine, "Join", construct, "translate", "Power Query", "JOIN changes the target table shape.", "Generate one collision-safe NestedJoin/Expand sequence per unique join signature.");
    else if (op.opType === "concat_load") add(op.file, op.startLine, "Concatenate", construct, "translate", "Power Query", "CONCATENATE appends rows.", "Generate one Table.Combine operation per unique payload.");
    else if (op.opType === "mapping_load") add(op.file, op.startLine, "Mapping table", construct, "translate", "Power Query", "MAPPING LOAD is a helper lookup, not a standalone model table.", "Translate ApplyMap usage to a lookup/merge and exclude the helper table from the semantic model.");
    else if (op.opType === "store_qvd") add(op.file, op.startLine, "QVD handoff", construct, "preserve-metadata", "Migration Metadata", "QVD STORE is an intermediate persistence handoff.", "Resolve its producer/consumer lineage and bypass the QVD when upstream logic is available.");
    else if (op.opType === "drop") add(op.file, op.startLine, "Dropped intermediate", construct, "translate", "Semantic Model", "Dropped tables must not survive into the final model.", "Exclude the table after using it for lineage/dependency resolution.");
  }

  const seen = new Set<string>();
  return out.filter((item) => {
    const key = [item.file.toLowerCase(), item.startLine, item.category, item.qlikConstruct.toLowerCase(), item.action].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
