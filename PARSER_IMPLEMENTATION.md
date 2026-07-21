# Generalized Qlik Parser Implementation

## Added architecture

The migration project now includes a modular parser under:

`src/lib/migration/parser/`

### Core

- `core/Tokenizer.ts`
- `core/StatementParser.ts`
- `core/ParserContext.ts`
- `core/ParserTypes.ts`
- `core/ParserUtils.ts`
- `core/ParserEngine.ts`

### Statement parsers

- `parsers/LoadParser.ts`
- `parsers/ResidentParser.ts`
- `parsers/JoinParser.ts`
- `parsers/MappingParser.ts`
- `parsers/ApplyMapParser.ts`
- `parsers/StoreParser.ts`
- `parsers/DropParser.ts`
- `parsers/CalendarParser.ts`
- `parsers/VariableParser.ts`
- `parsers/ConnectionParser.ts`

### Builders

- `builders/MetadataExtractor.ts`
- `builders/RelationshipBuilder.ts`
- `builders/LineageBuilder.ts`
- `builders/ExecutionGraphBuilder.ts`

## Compatibility

The existing `qvs-parser.ts` and `enterprise-parser.ts` were not removed. The new engine is exported additively from `qvs-parser.ts` as:

```ts
import { QlikParserEngine, parseQlikScript } from "@/lib/migration/qvs-parser";
```

It can also be imported directly:

```ts
import { parseQlikScript } from "@/lib/migration/parser";
```

## Validation completed

- Strict project-wide TypeScript check: passed with `tsc -p tsconfig.json --noEmit`
- Parser smoke test: passed for variables, `lib://` paths, MAPPING LOAD, ApplyMap, QVD LOAD, RESIDENT JOIN, master calendar, STORE, DROP FIELD, DROP TABLE, relationship inference, lineage, and execution graph.

## Important migration approach

The modular framework is intentionally additive. Existing screens continue using the current parser until their output mapping is migrated and regression-tested. This prevents a new parser rollout from silently changing current UI and PBIP generation behavior.
