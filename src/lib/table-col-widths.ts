import { getDictionary, type Locale } from "./i18n";

export const COL_WIDTHS_COMMENT_REGEX =
  /<!--\s*col-widths\s*:\s*([^>]*?)\s*-->/gi;

const COL_WIDTHS_LINE_REGEX =
  /^[ \t]*<!--\s*col-widths\s*:\s*([^>]*?)\s*-->[ \t]*$/i;

export const MIN_COLUMN_WIDTH_PERCENT = 5;
export const MAX_TABLE_COLUMNS = 20;

export interface ColumnWidthPreset {
  id: string;
  label: string;
  widths: number[];
}

export interface MarkdownTableContext {
  headers: string[];
  columnCount: number;
  /** 1-based line number of the table header row */
  tableStartLine: number;
  /** 1-based line number of the last row in the table */
  tableEndLine: number;
  /** 1-based line number of an associated <!-- col-widths: ... --> line, if present */
  directiveLine: number | null;
  /** Normalized integer percentage widths summing to 100, or null when automatic */
  widths: number[] | null;
}

export interface TextRangeEdit {
  from: number;
  to: number;
  insert: string;
}

const TOKEN_NUMBER_REGEX = /^(\d+(?:\.\d+)?)%?$/;
const DELIMITER_CELL_REGEX = /^:?-{1,}:?$/;
const FENCE_LINE_REGEX = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Parses a `<!-- col-widths: ... -->` specification string into positive numeric weights.
 * Accepts comma, whitespace, or colon separators and optional `%` suffixes.
 * Returns null if empty, malformed, contains non-numeric tokens, or exceeds column limits.
 */
export function parseColWidthsSpec(rawSpec: string): number[] | null {
  const trimmed = rawSpec.trim();
  if (!trimmed) return null;

  const tokens = trimmed
    .split(/[\s,:]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0 || tokens.length > MAX_TABLE_COLUMNS) {
    return null;
  }

  const values: number[] = [];
  for (const token of tokens) {
    const match = token.match(TOKEN_NUMBER_REGEX);
    if (!match) return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    values.push(num);
  }

  return values;
}

/**
 * Normalizes positive numeric weights to integer percentages summing to exactly 100,
 * matching `columnCount` and enforcing `minPercent` per column.
 */
export function normalizeColumnWidths(
  rawValues: number[],
  columnCount: number,
  minPercent = MIN_COLUMN_WIDTH_PERCENT
): number[] {
  if (columnCount <= 0) return [];
  if (columnCount === 1) return [100];

  const safeMin = Math.max(1, Math.min(minPercent, Math.floor(100 / columnCount)));

  const validRaw = rawValues.filter((v) => Number.isFinite(v) && v > 0);
  let fitted: number[];

  if (validRaw.length === 0) {
    fitted = Array<number>(columnCount).fill(1);
  } else if (validRaw.length >= columnCount) {
    fitted = validRaw.slice(0, columnCount);
  } else {
    const sum = validRaw.reduce((acc, n) => acc + n, 0);
    const missing = columnCount - validRaw.length;
    const fillVal = sum < 100 ? (100 - sum) / missing : sum / validRaw.length;
    fitted = [...validRaw, ...Array<number>(missing).fill(fillVal)];
  }

  const total = fitted.reduce((acc, n) => acc + n, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return buildEqualColumnWidths(columnCount);
  }

  // Scale proportionally to 100%, then clamp only columns below safeMin via water-filling
  const exact = fitted.map((v) => (v / total) * 100);
  const locked = new Array<boolean>(columnCount).fill(false);

  while (true) {
    let newlyLocked = false;
    for (let i = 0; i < columnCount; i++) {
      if (!locked[i] && exact[i] < safeMin) {
        exact[i] = safeMin;
        locked[i] = true;
        newlyLocked = true;
      }
    }
    if (!newlyLocked) break;

    const lockedSum = exact.reduce((sum, v, i) => (locked[i] ? sum + v : sum), 0);
    const unlockedSum = exact.reduce(
      (sum, v, i) => (!locked[i] ? sum + v : sum),
      0
    );
    const remaining = Math.max(0, 100 - lockedSum);
    if (unlockedSum <= 0) break;

    for (let i = 0; i < columnCount; i++) {
      if (!locked[i]) {
        exact[i] = (exact[i] / unlockedSum) * remaining;
      }
    }
  }

  const floors = exact.map((v) => Math.max(safeMin, Math.floor(v)));
  let diff = 100 - floors.reduce((sum, n) => sum + n, 0);

  if (diff > 0) {
    const ranked = exact
      .map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
    for (let k = 0; k < diff; k++) {
      floors[ranked[k % ranked.length].idx] += 1;
    }
  } else if (diff < 0) {
    const ranked = exact
      .map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => a.frac - b.frac || b.idx - a.idx);
    let k = 0;
    while (diff < 0 && k < ranked.length * 2) {
      const idx = ranked[k % ranked.length].idx;
      if (floors[idx] > safeMin) {
        floors[idx] -= 1;
        diff += 1;
      }
      k += 1;
    }
  }

  return floors;
}

export function resolveTableColumnWidths(
  rawSpec: string,
  columnCount: number
): number[] | null {
  if (columnCount < 1) return null;
  const parsed = parseColWidthsSpec(rawSpec);
  if (!parsed) return null;
  return normalizeColumnWidths(parsed, columnCount);
}

export function formatColWidthsDirective(widths: number[]): string {
  return `<!-- col-widths: ${widths.join(", ")} -->`;
}

export function buildEqualColumnWidths(columnCount: number): number[] {
  if (columnCount <= 0) return [];
  const base = Math.floor(100 / columnCount);
  const rem = 100 - base * columnCount;
  return Array.from({ length: columnCount }, (_, i) =>
    i < rem ? base + 1 : base
  );
}

export function buildColumnWidthPresets(
  columnCount: number,
  locale: Locale = "ja"
): ColumnWidthPreset[] {
  if (columnCount < 2) return [];
  const t = getDictionary(locale).tableColWidths;

  const presets: ColumnWidthPreset[] = [
    {
      id: "equal",
      label: t.presetEqual,
      widths: buildEqualColumnWidths(columnCount),
    },
  ];

  if (columnCount === 2) {
    presets.push(
      { id: "narrow-left", label: t.presetNarrowLeft, widths: [25, 75] },
      { id: "narrow-right", label: t.presetNarrowRight, widths: [75, 25] }
    );
    return presets;
  }

  if (columnCount === 3) {
    presets.push(
      { id: "narrow-left", label: t.presetNarrowLeft, widths: [15, 30, 55] },
      { id: "narrow-right", label: t.presetNarrowRight, widths: [45, 40, 15] },
      { id: "wide-center", label: t.presetWideCenter, widths: [20, 60, 20] }
    );
    return presets;
  }

  const restEqual = (firstTotal: number, count: number) => {
    const base = Math.floor(firstTotal / count);
    const rem = firstTotal - base * count;
    return Array.from({ length: count }, (_, i) => (i < rem ? base + 1 : base));
  };

  presets.push(
    {
      id: "narrow-left",
      label: t.presetNarrowLeft,
      widths: [12, ...restEqual(88, columnCount - 1)],
    },
    {
      id: "narrow-right",
      label: t.presetNarrowRight,
      widths: [...restEqual(85, columnCount - 1), 15],
    },
    {
      id: "wide-center",
      label: t.presetWideCenter,
      widths: [15, ...restEqual(70, columnCount - 2), 15],
    }
  );

  return presets;
}

/**
 * Adjusts adjacent columns (`dividerIndex` and `dividerIndex + 1`) by `deltaPercent`
 * while keeping total width invariant and enforcing `minPercent` on both columns.
 */
export function adjustAdjacentColumnWidths(
  widths: number[],
  dividerIndex: number,
  deltaPercent: number,
  minPercent = MIN_COLUMN_WIDTH_PERCENT
): number[] {
  if (
    dividerIndex < 0 ||
    dividerIndex >= widths.length - 1 ||
    !Number.isFinite(deltaPercent)
  ) {
    return [...widths];
  }

  const left = widths[dividerIndex];
  const right = widths[dividerIndex + 1];
  const safeMin = Math.max(1, Math.min(minPercent, Math.floor((left + right) / 2)));

  const minDelta = safeMin - left;
  const maxDelta = right - safeMin;
  const clampedDelta = Math.round(
    Math.min(maxDelta, Math.max(minDelta, deltaPercent))
  );

  if (clampedDelta === 0) return [...widths];

  const next = [...widths];
  next[dividerIndex] = left + clampedDelta;
  next[dividerIndex + 1] = right - clampedDelta;
  return next;
}

/**
 * Updates a single column's percentage width and rebalances remaining columns
 * so the sum stays strictly 100% and every column respects `minPercent`.
 */
export function updateSingleColumnWidth(
  widths: number[],
  colIndex: number,
  targetPercent: number,
  minPercent = MIN_COLUMN_WIDTH_PERCENT
): number[] {
  const n = widths.length;
  if (n <= 1 || colIndex < 0 || colIndex >= n || !Number.isFinite(targetPercent)) {
    return [...widths];
  }

  const safeMin = Math.max(1, Math.min(minPercent, Math.floor(100 / n)));
  const maxForSingle = 100 - safeMin * (n - 1);
  const clampedTarget = Math.round(
    Math.min(maxForSingle, Math.max(safeMin, targetPercent))
  );

  const otherIndices = widths
    .map((_, i) => i)
    .filter((i) => i !== colIndex);
  const remainingTarget = 100 - clampedTarget;
  const otherRaw = otherIndices.map((i) => Math.max(1, widths[i]));
  const otherTotal = otherRaw.reduce((acc, v) => acc + v, 0);

  const exactOthers = otherRaw.map((v) => (v / otherTotal) * remainingTarget);
  const locked = new Array<boolean>(otherIndices.length).fill(false);

  while (true) {
    let newlyLocked = false;
    for (let i = 0; i < otherIndices.length; i++) {
      if (!locked[i] && exactOthers[i] < safeMin) {
        exactOthers[i] = safeMin;
        locked[i] = true;
        newlyLocked = true;
      }
    }
    if (!newlyLocked) break;

    const lockedSum = exactOthers.reduce(
      (sum, v, i) => (locked[i] ? sum + v : sum),
      0
    );
    const unlockedSum = exactOthers.reduce(
      (sum, v, i) => (!locked[i] ? sum + v : sum),
      0
    );
    const leftForUnlocked = Math.max(0, remainingTarget - lockedSum);
    if (unlockedSum <= 0) break;

    for (let i = 0; i < otherIndices.length; i++) {
      if (!locked[i]) {
        exactOthers[i] = (exactOthers[i] / unlockedSum) * leftForUnlocked;
      }
    }
  }

  const floors = exactOthers.map((v) => Math.max(safeMin, Math.floor(v)));
  let diff = remainingTarget - floors.reduce((acc, v) => acc + v, 0);
  if (diff > 0) {
    const ranked = exactOthers
      .map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
    for (let k = 0; k < diff; k++) {
      floors[ranked[k % ranked.length].idx] += 1;
    }
  } else if (diff < 0) {
    const ranked = exactOthers
      .map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => a.frac - b.frac || b.idx - a.idx);
    let k = 0;
    while (diff < 0 && k < ranked.length * 2) {
      const idx = ranked[k % ranked.length].idx;
      if (floors[idx] > safeMin) {
        floors[idx] -= 1;
        diff += 1;
      }
      k += 1;
    }
  }

  const next = [...widths];
  next[colIndex] = clampedTarget;
  otherIndices.forEach((origIdx, k) => {
    next[origIdx] = floors[k];
  });

  return next;
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("|")) return null;

  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length && body[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());

  return cells.length > 0 ? cells : null;
}

function isDelimiterRow(line: string, expectedCols: number): boolean {
  const cells = splitMarkdownTableRow(line);
  if (!cells || cells.length !== expectedCols) return false;
  return cells.every((cell) => DELIMITER_CELL_REGEX.test(cell));
}

function isTableBodyRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (FENCE_LINE_REGEX.test(trimmed)) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (COL_WIDTHS_LINE_REGEX.test(trimmed)) return false;
  return trimmed.includes("|");
}

function cleanHeaderLabel(raw: string, index: number): string {
  const cleaned = raw
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
  return cleaned || `列${index + 1}`;
}

/**
 * Detects a GFM Markdown table enclosing `cursorLine` (1-based), including
 * an immediately preceding `<!-- col-widths: ... -->` directive line.
 * Skips YAML frontmatter and fenced code blocks.
 */
export function detectTableAtCursorLine(
  markdown: string,
  cursorLine: number
): MarkdownTableContext | null {
  if (!markdown || cursorLine < 1) return null;

  const lines = markdown.split(/\r?\n/);
  const totalLines = lines.length;
  if (cursorLine > totalLines) return null;

  let i = 0;

  // Skip YAML frontmatter
  if (lines[0]?.trim() === "---") {
    for (let fmIdx = 1; fmIdx < totalLines; fmIdx++) {
      if (lines[fmIdx].trim() === "---") {
        i = fmIdx + 1;
        break;
      }
    }
  }

  let activeFence: { char: string; length: number } | null = null;

  while (i < totalLines) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_LINE_REGEX);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!activeFence) {
        activeFence = { char: marker[0], length: marker.length };
      } else if (
        marker[0] === activeFence.char &&
        marker.length >= activeFence.length &&
        line.trim().length === marker.length
      ) {
        activeFence = null;
      }
      i += 1;
      continue;
    }

    if (activeFence) {
      i += 1;
      continue;
    }

    const headerCells = splitMarkdownTableRow(line);
    if (
      headerCells &&
      headerCells.length >= 2 &&
      i + 1 < totalLines &&
      isDelimiterRow(lines[i + 1], headerCells.length)
    ) {
      const tableStartLine = i + 1; // 1-based
      let endIdx = i + 1;
      while (endIdx + 1 < totalLines && isTableBodyRow(lines[endIdx + 1])) {
        endIdx += 1;
      }
      const tableEndLine = endIdx + 1; // 1-based

      // Look for an immediately preceding <!-- col-widths: ... --> (allowing at most 1 blank line)
      let directiveLine: number | null = null;
      let widths: number[] | null = null;

      let probeIdx = i - 1;
      if (probeIdx >= 0 && lines[probeIdx].trim() === "") {
        probeIdx -= 1;
      }
      if (probeIdx >= 0) {
        const dirMatch = lines[probeIdx].match(COL_WIDTHS_LINE_REGEX);
        if (dirMatch) {
          directiveLine = probeIdx + 1; // 1-based
          widths = resolveTableColumnWidths(dirMatch[1], headerCells.length);
        }
      }

      const activeStart = directiveLine ?? tableStartLine;
      if (cursorLine >= activeStart && cursorLine <= tableEndLine) {
        return {
          headers: headerCells.map((cell, idx) => cleanHeaderLabel(cell, idx)),
          columnCount: headerCells.length,
          tableStartLine,
          tableEndLine,
          directiveLine,
          widths,
        };
      }

      i = endIdx + 1;
      continue;
    }

    i += 1;
  }

  return null;
}

function getLineOffsets(markdown: string): Array<{ from: number; to: number; eolLength: number }> {
  const result: Array<{ from: number; to: number; eolLength: number }> = [];
  let pos = 0;
  const len = markdown.length;

  while (pos <= len) {
    const lfIdx = markdown.indexOf("\n", pos);
    if (lfIdx === -1) {
      result.push({ from: pos, to: len, eolLength: 0 });
      break;
    }
    const isCrlf = lfIdx > pos && markdown[lfIdx - 1] === "\r";
    const to = isCrlf ? lfIdx - 1 : lfIdx;
    const eolLength = isCrlf ? 2 : 1;
    result.push({ from: pos, to, eolLength });
    pos = lfIdx + 1;
  }

  return result;
}

/**
 * Computes a single atomic `{ from, to, insert }` edit to insert, update, or remove
 * the `<!-- col-widths: ... -->` directive line above the target table.
 */
export function computeColWidthsDirectiveEdit(
  markdown: string,
  context: MarkdownTableContext,
  nextWidths: number[] | null
): TextRangeEdit | null {
  const lineOffsets = getLineOffsets(markdown);

  if (nextWidths === null) {
    if (context.directiveLine === null) return null;
    const target = lineOffsets[context.directiveLine - 1];
    if (!target) return null;
    return {
      from: target.from,
      to: target.to + target.eolLength,
      insert: "",
    };
  }

  const normalized = normalizeColumnWidths(nextWidths, context.columnCount);
  const directiveText = formatColWidthsDirective(normalized);

  if (context.directiveLine !== null) {
    const target = lineOffsets[context.directiveLine - 1];
    if (!target) return null;
    return {
      from: target.from,
      to: target.to,
      insert: directiveText,
    };
  }

  const tableStart = lineOffsets[context.tableStartLine - 1];
  if (!tableStart) return null;
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  return {
    from: tableStart.from,
    to: tableStart.from,
    insert: `${directiveText}${eol}`,
  };
}
