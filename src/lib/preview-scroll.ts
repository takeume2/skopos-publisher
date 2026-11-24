export interface ElementAnchor {
  kind: "id" | "section" | "content";
  id?: string;
  sectionSelector?: string;
  tagName?: string;
  textSignature?: string;
  occurrenceIndex?: number;
  offsetFromContainerTop: number;
}

export interface PreviewScrollSnapshot {
  scrollTop: number;
  scrollLeft: number;
  pageIndex: number;
  pageOffsetRatio: number;
  anchors: ElementAnchor[];
}

const ANCHOR_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "blockquote",
  "pre",
  "table",
  "figure",
  ".callout",
  ".code-block-wrapper",
  ".doc-cover",
  ".doc-toc",
  ".doc-backcover",
  ".doc-chapter-cover",
].join(", ");

const SPECIAL_SECTION_CLASSES = [
  "doc-cover",
  "doc-toc",
  "doc-backcover",
] as const;

const MAX_ID_ANCHORS = 2;
const MAX_CONTENT_ANCHORS = 4;
const MIN_SIGNATURE_LENGTH = 4;
const MAX_SIGNATURE_LENGTH = 80;
const TOP_THRESHOLD_PX = 2;

export function escapeCssId(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^\w-])/g, "\\$1");
}

function normalizeTextSignature(el: HTMLElement): string {
  return (el.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SIGNATURE_LENGTH);
}

function isContentCandidate(el: HTMLElement): boolean {
  if (el.closest(".pagedjs_margin")) return false;
  return Boolean(
    el.closest(".pagedjs_page_content") || el.closest(".pagedjs_page")
  );
}

function isHeadingElement(el: HTMLElement): boolean {
  return /^H[1-6]$/.test(el.tagName);
}

function getSpecialSectionSelector(el: HTMLElement): string | null {
  for (const cls of SPECIAL_SECTION_CLASSES) {
    if (el.classList.contains(cls)) {
      return `.${cls}`;
    }
  }
  return null;
}

function hasValidAnchorId(el: HTMLElement): boolean {
  const id = el.id?.trim();
  if (!id) return false;
  if (id.startsWith("page-")) return false;
  return true;
}

export function detectCurrentPage(
  scrollContainer: HTMLElement,
  previewHost: HTMLElement
): number {
  const pages = Array.from(
    previewHost.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  if (!pages.length) return 1;

  const containerRect = scrollContainer.getBoundingClientRect();
  const focusY = containerRect.top + containerRect.height / 3;

  for (let i = 0; i < pages.length; i++) {
    const rect = pages[i].getBoundingClientRect();
    if (rect.top <= focusY && rect.bottom >= focusY) {
      return i + 1;
    }
  }

  let closestIndex = 0;
  let closestDistance = Infinity;

  pages.forEach((pageEl, idx) => {
    const rect = pageEl.getBoundingClientRect();
    const dist = Math.abs(rect.top - focusY);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestIndex = idx;
    }
  });

  return closestIndex + 1;
}

export function capturePreviewScrollSnapshot(
  scrollContainer: HTMLElement,
  previewHost: HTMLElement
): PreviewScrollSnapshot | null {
  const pages = Array.from(
    previewHost.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  if (!pages.length) return null;

  const containerRect = scrollContainer.getBoundingClientRect();
  const currentPage = detectCurrentPage(scrollContainer, previewHost);
  const pageIndex = Math.min(Math.max(0, currentPage - 1), pages.length - 1);
  const pageRect = pages[pageIndex].getBoundingClientRect();
  const pageOffsetRatio =
    pageRect.height > 0
      ? (containerRect.top - pageRect.top) / pageRect.height
      : 0;

  const allCandidates = Array.from(
    previewHost.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR)
  ).filter(isContentCandidate);

  const signatureCounts = new Map<string, number>();

  const visibleIdAnchors: Array<{ anchor: ElementAnchor; dist: number; el: HTMLElement }> = [];
  const visibleSectionAnchors: Array<{ anchor: ElementAnchor; dist: number; el: HTMLElement }> = [];
  const visibleContentAnchors: Array<{ anchor: ElementAnchor; dist: number; el: HTMLElement }> = [];
  let precedingHeading: { anchor: ElementAnchor; top: number } | null = null;

  for (const el of allCandidates) {
    const tagName = el.tagName.toLowerCase();
    const signature = normalizeTextSignature(el);
    let occurrenceIndex = 0;
    if (signature.length >= MIN_SIGNATURE_LENGTH) {
      const sigKey = `${tagName}::${signature}`;
      occurrenceIndex = signatureCounts.get(sigKey) ?? 0;
      signatureCounts.set(sigKey, occurrenceIndex + 1);
    }

    const rect = el.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) continue;

    const offsetFromContainerTop = rect.top - containerRect.top;
    const isVisible =
      rect.bottom > containerRect.top && rect.top < containerRect.bottom;

    if (!isVisible) {
      if (
        rect.bottom <= containerRect.top &&
        isHeadingElement(el) &&
        hasValidAnchorId(el)
      ) {
        if (!precedingHeading || rect.top >= precedingHeading.top) {
          precedingHeading = {
            top: rect.top,
            anchor: {
              kind: "id",
              id: el.id,
              offsetFromContainerTop,
            },
          };
        }
      }
      continue;
    }

    const dist = Math.abs(offsetFromContainerTop);

    if (hasValidAnchorId(el)) {
      visibleIdAnchors.push({
        el,
        dist,
        anchor: {
          kind: "id",
          id: el.id,
          offsetFromContainerTop,
        },
      });
      continue;
    }

    const sectionSelector = getSpecialSectionSelector(el);
    if (sectionSelector) {
      visibleSectionAnchors.push({
        el,
        dist,
        anchor: {
          kind: "section",
          sectionSelector,
          offsetFromContainerTop,
        },
      });
      continue;
    }

    if (signature.length >= MIN_SIGNATURE_LENGTH) {
      visibleContentAnchors.push({
        el,
        dist,
        anchor: {
          kind: "content",
          tagName,
          textSignature: signature,
          occurrenceIndex,
          offsetFromContainerTop,
        },
      });
    }
  }

  visibleIdAnchors.sort((a, b) => a.dist - b.dist);
  visibleSectionAnchors.sort((a, b) => a.dist - b.dist);
  visibleContentAnchors.sort((a, b) => a.dist - b.dist);

  const anchors: ElementAnchor[] = [
    ...visibleIdAnchors.slice(0, MAX_ID_ANCHORS).map((item) => item.anchor),
    ...visibleSectionAnchors.slice(0, 1).map((item) => item.anchor),
    ...visibleContentAnchors
      .slice(0, MAX_CONTENT_ANCHORS)
      .map((item) => item.anchor),
  ];

  if (precedingHeading) {
    anchors.push(precedingHeading.anchor);
  }

  return {
    scrollTop: scrollContainer.scrollTop,
    scrollLeft: scrollContainer.scrollLeft,
    pageIndex,
    pageOffsetRatio,
    anchors,
  };
}

function findAnchorElement(
  previewHost: HTMLElement,
  anchor: ElementAnchor
): HTMLElement | null {
  if (anchor.kind === "id" && anchor.id) {
    const matched = previewHost.querySelector<HTMLElement>(
      `#${escapeCssId(anchor.id)}`
    );
    return matched && isContentCandidate(matched) ? matched : null;
  }

  if (anchor.kind === "section" && anchor.sectionSelector) {
    const matched = previewHost.querySelector<HTMLElement>(
      anchor.sectionSelector
    );
    return matched && isContentCandidate(matched) ? matched : null;
  }

  if (anchor.kind === "content" && anchor.tagName && anchor.textSignature) {
    const candidates = Array.from(
      previewHost.querySelectorAll<HTMLElement>(anchor.tagName)
    ).filter(
      (el) =>
        isContentCandidate(el) &&
        normalizeTextSignature(el) === anchor.textSignature
    );
    if (!candidates.length) return null;
    const idx = anchor.occurrenceIndex ?? 0;
    return candidates[idx] ?? candidates[0] ?? null;
  }

  return null;
}

export function restorePreviewScrollSnapshot(
  scrollContainer: HTMLElement,
  previewHost: HTMLElement,
  snapshot: PreviewScrollSnapshot
): number {
  const pages = Array.from(
    previewHost.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  if (!pages.length) return 1;

  if (snapshot.scrollTop <= TOP_THRESHOLD_PX) {
    scrollContainer.scrollTop = 0;
    scrollContainer.scrollLeft = snapshot.scrollLeft;
    return 1;
  }

  const containerRect = scrollContainer.getBoundingClientRect();

  for (const anchor of snapshot.anchors) {
    const targetEl = findAnchorElement(previewHost, anchor);
    if (!targetEl) continue;

    const targetRect = targetEl.getBoundingClientRect();
    if (targetRect.height === 0 && targetRect.width === 0) continue;

    const deltaY =
      targetRect.top - containerRect.top - anchor.offsetFromContainerTop;
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + deltaY);
    scrollContainer.scrollLeft = snapshot.scrollLeft;

    return detectCurrentPage(scrollContainer, previewHost);
  }

  const clampedPageIndex = Math.min(
    Math.max(0, snapshot.pageIndex),
    pages.length - 1
  );
  const targetPage = pages[clampedPageIndex];
  const pageRect = targetPage.getBoundingClientRect();
  const deltaY =
    pageRect.top - containerRect.top + pageRect.height * snapshot.pageOffsetRatio;

  scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + deltaY);
  scrollContainer.scrollLeft = snapshot.scrollLeft;

  return clampedPageIndex + 1;
}
