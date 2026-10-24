/**
 * Controlled SVG helpers — no arbitrary HTML/JS from model input.
 */
import { fontCssStack } from "./fonts.mjs";

export const THEME = Object.freeze({
  bg: "#F7F5F1",
  panel: "#FFFFFF",
  ink: "#1C2430",
  muted: "#5B6573",
  line: "#D5D0C8",
  accent: "#0F6E56",
  accent2: "#C45C26",
  accent3: "#2F5D8C",
  accent4: "#8B5E3C",
  accent5: "#4A6670",
  accent6: "#A67C52",
  warn: "#A33B2B",
  good: "#0F6E56",
});

export const PALETTE = [
  THEME.accent,
  THEME.accent2,
  THEME.accent3,
  THEME.accent4,
  THEME.accent5,
  THEME.accent6,
];

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function fmtNum(v, { money = false, digits = 2 } = {}) {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(String(v));
  if (money) {
    return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
  }
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function wrapSvg(width, height, body, { title = "", aria = "" } = {}) {
  const font = fontCssStack();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria || title)}">
  <title>${esc(title)}</title>
  <defs>
    <style><![CDATA[
      text { font-family: ${font}; }
    ]]></style>
  </defs>
  <rect width="100%" height="100%" fill="${THEME.bg}"/>
  ${body}
</svg>`;
}

export function footerBlock(meta, y, width) {
  const source = esc(meta.sourceLabel || "ERP");
  const when = esc(meta.generatedAtZh || meta.generatedAt || "");
  const range = meta.timeRange ? ` · ${esc(meta.timeRange)}` : "";
  const unit = meta.unit ? ` · 单位 ${esc(meta.unit)}` : meta.currency ? ` · ${esc(meta.currency)}` : "";
  return `<text x="24" y="${y}" fill="${THEME.muted}" font-size="11">来源：${source}${range}${unit} · 生成 ${when}</text>
  <text x="${width - 24}" y="${y}" fill="${THEME.muted}" font-size="10" text-anchor="end">非发票 · ERP 授权数据</text>`;
}

export function titleBlock(meta, x = 24, y = 36) {
  return `<text x="${x}" y="${y}" fill="${THEME.ink}" font-size="20" font-weight="700">${esc(meta.title)}</text>`;
}

export function buildAltSummary(meta, kind, facts = {}) {
  const parts = [
    meta.title,
    kind,
    meta.unit ? `单位${meta.unit}` : null,
    meta.timeRange || null,
    `来源${meta.sourceLabel}`,
    facts.highlight || null,
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 280);
}
