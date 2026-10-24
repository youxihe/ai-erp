import { extractTrendPoints } from "../validate.mjs";
import {
  THEME,
  esc,
  fmtNum,
  wrapSvg,
  titleBlock,
  footerBlock,
  buildAltSummary,
} from "../svg-util.mjs";

export function renderLineTrend(dataset, meta) {
  const points = extractTrendPoints(dataset);
  const width = 920;
  const chartTop = 72;
  const chartH = 300;
  const chartLeft = 72;
  const chartW = width - 120;
  const height = chartTop + chartH + 80;
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const span = maxY - minY || 1;

  const coords = points.map((p, i) => {
    const x = chartLeft + (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW);
    const y = chartTop + chartH - ((p.y - minY) / span) * (chartH - 20) - 10;
    return { ...p, px: x, py: y };
  });

  let body = titleBlock(meta);
  if (meta.unit || meta.currency) {
    body += `<text x="24" y="56" fill="${THEME.muted}" font-size="12">度量：${esc(meta.unit || meta.currency)}</text>`;
  }
  body += `<rect x="${chartLeft}" y="${chartTop}" width="${chartW}" height="${chartH}" fill="${THEME.panel}" stroke="${THEME.line}" rx="4"/>`;

  for (let i = 0; i <= 4; i++) {
    const y = chartTop + chartH - (chartH * i) / 4;
    const val = minY + (span * i) / 4;
    body += `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartW}" y2="${y}" stroke="${THEME.line}" stroke-dasharray="4 4"/>`;
    body += `<text x="${chartLeft - 8}" y="${y + 4}" fill="${THEME.muted}" font-size="11" text-anchor="end">${fmtNum(val, { money: true })}</text>`;
  }

  const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.px},${c.py}`).join(" ");
  body += `<path d="${d}" fill="none" stroke="${THEME.accent}" stroke-width="2.5"/>`;
  coords.forEach((c) => {
    body += `<circle cx="${c.px}" cy="${c.py}" r="4" fill="${THEME.accent}"/>`;
    body += `<text x="${c.px}" y="${c.py - 10}" fill="${THEME.ink}" font-size="11" text-anchor="middle">${fmtNum(c.y, { money: true })}</text>`;
    body += `<text x="${c.px}" y="${chartTop + chartH + 18}" fill="${THEME.ink}" font-size="11" text-anchor="middle">${esc(String(c.x).slice(0, 10))}</text>`;
  });

  body += footerBlock(meta, height - 16, width);
  const alt = buildAltSummary(meta, "趋势折线", {
    highlight: `${points[0].x}→${points[points.length - 1].x}`,
  });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    width,
    height,
  };
}
