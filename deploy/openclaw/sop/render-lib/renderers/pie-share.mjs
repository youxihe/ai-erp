import { extractCategories } from "../validate.mjs";
import {
  THEME,
  PALETTE,
  esc,
  fmtNum,
  wrapSvg,
  titleBlock,
  footerBlock,
  buildAltSummary,
} from "../svg-util.mjs";

function polar(cx, cy, r, angle) {
  const a = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${end.x} ${end.y} A ${r} ${r} 0 ${large} 1 ${start.x} ${start.y} Z`;
}

export function renderPieShare(dataset, meta) {
  const slices = extractCategories(dataset).slice(0, 6);
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const width = 880;
  const height = 420;
  const cx = 280;
  const cy = 220;
  const r = 130;

  let body = titleBlock(meta);
  body += `<text x="24" y="56" fill="${THEME.muted}" font-size="12">同分母份额 · 合计 ${fmtNum(sum, { money: /金额|¥|元/.test(meta.title + (meta.unit || "")) })} ${esc(meta.unit || meta.currency || "")}</text>`;

  let angle = 0;
  slices.forEach((s, i) => {
    const sweep = (s.value / sum) * 360;
    const path = sweep >= 359.9
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
      : arcPath(cx, cy, r, angle, angle + sweep);
    body += `<path d="${path}" fill="${PALETTE[i % PALETTE.length]}" stroke="${THEME.panel}" stroke-width="2"/>`;
    const mid = angle + sweep / 2;
    const labelPos = polar(cx, cy, r * 0.62, mid);
    const pct = ((s.value / sum) * 100).toFixed(1);
    if (sweep > 18) {
      body += `<text x="${labelPos.x}" y="${labelPos.y}" fill="#fff" font-size="12" text-anchor="middle" font-weight="600">${pct}%</text>`;
    }
    angle += sweep;
  });

  // legend
  let ly = 90;
  slices.forEach((s, i) => {
    const pct = ((s.value / sum) * 100).toFixed(1);
    body += `<rect x="520" y="${ly - 12}" width="14" height="14" rx="2" fill="${PALETTE[i % PALETTE.length]}"/>`;
    body += `<text x="544" y="${ly}" fill="${THEME.ink}" font-size="13">${esc(s.label)} · ${fmtNum(s.value, { money: true })}（${pct}%）</text>`;
    ly += 28;
  });

  body += footerBlock(meta, height - 16, width);
  const alt = buildAltSummary(meta, "占比饼图", {
    highlight: slices.map((s) => s.label).join("/"),
  });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    width,
    height,
  };
}
