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

function normalizeDeltas(dataset) {
  if (Array.isArray(dataset.deltas) && dataset.deltas.length) {
    return dataset.deltas.map((d) => ({
      label: d.label ?? d.name ?? d.materialName ?? "-",
      before: Number(d.before ?? d.stockBefore ?? 0),
      after: Number(d.after ?? d.stockAfter ?? 0),
      unit: d.unit || dataset.unit || "",
    }));
  }
  return rowsOf(dataset).map((r) => ({
    label: r.label ?? r.name ?? r.materialName ?? "-",
    before: Number(r.before ?? r.stockBefore ?? 0),
    after: Number(r.after ?? r.stockAfter ?? 0),
    unit: r.unit || dataset.unit || "",
  }));
}

export function renderDeltaBeforeAfter(dataset, meta) {
  const items = normalizeDeltas(dataset).slice(0, 10);
  const width = 900;
  const rowH = 56;
  const top = 72;
  const height = top + items.length * rowH + 60;
  const maxAbs = Math.max(
    ...items.flatMap((it) => [Math.abs(it.before), Math.abs(it.after)]),
    1,
  );
  const barMax = 220;

  let body = titleBlock(meta);
  body += `<text x="24" y="56" fill="${THEME.muted}" font-size="12">前 → 后（原料减少 / 成品增加等库存差异）</text>`;
  body += `<text x="360" y="56" fill="${THEME.muted}" font-size="11">前</text>`;
  body += `<text x="620" y="56" fill="${THEME.muted}" font-size="11">后</text>`;

  items.forEach((it, i) => {
    const y = top + i * rowH;
    const bw = (Math.abs(it.before) / maxAbs) * barMax;
    const aw = (Math.abs(it.after) / maxAbs) * barMax;
    const delta = it.after - it.before;
    const deltaColor = delta >= 0 ? THEME.good : THEME.warn;
    body += `<text x="24" y="${y + 28}" fill="${THEME.ink}" font-size="14" font-weight="600">${esc(String(it.label).slice(0, 16))}</text>`;
    body += `<rect x="360" y="${y + 12}" width="${bw}" height="18" fill="${THEME.accent3}" rx="2"/>`;
    body += `<text x="${360 + bw + 8}" y="${y + 26}" fill="${THEME.muted}" font-size="12">${fmtNum(it.before)} ${esc(it.unit)}</text>`;
    body += `<rect x="620" y="${y + 12}" width="${aw}" height="18" fill="${THEME.accent}" rx="2"/>`;
    body += `<text x="${620 + aw + 8}" y="${y + 26}" fill="${THEME.ink}" font-size="12">${fmtNum(it.after)} ${esc(it.unit)}</text>`;
    body += `<text x="24" y="${y + 48}" fill="${deltaColor}" font-size="11">Δ ${delta >= 0 ? "+" : ""}${fmtNum(delta)} ${esc(it.unit)}</text>`;
  });

  body += footerBlock(meta, height - 16, width);
  const alt = buildAltSummary(meta, "前后差异", {
    highlight: items.map((it) => it.label).join("、"),
  });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    width,
    height,
  };
}
