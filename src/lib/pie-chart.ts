import {
  formatColorBarNumber,
  formatColorBarPercent,
  parseColorBarSpec,
  type ColorBarSegment,
} from "./colorbar";

export type ChartKind = "pie" | "donut";

export interface SvgChartSlice {
  label: string;
  value: number;
  displayPercent: number;
  color: string;
  textColor: string;
  isFullCircle: boolean;
  pathD: string | null;
  labelX: number;
  labelY: number;
  showLabel: boolean;
}

export interface BuiltSvgChart {
  kind: ChartKind;
  title: string;
  total: number;
  totalLabel: string;
  segments: ColorBarSegment[];
  slices: SvgChartSlice[];
}

export const CHART_SVG_SIZE = 200;
export const CHART_CENTER = 100;
export const CHART_OUTER_RADIUS = 86;
export const CHART_DONUT_INNER_RADIUS = 46;
export const CHART_DONUT_RING_RADIUS =
  (CHART_OUTER_RADIUS + CHART_DONUT_INNER_RADIUS) / 2;
export const CHART_DONUT_RING_STROKE_WIDTH =
  CHART_OUTER_RADIUS - CHART_DONUT_INNER_RADIUS;

const PIE_LABEL_RADIUS = CHART_OUTER_RADIUS * 0.62;
const DONUT_LABEL_RADIUS = CHART_DONUT_RING_RADIUS;
const MIN_PIE_LABEL_PERCENT = 8;
const MIN_DONUT_LABEL_PERCENT = 10;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleRad: number
): { x: number; y: number } {
  return {
    x: round2(cx + radius * Math.cos(angleRad)),
    y: round2(cy + radius * Math.sin(angleRad)),
  };
}

function buildPieSlicePath(startAngle: number, endAngle: number): string {
  const delta = endAngle - startAngle;
  const largeArcFlag = delta > Math.PI ? 1 : 0;
  const p1 = polarToCartesian(
    CHART_CENTER,
    CHART_CENTER,
    CHART_OUTER_RADIUS,
    startAngle
  );
  const p2 = polarToCartesian(
    CHART_CENTER,
    CHART_CENTER,
    CHART_OUTER_RADIUS,
    endAngle
  );
  return `M ${CHART_CENTER} ${CHART_CENTER} L ${p1.x} ${p1.y} A ${CHART_OUTER_RADIUS} ${CHART_OUTER_RADIUS} 0 ${largeArcFlag} 1 ${p2.x} ${p2.y} Z`;
}

function buildDonutSlicePath(startAngle: number, endAngle: number): string {
  const delta = endAngle - startAngle;
  const largeArcFlag = delta > Math.PI ? 1 : 0;
  const o1 = polarToCartesian(
    CHART_CENTER,
    CHART_CENTER,
    CHART_OUTER_RADIUS,
    startAngle
  );
  const o2 = polarToCartesian(
    CHART_CENTER,
    CHART_CENTER,
    CHART_OUTER_RADIUS,
    endAngle
  );
  const i2 = polarToCartesian(
    CHART_CENTER,
    CHART_CENTER,
    CHART_DONUT_INNER_RADIUS,
    endAngle
  );
  const i1 = polarToCartesian(
    CHART_CENTER,
    CHART_CENTER,
    CHART_DONUT_INNER_RADIUS,
    startAngle
  );
  return `M ${o1.x} ${o1.y} A ${CHART_OUTER_RADIUS} ${CHART_OUTER_RADIUS} 0 ${largeArcFlag} 1 ${o2.x} ${o2.y} L ${i2.x} ${i2.y} A ${CHART_DONUT_INNER_RADIUS} ${CHART_DONUT_INNER_RADIUS} 0 ${largeArcFlag} 0 ${i1.x} ${i1.y} Z`;
}

export function buildSvgChart(
  kind: ChartKind,
  rawSpec: string,
  rawTitle = ""
): BuiltSvgChart | null {
  const parsed = parseColorBarSpec(rawSpec);
  if (!parsed) return null;

  const title = rawTitle.trim();
  const totalLabel = formatColorBarNumber(parsed.total);

  if (parsed.total <= 0) {
    return {
      kind,
      title,
      total: 0,
      totalLabel: "0",
      segments: parsed.segments,
      slices: [],
    };
  }

  const positiveSegments = parsed.segments.filter((seg) => seg.value > 0);
  const minLabelPercent =
    kind === "donut" ? MIN_DONUT_LABEL_PERCENT : MIN_PIE_LABEL_PERCENT;
  const labelRadius =
    kind === "donut" ? DONUT_LABEL_RADIUS : PIE_LABEL_RADIUS;

  if (positiveSegments.length === 1) {
    const only = positiveSegments[0];
    return {
      kind,
      title,
      total: parsed.total,
      totalLabel,
      segments: parsed.segments,
      slices: [
        {
          label: only.label,
          value: only.value,
          displayPercent: 100,
          color: only.color,
          textColor: only.textColor,
          isFullCircle: true,
          pathD: null,
          labelX: CHART_CENTER,
          labelY:
            kind === "donut"
              ? round2(CHART_CENTER - DONUT_LABEL_RADIUS)
              : CHART_CENTER,
          showLabel: true,
        },
      ],
    };
  }

  const slices: SvgChartSlice[] = [];
  let currentAngle = -Math.PI / 2;

  for (const seg of positiveSegments) {
    const fraction = seg.value / parsed.total;
    const deltaAngle = fraction * Math.PI * 2;
    const endAngle = currentAngle + deltaAngle;
    const midAngle = currentAngle + deltaAngle / 2;

    const labelPos = polarToCartesian(
      CHART_CENTER,
      CHART_CENTER,
      labelRadius,
      midAngle
    );
    const rawPercent = fraction * 100;

    slices.push({
      label: seg.label,
      value: seg.value,
      displayPercent: seg.displayPercent,
      color: seg.color,
      textColor: seg.textColor,
      isFullCircle: false,
      pathD:
        kind === "donut"
          ? buildDonutSlicePath(currentAngle, endAngle)
          : buildPieSlicePath(currentAngle, endAngle),
      labelX: labelPos.x,
      labelY: labelPos.y,
      showLabel: rawPercent >= minLabelPercent,
    });

    currentAngle = endAngle;
  }

  return {
    kind,
    title,
    total: parsed.total,
    totalLabel,
    segments: parsed.segments,
    slices,
  };
}

export { formatColorBarNumber, formatColorBarPercent };
