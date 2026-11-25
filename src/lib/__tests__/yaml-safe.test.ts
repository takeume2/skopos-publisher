import { describe, it, expect } from "vitest";
import { parseMarkdownDocument } from "@/lib/frontmatter";
import { resolvePrintDocumentTitle } from "@/lib/print-title";
import {
  MAX_YAML_INPUT_BYTES,
  parseSafeYamlRecord,
} from "@/lib/yaml-safe";

describe("yaml-safe (#14)", () => {
  it("parses standard JSON-compatible frontmatter types safely", () => {
    const rec = parseSafeYamlRecord(`
title: "セキュリティ報告書"
date: 2026-11-26
cover: true
font_size: 10.5
toc_depth: 3
`);
    expect(rec).toEqual({
      title: "セキュリティ報告書",
      // JSON_SCHEMA では非クォート日付も Date オブジェクトにならず文字列のまま保持
      date: "2026-11-26",
      cover: true,
      font_size: 10.5,
      toc_depth: 3,
    });
    expect(typeof rec?.date).toBe("string");
  });

  it("rejects non-JSON YAML tags such as !!timestamp, !!binary, and !!js/function", () => {
    expect(parseSafeYamlRecord("date: !!timestamp 2026-11-26")).toBeNull();
    expect(parseSafeYamlRecord("bin: !!binary R0lGODlhAQABAAAAACw=")).toBeNull();
    expect(
      parseSafeYamlRecord("fn: !!js/function 'function(){ return 1; }'")
    ).toBeNull();
  });

  it("strips prototype-polluting keys (__proto__, constructor, prototype)", () => {
    const rec = parseSafeYamlRecord(`
title: "安全な文書"
__proto__:
  polluted: true
constructor:
  prototype:
    polluted: true
prototype:
  polluted: true
`);
    expect(rec).not.toBeNull();
    expect(rec?.title).toBe("安全な文書");
    expect(Object.prototype.hasOwnProperty.call(rec, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rec, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rec, "prototype")).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects YAML alias bombs (Billion Laughs) and oversized YAML inputs", () => {
    const aliasBomb = [
      'a: &a ["lol","lol","lol","lol","lol"]',
      "b: &b [*a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c]",
      "e: &e [*d, *d, *d, *d, *d]",
      "f: &f [*e, *e, *e, *e, *e]",
    ].join("\n");
    expect(parseSafeYamlRecord(aliasBomb)).toBeNull();

    const oversized = `title: "${"a".repeat(MAX_YAML_INPUT_BYTES + 100)}"`;
    expect(parseSafeYamlRecord(oversized)).toBeNull();
  });

  it("falls back safely in frontmatter and print-title consumers when malicious YAML tags are present", () => {
    const md = `---
title: !!timestamp 2026-11-26
---

# フォールバック見出し
`;
    const parsed = parseMarkdownDocument(md);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter.title).toBe("文書タイトル");
    expect(resolvePrintDocumentTitle(md)).toBe("フォールバック見出し");
  });
});
