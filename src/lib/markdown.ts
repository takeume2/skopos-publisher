import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
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

type CalloutType = "note" | "warning" | "tip" | "important";

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: "NOTE",
  warning: "WARNING",
  tip: "TIP",
  important: "IMPORTANT",
};

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
  // remark-rehype は生HTMLを "raw" ノードとして生成するため raw も判定する
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

/**
 * <!-- chapter --> 直後の H1 要素および概要文（p要素等）を中扉（章扉）セクションへ変換する
 * <!-- /chapter --> があればそこまでを取り込み、省略時は直後の1段落までを取り込む
 */
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

      // 明示的な <!-- /chapter --> 終了マーカーを探索（最大10ノード先まで）
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
        // 終了マーカー省略時は直後の1段落(p)があれば概要文として取り込む
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

export function resolveAssetSrc(
  src: string,
  assets: Record<string, string>
): string {
  if (!src) return "";
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:")
  ) {
    return src;
  }
  if (src.startsWith("asset:") && assets[src]) {
    return assets[src];
  }

  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    decoded = src;
  }

  const normalized = decoded
    .replaceAll("\\", "/")
    .replace(/^(\.\/|\.\.\/)+/, "")
    .replace(/^\/+/, "");

  if (assets[`rel:${normalized}`]) {
    return assets[`rel:${normalized}`];
  }

  const fileName = normalized.split("/").pop() || normalized;
  for (const [key, val] of Object.entries(assets)) {
    if (!key.startsWith("rel:")) continue;
    const relPath = key.slice(4);
    if (relPath === fileName || relPath.endsWith(`/${fileName}`)) {
      return val;
    }
  }

  return src;
}

/**
 * 本文中の <img src="..."> (asset:ID およびフォルダ相対パス) を IndexedDB の DataURL へ解決する
 */
function rehypeResolveAssets(assets: Record<string, string>) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const src = node.properties?.src;
      if (typeof src !== "string") return;
      const resolved = resolveAssetSrc(src, assets);
      if (resolved && resolved !== src) {
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

      const match = firstChild.value.match(
        /^\[!(NOTE|WARNING|TIP|IMPORTANT)\]\s*(?:\r?\n)?/i
      );
      if (!match) return;

      const calloutType = match[1].toLowerCase() as CalloutType;
      const remainder = firstChild.value.slice(match[0].length);

      if (remainder.length > 0) {
        (firstChild as Text).value = remainder;
      } else {
        firstP.children.shift();
        if (
          firstP.children.length > 0 &&
          firstP.children[0].type === "element" &&
          firstP.children[0].tagName === "br"
        ) {
          firstP.children.shift();
        }
      }

      const bodyChildren = node.children.filter((child) => {
        if (child === firstP && firstP.children.length === 0) return false;
        return true;
      });

      node.tagName = "div";
      node.properties = {
        className: ["callout", `callout-${calloutType}`],
      };
      node.children = [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["callout-title"] },
          children: [{ type: "text", value: CALLOUT_LABELS[calloutType] }],
        },
        {
          type: "element",
          tagName: "div",
          properties: { className: ["callout-body"] },
          children: bodyChildren,
        },
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

function buildCoverHtml(fm: DocumentFrontmatter, logoSrc: string): string {
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

  return `
    <section class="doc-cover">
      <div class="cover-inner">
        ${logoHtml}
        <div class="cover-accent-bar"></div>
        <h1 class="cover-title">${escapeHtml(fm.title)}</h1>
        ${subtitleHtml}
        <div class="cover-meta">
          <div class="cover-author">${escapeHtml(fm.author)}</div>
          <div class="cover-date">${escapeHtml(fm.date)}</div>
        </div>
      </div>
    </section>
  `;
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
                <span class="toc-text">${escapeHtml(entry.text)}</span>
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

function buildBackCoverHtml(fm: DocumentFrontmatter): string {
  if (!fm.back_cover) return "";

  const lines = fm.back_cover_text
    .split(/\r?\n/)
    .map((line) => escapeHtml(line))
    .join("<br />");

  return `
    <section class="doc-backcover">
      <div class="backcover-inner">
        <div class="backcover-title">${escapeHtml(fm.title)}</div>
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
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeSafeHeadingIds)
    .use(createTocCollector(frontmatter.toc_depth, tocEntries))
    .use(rehypeChapterCovers)
    .use(rehypeResolveAssets(assets))
    .use(rehypeCallouts)
    .use(rehypeCodeBlockLabels)
    .use(rehypeKatex)
    .use(rehypeHighlight, { ignoreMissing: true })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = await processor.process(preprocessedBody);
  const bodyHtml = String(file);

  const logoSrc = resolveLogoUrl(frontmatter.logo, assets);
  const coverHtml = buildCoverHtml(frontmatter, logoSrc);
  const tocHtml = buildTocHtml(frontmatter, tocEntries);
  const backCoverHtml = buildBackCoverHtml(frontmatter);

  const fullHtml = `
    <article class="doc-root theme-${frontmatter.theme}">
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
