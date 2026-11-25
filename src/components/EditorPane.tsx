"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { classifyEditorDrop, isFileDragEvent } from "@/lib/editor-drop";
import { FormatSnippet, FormatToolbar } from "./FormatToolbar";

const UNSUPPORTED_DROP_MESSAGE =
  "画像ファイル以外はドロップできません（.md の読込は上部ツールバーをご利用ください）";

interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  onUploadImage?: (file: File) => Promise<string>;
}

export function EditorPane({
  value,
  onChange,
  onUploadImage,
}: EditorPaneProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dropNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 });
  const [dropNotice, setDropNotice] = useState<string | null>(null);

  const showDropNotice = useCallback((message: string) => {
    if (dropNoticeTimerRef.current) {
      clearTimeout(dropNoticeTimerRef.current);
    }
    setDropNotice(message);
    dropNoticeTimerRef.current = setTimeout(() => {
      setDropNotice(null);
      dropNoticeTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (dropNoticeTimerRef.current) {
        clearTimeout(dropNoticeTimerRef.current);
        dropNoticeTimerRef.current = null;
      }
    };
  }, []);

  const handleInsert = useCallback((snippet: FormatSnippet) => {
    const view = editorRef.current?.view;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);
    const innerText = selectedText || snippet.placeholder || "";

    let prefix = snippet.before;
    if (snippet.block && from > 0) {
      const prevChar = view.state.sliceDoc(from - 1, from);
      if (prevChar !== "\n" && !prefix.startsWith("\n")) {
        prefix = "\n" + prefix;
      }
    }

    const suffix = snippet.after ?? "";
    const insertText = `${prefix}${innerText}${suffix}`;
    const anchorStart = from + prefix.length;
    const anchorEnd = anchorStart + innerText.length;

    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: anchorStart, head: anchorEnd },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!onUploadImage || !file.type.startsWith("image/")) return;
      const assetId = await onUploadImage(file);
      const altName = file.name.replace(/\.[^.]+$/, "") || "image";
      handleInsert({
        label: "画像",
        before: `![${altName}](${assetId})`,
        block: false,
      });
    },
    [handleInsert, onUploadImage]
  );

  const handleFileDropEvent = useCallback(
    (event: Pick<DragEvent, "dataTransfer" | "preventDefault">): boolean => {
      const classification = classifyEditorDrop(event.dataTransfer);
      if (classification.kind === "text-drag") {
        return false;
      }

      event.preventDefault();

      if (classification.kind === "image" && onUploadImage) {
        setDropNotice(null);
        void insertImageFile(classification.file);
        return true;
      }

      showDropNotice(UNSUPPORTED_DROP_MESSAGE);
      return true;
    },
    [insertImageFile, onUploadImage, showDropNotice]
  );

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      search(),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        dragover: (event) => {
          if (isFileDragEvent(event.dataTransfer)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        drop: (event) => handleFileDropEvent(event),
        paste: (event) => {
          const items = event.clipboardData?.items;
          if (!items || !onUploadImage) return false;
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) {
                event.preventDefault();
                void insertImageFile(file);
                return true;
              }
            }
          }
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          setCursorInfo({
            line: line.number,
            col: head - line.from + 1,
          });
        }
      }),
    ],
    [handleFileDropEvent, insertImageFile, onUploadImage]
  );

  const lineCount = useMemo(() => {
    if (!value) return 0;
    return value.split(/\r?\n/).length;
  }, [value]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void insertImageFile(file);
          e.target.value = "";
        }}
      />

      <FormatToolbar
        onInsert={handleInsert}
        onImageUploadClick={
          onUploadImage ? () => imageInputRef.current?.click() : undefined
        }
      />

      {dropNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-950/70 px-3 py-1.5 text-[11px] text-amber-200"
        >
          <span>{dropNotice}</span>
          <button
            type="button"
            onClick={() => setDropNotice(null)}
            aria-label="通知を閉じる"
            className="rounded px-1.5 py-0.5 text-amber-300 hover:bg-amber-900/60 hover:text-amber-100"
          >
            ×
          </button>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-hidden"
        onDragOver={(e) => {
          if (!e.defaultPrevented && isFileDragEvent(e.dataTransfer)) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          if (!e.defaultPrevented) {
            handleFileDropEvent(e);
          }
        }}
      >
        <CodeMirror
          ref={editorRef}
          value={value}
          height="100%"
          theme={oneDark}
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            searchKeymap: true,
          }}
          className="h-full text-[13.5px]"
        />
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-3 py-1 text-[11px] text-slate-400">
        <div className="flex items-center gap-4">
          <span>文字数: {value.length.toLocaleString()}</span>
          <span>行数: {lineCount.toLocaleString()}</span>
        </div>
        <div>
          行 {cursorInfo.line}, 列 {cursorInfo.col}
        </div>
      </div>
    </div>
  );
}
