# Generalized Qlik Parser Framework

This folder contains a modular, deterministic Qlik script parser for the migration application. It is additive: the existing `qvs-parser.ts` and `enterprise-parser.ts` remain available while screens are migrated to this framework.

## Main entry point

```ts
import { parseQlikScript } from "@/lib/migration/parser";

const result = parseQlikScript(qvsText, {
  fileName: "DataModel.qvs",
  inferRelationships: true,
  strict: false,
});
```

The result includes statements, typed operations, tables, final tables, relationships, lineage edges, execution graph, variables, connections, diagnostics, and parser metrics.

## Extension model

Each statement parser implements `StatementParserPlugin`:

```ts
class CustomParser implements StatementParserPlugin {
  readonly name = "CustomParser";
  readonly priority = 250;
  canParse(statement, context) {
    return false;
  }
  parse(statement, context) {
    return { operations: [] };
  }
}
```

Register custom parsers without changing the engine:

```ts
const engine = new ParserEngine().register(new CustomParser());
```

## Supported in this package

- Quote-, bracket-, variable-, comment-, and line-aware tokenization
- Safe semicolon statement splitting
- Table labels and Qlik prefixes
- LOAD and SQL SELECT
- RESIDENT LOAD
- JOIN and KEEP payloads
- MAPPING LOAD and ApplyMap
- STORE
- DROP TABLE/FIELD
- Master-calendar pattern detection
- Variables and connection statements
- Table metadata, final-table inference, lineage, relationship inference, and execution graph

Unsupported or ambiguous syntax is retained as a diagnostic instead of being silently discarded.
