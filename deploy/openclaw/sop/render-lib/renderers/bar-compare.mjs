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

const CJK_RE = /[\u2e80-\ua4cf\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3000-\u303f]/;

function vwUnits(s) {
  let w = 0;
  for (const ch of s) w += CJK_RE.test(ch) ? 1 : 0.55;
  return w;
}

/** 按柱宽自适应标签长度（CJK≈12px，ASCII≈6.6px），避免日期/供应商名被截断 */
function barLabelText(label, barW) {
  const s = String(label ?? "");
  const maxUnits = Math.max(4, Math.floor((barW + 12) / 6.6));
  if (vwUnits(s) <= maxUnits) return esc(s);
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = CJK_RE.test(ch) ? 1 : 0.55;
    if (w + cw > maxUnits - 1) break;
    out += ch;
    w += cw;
  }
  return `${esc(out)}…`;
}

export function renderBarCompare(dataset, meta) {
  const cats = extractCategories(dataset).slice(0, 12);
  const width = 900;
  const chartTop = 72;
  const chartH = 320;
  const chartLeft = 72;
  const chartW = width - 120;
  const height = chartTop + chartH + 80;
  const maxV = Math.max(...cats.map((c) => c.value), 0) || 1;
  const barGap = 16;
  const barW = Math.max(24, (chartW - barGap * (cats.length + 1)) / cats.length);

  let body = titleBlock(meta);
  if (meta.unit || meta.currency) {
    body += `<text x="24" y="56" fill="${THEME.muted}" font-size="12">度量：${esc(meta.unit || meta.currency)}</text>`;
  }
  body += `<rect x="${chartLeft}" y="${chartTop}" width="${chartW}" height="${chartH}" fill="${THEME.panel}" stroke="${THEME.line}" rx="4"/>`;

  // y grid
  for (let i = 0; i <= 4; i++) {
    const y = chartTop + chartH - (chartH * i) / 4;
    const val = (maxV * i) / 4;
    body += `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartW}" y2="${y}" stroke="${THEME.line}" stroke-dasharray="4 4"/>`;
    body += `<text x="${chartLeft - 8}" y="${y + 4}" fill="${THEME.muted}" font-size="11" text-anchor="end">${fmtNum(val, { money: /¥|金额|CNY|元/i.test(meta.unit || meta.currency || meta.title) })}</text>`;
  }

  cats.forEach((c, i) => {
    const h = (c.value / maxV) * (chartH - 24);
    const x = chartLeft + barGap + i * (barW + barGap);
    const y = chartTop + chartH - h;
    const color = PALETTE[i % PALETTE.length];
    body += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="3"/>`;
    body += `<text x="${x + barW / 2}" y="${y - 8}" fill="${THEME.ink}" font-size="12" text-anchor="middle">${fmtNum(c.value, { money: /金额|¥/.test(meta.title + (meta.unit || "")) })}</text>`;
    body += `<text x="${x + barW / 2}" y="${chartTop + chartH + 18}" fill="${THEME.ink}" font-size="12" text-anchor="middle">${barLabelText(c.label, barW)}</text>`;
  });

  body += footerBlock(meta, height - 16, width);
  const highlight = cats.map((c) => `${c.label}:${c.value}`).join("，").slice(0, 120);
  const alt = buildAltSummary(meta, "柱状对比", { highlight });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    width,
    height,
  };
}
