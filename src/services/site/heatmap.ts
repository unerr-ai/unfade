// FILE: src/services/site/heatmap.ts
// UF-081: Heatmap renderer — SVG heatmap from daily decision counts.
// GitHub-style contribution graph: 52×7 grid, dark theme, 5 color levels.

import type { DayCount } from "./site-generator.js";

// ---------------------------------------------------------------------------
// Color palette — dark theme, 5 intensity levels
// ---------------------------------------------------------------------------

const COLORS = {
  empty: "#161b22", // level 0: no activity
  light: "#0e4429", // level 1: 1–3 intensity
  medium: "#006d32", // level 2: 4–7 intensity
  dark: "#26a641", // level 3: 8–11 intensity
  highlight: "#39d353", // level 4: 12+ intensity
};

function intensityColor(intensity: number): string {
  if (intensity <= 0) return COLORS.empty;
  if (intensity <= 3) return COLORS.light;
  if (intensity <= 7) return COLORS.medium;
  if (intensity <= 11) return COLORS.dark;
  return COLORS.highlight;
}

export function intensityLevel(intensity: number): number {
  if (intensity <= 0) return 0;
  if (intensity <= 3) return 1;
  if (intensity <= 7) return 2;
  if (intensity <= 11) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Month labels
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

const CELL_SIZE = 12;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const LABEL_HEIGHT = 20;
const LEFT_PADDING = 0;

/**
 * Render an inline SVG heatmap covering the last 90 days.
 * Grid: up to 14 columns × 7 rows (90 days ≈ ~13 weeks).
 * Each cell is a rounded rect colored by intensity level.
 */
export function renderHeatmapSvg(dayCounts: DayCount[]): string {
  // Build a lookup map: date → DayCount
  const countMap = new Map<string, DayCount>();
  for (const dc of dayCounts) {
    countMap.set(dc.date, dc);
  }

  // Compute the 90-day date range ending today
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 89); // 90 days including today

  // Align start to Sunday (beginning of week)
  const startDay = startDate.getDay(); // 0=Sun
  if (startDay !== 0) {
    startDate.setDate(startDate.getDate() - startDay);
  }

  // Build grid cells
  const cells: string[] = [];
  const monthLabels: { text: string; x: number }[] = [];
  let lastMonth = -1;

  const cursor = new Date(startDate);
  let col = 0;

  while (cursor <= today) {
    const weekStart = new Date(cursor);

    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(weekStart);
      cellDate.setDate(cellDate.getDate() + row);

      if (cellDate > today) break;

      const dateStr = cellDate.toISOString().slice(0, 10);
      const dc = countMap.get(dateStr);
      const intensity = dc?.intensity ?? 0;
      const color = intensityColor(intensity);

      const x = LEFT_PADDING + col * CELL_STEP;
      const y = LABEL_HEIGHT + row * CELL_STEP;

      // Tooltip text
      const decisions = dc?.decisions ?? 0;
      const tradeOffs = dc?.tradeOffs ?? 0;
      const deadEnds = dc?.deadEnds ?? 0;
      const monthName = MONTH_NAMES[cellDate.getMonth()];
      const dayNum = cellDate.getDate();
      const tooltip = `${monthName} ${dayNum}: ${decisions} decisions, ${tradeOffs} trade-offs, ${deadEnds} dead ends`;

      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" ry="2" fill="${color}" data-date="${dateStr}" data-level="${intensityLevel(intensity)}"><title>${tooltip}</title></rect>`,
      );

      // Month label on first occurrence
      const month = cellDate.getMonth();
      if (month !== lastMonth && cellDate.getDate() <= 7) {
        monthLabels.push({ text: MONTH_NAMES[month], x: LEFT_PADDING + col * CELL_STEP });
        lastMonth = month;
      }
    }

    // Advance to next week
    cursor.setDate(cursor.getDate() + 7);
    col++;
  }

  const totalWidth = LEFT_PADDING + col * CELL_STEP;
  const totalHeight = LABEL_HEIGHT + 7 * CELL_STEP;

  const monthLabelsSvg = monthLabels
    .map(
      (ml) =>
        `<text x="${ml.x}" y="12" fill="#8b949e" font-size="10" font-family="sans-serif">${ml.text}</text>`,
    )
    .join("\n  ");

  // Legend
  const legendY = totalHeight + 8;
  const _legendLabels = ["Less", "", "", "", "", "More"];
  const legendColors = [COLORS.empty, COLORS.light, COLORS.medium, COLORS.dark, COLORS.highlight];
  const legendX = totalWidth - legendColors.length * CELL_STEP - 40;
  const legendSvg = [
    `<text x="${legendX - 4}" y="${legendY + 10}" fill="#8b949e" font-size="10" font-family="sans-serif">Less</text>`,
    ...legendColors.map(
      (c, i) =>
        `<rect x="${legendX + 30 + i * CELL_STEP}" y="${legendY}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" ry="2" fill="${c}"/>`,
    ),
    `<text x="${legendX + 30 + legendColors.length * CELL_STEP + 4}" y="${legendY + 10}" fill="#8b949e" font-size="10" font-family="sans-serif">More</text>`,
  ].join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight + 30}" viewBox="0 0 ${totalWidth} ${totalHeight + 30}" role="img" aria-label="Decision Density Heatmap">
  ${monthLabelsSvg}
  ${cells.join("\n  ")}
  ${legendSvg}
</svg>`;
}
