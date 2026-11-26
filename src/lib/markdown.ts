import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Element, Parent, Root, RootContent, Text } from "hast";
import type {
  CompiledDocument,
  DocumentFrontmatter,
  TocEntry,
} from "@/types/document";
import { parseMarkdownDocument } from "./frontmatter";
import {
  formatColorBarNumber,
  formatColorBarPercent,
  parseColorBarSpec,
} from "./colorbar";
import {
  parseCardColumnsAttr,
  parseCardItem,
  resolveCardColumns,
  type ParsedCardItem,
} from "./cards";
import {
  buildSvgChart,
  CHART_CENTER,
  CHART_DONUT_RING_RADIUS,
  CHART_DONUT_RING_STROKE_WIDTH,
  CHART_OUTER_RADIUS,
  CHART_SVG_SIZE,
  type ChartKind,
} from "./pie-chart";
import {
  getAssetDisplayName,
  sanitizePlaceholderDimension,
} from "./unresolved-assets";

type CalloutType =
  | "note"
  | "warning"
  | "tip"
  | "important"
  | "caution"
  | "summary"
  | "success";


const ALLOWED_TAG_NAMES = (defaultSchema.tagNames || []).filter(
  (tag) => tag !== "source" && tag !== "picture"
);

const SANITIZE_SCHEMA: NonNullable<Parameters<typeof rehypeSanitize>[0]> = {
  ...defaultSchema,
  clobberPrefix: "user-content-",
  tagNames: Array.from(new Set([...ALLOWED_TAG_NAMES, "div", "span"])),
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] || []).filter(
      (attr) => attr !== "className" && attr !== "style"
    ),
    div: [
      ...(defaultSchema.attributes?.div || []),
      ["className", "page-break"],
      ["dataChapterMarker", "start", "end"],
      ["dataCardsMarker", "start", "end"],
      ["dataCardsCols", "2", "3", "4"],
      ["dataChartKind", "pie", "donut"],
      "dataChartTitle",
      "dataChartSpec",
      "dataColorbar",
    ],
    span: [
      ...(defaultSchema.attributes?.span || []),
      ["dataHl", /^[a-zA-Z0-9_-]+$/],
    ],
    img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
    th: [...(defaultSchema.attributes?.th || []), "align"],
    td: [...(defaultSchema.attributes?.td || []), "align"],
    code: [
      [
        "className",
        /^language-[a-zA-Z0-9_.:/-]+$/,
        "math-inline",
        "math-display",
      ],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data", "asset", "rel"],
  },
};

const SAFE_RASTER_DATA_URI_REGEX =
  /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=_\-\s]+$/i;
const SVG_DATA_URI_REGEX =
  /^data:image\/svg\+xml(?:\s*;\s*charset=[a-zA-Z0-9._-]+)?(?:\s*;\s*(base64))?,([\s\S]*)$/i;
const DANGEROUS_SVG_PATTERN =
  /<\s*(?:script|foreignObject|iframe|object|embed|applet|meta|link|base|animate|set|handler)\b|\bon[a-z]+\s*=|(?:javascript|vbscript|data\s*:\s*text\/html)\s*:|@import\b|expression\s*\(/i;

function decodeHtmlNumericEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#([0-9]+);?/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function decodeBase64Utf8(encoded: string): string | null {
  try {
    const cleaned = encoded.replace(/\s+/g, "");
    if (typeof Buffer !== "undefined") {
      return Buffer.from(cleaned, "base64").toString("utf8");
    }
    if (typeof atob === "function") {
      return atob(cleaned);
    }
    return null;
  } catch {
    return null;
  }
}

function isSafeSvgDataUri(uri: string): boolean {
  const match = uri.match(SVG_DATA_URI_REGEX);
  if (!match) return false;

  const isBase64 = Boolean(match[1]);
  const rawPayload = match[2] ?? "";

  let decoded: string | null = null;
  if (isBase64) {
    decoded = decodeBase64Utf8(rawPayload);
  } else {
    try {
      decoded = decodeURIComponent(rawPayload);
    } catch {
      return false;
    }
  }

  if (!decoded) return false;
  const normalized = decodeHtmlNumericEntities(decoded);
  return !DANGEROUS_SVG_PATTERN.test(normalized);
}

export function sanitizeImageUrl(
  url: string,
  options: { allowRelativePath?: boolean } = {}
): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return trimmed;
      }
    } catch {
      return "";
    }
    return "";
  }

  if (/^data:/i.test(trimmed)) {
    if (SAFE_RASTER_DATA_URI_REGEX.test(trimmed)) {
      return trimmed;
    }
    if (isSafeSvgDataUri(trimmed)) {
      return trimmed;
    }
    return "";
  }

  if (
    options.allowRelativePath &&
    !trimmed.startsWith("//") &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
  ) {
    return trimmed;
  }

  return "";
}

function rehypeNormalizeClobberPrefix() {
  return (tree: Root) => {
    const doublePrefix = "user-content-user-content-";
    visit(tree, "element", (node: Element) => {
      if (!node.properties) return;

      for (const key of ["id", "name"] as const) {
        const val = node.properties[key];
        if (typeof val === "string" && val.startsWith(doublePrefix)) {
          node.properties[key] = `user-content-${val.slice(doublePrefix.length)}`;
        }
      }

      const props = node.properties as Record<string, unknown>;
      for (const key of ["ariaDescribedBy", "ariaLabelledBy"] as const) {
        const val = props[key];
        if (typeof val === "string" && val.startsWith(doublePrefix)) {
          props[key] = `user-content-${val.slice(doublePrefix.length)}`;
        } else if (Array.isArray(val)) {
          props[key] = val.map((item) =>
            typeof item === "string" && item.startsWith(doublePrefix)
              ? `user-content-${item.slice(doublePrefix.length)}`
              : item
          );
        }
      }
    });
  };
}

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: "NOTE",
  warning: "WARNING",
  tip: "TIP",
  important: "IMPORTANT",
  caution: "CAUTION",
  summary: "SUMMARY",
  success: "SUCCESS",
};

const BADGE_SPEC_MAP: Record<string, { className: string; label: string }> = {
  critical: { className: "doc-badge-critical", label: "Critical" },
  "緊急": { className: "doc-badge-critical", label: "緊急" },
  high: { className: "doc-badge-high", label: "High" },
  "高": { className: "doc-badge-high", label: "高" },
  medium: { className: "doc-badge-medium", label: "Medium" },
  "中": { className: "doc-badge-medium", label: "中" },
  low: { className: "doc-badge-low", label: "Low" },
  "低": { className: "doc-badge-low", label: "低" },
  info: { className: "doc-badge-info", label: "Info" },
  "参考": { className: "doc-badge-info", label: "参考" },
  scoping: { className: "doc-badge-scoping", label: "Scoping" },
  active: { className: "doc-badge-active", label: "Active" },
  draft: { className: "doc-badge-draft", label: "Draft" },
  final: { className: "doc-badge-final", label: "Final" },
  closed: { className: "doc-badge-closed", label: "Closed" },
};

const BADGE_REGEX =
  /:(Critical|High|Medium|Low|Info|緊急|高|中|低|参考|Scoping|Active|Draft|Final|Closed):/gi;

function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getNodeText(node: Element | Parent): string {
  let out = "";
  for (const child of node.children) {
    if (child.type === "text") {
      out += child.value;
    } else if ("children" in child) {
      out += getNodeText(child as Parent);
    }
  }
  return out;
}

type MdastLikeNode = {
  type: string;
  value?: string;
  children?: MdastLikeNode[];
};

const PAGEBREAK_COMMENT_REGEX = /<!--\s*pagebreak\s*-->/gi;
const CHAPTER_START_COMMENT_REGEX = /<!--\s*chapter\s*-->/gi;
const CHAPTER_END_COMMENT_REGEX = /<!--\s*\/chapter\s*-->/gi;
const HL_COMMENT_REGEX = /<!--\s*hl:\s*([a-zA-Z0-9_-]+)\s*-->/gi;
const NEWPAGE_LINE_REGEX = /^[ \t]*\\newpage[ \t]*$/;

function transformMdastDirectives(
  node: MdastLikeNode,
  insideBlockquote: boolean
) {
  if (!Array.isArray(node.children)) return;

  const nextInsideBlockquote = insideBlockquote || node.type === "blockquote";

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    // コードブロック・インラインコード内のディレクティブ記法はリテラルとして保持
    if (child.type === "code" || child.type === "inlineCode") {
      continue;
    }

    if (child.type === "html" && typeof child.value === "string") {
      let next = child.value.replace(
        HL_COMMENT_REGEX,
        '<span data-hl="$1"></span>'
      );
      if (!nextInsideBlockquote) {
        next = next
          .replace(
            PAGEBREAK_COMMENT_REGEX,
            '\n<div class="page-break"></div>\n'
          )
          .replace(
            CHAPTER_START_COMMENT_REGEX,
            '\n<div data-chapter-marker="start"></div>\n'
          )
          .replace(
            CHAPTER_END_COMMENT_REGEX,
            '\n<div data-chapter-marker="end"></div>\n'
          );
      }
      child.value = next;
      continue;
    }

    if (
      !nextInsideBlockquote &&
      child.type === "paragraph" &&
      Array.isArray(child.children)
    ) {
      if (
        child.children.length === 1 &&
        child.children[0].type === "text" &&
        typeof child.children[0].value === "string" &&
        NEWPAGE_LINE_REGEX.test(child.children[0].value)
      ) {
        node.children[i] = {
          type: "html",
          value: '<div class="page-break"></div>',
        };
        continue;
      }

      const nextParaChildren: MdastLikeNode[] = [];
      let changed = false;

      for (const pChild of child.children) {
        if (pChild.type !== "text" || typeof pChild.value !== "string") {
          nextParaChildren.push(pChild);
          continue;
        }
        const lines = pChild.value.split(/\r?\n/);
        if (!lines.some((line) => NEWPAGE_LINE_REGEX.test(line))) {
          nextParaChildren.push(pChild);
          continue;
        }
        changed = true;
        let textBuf: string[] = [];
        const flushText = () => {
          if (textBuf.length > 0) {
            nextParaChildren.push({ type: "text", value: textBuf.join("\n") });
            textBuf = [];
          }
        };
        for (const line of lines) {
          if (NEWPAGE_LINE_REGEX.test(line)) {
            flushText();
            nextParaChildren.push({
              type: "html",
              value: '<div class="page-break"></div>',
            });
          } else {
            textBuf.push(line);
          }
        }
        flushText();
      }

      if (changed) {
        child.children = nextParaChildren;
      }
    }

    transformMdastDirectives(child, nextInsideBlockquote);
  }
}

function remarkDirectives() {
  return (tree: unknown) => {
    transformMdastDirectives(tree as MdastLikeNode, false);
  };
}

/**
 * rehype-slug が生成した見出し ID を Paged.js の querySelector("#id") で
 * 確実に SyntaxError にならない有効な CSS セレクタ ID へ正規化する
 */
function rehypeSafeHeadingIds() {
  return (tree: Root) => {
    const usedIds = new Set<string>();
    let fallbackIndex = 1;

    visit(tree, "element", (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;

      const rawId =
        typeof node.properties?.id === "string" ? node.properties.id : "";

      const sanitized = rawId
        .replace(/[^\p{L}\p{N}_-]/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");

      const baseId = sanitized
        ? `sec-${sanitized}`
        : `sec-heading-${fallbackIndex++}`;

      let uniqueId = baseId;
      let suffix = 2;
      while (usedIds.has(uniqueId)) {
        uniqueId = `${baseId}-${suffix++}`;
      }

      usedIds.add(uniqueId);
      node.properties = {
        ...node.properties,
        id: uniqueId,
      };
    });
  };
}

function isChapterMarkerNode(
  node: RootContent | undefined,
  kind: "start" | "end"
): boolean {
  if (!node) return false;
  if (node.type === "element" && node.tagName === "div") {
    return node.properties?.dataChapterMarker === kind;
  }
  if ((node as { type: string; value?: string }).type === "raw") {
    const val = (node as { value?: string }).value || "";
    return val.includes(`data-chapter-marker="${kind}"`);
  }
  return false;
}

function isWhitespaceText(node: RootContent | undefined): boolean {
  return (
    Boolean(node) &&
    node!.type === "text" &&
    !(node as Text).value.trim()
  );
}

function rehypeChapterCovers() {
  return (tree: Root) => {
    const children = tree.children;

    for (let i = 0; i < children.length; i++) {
      if (!isChapterMarkerNode(children[i], "start")) continue;

      let cursor = i + 1;
      while (cursor < children.length && isWhitespaceText(children[cursor])) {
        cursor++;
      }

      const headingNode = children[cursor];
      if (
        !headingNode ||
        headingNode.type !== "element" ||
        headingNode.tagName !== "h1"
      ) {
        children.splice(i, 1);
        i--;
        continue;
      }

      let explicitEndIdx = -1;
      const searchLimit = Math.min(children.length, cursor + 12);
      for (let j = cursor + 1; j < searchLimit; j++) {
        if (isChapterMarkerNode(children[j], "end")) {
          explicitEndIdx = j;
          break;
        }
        if (isChapterMarkerNode(children[j], "start")) {
          break;
        }
      }

      const leadNodes: Element[] = [];
      let replaceEndIdx = cursor;

      if (explicitEndIdx !== -1) {
        for (let j = cursor + 1; j < explicitEndIdx; j++) {
          const item = children[j];
          if (item.type === "element") {
            leadNodes.push(item);
          }
        }
        replaceEndIdx = explicitEndIdx;
      } else {
        let nextIdx = cursor + 1;
        while (
          nextIdx < children.length &&
          isWhitespaceText(children[nextIdx])
        ) {
          nextIdx++;
        }
        const maybeParagraph = children[nextIdx];
        if (
          maybeParagraph &&
          maybeParagraph.type === "element" &&
          maybeParagraph.tagName === "p"
        ) {
          leadNodes.push(maybeParagraph);
          replaceEndIdx = nextIdx;
        }
      }

      const innerChildren: Element[] = [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["chapter-cover-bar"] },
          children: [],
        },
        headingNode,
      ];

      if (leadNodes.length > 0) {
        innerChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["chapter-cover-lead"] },
          children: leadNodes,
        });
      }

      const chapterSection: Element = {
        type: "element",
        tagName: "section",
        properties: { className: ["doc-chapter-cover"] },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["chapter-cover-inner"] },
            children: innerChildren,
          },
        ],
      };

      children.splice(i, replaceEndIdx - i + 1, chapterSection);
    }
  };
}

/**
 * 特定単語(:Critical:, :High:, :Draft:等)をバッジ要素へ変換する
 * コードブロック(<pre>)およびインラインコード(<code>)内は対象外
 */

const HEADING_HL_ALIASES: Record<string, string> = {
  critical: "critical",
  danger: "critical",
  high: "high",
  medium: "medium",
  warning: "medium",
  low: "low",
  success: "low",
  info: "info",
  scoping: "scoping",
  neutral: "neutral",
  primary: "primary",
  accent: "accent",
  none: "none",
};

const BADGE_TO_HL_KIND: Array<[string, string]> = [
  ["doc-badge-critical", "critical"],
  ["doc-badge-high", "high"],
  ["doc-badge-medium", "medium"],
  ["doc-badge-low", "low"],
  ["doc-badge-final", "low"],
  ["doc-badge-info", "info"],
  ["doc-badge-active", "info"],
  ["doc-badge-scoping", "scoping"],
  ["doc-badge-draft", "neutral"],
  ["doc-badge-closed", "neutral"],
];

function extractExplicitHlAndStrip(node: Element): string | null {
  let found: string | null = null;
  if (!node.children) return null;

  const nextChildren: Element["children"] = [];
  for (const child of node.children) {
    if (
      child.type === "element" &&
      child.tagName === "span" &&
      typeof child.properties?.dataHl === "string"
    ) {
      const raw = child.properties.dataHl.trim().toLowerCase();
      if (!found && raw in HEADING_HL_ALIASES) {
        found = HEADING_HL_ALIASES[raw];
      }
      continue;
    }
    if (child.type === "element") {
      const nested = extractExplicitHlAndStrip(child);
      if (!found && nested) found = nested;
    }
    nextChildren.push(child);
  }
  node.children = nextChildren;
  return found;
}

function findBadgeHlKind(node: Element): string | null {
  let detected: string | null = null;
  visit(node, "element", (child: Element) => {
    if (detected) return;
    const classes = Array.isArray(child.properties?.className)
      ? (child.properties.className as string[])
      : [];
    for (const [badgeClass, hlKind] of BADGE_TO_HL_KIND) {
      if (classes.includes(badgeClass)) {
        detected = hlKind;
        return;
      }
    }
  });
  return detected;
}

function rehypeHeadingHighlights() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, _idx, parent) => {
      if (
        node.tagName !== "h1" &&
        node.tagName !== "h2" &&
        node.tagName !== "h3"
      ) {
        return;
      }

      if (parent && parent.type === "element") {
        const pClasses = Array.isArray(parent.properties?.className)
          ? (parent.properties.className as string[])
          : [];
        if (
          pClasses.includes("chapter-cover-inner") ||
          pClasses.includes("doc-chapter-cover")
        ) {
          return;
        }
      }

      const explicitKind = extractExplicitHlAndStrip(node);
      const badgeKind = explicitKind ? null : findBadgeHlKind(node);
      const resolvedKind = explicitKind || badgeKind;

      if (!resolvedKind) return;

      const existingClasses = Array.isArray(node.properties?.className)
        ? (node.properties.className as string[])
        : [];
      const nextClasses =
        resolvedKind === "none"
          ? [...existingClasses, "doc-hl-none"]
          : [...existingClasses, "doc-hl-custom", `doc-hl-${resolvedKind}`];

      node.properties = {
        ...node.properties,
        className: nextClasses,
      };
    });
  };
}

function rehypeBadges() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (
        node.tagName === "code" ||
        node.tagName === "pre" ||
        node.tagName === "script" ||
        node.tagName === "style"
      ) {
        return;
      }

      if (!node.children || node.children.length === 0) return;

      const nextChildren: Element["children"] = [];
      let changed = false;

      for (const child of node.children) {
        if (child.type !== "text" || !child.value.includes(":")) {
          nextChildren.push(child);
          continue;
        }

        const text = child.value;
        BADGE_REGEX.lastIndex = 0;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = BADGE_REGEX.exec(text)) !== null) {
          const key = match[1].toLowerCase();
          const spec = BADGE_SPEC_MAP[key];
          if (!spec) continue;

          if (match.index > lastIndex) {
            nextChildren.push({
              type: "text",
              value: text.slice(lastIndex, match.index),
            });
          }

          nextChildren.push({
            type: "element",
            tagName: "span",
            properties: { className: ["doc-badge", spec.className] },
            children: [{ type: "text", value: spec.label }],
          });

          lastIndex = match.index + match[0].length;
          changed = true;
        }

        if (lastIndex < text.length) {
          nextChildren.push({
            type: "text",
            value: text.slice(lastIndex),
          });
        }
      }

      if (changed) {
        node.children = nextChildren;
      }
    });
  };
}

export function resolveAssetSrc(
  src: string,
  assets: Record<string, string>,
  options: { allowRelativePath?: boolean } = {}
): string {
  const trimmed = src.trim();
  if (!trimmed) return "";
  if (
    /^https?:\/\//i.test(trimmed) ||
    /^data:/i.test(trimmed)
  ) {
    return sanitizeImageUrl(trimmed);
  }
  if (trimmed.startsWith("asset:")) {
    return assets[trimmed] ? sanitizeImageUrl(assets[trimmed]) : "";
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  const normalized = decoded
    .replaceAll("\\", "/")
    .replace(/^(\.\/|\.\.\/)+/, "")
    .replace(/^\/+/, "");

  if (assets[`rel:${normalized}`]) {
    return sanitizeImageUrl(assets[`rel:${normalized}`]);
  }

  const fileName = normalized.split("/").pop() || normalized;
  for (const [key, val] of Object.entries(assets)) {
    if (!key.startsWith("rel:")) continue;
    const relPath = key.slice(4);
    if (relPath === fileName || relPath.endsWith(`/${fileName}`)) {
      return sanitizeImageUrl(val);
    }
  }

  return sanitizeImageUrl(trimmed, options);
}

function isSmallInlineDimension(cssValue: string | null): boolean {
  if (!cssValue) return false;
  const match = cssValue.trim().match(/^(\d+(?:\.\d+)?)(px|mm|cm|pt|in|em|rem)$/i);
  if (!match) return false;
  const num = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(num) || num <= 0) return false;
  switch (unit) {
    case "px":
      return num <= 48;
    case "mm":
      return num <= 15;
    case "cm":
      return num <= 1.5;
    case "pt":
      return num <= 36;
    case "in":
      return num <= 0.6;
    case "em":
    case "rem":
      return num <= 3;
    default:
      return false;
  }
}

function isBlockPlaceholderNode(node: RootContent): boolean {
  if (node.type !== "element" || node.tagName !== "figure") return false;
  const classNames = node.properties?.className;
  return Array.isArray(classNames) && classNames.includes("doc-asset-placeholder");
}

function trimSplitParagraphChildren(
  children: Element["children"]
): Element["children"] {
  const result = children.slice();

  while (result.length > 0) {
    const first = result[0];
    if (first.type === "text") {
      const trimmed = first.value.replace(/^[\t\r\n ]+/, "");
      if (!trimmed) {
        result.shift();
        continue;
      }
      result[0] = { type: "text", value: trimmed };
      break;
    }
    if (first.type === "element" && first.tagName === "br") {
      result.shift();
      continue;
    }
    break;
  }

  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last.type === "text") {
      const trimmed = last.value.replace(/[\t\r\n ]+$/, "");
      if (!trimmed) {
        result.pop();
        continue;
      }
      result[result.length - 1] = { type: "text", value: trimmed };
      break;
    }
    if (last.type === "element" && last.tagName === "br") {
      result.pop();
      continue;
    }
    break;
  }

  return result;
}

function splitParagraphsAroundBlockPlaceholders(children: RootContent[]) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type !== "element") continue;

    if (
      child.tagName === "p" &&
      child.children.some((grandChild) => isBlockPlaceholderNode(grandChild))
    ) {
      const replacements: RootContent[] = [];
      let inlineBuffer: Element["children"] = [];

      const flushInline = () => {
        const trimmed = trimSplitParagraphChildren(inlineBuffer);
        inlineBuffer = [];
        if (trimmed.length > 0) {
          replacements.push({
            type: "element",
            tagName: "p",
            properties: child.properties ? { ...child.properties } : {},
            children: trimmed,
          });
        }
      };

      for (const grandChild of child.children) {
        if (isBlockPlaceholderNode(grandChild)) {
          flushInline();
          replacements.push(grandChild);
        } else {
          inlineBuffer.push(grandChild);
        }
      }
      flushInline();

      children.splice(i, 1, ...replacements);
      i += replacements.length - 1;
      continue;
    }

    if (child.children && child.children.length > 0) {
      splitParagraphsAroundBlockPlaceholders(child.children as RootContent[]);
    }
  }
}

function buildUnresolvedAssetPlaceholderNode(
  assetKey: string,
  alt: string,
  widthCss: string | null,
  heightCss: string | null,
  mode: "block" | "inline" = "block"
): Element {
  const displayName = getAssetDisplayName(assetKey, alt);
  const styleParts: string[] = [];
  if (widthCss) {
    styleParts.push(`width: ${widthCss}`);
  }
  if (heightCss) {
    styleParts.push(`height: ${heightCss}`);
  }

  const classNames =
    mode === "inline"
      ? ["doc-asset-placeholder", "doc-asset-placeholder-inline"]
      : ["doc-asset-placeholder"];

  const properties: Element["properties"] = {
    className: classNames,
    dataAssetKey: assetKey,
    dataAssetLabel: displayName,
    role: "group",
    ariaLabel: `未解決の画像: ${displayName}（画像をドロップして復元）`,
  };
  if (styleParts.length > 0) {
    properties.style = `${styleParts.join("; ")};`;
  }

  const innerTagName = mode === "inline" ? "span" : "div";

  return {
    type: "element",
    tagName: mode === "inline" ? "span" : "figure",
    properties,
    children: [
      {
        type: "element",
        tagName: innerTagName,
        properties: { className: ["doc-asset-placeholder-inner"] },
        children: [
          {
            type: "element",
            tagName: "svg",
            properties: {
              className: ["doc-asset-placeholder-icon"],
              viewBox: "0 0 24 24",
              width: "28",
              height: "28",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: "1.6",
              strokeLinecap: "round",
              strokeLinejoin: "round",
              ariaHidden: "true",
            },
            children: [
              {
                type: "element",
                tagName: "rect",
                properties: {
                  x: "3",
                  y: "3",
                  width: "18",
                  height: "18",
                  rx: "2",
                  ry: "2",
                },
                children: [],
              },
              {
                type: "element",
                tagName: "circle",
                properties: {
                  cx: "8.5",
                  cy: "8.5",
                  r: "1.5",
                },
                children: [],
              },
              {
                type: "element",
                tagName: "polyline",
                properties: {
                  points: "21 15 16 10 5 21",
                },
                children: [],
              },
            ],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["doc-asset-placeholder-name"] },
            children: [{ type: "text", value: displayName }],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["doc-asset-placeholder-hint"] },
            children: [{ type: "text", value: "画像をドロップして復元" }],
          },
        ],
      },
    ],
  };
}

const BLOCK_PLACEHOLDER_PARENT_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "blockquote",
  "li",
  "figure",
]);

function rehypeResolveAssets(assets: Record<string, string>) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "img") return;
      const src = node.properties?.src;
      if (typeof src !== "string") return;
      const trimmedSrc = src.trim();
      const resolved = resolveAssetSrc(trimmedSrc, assets, {
        allowRelativePath: true,
      });
      if (!resolved) {
        if (
          trimmedSrc.startsWith("asset:") &&
          parent &&
          typeof index === "number"
        ) {
          const alt =
            typeof node.properties?.alt === "string" ? node.properties.alt : "";
          const widthCss = sanitizePlaceholderDimension(node.properties?.width);
          const heightCss = sanitizePlaceholderDimension(node.properties?.height);

          let mode: "block" | "inline" = "inline";
          if (parent.type === "root") {
            mode = "block";
          } else if (parent.type === "element") {
            if (parent.tagName === "p") {
              const hasOtherNonWhitespace = parent.children.some(
                (sibling, sibIdx) =>
                  sibIdx !== index &&
                  (sibling.type !== "text" || sibling.value.trim().length > 0)
              );
              const isExplicitSmallIcon =
                hasOtherNonWhitespace &&
                (isSmallInlineDimension(widthCss) ||
                  isSmallInlineDimension(heightCss));
              mode = isExplicitSmallIcon ? "inline" : "block";
            } else if (BLOCK_PLACEHOLDER_PARENT_TAGS.has(parent.tagName)) {
              mode = "block";
            }
          }

          parent.children[index] = buildUnresolvedAssetPlaceholderNode(
            trimmedSrc,
            alt,
            widthCss,
            heightCss,
            mode
          );
          return;
        }
        const nextProps = { ...node.properties };
        delete nextProps.src;
        node.properties = nextProps;
      } else if (resolved !== src) {
        node.properties = {
          ...node.properties,
          src: resolved,
        };
      }
    });

    splitParagraphsAroundBlockPlaceholders(tree.children);
  };
}

function rehypeCodeBlockLabels() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (
        node.tagName !== "pre" ||
        !parent ||
        typeof index !== "number" ||
        !node.children.length
      ) {
        return;
      }

      const codeNode = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "code"
      );
      if (!codeNode) return;

      const classList = Array.isArray(codeNode.properties?.className)
        ? (codeNode.properties.className as string[])
        : [];

      const langClass = classList.find((c) => c.startsWith("language-"));
      if (!langClass) return;

      const rawSpec = langClass.replace(/^language-/, "");
      const colonIdx = rawSpec.indexOf(":");
      const lang = colonIdx >= 0 ? rawSpec.slice(0, colonIdx) : rawSpec;
      const filename = colonIdx >= 0 ? rawSpec.slice(colonIdx + 1) : "";

      if (lang) {
        codeNode.properties = {
          ...codeNode.properties,
          className: [
            ...classList.filter((c) => c !== langClass),
            `language-${lang}`,
          ],
        };
      } else {
        codeNode.properties = {
          ...codeNode.properties,
          className: classList.filter((c) => c !== langClass),
        };
      }

      if (!lang && !filename) return;

      const headerChildren: Element[] = [];
      if (lang) {
        headerChildren.push({
          type: "element",
          tagName: "span",
          properties: { className: ["code-lang"] },
          children: [{ type: "text", value: lang.toUpperCase() }],
        });
      }
      if (filename) {
        headerChildren.push({
          type: "element",
          tagName: "span",
          properties: { className: ["code-filename"] },
          children: [{ type: "text", value: filename }],
        });
      }

      const wrapper: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["code-block-wrapper"] },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["code-block-header"] },
            children: headerChildren,
          },
          node,
        ],
      };

      parent.children[index] = wrapper;
    });
  };
}

const CALLOUT_MARKER_REGEX =
  /^\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION|SUMMARY|ABSTRACT|SUCCESS)\](?=[ \t\r\n]|$)/i;

function trimCalloutTitleNodes(
  nodes: Element["children"]
): Element["children"] {
  const result = nodes.slice();

  while (result.length > 0 && result[0].type === "text") {
    const trimmed = result[0].value.replace(/^[ \t]+/, "");
    if (!trimmed) {
      result.shift();
    } else {
      result[0] = { type: "text", value: trimmed };
      break;
    }
  }

  while (result.length > 0 && result[result.length - 1].type === "text") {
    const lastIdx = result.length - 1;
    const trimmed = (result[lastIdx] as Text).value.replace(/[ \t]+$/, "");
    if (!trimmed) {
      result.pop();
    } else {
      result[lastIdx] = { type: "text", value: trimmed };
      break;
    }
  }

  return result;
}

function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "blockquote") return;

      const firstP = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "p"
      );
      if (!firstP || !firstP.children.length) return;

      const firstChild = firstP.children[0];
      if (firstChild.type !== "text") return;

      const markerMatch = firstChild.value.match(CALLOUT_MARKER_REGEX);
      if (!markerMatch) return;

      const rawType = markerMatch[1].toLowerCase();
      const calloutType: CalloutType =
        rawType === "abstract" ? "summary" : (rawType as CalloutType);
      const afterMarker = firstChild.value.slice(markerMatch[0].length);

      const remainingChildren: Element["children"] = [
        ...(afterMarker ? [{ type: "text" as const, value: afterMarker }] : []),
        ...firstP.children.slice(1),
      ];

      const rawTitleNodes: Element["children"] = [];
      const bodyFirstPChildren: Element["children"] = [];
      let inBody = false;

      for (const child of remainingChildren) {
        if (inBody) {
          bodyFirstPChildren.push(child);
          continue;
        }

        if (child.type === "element" && child.tagName === "br") {
          inBody = true;
          continue;
        }

        if (child.type === "text") {
          const nlMatch = child.value.match(/\r?\n/);
          if (nlMatch && typeof nlMatch.index === "number") {
            const beforeNl = child.value.slice(0, nlMatch.index);
            const afterNl = child.value.slice(
              nlMatch.index + nlMatch[0].length
            );
            if (beforeNl) {
              rawTitleNodes.push({ type: "text", value: beforeNl });
            }
            if (afterNl) {
              bodyFirstPChildren.push({ type: "text", value: afterNl });
            }
            inBody = true;
            continue;
          }
        }

        rawTitleNodes.push(child);
      }

      if (
        bodyFirstPChildren.length > 0 &&
        bodyFirstPChildren[0].type === "text"
      ) {
        const cleaned = bodyFirstPChildren[0].value.replace(/^\r?\n/, "");
        if (cleaned) {
          bodyFirstPChildren[0] = { type: "text", value: cleaned };
        } else {
          bodyFirstPChildren.shift();
        }
      }

      firstP.children = bodyFirstPChildren;

      const trimmedTitleNodes = trimCalloutTitleNodes(rawTitleNodes);
      const titleChildren: Element["children"] =
        trimmedTitleNodes.length > 0
          ? trimmedTitleNodes
          : [{ type: "text", value: CALLOUT_LABELS[calloutType] }];

      const bodyChildren = node.children.filter((child) => {
        if (child === firstP && firstP.children.length === 0) return false;
        return true;
      });
      const hasBodyContent = bodyChildren.some(
        (child) => child.type !== "text" || child.value.trim().length > 0
      );

      node.tagName = "div";
      node.properties = {
        className: ["callout", `callout-${calloutType}`],
      };
      node.children = [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["callout-title"] },
          children: titleChildren,
        },
        ...(hasBodyContent
          ? [
              {
                type: "element" as const,
                tagName: "div",
                properties: { className: ["callout-body"] },
                children: bodyChildren,
              },
            ]
          : []),
      ];
    });
  };
}

function createTocCollector(tocDepth: 1 | 2 | 3, collector: TocEntry[]) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (
        node.tagName !== "h1" &&
        node.tagName !== "h2" &&
        node.tagName !== "h3"
      ) {
        return;
      }
      const level = Number(node.tagName.slice(1)) as 1 | 2 | 3;
      if (level > tocDepth) return;

      const id =
        typeof node.properties?.id === "string" ? node.properties.id : "";
      const text = getNodeText(node).trim();
      if (!id || !text) return;

      collector.push({ id, level, text });
    });
  };
}

function resolveLogoUrl(
  logoValue: string,
  assets: Record<string, string>
): string {
  return resolveAssetSrc(logoValue, assets);
}

function formatCoverTitleHtml(title: string): string {
  const parts = title.split(/(?:\\n|\r?\n|<br\s*\/?>)/i);
  return parts.map((part) => escapeHtml(part)).join("<br />");
}

function formatSingleLineTitle(title: string): string {
  return title
    .replace(/([A-Za-z0-9])\s*(?:\\n|\r?\n|<br\s*\/?>)\s*([A-Za-z0-9])/gi, "$1 $2")
    .replace(/\s*(?:\\n|\r?\n|<br\s*\/?>)\s*/gi, "");
}

function buildCoverHtml(
  fm: DocumentFrontmatter,
  logoSrc: string,
  coverImageSrc: string
): string {
  if (!fm.cover) return "";

  const showLogoOnCover =
    Boolean(logoSrc) &&
    (fm.logo_position === "cover-only" ||
      fm.logo_position === "cover-and-header");

  const logoHtml = showLogoOnCover
    ? `<div class="cover-logo"><img src="${escapeHtml(logoSrc)}" alt="Logo" /></div>`
    : "";

  const subtitleHtml = fm.subtitle
    ? `<p class="cover-subtitle">${escapeHtml(fm.subtitle)}</p>`
    : "";

  const recipientHtml = fm.recipient.trim()
    ? `<div class="cover-recipient">${escapeHtml(fm.recipient)}</div>`
    : "";

  const overlayMode = fm.cover_overlay || "light-fade";
  const overlayGradient =
    overlayMode === "light-fade"
      ? "linear-gradient(90deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.84) 46%, rgba(255,255,255,0.22) 76%, rgba(255,255,255,0) 100%)"
      : overlayMode === "dark-fade"
        ? "linear-gradient(90deg, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.72) 48%, rgba(15,23,42,0.20) 78%, rgba(15,23,42,0) 100%)"
        : "";

  const overlayHtml =
    coverImageSrc && overlayGradient
      ? `<div class="cover-bg-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;background:${overlayGradient};z-index:1;pointer-events:none;"></div>`
      : "";

  const bgHtml = coverImageSrc
    ? `<img class="cover-bg-img" src="${escapeHtml(coverImageSrc)}" alt="" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;" />${overlayHtml}`
    : "";

  const extraClass = coverImageSrc
    ? ` has-cover-image cover-overlay-${overlayMode}`
    : "";
  const sectionStyle = coverImageSrc
    ? ` style="position:relative;background-color:transparent;"`
    : "";
  const innerStyle = coverImageSrc
    ? ` style="position:relative;z-index:2;"`
    : "";

  return `
    <section class="doc-cover${extraClass}"${sectionStyle}>
      ${bgHtml}
      <div class="cover-inner"${innerStyle}>
        <div class="cover-top">
          ${logoHtml}
        </div>
        <div class="cover-center">
          <div class="cover-accent-bar"></div>
          <h1 class="cover-title">${formatCoverTitleHtml(fm.title)}</h1>
          ${subtitleHtml}
          ${recipientHtml}
        </div>
        <div class="cover-meta">
          <div class="cover-author">${escapeHtml(fm.author)}</div>
          <div class="cover-date">${escapeHtml(fm.date)}</div>
        </div>
      </div>
    </section>
  `;
}

function formatTocTextHtml(text: string): string {
  const regex = new RegExp(BADGE_REGEX.source, "gi");
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(text.slice(lastIndex, match.index));
    }
    const spec = BADGE_SPEC_MAP[match[1].toLowerCase()];
    if (spec) {
      result += `<span class="doc-badge ${spec.className}">${escapeHtml(spec.label)}</span>`;
    } else {
      result += escapeHtml(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result += escapeHtml(text.slice(lastIndex));
  }
  return result;
}

function buildTocHtml(fm: DocumentFrontmatter, entries: TocEntry[]): string {
  if (!fm.toc) return "";

  const itemsHtml =
    entries.length > 0
      ? entries
          .map(
            (entry) => `
            <li class="toc-item toc-level-${entry.level}">
              <a href="#${escapeHtml(entry.id)}" class="toc-link">
                <span class="toc-text">${formatTocTextHtml(entry.text)}</span>
                <span class="toc-dots" aria-hidden="true"></span>
                <span class="toc-page-num" data-target-id="${escapeHtml(entry.id)}"></span>
              </a>
            </li>`
          )
          .join("")
      : `<li class="toc-empty">見出し（H1〜H${fm.toc_depth}）が見つかりません。</li>`;

  return `
    <nav class="doc-toc" aria-label="目次">
      <h2 class="toc-heading">目次</h2>
      <ul class="toc-list">
        ${itemsHtml}
      </ul>
    </nav>
  `;
}

function buildBackCoverHtml(
  fm: DocumentFrontmatter,
  backCoverImageSrc: string
): string {
  if (!fm.back_cover) return "";

  const lines = fm.back_cover_text
    .split(/\r?\n/)
    .map((line) => escapeHtml(line))
    .join("<br />");

  const bgHtml = backCoverImageSrc
    ? `<img class="backcover-bg-img" src="${escapeHtml(backCoverImageSrc)}" alt="" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;" /><div class="backcover-bg-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;background-color:rgba(255,255,255,0.82);z-index:1;"></div>`
    : "";

  const extraClass = backCoverImageSrc ? " has-backcover-image" : "";
  const sectionStyle = backCoverImageSrc
    ? ` style="position:relative;background-color:transparent;"`
    : "";
  const innerStyle = backCoverImageSrc
    ? ` style="position:relative;z-index:2;"`
    : "";

  return `
    <section class="doc-backcover${extraClass}"${sectionStyle}>
      ${bgHtml}
      <div class="backcover-inner"${innerStyle}>
        <div class="backcover-title">${escapeHtml(formatSingleLineTitle(fm.title))}</div>
        <div class="backcover-divider"></div>
        <div class="backcover-text">${lines}</div>
        <div class="backcover-meta">
          <span>${escapeHtml(fm.author)}</span>
          <span>${escapeHtml(fm.date)}</span>
        </div>
      </div>
    </section>
  `;
}

const COLORBAR_COMMENT_REGEX = /<!--\s*colorbar\s*:\s*([\s\S]*?)\s*-->/gi;
const CHART_COMMENT_REGEX =
  /<!--\s*(pie|donut)(?:\s*\(([^)\r\n]+)\))?\s*:\s*([\s\S]*?)\s*-->/gi;
const CARDS_START_COMMENT_REGEX =
  /<!--\s*cards(?:\s*(?::\s*|\s+cols\s*=\s*)(\d+))?\s*-->/gi;
const CARDS_END_COMMENT_REGEX = /<!--\s*\/cards\s*-->/gi;

function remarkChartMarkers() {
  return (tree: unknown) => {
    visit(
      tree as Parameters<typeof visit>[0],
      "html",
      (node: { type: string; value?: string }) => {
        if (typeof node.value !== "string") return;
        CHART_COMMENT_REGEX.lastIndex = 0;
        if (!CHART_COMMENT_REGEX.test(node.value)) return;
        CHART_COMMENT_REGEX.lastIndex = 0;
        node.value = node.value.replace(
          CHART_COMMENT_REGEX,
          (_match, rawKind: string, rawTitle: string | undefined, spec: string) => {
            const kind = rawKind.toLowerCase() === "donut" ? "donut" : "pie";
            const titleAttr = rawTitle?.trim()
              ? ` data-chart-title="${escapeHtml(rawTitle.trim())}"`
              : "";
            return `\n<div data-chart-kind="${kind}"${titleAttr} data-chart-spec="${escapeHtml(spec.trim())}"></div>\n`;
          }
        );
      }
    );
  };
}

function rehypeCharts() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (
        node.tagName !== "div" ||
        !parent ||
        typeof index !== "number" ||
        typeof node.properties?.dataChartSpec !== "string"
      ) {
        return;
      }

      const rawKind = node.properties?.dataChartKind;
      if (rawKind !== "pie" && rawKind !== "donut") {
        parent.children.splice(index, 1);
        return index;
      }

      const kind: ChartKind = rawKind;
      const rawTitle =
        typeof node.properties?.dataChartTitle === "string"
          ? node.properties.dataChartTitle
          : "";
      const chart = buildSvgChart(kind, node.properties.dataChartSpec, rawTitle);

      if (!chart) {
        parent.children.splice(index, 1);
        return index;
      }

      const ariaSummary = chart.segments
        .map(
          (seg) =>
            `${seg.label} ${formatColorBarNumber(seg.value)} (${formatColorBarPercent(seg.displayPercent)})`
        )
        .join(", ");

      const svgChildren: Element[] = [];

      if (chart.slices.length === 0) {
        if (kind === "donut") {
          svgChildren.push({
            type: "element",
            tagName: "circle",
            properties: {
              cx: String(CHART_CENTER),
              cy: String(CHART_CENTER),
              r: String(CHART_DONUT_RING_RADIUS),
              fill: "none",
              stroke: "#e2e8f0",
              strokeWidth: String(CHART_DONUT_RING_STROKE_WIDTH),
            },
            children: [],
          });
        } else {
          svgChildren.push({
            type: "element",
            tagName: "circle",
            properties: {
              cx: String(CHART_CENTER),
              cy: String(CHART_CENTER),
              r: String(CHART_OUTER_RADIUS),
              fill: "#e2e8f0",
            },
            children: [],
          });
          svgChildren.push({
            type: "element",
            tagName: "text",
            properties: {
              x: String(CHART_CENTER),
              y: String(CHART_CENTER),
              textAnchor: "middle",
              dominantBaseline: "central",
              fill: "#64748b",
              fontSize: "16",
              fontWeight: "700",
            },
            children: [{ type: "text", value: "0" }],
          });
        }
      } else {
        for (const slice of chart.slices) {
          if (slice.isFullCircle) {
            svgChildren.push(
              kind === "donut"
                ? {
                    type: "element",
                    tagName: "circle",
                    properties: {
                      cx: String(CHART_CENTER),
                      cy: String(CHART_CENTER),
                      r: String(CHART_DONUT_RING_RADIUS),
                      fill: "none",
                      stroke: slice.color,
                      strokeWidth: String(CHART_DONUT_RING_STROKE_WIDTH),
                    },
                    children: [],
                  }
                : {
                    type: "element",
                    tagName: "circle",
                    properties: {
                      cx: String(CHART_CENTER),
                      cy: String(CHART_CENTER),
                      r: String(CHART_OUTER_RADIUS),
                      fill: slice.color,
                    },
                    children: [],
                  }
            );
          } else if (slice.pathD) {
            svgChildren.push({
              type: "element",
              tagName: "path",
              properties: {
                d: slice.pathD,
                fill: slice.color,
                stroke: "#ffffff",
                strokeWidth: "1.5",
                strokeLinejoin: "round",
              },
              children: [],
            });
          }
        }

        for (const slice of chart.slices) {
          if (!slice.showLabel) continue;
          svgChildren.push({
            type: "element",
            tagName: "text",
            properties: {
              x: String(slice.labelX),
              y: String(slice.labelY),
              textAnchor: "middle",
              dominantBaseline: "central",
              fill: slice.textColor,
              fontSize: "11",
              fontWeight: "700",
            },
            children: [
              {
                type: "text",
                value: formatColorBarPercent(slice.displayPercent),
              },
            ],
          });
        }
      }

      if (kind === "donut") {
        svgChildren.push(
          {
            type: "element",
            tagName: "text",
            properties: {
              x: String(CHART_CENTER),
              y: String(CHART_CENTER - 6),
              textAnchor: "middle",
              dominantBaseline: "central",
              fill: "#1e293b",
              fontSize: "18",
              fontWeight: "700",
            },
            children: [{ type: "text", value: chart.totalLabel }],
          },
          {
            type: "element",
            tagName: "text",
            properties: {
              x: String(CHART_CENTER),
              y: String(CHART_CENTER + 14),
              textAnchor: "middle",
              dominantBaseline: "central",
              fill: "#64748b",
              fontSize: "9.5",
              fontWeight: "600",
            },
            children: [{ type: "text", value: "合計" }],
          }
        );
      }

      const svgNode: Element = {
        type: "element",
        tagName: "svg",
        properties: {
          className: ["doc-chart-svg"],
          viewBox: `0 0 ${CHART_SVG_SIZE} ${CHART_SVG_SIZE}`,
          role: "img",
          ariaLabel: chart.title ? `${chart.title}: ${ariaSummary}` : ariaSummary,
        },
        children: svgChildren,
      };

      const legendChildren: Element[] = chart.segments.map((seg) => ({
        type: "element",
        tagName: "div",
        properties: { className: ["doc-chart-legend-item"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["doc-chart-swatch"],
              style: `background-color: ${seg.color};`,
              ariaHidden: "true",
            },
            children: [],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["doc-chart-legend-label"] },
            children: [{ type: "text", value: seg.label }],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["doc-chart-legend-value"] },
            children: [
              {
                type: "text",
                value: `${formatColorBarNumber(seg.value)} (${formatColorBarPercent(seg.displayPercent)})`,
              },
            ],
          },
        ],
      }));

      legendChildren.push({
        type: "element",
        tagName: "div",
        properties: { className: ["doc-chart-total"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: {},
            children: [{ type: "text", value: "合計" }],
          },
          {
            type: "element",
            tagName: "span",
            properties: {},
            children: [{ type: "text", value: chart.totalLabel }],
          },
        ],
      });

      const figureChildren: Element[] = [];
      if (chart.title) {
        figureChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["doc-chart-title"] },
          children: [{ type: "text", value: chart.title }],
        });
      }

      figureChildren.push({
        type: "element",
        tagName: "div",
        properties: { className: ["doc-chart-body"] },
        children: [
          svgNode,
          {
            type: "element",
            tagName: "figcaption",
            properties: { className: ["doc-chart-legend"] },
            children: legendChildren,
          },
        ],
      });

      parent.children[index] = {
        type: "element",
        tagName: "figure",
        properties: {
          className: ["doc-chart", `doc-chart-${kind}`],
          ariaLabel: chart.title ? `${chart.title}: ${ariaSummary}` : ariaSummary,
        },
        children: figureChildren,
      };
    });
  };
}

function remarkCardBlockMarkers() {
  return (tree: unknown) => {
    visit(
      tree as Parameters<typeof visit>[0],
      "html",
      (node: { type: string; value?: string }) => {
        if (typeof node.value !== "string") return;
        let next = node.value;

        CARDS_START_COMMENT_REGEX.lastIndex = 0;
        next = next.replace(
          CARDS_START_COMMENT_REGEX,
          (_match, colsRaw?: string) => {
            const cols = parseCardColumnsAttr(colsRaw);
            return cols
              ? `\n<div data-cards-marker="start" data-cards-cols="${cols}"></div>\n`
              : '\n<div data-cards-marker="start"></div>\n';
          }
        );

        CARDS_END_COMMENT_REGEX.lastIndex = 0;
        next = next.replace(
          CARDS_END_COMMENT_REGEX,
          '\n<div data-cards-marker="end"></div>\n'
        );

        node.value = next;
      }
    );
  };
}

function isCardsMarkerNode(
  node: RootContent | undefined,
  kind: "start" | "end"
): boolean {
  return (
    Boolean(node) &&
    node!.type === "element" &&
    node!.tagName === "div" &&
    node!.properties?.dataCardsMarker === kind
  );
}

function collectCardsFromNodes(nodes: RootContent[]): ParsedCardItem[] {
  const cards: ParsedCardItem[] = [];
  for (const item of nodes) {
    if (
      item.type === "element" &&
      (item.tagName === "ul" || item.tagName === "ol")
    ) {
      for (const li of item.children) {
        if (li.type === "element" && li.tagName === "li") {
          const parsed = parseCardItem(getNodeText(li));
          if (parsed) cards.push(parsed);
        }
      }
    }
  }
  return cards;
}

function buildCardGridElement(
  cards: ParsedCardItem[],
  cols: 2 | 3 | 4
): Element {
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["doc-cards", `doc-cards-cols-${cols}`],
    },
    children: cards.map((card) => {
      const classNames = ["doc-card"];
      if (card.accentKind) {
        classNames.push(`doc-card-accent-${card.accentKind}`);
      }

      const cardChildren: Element[] = [];
      if (card.label) {
        cardChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["doc-card-label"] },
          children: [{ type: "text", value: card.label }],
        });
      }
      if (card.value) {
        cardChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["doc-card-value"] },
          children: [{ type: "text", value: card.value }],
        });
      }
      if (card.note) {
        cardChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["doc-card-note"] },
          children: [{ type: "text", value: card.note }],
        });
      }

      const properties: Element["properties"] = { className: classNames };
      if (card.customColor) {
        properties.style = `--card-accent: ${card.customColor};`;
      }

      return {
        type: "element",
        tagName: "div",
        properties,
        children: cardChildren,
      };
    }),
  };
}

function transformCardChildren(children: RootContent[]) {
  for (let i = 0; i < children.length; i++) {
    const current = children[i];
    if (isCardsMarkerNode(current, "end")) {
      children.splice(i, 1);
      i--;
      continue;
    }

    if (!isCardsMarkerNode(current, "start") || current.type !== "element") {
      continue;
    }

    const rawCols =
      typeof current.properties?.dataCardsCols === "string"
        ? current.properties.dataCardsCols
        : undefined;
    const explicitCols = parseCardColumnsAttr(rawCols);

    let endIdx = -1;
    for (let j = i + 1; j < children.length; j++) {
      if (isCardsMarkerNode(children[j], "end")) {
        endIdx = j;
        break;
      }
      if (isCardsMarkerNode(children[j], "start")) {
        break;
      }
    }

    let sliceStart = i + 1;
    let sliceEnd = endIdx;
    let replaceEnd = endIdx;

    if (endIdx === -1) {
      let nextIdx = i + 1;
      while (nextIdx < children.length && isWhitespaceText(children[nextIdx])) {
        nextIdx++;
      }
      const maybeList = children[nextIdx];
      if (
        maybeList &&
        maybeList.type === "element" &&
        (maybeList.tagName === "ul" || maybeList.tagName === "ol")
      ) {
        sliceStart = nextIdx;
        sliceEnd = nextIdx + 1;
        replaceEnd = nextIdx;
      } else {
        children.splice(i, 1);
        i--;
        continue;
      }
    }

    const cards = collectCardsFromNodes(children.slice(sliceStart, sliceEnd));
    if (cards.length === 0) {
      if (endIdx !== -1) {
        children.splice(endIdx, 1);
      }
      children.splice(i, 1);
      i--;
      continue;
    }

    const cols = resolveCardColumns(cards.length, explicitCols);
    const gridNode = buildCardGridElement(cards, cols);
    children.splice(i, replaceEnd - i + 1, gridNode);
  }
}

function rehypeCardBlocks() {
  return (tree: Root) => {
    transformCardChildren(tree.children);
    visit(tree, "element", (node: Element) => {
      if (node.children && node.children.length > 0) {
        transformCardChildren(node.children as RootContent[]);
      }
    });
  };
}

function remarkColorBarMarkers() {
  return (tree: unknown) => {
    visit(
      tree as Parameters<typeof visit>[0],
      "html",
      (node: { type: string; value?: string }) => {
        if (typeof node.value !== "string") return;
        COLORBAR_COMMENT_REGEX.lastIndex = 0;
        if (!COLORBAR_COMMENT_REGEX.test(node.value)) return;
        COLORBAR_COMMENT_REGEX.lastIndex = 0;
        node.value = node.value.replace(
          COLORBAR_COMMENT_REGEX,
          (_match, spec: string) =>
            `\n<div data-colorbar="${escapeHtml(spec.trim())}"></div>\n`
        );
      }
    );
  };
}

function rehypeColorBars() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (
        node.tagName !== "div" ||
        !parent ||
        typeof index !== "number" ||
        typeof node.properties?.dataColorbar !== "string"
      ) {
        return;
      }

      const parsed = parseColorBarSpec(node.properties.dataColorbar);
      if (!parsed) {
        parent.children.splice(index, 1);
        return index;
      }

      const ariaSummary = parsed.segments
        .map(
          (seg) =>
            `${seg.label} ${formatColorBarNumber(seg.value)} (${formatColorBarPercent(seg.displayPercent)})`
        )
        .join(", ");

      const positiveSegments = parsed.segments.filter(
        (seg) => seg.widthPercent > 0
      );

      const trackChildren: Element[] =
        positiveSegments.length > 0
          ? positiveSegments.map((seg) => ({
              type: "element",
              tagName: "div",
              properties: {
                className: ["doc-colorbar-segment"],
                style: `width: ${seg.widthPercent}%; background-color: ${seg.color}; color: ${seg.textColor};`,
                title: `${seg.label}: ${formatColorBarNumber(seg.value)} (${formatColorBarPercent(seg.displayPercent)})`,
              },
              children: seg.showInBarLabel
                ? [
                    {
                      type: "element",
                      tagName: "span",
                      properties: {
                        className: ["doc-colorbar-segment-label"],
                      },
                      children: [
                        {
                          type: "text",
                          value: formatColorBarPercent(seg.displayPercent),
                        },
                      ],
                    },
                  ]
                : [],
            }))
          : [
              {
                type: "element",
                tagName: "div",
                properties: { className: ["doc-colorbar-empty"] },
                children: [{ type: "text", value: "0" }],
              },
            ];

      const legendItems: Element[] = parsed.segments.map((seg) => ({
        type: "element",
        tagName: "span",
        properties: { className: ["doc-colorbar-legend-item"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["doc-colorbar-swatch"],
              style: `background-color: ${seg.color};`,
              ariaHidden: "true",
            },
            children: [],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["doc-colorbar-legend-label"] },
            children: [{ type: "text", value: seg.label }],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["doc-colorbar-legend-value"] },
            children: [
              {
                type: "text",
                value: `${formatColorBarNumber(seg.value)} (${formatColorBarPercent(seg.displayPercent)})`,
              },
            ],
          },
        ],
      }));

      legendItems.push({
        type: "element",
        tagName: "span",
        properties: { className: ["doc-colorbar-total"] },
        children: [
          {
            type: "text",
            value: `計 ${formatColorBarNumber(parsed.total)}`,
          },
        ],
      });

      const figureNode: Element = {
        type: "element",
        tagName: "figure",
        properties: {
          className: ["doc-colorbar"],
          ariaLabel: ariaSummary,
        },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["doc-colorbar-track"] },
            children: trackChildren,
          },
          {
            type: "element",
            tagName: "figcaption",
            properties: { className: ["doc-colorbar-legend"] },
            children: legendItems,
          },
        ],
      };

      parent.children[index] = figureNode;
    });
  };
}

export async function compileMarkdownToHtml(
  markdown: string,
  assets: Record<string, string> = {}
): Promise<CompiledDocument> {
  const { frontmatter, body } = parseMarkdownDocument(markdown);
  const tocEntries: TocEntry[] = [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirectives)
    .use(remarkColorBarMarkers)
    .use(remarkChartMarkers)
    .use(remarkCardBlockMarkers)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeNormalizeClobberPrefix)
    .use(rehypeSlug)
    .use(rehypeSafeHeadingIds)
    .use(createTocCollector(frontmatter.toc_depth, tocEntries))
    .use(rehypeChapterCovers)
    .use(rehypeResolveAssets(assets))
    .use(rehypeCallouts)
    .use(rehypeBadges)
    .use(rehypeColorBars)
    .use(rehypeCharts)
    .use(rehypeCardBlocks)
    .use(rehypeHeadingHighlights)
    .use(rehypeCodeBlockLabels)
    .use(rehypeKatex, { trust: false, strict: false, maxExpand: 1000 })
    .use(rehypeHighlight)
    .use(rehypeStringify);

  const file = await processor.process(body);
  const bodyHtml = String(file);

  const logoSrc = resolveLogoUrl(frontmatter.logo, assets);
  const coverImageSrc = frontmatter.cover_image
    ? resolveAssetSrc(frontmatter.cover_image, assets)
    : "";
  const backCoverImageSrc = frontmatter.back_cover_image
    ? resolveAssetSrc(frontmatter.back_cover_image, assets)
    : "";

  const coverHtml = buildCoverHtml(frontmatter, logoSrc, coverImageSrc);
  const tocHtml = buildTocHtml(frontmatter, tocEntries);
  const backCoverHtml = buildBackCoverHtml(frontmatter, backCoverImageSrc);

  const fullHtml = `
    <article class="doc-root theme-${frontmatter.theme} heading-hl-${frontmatter.heading_highlight}">
      ${coverHtml}
      ${tocHtml}
      <main class="doc-body">
        ${bodyHtml}
      </main>
      ${backCoverHtml}
    </article>
  `;

  return {
    frontmatter,
    html: fullHtml,
    tocEntries,
  };
}
