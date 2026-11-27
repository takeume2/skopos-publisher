"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import {
  adjustAdjacentColumnWidths,
  buildColumnWidthPresets,
  buildEqualColumnWidths,
  formatColWidthsDirective,
  MIN_COLUMN_WIDTH_PERCENT,
  updateSingleColumnWidth,
  type MarkdownTableContext,
} from "@/lib/table-col-widths";

interface TableColWidthsPopoverProps {
  tableContext: MarkdownTableContext;
  onApply: (widths: number[]) => void;
  onResetAuto: () => void;
  onClose: () => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

export function TableColWidthsPopover({
  tableContext,
  onApply,
  onResetAuto,
  onClose,
}: TableColWidthsPopoverProps) {
  const initialWidths = useMemo(
    () =>
      tableContext.widths ?? buildEqualColumnWidths(tableContext.columnCount),
    [tableContext.columnCount, tableContext.widths]
  );

  const [draftWidths, setDraftWidths] = useState<number[]>(initialWidths);
  const barRef = useRef<HTMLDivElement>(null);

  const contextKey = `${tableContext.tableStartLine}:${tableContext.columnCount}:${tableContext.widths?.join(",") ?? "auto"}`;
  useEffect(() => {
    setDraftWidths(initialWidths);
  }, [contextKey, initialWidths]);

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

  const presets = useMemo(
    () => buildColumnWidthPresets(tableContext.columnCount),
    [tableContext.columnCount]
  );

  const handleDividerPointerDown = useCallback(
    (dividerIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
      const barEl = barRef.current;
      if (!barEl) return;
      const barWidth = barEl.getBoundingClientRect().width;
      if (barWidth <= 0) return;

      e.preventDefault();
      const startX = e.clientX;
      const startWidths = [...draftWidths];

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const deltaPercent = (dx / barWidth) * 100;
        setDraftWidths(
          adjustAdjacentColumnWidths(startWidths, dividerIndex, deltaPercent)
        );
      };

      const onPointerUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [draftWidths]
  );

  const handleDividerKeyDown = useCallback(
    (dividerIndex: number, e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 1 : 5;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setDraftWidths((prev) =>
          adjustAdjacentColumnWidths(prev, dividerIndex, -step)
        );
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setDraftWidths((prev) =>
          adjustAdjacentColumnWidths(prev, dividerIndex, step)
        );
      }
    },
    []
  );

  const directivePreview = formatColWidthsDirective(draftWidths);

  return (
    <div
      role="dialog"
      aria-label="テーブル列幅の調整"
      className="rounded-lg border border-slate-700 bg-slate-900/95 p-3.5 text-xs text-slate-200 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">
            テーブル列幅（{tableContext.columnCount}列）
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {tableContext.widths ? "カスタム指定中" : "自動幅"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {tableContext.widths && (
            <button
              type="button"
              onClick={onResetAuto}
              className={`inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700 hover:text-white ${FOCUS_RING}`}
            >
              <RotateCcw className="h-3 w-3" />
              <span>自動に戻す</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="列幅調整を閉じる"
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
            const label = tableContext.headers[idx] ?? `列${idx + 1}`;
            const nextLabel = tableContext.headers[idx + 1] ?? `列${idx + 2}`;
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
                    aria-label={`${label}と${nextLabel}の境界を調整`}
                    aria-valuemin={MIN_COLUMN_WIDTH_PERCENT}
                    aria-valuemax={100 - MIN_COLUMN_WIDTH_PERCENT}
                    aria-valuenow={width}
                    title="ドラッグまたは左右キーで列幅を調整"
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
        <p className="mt-1 text-[10px] text-slate-400">
          列の境界線を左右にドラッグ（または選択して ← / → キー）すると、合計 100% を保ったまま幅を調整できます。
        </p>
      </div>

      {/* ワンクリックプリセット */}
      {presets.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400">プリセット:</span>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setDraftWidths(preset.widths)}
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
          const label = tableContext.headers[idx] ?? `列${idx + 1}`;
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
                aria-label={`${label}の幅(%)`}
                min={MIN_COLUMN_WIDTH_PERCENT}
                max={100 - MIN_COLUMN_WIDTH_PERCENT * (draftWidths.length - 1)}
                step={1}
                value={width}
                onChange={(e) => {
                  const nextVal = Number(e.target.value);
                  if (Number.isFinite(nextVal)) {
                    setDraftWidths((prev) =>
                      updateSingleColumnWidth(prev, idx, nextVal)
                    );
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
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800 ${FOCUS_RING}`}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onApply(draftWidths)}
            className={`rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-sky-500 ${FOCUS_RING}`}
          >
            適用する
          </button>
        </div>
      </div>
    </div>
  );
}
