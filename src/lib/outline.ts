export type OutlineHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface OutlineHeading {
  id: string;
  level: OutlineHeadingLevel;
  text: string;
  /** 1-based line number in the full Markdown document (including frontmatter). */
  line: number;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const ATX_HEADING_REGEX = /^[ ]{0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const BACKTICK_FENCE_OPEN_REGEX = /^[ ]{0,3}(`{3,})([^`]*)$/;
const TILDE_FENCE_OPEN_REGEX = /^[ ]{0,3}(~{3,})(.*)$/;

function stripClosingHashes(raw: string): string {
  const trimmedEnd = raw.replace(/[ \t]+$/, "");
  if (/^#+$/.test(trimmedEnd)) {
    return "";
  }
  return trimmedEnd.replace(/[ \t]+#+$/, "").trim();
}

function formatHeadingPlainText(raw: string): string {
  // Remove HTML comments (e.g., <!-- hl:high -->)
  let text = raw.replace(/<!--[\s\S]*?-->/g, "");

  // Protect inline code spans so markers like * or _ inside code are preserved verbatim
  const codeSpans: string[] = [];
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks: string, code: string) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(code.trim());
    return token;
  });

  // Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links: [label](url) -> label
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Reference-style links: [label][ref] -> label
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  // Strikethrough & emphasis
  text = text
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\w])___([^_]+)___(?=$|[^\w])/g, "$1$2")
    .replace(/(^|[^\w])__([^_]+)__(?=$|[^\w])/g, "$1$2")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[^\w])_([^_]+)_(?=$|[^\w])/g, "$1$2");

  // Unescape common Markdown backslash escapes
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, "$1");

  // Restore inline code text
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_match, idx: string) => {
    return codeSpans[Number(idx)] ?? "";
  });

  return text.replace(/\s+/g, " ").trim();
}

function countLinesInPrefix(prefix: string): number {
  if (!prefix) return 0;
  const matches = prefix.match(/\r?\n/g);
  return matches ? matches.length : 0;
}

/**
 * Extracts ATX Markdown headings (`#` through `######`) with 1-based line numbers
 * relative to the full document (including any leading YAML frontmatter).
 * Headings inside YAML frontmatter, fenced code blocks, and multi-line HTML comments
 * are ignored.
 */
export function extractOutlineHeadings(markdown: string): OutlineHeading[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  let startLineIndex = 0;
  const frontmatterMatch = markdown.match(FRONTMATTER_REGEX);
  if (frontmatterMatch) {
    startLineIndex = /\r?\n$/.test(frontmatterMatch[0])
      ? countLinesInPrefix(frontmatterMatch[0])
      : lines.length;
  }

  const headings: OutlineHeading[] = [];

  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  let insideHtmlComment = false;

  for (let i = startLineIndex; i < lines.length; i++) {
    const line = lines[i];

    if (fenceChar !== null) {
      const closeRegex = new RegExp(`^[ ]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`);
      if (closeRegex.test(line)) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    if (insideHtmlComment) {
      if (line.includes("-->")) {
        insideHtmlComment = false;
      }
      continue;
    }

    const backtickOpen = line.match(BACKTICK_FENCE_OPEN_REGEX);
    if (backtickOpen) {
      fenceChar = "`";
      fenceLen = backtickOpen[1].length;
      continue;
    }

    const tildeOpen = line.match(TILDE_FENCE_OPEN_REGEX);
    if (tildeOpen) {
      fenceChar = "~";
      fenceLen = tildeOpen[1].length;
      continue;
    }

    // Track multi-line HTML comment blocks that start on a non-heading line
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
      insideHtmlComment = true;
      continue;
    }

    const match = line.match(ATX_HEADING_REGEX);
    if (!match) continue;

    const level = match[1].length as OutlineHeadingLevel;
    const rawContent = stripClosingHashes(match[2] ?? "");
    const text = formatHeadingPlainText(rawContent);
    if (!text) continue;

    const lineNumber = i + 1;
    headings.push({
      id: `heading-${lineNumber}-${headings.length}`,
      level,
      text,
      line: lineNumber,
    });
  }

  return headings;
}

/**
 * Returns the ID of the heading active at the given 1-based cursor line
 * (the last heading whose line number is <= cursorLine), or null if none.
 */
export function findActiveOutlineHeadingId(
  headings: OutlineHeading[],
  cursorLine: number
): string | null {
  if (headings.length === 0 || cursorLine < 1) return null;

  let activeId: string | null = null;
  for (const heading of headings) {
    if (heading.line <= cursorLine) {
      activeId = heading.id;
    } else {
      break;
    }
  }
  return activeId;
}
