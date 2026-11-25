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
}

export function FormatToolbar({
  onInsert,
  onImageUploadClick,
}: FormatToolbarProps) {
  const buttons: Array<{
    title: string;
    icon: React.ReactNode;
    snippet: FormatSnippet;
  }> = [
    {
      title: "見出し H1",
      icon: <Heading1 className="h-3.5 w-3.5" />,
      snippet: { label: "H1", before: "# ", placeholder: "見出し1", block: true },
    },
    {
      title: "見出し H2",
      icon: <Heading2 className="h-3.5 w-3.5" />,
      snippet: { label: "H2", before: "## ", placeholder: "見出し2", block: true },
    },
    {
      title: "見出し H3",
      icon: <Heading3 className="h-3.5 w-3.5" />,
      snippet: { label: "H3", before: "### ", placeholder: "見出し3", block: true },
    },
    {
      title: "見出しハイライト指定 <!-- hl: ... -->",
      icon: <Highlighter className="h-3.5 w-3.5" />,
      snippet: {
        label: "HL",
        before: " <!-- hl: ",
        after: " -->",
        placeholder: "info",
      },
    },
    {
      title: "太字",
      icon: <Bold className="h-3.5 w-3.5" />,
      snippet: { label: "太字", before: "**", after: "**", placeholder: "太字テキスト" },
    },
    {
      title: "斜体",
      icon: <Italic className="h-3.5 w-3.5" />,
      snippet: { label: "斜体", before: "*", after: "*", placeholder: "斜体テキスト" },
    },
    {
      title: "箇条書きリスト",
      icon: <List className="h-3.5 w-3.5" />,
      snippet: { label: "リスト", before: "- ", placeholder: "項目", block: true },
    },
    {
      title: "テーブル雛形",
      icon: <Table className="h-3.5 w-3.5" />,
      snippet: {
        label: "テーブル",
        before:
          "| 項目 | 内容 | 数値 |\n| :--- | :--- | ---: |\n| サンプル | 値 | 1,000 |\n",
        block: true,
      },
    },
    {
      title: "カラーバー（割合積み上げ棒）<!-- colorbar: ... -->",
      icon: <BarChartHorizontal className="h-3.5 w-3.5" />,
      snippet: {
        label: "カラーバー",
        before: "<!-- colorbar: ",
        after: " -->\n",
        placeholder: "Critical=10, High=20, Medium=30, Low=40",
        block: true,
      },
    },
    {
      title: "カードブロック（サマリー／KPI）<!-- cards -->",
      icon: <LayoutGrid className="h-3.5 w-3.5" />,
      snippet: {
        label: "カード",
        before: "<!-- cards -->\n",
        after: "\n<!-- /cards -->\n",
        placeholder:
          "- 検出総数 | 42件 | 前回比 -8件\n- Critical | 3件 | 要即時対応 | critical\n- 適合率 | 92.5% | 目標 90%以上 | success",
        block: true,
      },
    },
    {
      title: "円／ドーナツグラフ <!-- donut: ... -->",
      icon: <PieChart className="h-3.5 w-3.5" />,
      snippet: {
        label: "グラフ",
        before: "<!-- donut: ",
        after: " -->\n",
        placeholder: "Critical=10, High=20, Medium=30, Low=40",
        block: true,
      },
    },
    {
      title: "コールアウト [!NOTE]",
      icon: <Info className="h-3.5 w-3.5" />,
      snippet: {
        label: "NOTE",
        before: "> [!NOTE] ノート\n> ",
        placeholder: "補足事項を記述します。",
        block: true,
      },
    },
    {
      title: "コールアウト [!WARNING]",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      snippet: {
        label: "WARNING",
        before: "> [!WARNING] ワーニング\n> ",
        placeholder: "注意事項を記述します。",
        block: true,
      },
    },
    {
      title: "コールアウト [!CAUTION]",
      icon: <OctagonAlert className="h-3.5 w-3.5" />,
      snippet: {
        label: "CAUTION",
        before: "> [!CAUTION] コーション\n> ",
        placeholder: "重大なリスクや禁止事項を記述します。",
        block: true,
      },
    },
    {
      title: "コールアウト [!SUMMARY]",
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      snippet: {
        label: "SUMMARY",
        before: "> [!SUMMARY] サマリー\n> ",
        placeholder: "セクションの要点を記述します。",
        block: true,
      },
    },
    {
      title: "コールアウト [!SUCCESS]",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      snippet: {
        label: "SUCCESS",
        before: "> [!SUCCESS] サクセス\n> ",
        placeholder: "適合・達成した基準や確認結果を記述します。",
        block: true,
      },
    },
    {
      title: "数式ブロック $$",
      icon: <Sigma className="h-3.5 w-3.5" />,
      snippet: {
        label: "数式",
        before: "$$\n",
        after: "\n$$",
        placeholder: "E = mc^2",
        block: true,
      },
    },
    {
      title: "コードブロック",
      icon: <Code2 className="h-3.5 w-3.5" />,
      snippet: {
        label: "コード",
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
          key={btn.title}
          type="button"
          title={btn.title}
          onClick={() => onInsert(btn.snippet)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          {btn.icon}
        </button>
      ))}

      {onImageUploadClick && (
        <button
          type="button"
          title="画像を挿入"
          onClick={onImageUploadClick}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          title="中扉挿入 (<!-- chapter -->)"
          onClick={() =>
            onInsert({
              label: "中扉",
              before: "\n<!-- chapter -->\n# ",
              placeholder: "第1章 タイトル",
              after: "\nこの章の概要文やサブタイトルを記述します。\n<!-- /chapter -->\n",
              block: true,
            })
          }
          className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
        >
          <BookMarked className="h-3.5 w-3.5" />
          <span>中扉</span>
        </button>

        <button
          type="button"
          title="改ページ挿入 (<!-- pagebreak -->)"
          onClick={() =>
            onInsert({
              label: "改ページ",
              before: "\n<!-- pagebreak -->\n",
              block: true,
            })
          }
          className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          <span>改ページ</span>
        </button>
      </div>
    </div>
  );
}
