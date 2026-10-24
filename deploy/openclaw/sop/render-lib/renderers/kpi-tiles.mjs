import { rowsOf } from "../validate.mjs";
import {
  THEME,
  esc,
  fmtNum,
  wrapSvg,
  titleBlock,
  footerBlock,
  buildAltSummary,
} from "../svg-util.mjs";

function normalizeKpis(dataset) {
  if (Array.isArray(dataset.kpis) && dataset.kpis.length) {
    return dataset.kpis.map((k) => ({
      label: k.label ?? k.name ?? "-",
      value: k.value ?? k.amount ?? k.qty,
      unit: k.unit || "",
      money: !!k.money || /金额|元|¥|CNY/i.test(String(k.unit || k.label || "")),
      delta: k.delta,
    }));
  }
  return rowsOf(dataset).map((r) => ({
    label: r.label ?? r.name ?? "-",
    value: r.value ?? r.amount ?? r.qty,
    unit: r.unit || "",
    money: !!r.money,
    delta: r.delta,
  }));
}

export function renderKpiTiles(dataset, meta) {
  const kpis = normalizeKpis(dataset).slice(0, 6);
  const cols = Math.min(3, kpis.length);
  const tileW = 240;
  const tileH = 110;
  const gap = 16;
  const width = 48 + cols * tileW + (cols - 1) * gap;
  const rows = Math.ceil(kpis.length / cols);
  const height = 72 + rows * tileH + (rows - 1) * gap + 48;

  let body = titleBlock(meta);
  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 24 + col * (tileW + gap);
    const y = 64 + row * (tileH + gap);
    body += `<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" fill="${THEME.panel}" stroke="${THEME.line}" rx="8"/>`;
    body += `<text x="${x + 18}" y="${y + 32}" fill="${THEME.muted}" font-size="13">${esc(k.label)}</text>`;
    body += `<text x="${x + 18}" y="${y + 68}" fill="${THEME.ink}" font-size="28" font-weight="700">${fmtNum(k.value, { money: k.money })}</text>`;
    if (k.unit) {
      body += `<text x="${x + tileW - 18}" y="${y + 68}" fill="${THEME.muted}" font-size="13" text-anchor="end">${esc(k.unit)}</text>`;
    }
    if (k.delta != null && k.delta !== "") {
      const n = Number(k.delta);
      const color = Number.isFinite(n) && n < 0 ? THEME.warn : THEME.good;
      body += `<text x="${x + 18}" y="${y + 92}" fill="${color}" font-size="12">${esc(String(k.delta))}</text>`;
    }
  });

  body += footerBlock(meta, height - 16, width);
  const alt = buildAltSummary(meta, "KPI", {
    highlight: kpis.map((k) => `${k.label}:${k.value}`).join("，").slice(0, 120),
  });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    width,
    height,
  };
}
