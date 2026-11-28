"use client";

import React from "react";
import {
  AlertTriangle,
  BarChartHorizontal,
  Bold,
  BookMarked,
  CheckCircle2,
  ClipboardList,
  Code2,
  Columns3,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  LayoutGrid,
  List,
  OctagonAlert,
  PieChart,
  Sigma,
  Table,
} from "lucide-react";
import { useI18n } from "./I18nProvider";

export interface FormatSnippet {
  label: string;
  before: string;
  after?: string;
  placeholder?: string;
  block?: boolean;
}

interface FormatToolbarProps {
  onInsert: (snippet: FormatSnippet) => void;
  onImageUploadClick?: () => void;
  isTableActive?: boolean;
  hasCustomTableColWidths?: boolean;
  isTableColWidthsOpen?: boolean;
  onToggleTableColWidths?: () => void;
}

export function FormatToolbar({
  onInsert,
  onImageUploadClick,
  isTableActive = false,
  hasCustomTableColWidths = false,
  isTableColWidthsOpen = false,
  onToggleTableColWidths,
}: FormatToolbarProps) {
  const { dict } = useI18n();
  const ft = dict.formatToolbar;

  const buttons: Array<{
    id: string;
    title: string;
    icon: React.ReactNode;
    snippet: FormatSnippet;
  }> = [
    {
      id: "h1",
      title: ft.h1Title,
      icon: <Heading1 className="h-3.5 w-3.5" />,
      snippet: { label: "H1", before: "# ", placeholder: ft.h1Placeholder, block: true },
    },
    {
      id: "h2",
      title: ft.h2Title,
      icon: <Heading2 className="h-3.5 w-3.5" />,
      snippet: { label: "H2", before: "## ", placeholder: ft.h2Placeholder, block: true },
    },
    {
      id: "h3",
      title: ft.h3Title,
      icon: <Heading3 className="h-3.5 w-3.5" />,
      snippet: { label: "H3", before: "### ", placeholder: ft.h3Placeholder, block: true },
    },
    {
      id: "hl",
      title: ft.highlightTitle,
      icon: <Highlighter className="h-3.5 w-3.5" />,
      snippet: {
        label: "HL",
        before: " <!-- hl: ",
        after: " -->",
        placeholder: "info",
      },
    },
    {
      id: "bold",
      title: ft.boldTitle,
      icon: <Bold className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.boldLabel,
        before: "**",
        after: "**",
        placeholder: ft.boldPlaceholder,
      },
    },
    {
      id: "italic",
      title: ft.italicTitle,
      icon: <Italic className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.italicLabel,
        before: "*",
        after: "*",
        placeholder: ft.italicPlaceholder,
      },
    },
    {
      id: "list",
      title: ft.listTitle,
      icon: <List className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.listLabel,
        before: "- ",
        placeholder: ft.listPlaceholder,
        block: true,
      },
    },
    {
      id: "table",
      title: ft.tableTitle,
      icon: <Table className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.tableLabel,
        before: ft.tableSnippet,
        block: true,
      },
    },
    {
      id: "colorbar",
      title: ft.colorbarTitle,
      icon: <BarChartHorizontal className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.colorbarLabel,
        before: "<!-- colorbar: ",
        after: " -->\n",
        placeholder: "Critical=10, High=20, Medium=30, Low=40",
        block: true,
      },
    },
    {
      id: "cards",
      title: ft.cardsTitle,
      icon: <LayoutGrid className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.cardsLabel,
        before: "<!-- cards -->\n",
        after: "\n<!-- /cards -->\n",
        placeholder: ft.cardsPlaceholder,
        block: true,
      },
    },
    {
      id: "chart",
      title: ft.chartTitle,
      icon: <PieChart className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.chartLabel,
        before: "<!-- donut: ",
        after: " -->\n",
        placeholder: "Critical=10, High=20, Medium=30, Low=40",
        block: true,
      },
    },
    {
      id: "note",
      title: ft.calloutNoteTitle,
      icon: <Info className="h-3.5 w-3.5" />,
      snippet: {
        label: "NOTE",
        before: ft.calloutNoteBefore,
        placeholder: ft.calloutNotePlaceholder,
        block: true,
      },
    },
    {
      id: "warning",
      title: ft.calloutWarningTitle,
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      snippet: {
        label: "WARNING",
        before: ft.calloutWarningBefore,
        placeholder: ft.calloutWarningPlaceholder,
        block: true,
      },
    },
    {
      id: "caution",
      title: ft.calloutCautionTitle,
      icon: <OctagonAlert className="h-3.5 w-3.5" />,
      snippet: {
        label: "CAUTION",
        before: ft.calloutCautionBefore,
        placeholder: ft.calloutCautionPlaceholder,
        block: true,
      },
    },
    {
      id: "summary",
      title: ft.calloutSummaryTitle,
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      snippet: {
        label: "SUMMARY",
        before: ft.calloutSummaryBefore,
        placeholder: ft.calloutSummaryPlaceholder,
        block: true,
      },
    },
    {
      id: "success",
      title: ft.calloutSuccessTitle,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      snippet: {
        label: "SUCCESS",
        before: ft.calloutSuccessBefore,
        placeholder: ft.calloutSuccessPlaceholder,
        block: true,
      },
    },
    {
      id: "math",
      title: ft.mathTitle,
      icon: <Sigma className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.mathLabel,
        before: "$$\n",
        after: "\n$$",
        placeholder: "E = mc^2",
        block: true,
      },
    },
    {
      id: "code",
      title: ft.codeTitle,
      icon: <Code2 className="h-3.5 w-3.5" />,
      snippet: {
        label: ft.codeLabel,
        before: "```ts:src/example.ts\n",
        after: "\n```",
        placeholder: "console.log('hello');",
        block: true,
      },
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-900 px-2.5 py-1.5">
      {buttons.map((btn) => (
        <button
          key={btn.id}
          type="button"
          title={btn.title}
          onClick={() => onInsert(btn.snippet)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          {btn.icon}
        </button>
      ))}

      {onImageUploadClick && (
        <button
          type="button"
          title={ft.insertImageTitle}
          onClick={onImageUploadClick}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
      )}

      {onToggleTableColWidths && (
        <button
          type="button"
          disabled={!isTableActive}
          aria-expanded={isTableColWidthsOpen}
          title={
            isTableActive ? ft.colWidthsActiveTitle : ft.colWidthsInactiveTitle
          }
          onClick={onToggleTableColWidths}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40 ${
            isTableColWidthsOpen || (isTableActive && hasCustomTableColWidths)
              ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
              : isTableActive
                ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
                : "border-transparent text-slate-400"
          }`}
        >
          <Columns3 className="h-3.5 w-3.5" />
          <span>{ft.colWidthsButton}</span>
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          title={ft.chapterTitle}
          onClick={() =>
            onInsert({
              label: ft.chapterLabel,
              before: "\n<!-- chapter -->\n# ",
              placeholder: ft.chapterPlaceholder,
              after: ft.chapterAfter,
              block: true,
            })
          }
          className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <BookMarked className="h-3.5 w-3.5" />
          <span>{ft.chapterLabel}</span>
        </button>

        <button
          type="button"
          title={ft.pagebreakTitle}
          onClick={() =>
            onInsert({
              label: ft.pagebreakLabel,
              before: "\n<!-- pagebreak -->\n",
              block: true,
            })
          }
          className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          <span>{ft.pagebreakLabel}</span>
        </button>
      </div>
    </div>
  );
}
