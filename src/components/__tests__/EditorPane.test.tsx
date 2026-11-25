import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

type DomHandlers = {
  dragover?: (event: DragEvent) => boolean | void;
  drop?: (event: DragEvent) => boolean | void;
  paste?: (event: ClipboardEvent) => boolean | void;
};

let capturedHandlers: DomHandlers = {};
const mockDispatch = vi.fn();
const mockFocus = vi.fn();

vi.mock("@codemirror/view", () => ({
  EditorView: {
    lineWrapping: { __mock: "lineWrapping" },
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
            selection: { main: { from: 0, to: 0, head: 0 } },
            sliceDoc: () => "",
          },
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

describe("EditorPane file drop restriction (#30)", () => {
  beforeEach(() => {
    capturedHandlers = {};
    mockDispatch.mockClear();
    mockFocus.mockClear();
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

    let handled: boolean | void;
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
});
