export interface ColorBarSegment {
  label: string;
  value: number;
  widthPercent: number;
  displayPercent: number;
  color: string;
  textColor: string;
  showInBarLabel: boolean;
}

export interface ParsedColorBar {
  segments: ColorBarSegment[];
  total: number;
}

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VALUE_WITH_OPTIONAL_COLOR_REGEX = /^(\d+(?:\.\d+)?)(?:\s*\((.+)\))?$/;
const MIN_IN_BAR_LABEL_PERCENT = 10;

const SEMANTIC_COLOR_MAP: Record<string, string> = {
  critical: "#9f1239",
  "緊急": "#9f1239",
  "致命的": "#9f1239",
  high: "#ea580c",
  "高": "#ea580c",
  medium: "#d97706",
  "中": "#d97706",
  low: "#16a34a",
  "低": "#16a34a",
  info: "#2563eb",
  "参考": "#2563eb",
  "情報": "#2563eb",
  scoping: "#7c3aed",
  active: "#0284c7",
  "進行中": "#0284c7",
  "対応中": "#0284c7",
  draft: "#64748b",
  "下書き": "#64748b",
  "未着手": "#64748b",
  "保留": "#64748b",
  final: "#059669",
  "完了": "#059669",
  "対応済": "#059669",
  "済": "#059669",
  closed: "#334155",
  "クローズ": "#334155",
  "対象外": "#334155",
};

const FALLBACK_PALETTE = [
  "#2563eb",
  "#0891b2",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#e11d48",
  "#4f46e5",
  "#475569",
];

function expandHex(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 4) {
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
  }
  return lower;
}

export function getContrastTextColor(hex: string): string {
  if (!HEX_COLOR_REGEX.test(hex)) {
    return "#ffffff";
  }
  const full = expandHex(hex);
  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 165 ? "#0f172a" : "#ffffff";
}

export function formatColorBarNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

export function formatColorBarPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "0%";
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded}%`;
}

export function parseColorBarSpec(rawSpec: string): ParsedColorBar | null {
  if (!rawSpec || !rawSpec.trim()) return null;

  const tokens = rawSpec.split(/[,、\r\n]+/);
  const parsedEntries: Array<{
    label: string;
    value: number;
    color: string;
  }> = [];

  let fallbackIndex = 0;

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (!token) continue;

    const eqIdx = token.lastIndexOf("=");
    if (eqIdx <= 0) continue;

    const label = token.slice(0, eqIdx).trim();
    const rhs = token.slice(eqIdx + 1).trim();
    if (!label || !rhs) continue;

    const match = rhs.match(VALUE_WITH_OPTIONAL_COLOR_REGEX);
    if (!match) continue;

    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value < 0) continue;

    const rawColor = match[2]?.trim() ?? "";
    let color: string;
    if (rawColor && HEX_COLOR_REGEX.test(rawColor)) {
      color = expandHex(rawColor);
    } else {
      const semantic = SEMANTIC_COLOR_MAP[label.toLowerCase()];
      if (semantic) {
        color = semantic;
      } else {
        color = FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
        fallbackIndex++;
      }
    }

    parsedEntries.push({ label, value, color });
  }

  if (parsedEntries.length === 0) {
    return null;
  }

  const rawTotal = parsedEntries.reduce((sum, entry) => sum + entry.value, 0);
  const total = Math.round(rawTotal * 10000) / 10000;

  if (total <= 0) {
    return {
      total: 0,
      segments: parsedEntries.map((entry) => ({
        label: entry.label,
        value: entry.value,
        widthPercent: 0,
        displayPercent: 0,
        color: entry.color,
        textColor: getContrastTextColor(entry.color),
        showInBarLabel: false,
      })),
    };
  }

  const lastPositiveIndex = parsedEntries.reduce(
    (lastIdx, entry, idx) => (entry.value > 0 ? idx : lastIdx),
    -1
  );

  let accumulatedWidth = 0;
  const segments: ColorBarSegment[] = parsedEntries.map((entry, idx) => {
    if (entry.value <= 0) {
      return {
        label: entry.label,
        value: entry.value,
        widthPercent: 0,
        displayPercent: 0,
        color: entry.color,
        textColor: getContrastTextColor(entry.color),
        showInBarLabel: false,
      };
    }

    const rawPercent = (entry.value / total) * 100;
    const displayPercent = Math.round(rawPercent * 10) / 10;

    let widthPercent: number;
    if (idx === lastPositiveIndex) {
      widthPercent = Math.max(
        0,
        Math.round((100 - accumulatedWidth) * 100) / 100
      );
    } else {
      widthPercent = Math.round(rawPercent * 100) / 100;
      accumulatedWidth = Math.round((accumulatedWidth + widthPercent) * 100) / 100;
    }

    return {
      label: entry.label,
      value: entry.value,
      widthPercent,
      displayPercent,
      color: entry.color,
      textColor: getContrastTextColor(entry.color),
      showInBarLabel: rawPercent >= MIN_IN_BAR_LABEL_PERCENT,
    };
  });

  return { segments, total };
}
