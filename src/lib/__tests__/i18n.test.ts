import { describe, it, expect } from "vitest";
import {
  detectBrowserLocale,
  EN_DICTIONARY,
  formatMessage,
  getDictionary,
  isLocale,
  JA_DICTIONARY,
} from "@/lib/i18n";
import { compileMarkdownToHtml } from "@/lib/markdown";
import { runPreflightCheck } from "@/lib/preflight";
import { getSampleMarkdown, SAMPLE_MARKDOWN_EN } from "@/lib/sample-markdown";
import { buildColumnWidthPresets } from "@/lib/table-col-widths";
import { validateImageFile } from "@/lib/image-processing";

function extractPlaceholders(str: string): string[] {
  return Array.from(new Set(str.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])).sort();
}

describe("i18n dictionaries, locale detection, and localized libraries (#71)", () => {
  it("detects Japanese vs English locales properly (including Sri Lanka en-LK / si-LK / ta-LK)", () => {
    expect(detectBrowserLocale("ja")).toBe("ja");
    expect(detectBrowserLocale("ja-JP")).toBe("ja");
    expect(detectBrowserLocale("JA_jp")).toBe("ja");

    expect(detectBrowserLocale("en-LK")).toBe("en");
    expect(detectBrowserLocale("en-GB")).toBe("en");
    expect(detectBrowserLocale("en-US")).toBe("en");
    expect(detectBrowserLocale("si-LK")).toBe("en");
    expect(detectBrowserLocale("ta-LK")).toBe("en");
    expect(detectBrowserLocale("")).toBe("en");
    expect(detectBrowserLocale(null)).toBe("en");

    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("keeps JA and EN dictionaries structurally identical with matching placeholders", () => {
    const jaSections = Object.keys(JA_DICTIONARY).sort();
    const enSections = Object.keys(EN_DICTIONARY).sort();
    expect(enSections).toEqual(jaSections);

    const allowedEmptyEnKeys = new Set(["printConfirm.headerFooterTipSuffix"]);

    for (const section of jaSections) {
      const jaSection = JA_DICTIONARY[section as keyof typeof JA_DICTIONARY];
      const enSection = EN_DICTIONARY[section as keyof typeof EN_DICTIONARY];
      const jaKeys = Object.keys(jaSection).sort();
      const enKeys = Object.keys(enSection).sort();
      expect(enKeys).toEqual(jaKeys);

      for (const key of jaKeys) {
        const jaVal = jaSection[key as keyof typeof jaSection] as string;
        const enVal = enSection[key as keyof typeof enSection] as string;
        expect(jaVal.length).toBeGreaterThan(0);
        if (!allowedEmptyEnKeys.has(`${section}.${key}`)) {
          expect(enVal.length).toBeGreaterThan(0);
        }
        expect(extractPlaceholders(enVal)).toEqual(extractPlaceholders(jaVal));
      }
    }

    expect(getDictionary("en")).toBe(EN_DICTIONARY);
    expect(getDictionary("ja")).toBe(JA_DICTIONARY);
    expect(formatMessage("Hello {name} ({count})", { name: "SL", count: 3 })).toBe(
      "Hello SL (3)"
    );
  });

  it("renders English TOC heading and unresolved asset placeholder when locale is 'en'", async () => {
    const md = [
      "---",
      'title: "System Spec"',
      "toc: true",
      "---",
      "",
      "# Overview",
      "",
      "![Arch](asset:arch.png)",
    ].join("\n");

    const compiledEn = await compileMarkdownToHtml(md, {}, { locale: "en" });
    expect(compiledEn.html).toContain('<h2 class="toc-heading">Table of Contents</h2>');
    expect(compiledEn.html).toContain("Drop image to restore");
    expect(compiledEn.html).not.toContain(">目次<");

    const compiledJa = await compileMarkdownToHtml(md, {}, { locale: "ja" });
    expect(compiledJa.html).toContain('<h2 class="toc-heading">目次</h2>');
    expect(compiledJa.html).toContain("画像をドロップして復元");
  });

  it("runs preflight checks, image validation, table presets, and sample markdown in English", async () => {
    const report = runPreflightCheck(
      '---\ntitle: "Untitled Document"\ncover: true\nlogo: "asset:missing_logo"\n---\n\nPrice is TBD for Sample Enterprise Ltd.',
      {},
      { ngWords: "SecretCode", locale: "en" }
    );

    expect(report.summary.pageLabel).toBe("A4 Portrait");
    expect(report.issues.some((i) => i.message.includes('still the default ("Untitled Document")'))).toBe(true);
    expect(report.issues.some((i) => i.message.includes('Image "missing_logo" set for Logo Image'))).toBe(true);
    expect(report.issues.some((i) => i.message.includes('Draft marker "TBD"'))).toBe(true);
    expect(report.issues.some((i) => i.message.includes('Sample placeholder "Sample Enterprise Ltd."'))).toBe(true);

    const presetsEn = buildColumnWidthPresets(3, "en");
    expect(presetsEn.map((p) => p.label)).toEqual([
      "Equal",
      "Narrow Left",
      "Narrow Right",
      "Wide Center",
    ]);

    expect(() =>
      validateImageFile(
        { name: "notes.txt", type: "text/plain", size: 100 },
        "inline",
        "en"
      )
    ).toThrow(/not a supported file type/);

    expect(getSampleMarkdown("en")).toBe(SAMPLE_MARKDOWN_EN);
    const compiledSample = await compileMarkdownToHtml(
      SAMPLE_MARKDOWN_EN,
      {},
      { locale: "en" }
    );
    expect(compiledSample.frontmatter.title).toContain("Next-Gen Cloud Platform");
    expect(compiledSample.html).toContain("Table of Contents");
  });
});
