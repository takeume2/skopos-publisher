import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

type DomHandlers = {
  dragover?: (event: DragEvent, view?: unknown) => boolean | void;
  drop?: (event: DragEvent, view?: unknown) => boolean | void;
  paste?: (event: ClipboardEvent, view?: unknown) => boolean | void;
};

let capturedHandlers: DomHandlers = {};
let mockSelection = { from: 0, to: 0, head: 0 };
let mockDocLength = 100;
const mockDispatch = vi.fn();
const mockFocus = vi.fn();
const mockScrollIntoView = vi.fn((pos: number, opts?: unknown) => ({
  __mock: "scrollIntoView",
  pos,
  opts,
}));
let mockDocLines = ["# 見出し1", "本文", "## 見出し2", "詳細"];
const mockPosAtCoords = vi.fn<
  (coords: { x: number; y: number }) => number | null
>(() => null);

vi.mock("@codemirror/view", () => ({
  EditorView: {
    lineWrapping: { __mock: "lineWrapping" },
    scrollIntoView: (pos: number, opts?: unknown) =>
      mockScrollIntoView(pos, opts),
    domEventHandlers: (handlers: DomHandlers) => {
      capturedHandlers = handlers;
      return { __mock: "domEventHandlers", handlers };
    },
    updateListener: {
      of: () => ({ __mock: "updateListener" }),
    },
  },
}));

vi.mock("@uiw/react-codemirror", () => {
  const MockCodeMirror = React.forwardRef(
    (
      { value }: { value: string },
      ref: React.ForwardedRef<{ view?: unknown }>
    ) => {
      React.useImperativeHandle(ref, () => ({
        view: {
          state: {
            doc: {
              length: mockDocLength,
              lines: mockDocLines.length,
              line: (lineNumber: number) => {
                let offset = 0;
                for (let i = 0; i < lineNumber - 1; i++) {
                  offset += (mockDocLines[i]?.length ?? 0) + 1;
                }
                const text = mockDocLines[lineNumber - 1] ?? "";
                return {
                  number: lineNumber,
                  from: offset,
                  to: offset + text.length,
                  text,
                };
              },
            },
            selection: { main: mockSelection },
            sliceDoc: () => "",
          },
          posAtCoords: mockPosAtCoords,
          dispatch: mockDispatch,
          focus: mockFocus,
        },
      }));
      return <div data-testid="mock-codemirror">{value}</div>;
    }
  );
  MockCodeMirror.displayName = "MockCodeMirror";
  return { default: MockCodeMirror };
});

import { EditorPane } from "@/components/EditorPane";

describe("EditorPane file drop restriction (#30) & drop position (#40)", () => {
  beforeEach(() => {
    capturedHandlers = {};
    mockSelection = { from: 0, to: 0, head: 0 };
    mockDocLength = 100;
    mockDocLines = ["# 見出し1", "本文", "## 見出し2", "詳細"];
    mockDispatch.mockClear();
    mockFocus.mockClear();
    mockScrollIntoView.mockClear();
    mockPosAtCoords.mockReset();
    mockPosAtCoords.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("blocks non-image files (.html, .rdp, .md) with preventDefault and return true, without modifying text", () => {
    const onChange = vi.fn();
    const onUploadImage = vi.fn();

    render(
      <EditorPane
        value="# 既存本文"
        onChange={onChange}
        onUploadImage={onUploadImage}
      />
    );

    const rdpFile = new File(["full address:s:10.0.0.1"], "work.rdp", {
      type: "",
    });
    const preventDefault = vi.fn();
    const dropEvent = {
      dataTransfer: { files: [rdpFile], types: ["Files"] },
      preventDefault,
    } as unknown as DragEvent;

    let handled: boolean | void = undefined;
    act(() => {
      handled = capturedHandlers.drop?.(dropEvent);
    });

    // CodeMirror のデフォルト読み込みを止めるため true を返し、ブラウザ遷移防止のため preventDefault を呼ぶ
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onUploadImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();

    // ユーザー向け通知が表示される
    expect(screen.getByRole("status").textContent).toContain(
      "画像ファイル以外はドロップできません"
    );
  });

  it("prevents browser default navigation on dragover for file drags, while passing through text drags", () => {
    render(<EditorPane value="# 本文" onChange={vi.fn()} />);

    const filePreventDefault = vi.fn();
    const fileHandled = capturedHandlers.dragover?.({
      dataTransfer: { files: [], types: ["Files"] },
      preventDefault: filePreventDefault,
    } as unknown as DragEvent);

    expect(fileHandled).toBe(true);
    expect(filePreventDefault).toHaveBeenCalledTimes(1);

    const textPreventDefault = vi.fn();
    const textHandled = capturedHandlers.dragover?.({
      dataTransfer: { files: [], types: ["text/plain"] },
      preventDefault: textPreventDefault,
    } as unknown as DragEvent);

    expect(textHandled).toBe(false);
    expect(textPreventDefault).not.toHaveBeenCalled();
  });

  it("allows internal text selection drag-and-drop by returning false", () => {
    render(
      <EditorPane
        value="# 本文"
        onChange={vi.fn()}
        onUploadImage={vi.fn()}
      />
    );

    const preventDefault = vi.fn();
    const handled = capturedHandlers.drop?.({
      dataTransfer: { files: [], types: ["text/plain"] },
      preventDefault,
    } as unknown as DragEvent);

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uploads and inserts markdown image syntax when an image file is dropped", async () => {
    const onUploadImage = vi.fn().mockResolvedValue("asset:img_123");

    render(
      <EditorPane
        value="# 本文"
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />
    );

    const pngFile = new File(["png"], "diagram.png", { type: "image/png" });
    const preventDefault = vi.fn();
    const handled = capturedHandlers.drop?.({
      dataTransfer: { files: [pngFile], types: ["Files"] },
      preventDefault,
    } as unknown as DragEvent);

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(onUploadImage).toHaveBeenCalledWith(pngFile);
      expect(mockDispatch).toHaveBeenCalled();
    });

    const dispatched = mockDispatch.mock.calls[0][0];
    expect(dispatched.changes.insert).toBe("![diagram](asset:img_123)");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("also blocks non-image file drops hitting the outer editor wrapper container", () => {
    const onUploadImage = vi.fn();
    const { getByTestId } = render(
      <EditorPane
        value="# 本文"
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />
    );

    const htmlFile = new File(["<html></html>"], "page.html", {
      type: "text/html",
    });
    const wrapper = getByTestId("mock-codemirror").parentElement!;

    fireEvent.drop(wrapper, {
      dataTransfer: { files: [htmlFile], types: ["Files"] },
    });

    expect(onUploadImage).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "画像ファイル以外はドロップできません"
    );
  });

  it("inserts dropped image at the resolved drop coordinates instead of the original cursor position (#40)", async () => {
    mockSelection = { from: 2, to: 6, head: 6 };
    mockDocLength = 50;
    mockPosAtCoords.mockReturnValue(24);
    const onUploadImage = vi.fn().mockResolvedValue("asset:img_drop");

    render(
      <EditorPane
        value={"# 見出し\n\nここに本文があります。\n\nここへドロップしたい。"}
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />
    );

    const pngFile = new File(["png"], "shot.png", { type: "image/png" });
    const preventDefault = vi.fn();
    const dropView = { posAtCoords: mockPosAtCoords };

    capturedHandlers.drop?.(
      {
        dataTransfer: { files: [pngFile], types: ["Files"] },
        clientX: 180,
        clientY: 220,
        preventDefault,
      } as unknown as DragEvent,
      dropView
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    expect(mockPosAtCoords).toHaveBeenCalledWith({ x: 180, y: 220 });
    const dispatched = mockDispatch.mock.calls[0][0];
    const expectedText = "![shot](asset:img_drop)";
    expect(dispatched.changes).toEqual({
      from: 24,
      to: 24,
      insert: expectedText,
    });
    expect(dispatched.selection).toEqual({
      anchor: 24 + expectedText.length,
      head: 24 + expectedText.length,
    });
  });

  it("handles dropping an image at document offset 0 without falling back to the cursor position (#40)", async () => {
    mockSelection = { from: 15, to: 15, head: 15 };
    mockDocLength = 30;
    mockPosAtCoords.mockReturnValue(0);
    const onUploadImage = vi.fn().mockResolvedValue("asset:img_top");

    render(
      <EditorPane
        value="先頭に挿入したい本文です。"
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />
    );

    const pngFile = new File(["png"], "top.png", { type: "image/png" });
    capturedHandlers.drop?.(
      {
        dataTransfer: { files: [pngFile], types: ["Files"] },
        clientX: 12,
        clientY: 14,
        preventDefault: vi.fn(),
      } as unknown as DragEvent,
      { posAtCoords: mockPosAtCoords }
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    const dispatched = mockDispatch.mock.calls[0][0];
    expect(dispatched.changes).toEqual({
      from: 0,
      to: 0,
      insert: "![top](asset:img_top)",
    });
  });

  it("falls back to cursor position when drop coordinates cannot be resolved and keeps paste insertion unchanged (#40)", async () => {
    mockSelection = { from: 9, to: 9, head: 9 };
    mockDocLength = 40;
    mockPosAtCoords.mockReturnValue(null);
    const onUploadImage = vi.fn().mockResolvedValue("asset:img_fallback");

    render(
      <EditorPane
        value="フォールバック確認用テキスト"
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />
    );

    // 座標解決不可な余白ドロップ → カーソル位置 (9) へフォールバック
    const dropFile = new File(["png"], "margin.png", { type: "image/png" });
    capturedHandlers.drop?.(
      {
        dataTransfer: { files: [dropFile], types: ["Files"] },
        clientX: 400,
        clientY: 500,
        preventDefault: vi.fn(),
      } as unknown as DragEvent,
      { posAtCoords: mockPosAtCoords }
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
    expect(mockDispatch.mock.calls[0][0].changes).toEqual({
      from: 9,
      to: 9,
      insert: "![margin](asset:img_fallback)",
    });

    // paste による画像挿入も従来通りカーソル位置 (9) へ挿入される
    mockDispatch.mockClear();
    const pasteFile = new File(["png"], "pasted.png", { type: "image/png" });
    const pasteHandled = capturedHandlers.paste?.({
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => pasteFile }],
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent);

    expect(pasteHandled).toBe(true);
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
    expect(mockDispatch.mock.calls[0][0].changes).toEqual({
      from: 9,
      to: 9,
      insert: "![pasted](asset:img_fallback)",
    });
  });

  it("jumps cursor and scrolls to the requested heading line (#34)", () => {
    mockDocLines = ["# 第1章", "本文1", "## 1.1 節", "本文2"];
    const onCursorLineChange = vi.fn();

    const { rerender } = render(
      <EditorPane
        value={mockDocLines.join("\n")}
        onChange={vi.fn()}
        jumpRequest={null}
        onCursorLineChange={onCursorLineChange}
      />
    );

    // 3行目 ("## 1.1 節") の先頭オフセット: "# 第1章\n"(6) + "本文1\n"(4) = 10
    rerender(
      <EditorPane
        value={mockDocLines.join("\n")}
        onChange={vi.fn()}
        jumpRequest={{ line: 3, requestId: 1 }}
        onCursorLineChange={onCursorLineChange}
      />
    );

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0]).toEqual({
      selection: { anchor: 10, head: 10 },
      effects: {
        __mock: "scrollIntoView",
        pos: 10,
        opts: { y: "start", yMargin: 24 },
      },
    });
    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(onCursorLineChange).toHaveBeenCalledWith(3);
    expect(screen.getByText("行 3, 列 1")).toBeTruthy();

    // 範囲外の行番号は最終行へ安全にクランプされる
    mockDispatch.mockClear();
    rerender(
      <EditorPane
        value={mockDocLines.join("\n")}
        onChange={vi.fn()}
        jumpRequest={{ line: 999, requestId: 2 }}
        onCursorLineChange={onCursorLineChange}
      />
    );

    // 4行目 ("本文2") の先頭オフセット: 10 + "## 1.1 節\n"(9) = 19
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0].selection).toEqual({
      anchor: 19,
      head: 19,
    });
    expect(onCursorLineChange).toHaveBeenCalledWith(4);
  });

  it("shows a notice and skips insertion when onUploadImage rejects with a size limit error (#16)", async () => {
    const onUploadImage = vi
      .fn()
      .mockRejectedValue(
        new Error("「huge.png」（15.0 MB）は インライン画像 の上限（10 MB）を超えているため読み込めません。")
      );

    render(
      <EditorPane
        value="# 本文"
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />
    );

    const bigPng = new File(["png"], "huge.png", { type: "image/png" });
    capturedHandlers.drop?.({
      dataTransfer: { files: [bigPng], types: ["Files"] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "上限（10 MB）を超えているため読み込めません"
      );
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
