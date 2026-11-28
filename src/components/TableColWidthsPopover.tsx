"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Undo2, X } from "lucide-react";
import {
  adjustAdjacentColumnWidths,
  buildColumnWidthPresets,
  buildEqualColumnWidths,
  formatColWidthsDirective,
  MIN_COLUMN_WIDTH_PERCENT,
  updateSingleColumnWidth,
  type MarkdownTableContext,
} from "@/lib/table-col-widths";
import { useI18n } from "./I18nProvider";

interface TableColWidthsPopoverProps {
  tableContext: MarkdownTableContext;
  onApply: (widths: number[]) => void;
  onResetAuto: () => void;
  onClose: () => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

function areWidthsEqual(a: number[] | null, b: number[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function TableColWidthsPopover({
  tableContext,
  onApply,
  onResetAuto,
  onClose,
}: TableColWidthsPopoverProps) {
  const { locale, dict, format } = useI18n();
  const tw = dict.tableColWidths;

  const initialWidths = useMemo(
    () =>
      tableContext.widths ?? buildEqualColumnWidths(tableContext.columnCount),
    [tableContext.columnCount, tableContext.widths]
  );

  const [draftWidths, setDraftWidths] = useState<number[]>(initialWidths);
  const draftWidthsRef = useRef<number[]>(draftWidths);
  draftWidthsRef.current = draftWidths;

  const initialSnapshotRef = useRef<number[] | null>(
    tableContext.widths ? [...tableContext.widths] : null
  );
  const barRef = useRef<HTMLDivElement>(null);
  const inputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const cancelPendingInputCommit = useCallback(() => {
    if (inputDebounceRef.current) {
      clearTimeout(inputDebounceRef.current);
      inputDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    setDraftWidths(initialWidths);
  }, [initialWidths]);

  useEffect(() => {
    return () => {
      cancelPendingInputCommit();
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
    };
  }, [cancelPendingInputCommit]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const commitWidths = useCallback(
    (nextWidths: number[]) => {
      cancelPendingInputCommit();
      setDraftWidths(nextWidths);
      draftWidthsRef.current = nextWidths;
      onApply(nextWidths);
    },
    [cancelPendingInputCommit, onApply]
  );

  const handleResetToAuto = useCallback(() => {
    cancelPendingInputCommit();
    const equal = buildEqualColumnWidths(tableContext.columnCount);
    setDraftWidths(equal);
    draftWidthsRef.current = equal;
    onResetAuto();
  }, [cancelPendingInputCommit, onResetAuto, tableContext.columnCount]);

  const handleRevertInitial = useCallback(() => {
    const snapshot = initialSnapshotRef.current;
    if (snapshot === null) {
      handleResetToAuto();
    } else {
      commitWidths([...snapshot]);
    }
  }, [commitWidths, handleResetToAuto]);

  const presets = useMemo(
    () => buildColumnWidthPresets(tableContext.columnCount, locale),
    [locale, tableContext.columnCount]
  );

  const handleDividerPointerDown = useCallback(
    (dividerIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
      const barEl = barRef.current;
      if (!barEl) return;
      const barWidth = barEl.getBoundingClientRect().width;
      if (barWidth <= 0) return;

      e.preventDefault();
      cancelPendingInputCommit();
      activeDragCleanupRef.current?.();

      const startX = e.clientX;
      const startWidths = [...draftWidthsRef.current];
      let latestWidths = startWidths;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const deltaPercent = (dx / barWidth) * 100;
        const next = adjustAdjacentColumnWidths(
          startWidths,
          dividerIndex,
          deltaPercent
        );
        latestWidths = next;
        setDraftWidths(next);
        draftWidthsRef.current = next;
      };

      const cleanupDrag = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        activeDragCleanupRef.current = null;
      };

      const onPointerUp = () => {
        cleanupDrag();
        if (!areWidthsEqual(latestWidths, tableContext.widths)) {
          onApply(latestWidths);
        }
      };

      activeDragCleanupRef.current = cleanupDrag;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [cancelPendingInputCommit, onApply, tableContext.widths]
  );

  const handleDividerKeyDown = useCallback(
    (dividerIndex: number, e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 1 : 5;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = adjustAdjacentColumnWidths(
          draftWidthsRef.current,
          dividerIndex,
          -step
        );
        commitWidths(next);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = adjustAdjacentColumnWidths(
          draftWidthsRef.current,
          dividerIndex,
          step
        );
        commitWidths(next);
      }
    },
    [commitWidths]
  );

  const handleNumericInputChange = useCallback(
    (colIndex: number, rawValue: string) => {
      const nextVal = Number(rawValue);
      if (!Number.isFinite(nextVal)) return;
      const next = updateSingleColumnWidth(
        draftWidthsRef.current,
        colIndex,
        nextVal
      );
      setDraftWidths(next);
      draftWidthsRef.current = next;

      cancelPendingInputCommit();
      inputDebounceRef.current = setTimeout(() => {
        inputDebounceRef.current = null;
        onApply(draftWidthsRef.current);
      }, 200);
    },
    [cancelPendingInputCommit, onApply]
  );

  const flushNumericInputCommit = useCallback(() => {
    if (inputDebounceRef.current) {
      clearTimeout(inputDebounceRef.current);
      inputDebounceRef.current = null;
      onApply(draftWidthsRef.current);
    }
  }, [onApply]);

  const directivePreview = formatColWidthsDirective(draftWidths);
  const canRevertInitial = !areWidthsEqual(
    tableContext.widths,
    initialSnapshotRef.current
  );

  return (
    <div
      role="dialog"
      aria-label={tw.dialogAria}
      className="rounded-lg border border-slate-700 bg-slate-900/95 p-3.5 text-xs text-slate-200 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">
            {format(tw.heading, { count: tableContext.columnCount })}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {tableContext.widths ? tw.statusCustom : tw.statusAuto}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {tableContext.widths && (
            <button
              type="button"
              onClick={handleResetToAuto}
              className={`inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700 hover:text-white ${FOCUS_RING}`}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{tw.resetAuto}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={tw.closeAria}
            className={`rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white ${FOCUS_RING}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* インタラクティブ列幅バー */}
      <div className="mt-3">
        <div
          ref={barRef}
          className="flex h-14 w-full select-none overflow-hidden rounded-md border border-slate-700 bg-slate-950"
        >
          {draftWidths.map((width, idx) => {
            const label =
              tableContext.headers[idx] ??
              format(tw.colFallback, { index: idx + 1 });
            const nextLabel =
              tableContext.headers[idx + 1] ??
              format(tw.colFallback, { index: idx + 2 });
            const isLast = idx === draftWidths.length - 1;

            return (
              <React.Fragment key={idx}>
                <div
                  style={{ width: `${width}%` }}
                  title={`${label}: ${width}%`}
                  className="flex min-w-0 flex-col items-center justify-center bg-sky-950/35 px-1 text-center"
                >
                  <span className="w-full truncate text-[11px] font-medium text-slate-100">
                    {label}
                  </span>
                  <span className="mt-0.5 font-mono text-[10px] tabular-nums text-sky-300">
                    {width}%
                  </span>
                </div>
                {!isLast && (
                  <div
                    role="separator"
                    tabIndex={0}
                    aria-orientation="vertical"
                    aria-label={format(tw.dividerAria, {
                      left: label,
                      right: nextLabel,
                    })}
                    aria-valuemin={MIN_COLUMN_WIDTH_PERCENT}
                    aria-valuemax={100 - MIN_COLUMN_WIDTH_PERCENT}
                    aria-valuenow={width}
                    title={tw.dividerTitle}
                    onPointerDown={(e) => handleDividerPointerDown(idx, e)}
                    onKeyDown={(e) => handleDividerKeyDown(idx, e)}
                    className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize focus:outline-none"
                  >
                    <span className="mx-auto block h-full w-0.5 bg-slate-600 transition group-hover:w-1 group-hover:bg-sky-400 group-focus-visible:w-1 group-focus-visible:bg-sky-400" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">{tw.hint}</p>
      </div>

      {/* ワンクリックプリセット */}
      {presets.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400">{tw.presetsLabel}</span>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => commitWidths(preset.widths)}
              className={`rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 transition hover:border-sky-500/60 hover:bg-slate-700 hover:text-white ${FOCUS_RING}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {/* 数値微調整 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {draftWidths.map((width, idx) => {
          const label =
            tableContext.headers[idx] ??
            format(tw.colFallback, { index: idx + 1 });
          return (
            <label
              key={idx}
              className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-300"
            >
              <span className="max-w-[72px] truncate" title={label}>
                {label}
              </span>
              <input
                type="number"
                aria-label={format(tw.widthInputAria, { label })}
                min={MIN_COLUMN_WIDTH_PERCENT}
                max={100 - MIN_COLUMN_WIDTH_PERCENT * (draftWidths.length - 1)}
                step={1}
                value={width}
                onChange={(e) => handleNumericInputChange(idx, e.target.value)}
                onBlur={flushNumericInputCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    flushNumericInputCommit();
                  }
                }}
                className="w-11 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-right font-mono text-[11px] tabular-nums text-white focus:border-sky-500 focus:outline-none"
              />
              <span className="text-slate-500">%</span>
            </label>
          );
        })}
      </div>

      {/* 出力プレビュー＆アクション */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
        <code className="max-w-full truncate rounded bg-slate-950 px-2 py-1 font-mono text-[10px] text-sky-300">
          {directivePreview}
        </code>
        <div className="ml-auto flex items-center gap-2">
          {canRevertInitial && (
            <button
              type="button"
              onClick={handleRevertInitial}
              className={`inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white ${FOCUS_RING}`}
            >
              <Undo2 className="h-3 w-3" />
              <span>{tw.revertButton}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-sky-500 ${FOCUS_RING}`}
          >
            {dict.common.done}
          </button>
        </div>
      </div>
    </div>
  );
}
