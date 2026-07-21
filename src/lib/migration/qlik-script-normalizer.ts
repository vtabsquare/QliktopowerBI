/**
 * Qlik script normalization helpers shared by the legacy and modular parsers.
 *
 * Qlik normally treats // as a physical-line comment. Some exported/uploaded
 * scripts are flattened into a single line before they reach the browser. In
 * that form, a conventional comment remover would discard every statement
 * after the first // marker. The recovery logic below keeps standard Qlik
 * behaviour for normal multi-line scripts and heuristically recovers a valid
 * semicolon-delimited statement that appears after flattened comment banners.
 */

export interface QlikStatementSlice {
  /** Original source slice, including comments and the terminating semicolon. */
  raw: string;
  /** Comment-free statement text, including the terminating semicolon. */
  cleaned: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

interface RawChunk {
  raw: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

interface Candidate {
  start: number;
  end: number;
  strength: number;
}

const STATEMENT_START_PATTERNS: Array<{ regex: RegExp; strength: number }> = [
  {
    // Named table followed by LOAD/SELECT and optional Qlik load prefixes.
    regex:
      /(?:^|\s)(?:\[[^\]\r\n]+\]|[A-Za-z_.$#@][A-Za-z0-9_.$#@ -]{0,180})\s*:\s*(?:(?:MAPPING|NOCONCATENATE)\s+|(?:(?:LEFT|RIGHT|INNER|OUTER)\s+)?(?:JOIN|KEEP)\s*(?:\([^)]*\))?\s*|CONCATENATE\s*(?:\([^)]*\))?\s*|(?:ADD|REPLACE|BUFFER)\s+)*(?:LOAD|SQL\s+SELECT|SELECT)\b/gi,
    strength: 100,
  },
  {
    // Prefix-led load without a table label, for example LEFT JOIN (...) LOAD.
    regex:
      /(?:^|\s)(?:(?:MAPPING|NOCONCATENATE)\s+|(?:(?:LEFT|RIGHT|INNER|OUTER)\s+)?(?:JOIN|KEEP)\s*(?:\([^)]*\))?\s*|CONCATENATE\s*(?:\([^)]*\))?\s*|(?:ADD|REPLACE|BUFFER)\s+)+(?:LOAD|SQL\s+SELECT|SELECT)\b/gi,
    strength: 95,
  },
  {
    regex: /(?:^|\s)STORE\s+(?:\[[^\]]+\]|[A-Za-z_.$#@][A-Za-z0-9_.$#@ -]*)\s+INTO\b/gi,
    strength: 90,
  },
  {
    regex: /(?:^|\s)DROP\s+(?:TABLES?|FIELDS?)\b/gi,
    strength: 90,
  },
  {
    regex: /(?:^|\s)(?:SET|LET)\s+[A-Za-z_.$#@][A-Za-z0-9_.$#@ -]*\s*=/gi,
    strength: 90,
  },
  {
    regex: /(?:^|\s)RENAME\s+(?:TABLE|FIELD)\b/gi,
    strength: 85,
  },
  {
    regex: /(?:^|\s)(?:QUALIFY|UNQUALIFY|TRACE|CALL|EXIT\s+SCRIPT)\b/gi,
    strength: 80,
  },
  {
    regex: /(?:^|\s)(?:FOR\s+EACH|FOR|NEXT|DO|LOOP|IF|ELSEIF|ELSE|END\s+IF|SUB|END\s+SUB)\b/gi,
    strength: 75,
  },
  {
    // Fallback for an anonymous LOAD/SELECT after a flattened comment.
    regex: /(?:^|\s)(?:LOAD|SQL\s+SELECT|SELECT)\b/gi,
    strength: 50,
  },
];

function leadingWhitespaceLength(value: string): number {
  return value.length - value.trimStart().length;
}

function collectStatementCandidates(value: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const item of STATEMENT_START_PATTERNS) {
    item.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = item.regex.exec(value)) !== null) {
      const leading = leadingWhitespaceLength(match[0]);
      candidates.push({
        start: (match.index ?? 0) + leading,
        end: (match.index ?? 0) + match[0].length,
        strength: item.strength,
      });
      if (match[0].length === 0) item.regex.lastIndex += 1;
    }
  }

  // Remove weak candidates that are nested inside a stronger grammar match,
  // such as the LOAD token inside "LEFT JOIN (...) LOAD".
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          other.strength > candidate.strength &&
          candidate.start >= other.start &&
          candidate.start < other.end,
      ),
  );
}

function findRecoveredStatementStart(value: string): number | undefined {
  const candidates = collectStatementCandidates(value);
  if (!candidates.length) return undefined;

  // Prefer the strongest complete grammar construct. This prevents nested
  // expressions such as IF(...) or the LOAD token inside LEFT JOIN (...) LOAD
  // from being mistaken for the beginning of the statement.
  candidates.sort((a, b) => b.strength - a.strength || a.start - b.start);
  return candidates[0].start;
}

function findLineCommentStarts(value: string): number[] {
  const starts: number[] = [];
  let quote: string | undefined;
  let squareDepth = 0;

  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (quote) {
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          index += 1;
          continue;
        }
        quote = undefined;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") {
      squareDepth += 1;
      continue;
    }
    if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }

    if (squareDepth === 0 && char === "/" && next === "/" && value[index - 1] !== ":") {
      starts.push(index);
      index += 1;
    }
  }
  return starts;
}

function spacesPreservingNewlines(value: string): string {
  return value.replace(/[^\r\n]/g, " ");
}

function stripBlockCommentsPreservingLayout(source: string): string {
  let result = "";
  let index = 0;
  let quote: string | undefined;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      result += char;
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          result += next;
          index += 2;
          continue;
        }
        quote = undefined;
      }
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          result += "  ";
          index += 2;
          break;
        }
        result += source[index] === "\n" || source[index] === "\r" ? source[index] : " ";
        index += 1;
      }
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function sanitizePhysicalLine(line: string): string {
  const commentStarts = findLineCommentStarts(line);
  const trimmed = line.trimStart();

  if (!commentStarts.length) {
    if (/^REM(?:\s|$)/i.test(trimmed)) return spacesPreservingNewlines(line);
    return line;
  }

  const firstComment = commentStarts[0];
  const lastComment = commentStarts.at(-1) ?? firstComment;
  const suffix = line.slice(lastComment + 2);
  const recoveredStart = findRecoveredStatementStart(suffix);

  if (recoveredStart !== undefined) {
    const absoluteStart = lastComment + 2 + recoveredStart;
    return spacesPreservingNewlines(line.slice(0, absoluteStart)) + line.slice(absoluteStart);
  }

  return line.slice(0, firstComment) + spacesPreservingNewlines(line.slice(firstComment));
}

/**
 * Remove Qlik comments while preserving source length and line layout.
 * It additionally recovers statements from scripts flattened to one line.
 */
export function stripQlikCommentsPreservingLayout(source: string): string {
  const withoutBlocks = stripBlockCommentsPreservingLayout(source);
  return withoutBlocks
    .split(/(\r\n|\n|\r)/)
    .map((part) => (part === "\r\n" || part === "\n" || part === "\r" ? part : sanitizePhysicalLine(part)))
    .join("");
}

function splitRawChunks(source: string): RawChunk[] {
  const chunks: RawChunk[] = [];
  let startOffset = 0;
  let startLine = 1;
  let line = 1;
  let quote: string | undefined;
  let squareDepth = 0;
  let roundDepth = 0;
  let curlyDepth = 0;
  let blockComment = false;

  const push = (endOffset: number, endLine: number): void => {
    chunks.push({
      raw: source.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      startLine,
      endLine,
    });
    startOffset = endOffset;
    startLine = endLine;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\n") line += 1;

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          index += 1;
          continue;
        }
        quote = undefined;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") roundDepth += 1;
    else if (char === ")") roundDepth = Math.max(0, roundDepth - 1);
    else if (char === "{") curlyDepth += 1;
    else if (char === "}") curlyDepth = Math.max(0, curlyDepth - 1);
    else if (
      char === ";" &&
      squareDepth === 0 &&
      roundDepth === 0 &&
      curlyDepth === 0
    ) {
      push(index + 1, line);
    }
  }

  if (startOffset < source.length) push(source.length, line);
  return chunks;
}

/** Split a Qlik script into semicolon-delimited, comment-free statements. */
export function splitQlikScriptStatements(source: string): QlikStatementSlice[] {
  const statements: QlikStatementSlice[] = [];

  for (const chunk of splitRawChunks(source)) {
    const cleanedLayout = stripQlikCommentsPreservingLayout(chunk.raw);
    const cleaned = cleanedLayout.trim();
    if (!cleaned) continue;

    statements.push({
      raw: chunk.raw.trim(),
      cleaned,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    });
  }

  return statements;
}
