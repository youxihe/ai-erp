import { PNG_LIMITS } from "../catalog.mjs";
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

function resolveColumns(dataset) {
  if (Array.isArray(dataset.columns) && dataset.columns.length) {
    return dataset.columns.map((c) => ({
      key: c.key || c.field,
      label: c.label || c.key || c.field,
      type: c.type || "string",
    }));
  }
  const rows = rowsOf(dataset);
  if (!rows.length) return [];
  return Object.keys(rows[0])
    .filter((k) => !/^_/.test(k))
    .slice(0, 8)
    .map((k) => ({ key: k, label: k, type: "string" }));
}

function cellText(row, col) {
  const v = row[col.key];
  if (col.type === "money" || /金额|amount|total|price/i.test(col.key) || /金额|单价|总额/.test(col.label)) {
    return fmtNum(v, { money: true });
  }
  if (col.type === "number" || col.type === "qty") return fmtNum(v);
  return esc(v == null ? "" : String(v));
}

const CJK_RE = /[\u2e80-\ua4cf\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3000-\u303f]/;

function visualWidth(s) {
  let w = 0;
  for (const ch of s) w += CJK_RE.test(ch) ? 1 : 0.55;
  return w;
}

/** 按列宽截断并加省略号，避免长文本压到相邻列（完整数据仍在 XLSX/来源系统） */
function fitCell(displayText, colW) {
  const s = String(displayText || "");
  const maxUnits = Math.max(4, Math.floor((colW - 16) / 13));
  if (visualWidth(s) <= maxUnits) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = CJK_RE.test(ch) ? 1 : 0.55;
    if (w + cw > maxUnits - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/**
 * @returns {{ svg: string, alt: string, previewRows: number, totalRows: number, width: number, height: number }}
 */
export function renderTableBasic(dataset, meta, opts = {}) {
  const maxRows = opts.maxPngRows || PNG_LIMITS.tablePreviewRows;
  const columns = resolveColumns(dataset);
  const allRows = rowsOf(dataset);
  const rows = allRows.slice(0, maxRows);
  const colCount = Math.max(columns.length, 1);
  const colW = Math.min(160, Math.floor(1200 / colCount));
  const width = Math.min(PNG_LIMITS.maxWidthPx, 48 + colW * colCount);
  const rowH = 32;
  const headerY = 64;
  const height = Math.min(
    PNG_LIMITS.maxHeightPx,
    headerY + 28 + rows.length * rowH + 48 + (allRows.length > maxRows ? 20 : 0),
  );

  let body = titleBlock(meta);
  body += `<rect x="24" y="${headerY}" width="${width - 48}" height="${28 + rows.length * rowH}" fill="${THEME.panel}" stroke="${THEME.line}" rx="4"/>`;

  let x = 32;
  for (const col of columns) {
    body += `<text x="${x}" y="${headerY + 20}" fill="${THEME.muted}" font-size="12" font-weight="600">${esc(col.label)}</text>`;
    x += colW;
  }
  body += `<line x1="24" y1="${headerY + 28}" x2="${width - 24}" y2="${headerY + 28}" stroke="${THEME.line}"/>`;

  rows.forEach((row, i) => {
    const y = headerY + 28 + i * rowH;
    if (i % 2 === 1) {
      body += `<rect x="24" y="${y}" width="${width - 48}" height="${rowH}" fill="#F0EDE7"/>`;
    }
    let cx = 32;
    for (const col of columns) {
      body += `<text x="${cx}" y="${y + 22}" fill="${THEME.ink}" font-size="13">${fitCell(cellText(row, col), colW)}</text>`;
      cx += colW;
    }
  });

  if (allRows.length > maxRows) {
    body += `<text x="24" y="${height - 36}" fill="${THEME.accent2}" font-size="12">PNG 预览前 ${maxRows} 行，完整 ${allRows.length} 行见附件 XLSX</text>`;
  }
  body += footerBlock(meta, height - 16, width);

  const alt = buildAltSummary(meta, "表格", {
    highlight: `共${allRows.length}行`,
  });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    previewRows: rows.length,
    totalRows: allRows.length,
    width,
    height,
  };
}

/** Explanation / empty degrade — still a PNG, never a fake chart. */
export function renderExplanation(meta, reason) {
  const width = 720;
  const height = 220;
  const msg = reasonMessage(reason);
  const body = `
    ${titleBlock(meta)}
    <rect x="24" y="56" width="${width - 48}" height="120" fill="${THEME.panel}" stroke="${THEME.line}" rx="6"/>
    <text x="40" y="100" fill="${THEME.ink}" font-size="16">无法按所选图表展示</text>
    <text x="40" y="128" fill="${THEME.muted}" font-size="13">${esc(msg)}</text>
    <text x="40" y="154" fill="${THEME.muted}" font-size="12">未生成虚构图形；请改用表格或核对 ERP 授权查询结果。</text>
    ${footerBlock(meta, height - 16, width)}
  `;
  const alt = buildAltSummary(meta, "说明", { highlight: msg });
  return {
    svg: wrapSvg(width, height, body, { title: meta.title, aria: alt }),
    alt,
    previewRows: 0,
    totalRows: 0,
    width,
    height,
    degraded: true,
    degradeReason: reason,
  };
}

function reasonMessage(reason) {
  const map = {
    empty_table: "数据集为空",
    pie_rejects_negative: "饼图不能包含负数",
    pie_needs_2_to_6_slices: "饼图需要 2–6 个分类",
    pie_empty_sum: "份额合计为 0",
    mixed_units_cannot_chart: "单位不一致，不能合并作图",
    mixed_currency_cannot_chart: "币种不一致，不能合并作图",
    bar_needs_two_plus_categories: "柱状对比至少需要 2 个类别",
    line_needs_three_plus_time_points: "折线至少需要 3 个时间点",
    dataset_must_be_authorized_erp_or_datasetRef: "缺少授权 ERP 数据集或 datasetRef",
    ai_invented_numbers_rejected: "禁止模型自行拼数",
    forbidden_html_sql_or_path: "禁止 HTML/SQL/本地路径",
    renderId_not_whitelisted: "renderId 不在白名单",
  };
  return map[reason] || String(reason || "数据不满足图表条件");
}
