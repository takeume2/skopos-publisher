export type CardAccentKind =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "success"
  | "info"
  | "warning"
  | "neutral"
  | "primary"
  | "accent"
  | "none";

export type CardColumns = 2 | 3 | 4;

export interface ParsedCardItem {
  label: string;
  value: string;
  note: string;
  accentKind: CardAccentKind | null;
  customColor: string | null;
}

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const ACCENT_ALIAS_MAP: Record<string, CardAccentKind> = {
  critical: "critical",
  danger: "critical",
  "緊急": "critical",
  "致命的": "critical",
  high: "high",
  "高": "high",
  medium: "medium",
  warning: "warning",
  "中": "medium",
  low: "low",
  "低": "low",
  success: "success",
  final: "success",
  "適合": "success",
  "完了": "success",
  info: "info",
  active: "info",
  "参考": "info",
  "情報": "info",
  neutral: "neutral",
  draft: "neutral",
  closed: "neutral",
  primary: "primary",
  accent: "accent",
  none: "none",
};

const PAREN_SEMANTIC_REGEX =
  /\((critical|high|medium|low|info|success|warning)\)/i;

function expandHex(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 4) {
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
  }
  return lower;
}

export function parseCardColumnsAttr(
  raw: string | undefined | null
): CardColumns | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "2") return 2;
  if (trimmed === "3") return 3;
  if (trimmed === "4") return 4;
  return null;
}

export function resolveCardColumns(
  itemCount: number,
  explicitCols: CardColumns | null = null
): CardColumns {
  if (explicitCols === 2 || explicitCols === 3 || explicitCols === 4) {
    return explicitCols;
  }
  if (itemCount <= 2) return 2;
  if (itemCount === 3) return 3;
  if (itemCount === 4) return 4;
  if (itemCount <= 6) return 3;
  return 4;
}

function inferAccentFromLabel(label: string): CardAccentKind | null {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return null;

  const exact = ACCENT_ALIAS_MAP[normalized];
  if (exact && exact !== "none" && exact !== "primary" && exact !== "accent") {
    return exact;
  }

  const parenMatch = label.match(PAREN_SEMANTIC_REGEX);
  if (parenMatch) {
    return ACCENT_ALIAS_MAP[parenMatch[1].toLowerCase()] ?? null;
  }

  return null;
}

export function parseCardItem(rawText: string): ParsedCardItem | null {
  const singleLine = rawText.replace(/\r?\n/g, " ").trim();
  if (!singleLine) return null;

  const parts = singleLine.split("|").map((part) => part.trim());
  const label = parts[0] ?? "";
  const value = parts[1] ?? "";
  const note = parts[2] ?? "";
  const rawAccent = parts[3] ?? "";

  if (!label && !value && !note) {
    return null;
  }

  let accentKind: CardAccentKind | null = null;
  let customColor: string | null = null;

  if (rawAccent) {
    if (HEX_COLOR_REGEX.test(rawAccent)) {
      customColor = expandHex(rawAccent);
    } else {
      const mapped = ACCENT_ALIAS_MAP[rawAccent.toLowerCase()];
      if (mapped) {
        accentKind = mapped;
      } else {
        accentKind = inferAccentFromLabel(label);
      }
    }
  } else {
    accentKind = inferAccentFromLabel(label);
  }

  return {
    label,
    value,
    note,
    accentKind,
    customColor,
  };
}
