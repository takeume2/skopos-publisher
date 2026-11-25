import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILENAME_TEMPLATE,
  FALLBACK_EXPORT_BASENAME,
  MAX_EXPORT_BASENAME_LENGTH,
  buildExportFilename,
  buildExportFilenameBasename,
  normalizeDateForFilename,
  resolveFilenamePresetId,
  sanitizeFilenameBasename,
} from "@/lib/export-filename";

const FIXED_NOW = new Date(2026, 10, 26, 9, 0, 0); // 2026-11-26 (local)

describe("export-filename", () => {
  it("builds YYYYMMDD_title_CONFIDENTIAL for pdf and md when confidential_mode is enabled", () => {
    const md = `---
title: "セキュリティ監査報告書"
date: "2026-11-14"
confidential_mode: "strict"
confidential_label: "CONFIDENTIAL"
---

# 概要
`;
    expect(buildExportFilename(md, "pdf", { now: FIXED_NOW })).toBe(
      "20261114_セキュリティ監査報告書_CONFIDENTIAL.pdf"
    );
    expect(buildExportFilename(md, "md", { now: FIXED_NOW })).toBe(
      "20261114_セキュリティ監査報告書_CONFIDENTIAL.md"
    );
  });

  it("omits confidential segment and trailing separator when confidential_mode is none", () => {
    const md = `---
title: "技術仕様書"
date: "2026-11-14"
confidential_mode: "none"
confidential_label: "CONFIDENTIAL"
---

# 概要
`;
    expect(buildExportFilename(md, "pdf", { now: FIXED_NOW })).toBe(
      "20261114_技術仕様書.pdf"
    );
    expect(buildExportFilename(md, "md", { now: FIXED_NOW })).toBe(
      "20261114_技術仕様書.md"
    );
  });

  it("supports custom confidential labels such as Japanese labels", () => {
    const md = `---
title: "設計書"
date: "2026/05/03"
confidential_mode: "standard"
confidential_label: "社外秘"
---
`;
    expect(buildExportFilename(md, "pdf", { now: FIXED_NOW })).toBe(
      "20260503_設計書_社外秘.pdf"
    );
  });

  it("normalizes various date formats and falls back to current date when date is omitted or invalid", () => {
    expect(normalizeDateForFilename("2026-11-14", FIXED_NOW)).toBe("20261114");
    expect(normalizeDateForFilename("2026/3/5", FIXED_NOW)).toBe("20260305");
    expect(normalizeDateForFilename("2026.01.09", FIXED_NOW)).toBe("20260109");
    expect(normalizeDateForFilename("2026年4月7日", FIXED_NOW)).toBe("20260407");
    expect(normalizeDateForFilename("20261125", FIXED_NOW)).toBe("20261125");
    expect(
      normalizeDateForFilename(new Date(Date.UTC(2026, 0, 15)), FIXED_NOW)
    ).toBe("20260115");
    // 無効な日付・空文字・未指定は当日へフォールバック
    expect(normalizeDateForFilename("2026-02-30", FIXED_NOW)).toBe("20261126");
    expect(normalizeDateForFilename("TBD", FIXED_NOW)).toBe("20261126");
    expect(normalizeDateForFilename("", FIXED_NOW)).toBe("20261126");
    expect(normalizeDateForFilename(undefined, FIXED_NOW)).toBe("20261126");

    // フロントマターに date が未指定の場合、ハードコード初期値ではなく当日日付を使う
    const noDateMd = `---\ntitle: "議事録"\n---\n`;
    expect(buildExportFilenameBasename(noDateMd, { now: FIXED_NOW })).toBe(
      "20261126_議事録"
    );

    // YAML 非クォート日付（js-yaml が Date として返すケース）
    const unquotedDateMd = `---\ntitle: "月次報告"\ndate: 2026-08-01\n---\n`;
    expect(buildExportFilenameBasename(unquotedDateMd, { now: FIXED_NOW })).toBe(
      "20260801_月次報告"
    );
  });

  it("supports custom templates, collapses separators around omitted variables, and preserves underscores inside values", () => {
    const md = `---
title: "API_v2-設計書"
date: "2026-11-20"
author: ""
recipient: "株式会社サンプル"
confidential_mode: "none"
---
`;
    expect(
      buildExportFilenameBasename(md, {
        template: "{date}_{author}_{title}_{confidential}",
        now: FIXED_NOW,
      })
    ).toBe("20261120_API_v2-設計書");

    expect(
      buildExportFilenameBasename(md, {
        template: "{confidential}_{date}_{recipient}_{title}",
        now: FIXED_NOW,
      })
    ).toBe("20261120_株式会社サンプル_API_v2-設計書");

    expect(
      buildExportFilenameBasename(md, {
        template: "[{date}_{confidential}]_{title}",
        now: FIXED_NOW,
      })
    ).toBe("[20261120]_API_v2-設計書");

    expect(
      buildExportFilenameBasename(md, {
        template: "{author}_{confidential}",
        now: FIXED_NOW,
      })
    ).toBe(FALLBACK_EXPORT_BASENAME);
  });

  it("falls back to first heading or imported filename when frontmatter title is missing", () => {
    expect(
      buildExportFilenameBasename("# 導入ガイド\n\n本文", { now: FIXED_NOW })
    ).toBe("20261126_導入ガイド");

    expect(
      buildExportFilenameBasename("見出しのない本文", {
        fallbackFilename: "quarterly-memo.md",
        now: FIXED_NOW,
      })
    ).toBe("20261126_quarterly-memo");
  });

  it("sanitizes OS-forbidden characters, reserved Windows names, and overly long basenames", () => {
    const md = `---
title: 'A/B:C*D?E"F<G>H|I'
date: "2026-11-26"
confidential_mode: "none"
---
`;
    expect(buildExportFilenameBasename(md, { now: FIXED_NOW })).toBe(
      "20261126_A_B_C_D_E_F_G_H_I"
    );

    expect(sanitizeFilenameBasename("CON")).toBe("CON_doc");
    expect(sanitizeFilenameBasename("  ...  ")).toBe(FALLBACK_EXPORT_BASENAME);

    const longName = "あ".repeat(160);
    const sanitizedLong = sanitizeFilenameBasename(longName);
    expect(Array.from(sanitizedLong).length).toBeLessThanOrEqual(
      MAX_EXPORT_BASENAME_LENGTH
    );
  });

  it("resolves preset IDs accurately", () => {
    expect(resolveFilenamePresetId(DEFAULT_FILENAME_TEMPLATE)).toBe("standard");
    expect(resolveFilenamePresetId("{date}_{title}")).toBe("date-title");
    expect(resolveFilenamePresetId("{title}")).toBe("title-only");
    expect(resolveFilenamePresetId("{date}-{recipient}-{title}")).toBe("custom");
  });
});
