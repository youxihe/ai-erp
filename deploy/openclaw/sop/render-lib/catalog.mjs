/**
 * AIERP-020C — whitelist of reusable table/chart render templates.
 * AI may only pick renderId + an authorized datasetRef; never invent numbers.
 */

export const RENDER_IDS = Object.freeze([
  "table.basic",
  "bar.compare",
  "line.trend",
  "pie.share",
  "delta.before_after",
  "kpi.tiles",
]);

/** Soft aliases → canonical ids (docs also mention grouped/stacked; degrade path uses table.basic). */
export const RENDER_ALIASES = Object.freeze({
  "table.grouped": "table.basic",
  "chart.bar_compare": "bar.compare",
  "chart.line_trend": "line.trend",
  "chart.pie_share": "pie.share",
  "chart.delta_before_after": "delta.before_after",
  "chart.kpi_tiles": "kpi.tiles",
  "bar.stacked": "bar.compare",
});

export const PNG_LIMITS = Object.freeze({
  maxWidthPx: 1600,
  maxHeightPx: 1200,
  maxBytes: 2 * 1024 * 1024,
  tablePreviewRows: 12,
  dpiScale: 2,
});

export const CACHE_TTL_MS = 30 * 60 * 1000;

export function resolveRenderId(raw) {
  const id = String(raw || "").trim();
  if (RENDER_IDS.includes(id)) return id;
  if (RENDER_ALIASES[id]) return RENDER_ALIASES[id];
  return null;
}

export function isAllowedRenderId(raw) {
  return resolveRenderId(raw) != null;
}
