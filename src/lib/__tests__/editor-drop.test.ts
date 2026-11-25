import { describe, it, expect, vi } from "vitest";
import {
  classifyEditorDrop,
  extractDropImageFile,
  isFileDragEvent,
  resolveDropInsertPosition,
} from "@/lib/editor-drop";

describe("editor-drop", () => {
  it("classifies plain text drag without files as text-drag", () => {
    const dt = {
      files: [],
      types: ["text/plain"],
      items: [{ kind: "string", type: "text/plain" }],
    };

    expect(isFileDragEvent(dt)).toBe(false);
    expect(classifyEditorDrop(dt)).toEqual({ kind: "text-drag" });
  });

  it("classifies image file drops as image", () => {
    const pngFile = new File(["png"], "diagram.png", { type: "image/png" });
    const dt = {
      files: [pngFile],
      types: ["Files"],
    };

    expect(isFileDragEvent(dt)).toBe(true);
    expect(extractDropImageFile(dt)).toBe(pngFile);
    expect(classifyEditorDrop(dt)).toEqual({ kind: "image", file: pngFile });
  });

  it("rejects .html, .rdp, .md, .txt, and binary files", () => {
    const cases = [
      new File(["<script>alert(1)</script>"], "evil.html", { type: "text/html" }),
      new File(["full address:s:10.0.0.1"], "server.rdp", { type: "" }),
      new File(["# Title"], "notes.md", { type: "text/markdown" }),
      new File(["plain text"], "memo.txt", { type: "text/plain" }),
      new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" }),
      new File(["\x00\x01\x02"], "blob.bin", { type: "application/octet-stream" }),
    ];

    for (const file of cases) {
      const result = classifyEditorDrop({ files: [file], types: ["Files"] });
      expect(result).toEqual({
        kind: "rejected-file",
        fileNames: [file.name],
      });
    }
  });

  it("detects file drag during dragover when files list is still empty but types contains Files", () => {
    const dragoverDt = {
      files: [],
      types: ["Files"],
    };

    expect(isFileDragEvent(dragoverDt)).toBe(true);
    expect(classifyEditorDrop(dragoverDt)).toEqual({
      kind: "rejected-file",
      fileNames: [],
    });
  });

  it("picks only the image file when mixed with non-image files", () => {
    const rdpFile = new File(["full address:s:10.0.0.1"], "conn.rdp", { type: "" });
    const jpgFile = new File(["jpg"], "photo.jpg", { type: "image/jpeg" });

    const result = classifyEditorDrop({
      files: [rdpFile, jpgFile],
      types: ["Files"],
    });

    expect(result).toEqual({ kind: "image", file: jpgFile });
  });

  it("resolves document offset from drop coordinates including offset 0 and returns null when unresolvable", () => {
    const posAtCoords = vi.fn(({ x, y }: { x: number; y: number }) => {
      if (x === 10 && y === 20) return 0;
      if (x === 120 && y === 240) return 42;
      return null;
    });

    expect(
      resolveDropInsertPosition({ posAtCoords }, { clientX: 10, clientY: 20 })
    ).toBe(0);
    expect(
      resolveDropInsertPosition({ posAtCoords }, { clientX: 120, clientY: 240 })
    ).toBe(42);
    expect(
      resolveDropInsertPosition({ posAtCoords }, { clientX: 999, clientY: 999 })
    ).toBeNull();
    expect(resolveDropInsertPosition(null, { clientX: 10, clientY: 20 })).toBeNull();
    expect(resolveDropInsertPosition({ posAtCoords }, {})).toBeNull();
  });
});
