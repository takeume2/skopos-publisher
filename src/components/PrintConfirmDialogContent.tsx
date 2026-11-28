"use client";

import React from "react";
import type { Locale } from "@/lib/i18n";
import {
  runPreflightCheck,
  type PreflightCategory,
  type PreflightReport,
} from "@/lib/preflight";
import type { UnresolvedAssetRef } from "@/lib/unresolved-assets";
import { useI18n } from "./I18nProvider";

export interface PrintConfirmEvaluation {
  unresolvedItems: UnresolvedAssetRef[];
  preflightReport: PreflightReport | null;
  showHeaderFooterNotice: boolean;
  shouldShowDialog: boolean;
}

export function evaluatePrintConfirm(params: {
  markdown: string;
  assets: Record<string, string>;
  unresolvedAssets: UnresolvedAssetRef[];
  enablePreflightCheck: boolean;
  preflightNgWords: string;
  skipPrintHeaderFooterNotice: boolean;
  locale?: Locale;
}): PrintConfirmEvaluation {
  const showHeaderFooterNotice = !params.skipPrintHeaderFooterNotice;
  const preflightReport = params.enablePreflightCheck
    ? runPreflightCheck(params.markdown, params.assets, {
        ngWords: params.preflightNgWords,
        locale: params.locale ?? "ja",
      })
    : null;
  const hasPreflightIssues = (preflightReport?.issues.length ?? 0) > 0;

  return {
    unresolvedItems: params.unresolvedAssets,
    preflightReport,
    showHeaderFooterNotice,
    shouldShowDialog:
      params.unresolvedAssets.length > 0 ||
      hasPreflightIssues ||
      showHeaderFooterNotice,
  };
}

export interface PrintConfirmDialogContentProps {
  titleId?: string;
  unresolvedItems: UnresolvedAssetRef[];
  preflightReport: PreflightReport | null;
  showHeaderFooterNotice: boolean;
  skipPrintNoticeNextTime: boolean;
  onChangeSkipPrintNoticeNextTime: (checked: boolean) => void;
  onJumpToLine?: (line: number) => void;
  jumpHintText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PrintConfirmDialogContent({
  titleId = "mdpub-dialog-title",
  unresolvedItems,
  preflightReport,
  showHeaderFooterNotice,
  skipPrintNoticeNextTime,
  onChangeSkipPrintNoticeNextTime,
  onJumpToLine,
  jumpHintText,
  onCancel,
  onConfirm,
}: PrintConfirmDialogContentProps) {
  const { dict, format } = useI18n();
  const pc = dict.printConfirm;
  const resolvedJumpHint = jumpHintText ?? pc.jumpHintDefault;

  const categoryLabels: Record<PreflightCategory, string> = {
    incomplete: pc.categoryIncomplete,
    "unresolved-asset": pc.categoryUnresolvedAsset,
    metadata: pc.categoryMetadata,
    "ng-word": pc.categoryNgWord,
  };

  const preflightIssues = preflightReport?.issues ?? [];
  const summary = preflightReport?.summary ?? null;
  const hasWarnings = unresolvedItems.length > 0 || preflightIssues.length > 0;

  return (
    <div className="p-5">
      {unresolvedItems.length > 0 ? (
        <h2 id={titleId} className="text-sm font-semibold text-amber-300">
          {format(pc.titleUnresolved, { count: unresolvedItems.length })}
        </h2>
      ) : preflightIssues.length > 0 ? (
        <h2 id={titleId} className="text-sm font-semibold text-amber-300">
          {format(pc.titlePreflight, { count: preflightIssues.length })}
        </h2>
      ) : (
        <h2 id={titleId} className="text-sm font-semibold text-sky-300">
          {pc.titleHeaderFooter}
        </h2>
      )}

      {summary && (
        <div
          aria-label={pc.summaryAria}
          className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[10px] text-slate-300"
        >
          <span className="rounded bg-slate-800 px-1.5 py-0.5">
            {format(pc.summaryPage, { page: summary.pageLabel })}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5">
            {format(pc.summaryCover, {
              status: summary.cover ? pc.yes : pc.no,
            })}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${
              summary.logoStatus === "missing"
                ? "bg-amber-950/80 text-amber-300"
                : "bg-slate-800"
            }`}
          >
            {format(pc.summaryLogo, {
              status:
                summary.logoStatus === "configured"
                  ? pc.yes
                  : summary.logoStatus === "missing"
                    ? pc.logoMissing
                    : pc.no,
            })}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5">
            {format(pc.summaryWatermark, {
              status: summary.confidentialLabel ?? pc.none,
            })}
          </span>
        </div>
      )}

      {unresolvedItems.length > 0 && (
        <>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            {pc.unresolvedDescription}
          </p>
          <ul className="mt-2.5 max-h-36 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2.5 font-mono text-[11px] text-amber-200">
            {unresolvedItems.map((item) => (
              <li
                key={item.assetKey}
                className="flex items-center justify-between gap-2"
                title={item.assetKey}
              >
                <span className="min-w-0 truncate">{item.displayName}</span>
                {item.occurrences > 1 && (
                  <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
                    ×{item.occurrences}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {preflightIssues.length > 0 && (
        <div className="mt-3">
          {unresolvedItems.length > 0 && (
            <p className="mb-1.5 text-xs font-semibold text-amber-300">
              {format(pc.preflightSubheading, { count: preflightIssues.length })}
            </p>
          )}
          <ul className="max-h-44 space-y-1.5 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2 text-[11px]">
            {preflightIssues.map((issue) => {
              const badgeLabel = categoryLabels[issue.category];
              const badgeTone =
                issue.category === "ng-word"
                  ? "bg-red-950/80 text-red-300 border-red-800/60"
                  : "bg-amber-950/80 text-amber-300 border-amber-800/60";
              const content = (
                <div className="flex w-full items-start gap-2 text-left">
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${badgeTone}`}
                  >
                    {badgeLabel}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-100">{issue.message}</span>
                      {typeof issue.line === "number" && (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-400">
                          L{issue.line}
                        </span>
                      )}
                    </div>
                    {issue.snippet && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                        {issue.snippet}
                      </p>
                    )}
                  </div>
                </div>
              );

              return (
                <li key={issue.id}>
                  {typeof issue.line === "number" && onJumpToLine ? (
                    <button
                      type="button"
                      onClick={() => onJumpToLine(issue.line!)}
                      title={format(pc.jumpTooltip, { line: issue.line })}
                      className="w-full rounded px-2 py-1.5 transition hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="px-2 py-1.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {resolvedJumpHint && (
            <p className="mt-1 text-[10px] text-slate-400">{resolvedJumpHint}</p>
          )}
        </div>
      )}

      {showHeaderFooterNotice && (
        <div
          className={
            hasWarnings
              ? "mt-3 rounded-md border border-sky-500/30 bg-sky-950/25 p-3"
              : "mt-2.5"
          }
        >
          {hasWarnings && (
            <p className="text-xs font-semibold text-sky-300">
              {pc.browserSettingsHeading}
            </p>
          )}
          <p
            className={`${
              hasWarnings ? "mt-1" : ""
            } text-xs leading-relaxed text-slate-300`}
          >
            {pc.browserSettingsDescription}
          </p>
          <ul className="mt-2.5 space-y-1.5 rounded-md border border-slate-800 bg-slate-950/70 p-2.5 text-[11px] leading-relaxed text-slate-200">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-300" aria-hidden="true">
                •
              </span>
              <span>
                {pc.headerFooterTipPrefix}
                <strong className="text-white">
                  {pc.headerFooterTipStrong}
                </strong>
                {pc.headerFooterTipSuffix}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-sky-400" aria-hidden="true">
                •
              </span>
              <span>
                <strong className="text-white">
                  {pc.backgroundGraphicsStrong}
                </strong>
                {pc.backgroundGraphicsSuffix}
              </span>
            </li>
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={skipPrintNoticeNextTime}
              onChange={(e) => onChangeSkipPrintNoticeNextTime(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            />
            <span>{pc.skipNoticeCheckbox}</span>
          </label>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          {dict.common.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-md px-3.5 py-1.5 text-xs font-semibold text-white transition ${
            hasWarnings
              ? "bg-amber-600 hover:bg-amber-500"
              : "bg-sky-600 hover:bg-sky-500"
          }`}
        >
          {hasWarnings ? pc.confirmWithWarnings : pc.confirmNormal}
        </button>
      </div>
    </div>
  );
}
