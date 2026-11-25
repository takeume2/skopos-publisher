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

function preprocessDirectives(markdownBody: string): string {
  return markdownBody
    .replace(/<!--\s*pagebreak\s*-->/gi, '\n<div class="page-break"></div>\n')
    .replace(/^[ \t]*\\newpage[ \t]*$/gm, '\n<div class="page-break"></div>\n')
    .replace(
      /<!--\s*chapter\s*-->/gi,
      '\n<div data-chapter-marker="start"></div>\n'
    )
    .replace(
      /<!--\s*\/chapter\s*-->/gi,
      '\n<div data-chapter-marker="end"></div>\n'
    )
    .replace(
      /<!--\s*hl:\s*([a-zA-Z0-9_-]+)\s*-->/gi,
      '<span data-hl="$1"></span>'
    );
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

function rehypeResolveAssets(assets: Record<string, string>) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const src = node.properties?.src;
      if (typeof src !== "string") return;
      const resolved = resolveAssetSrc(src, assets, { allowRelativePath: true });
      if (!resolved) {
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
  const preprocessedBody = preprocessDirectives(body);
  const tocEntries: TocEntry[] = [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkColorBarMarkers)
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
    .use(rehypeHeadingHighlights)
    .use(rehypeCodeBlockLabels)
    .use(rehypeKatex, { trust: false, strict: false, maxExpand: 1000 })
    .use(rehypeHighlight)
    .use(rehypeStringify);

  const file = await processor.process(preprocessedBody);
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
