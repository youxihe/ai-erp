/**
 * AIERP-020C reusable table/chart render library.
 *
 * Contract:
 * - Data only from authorized ERP query results / datasetRef
 * - AI picks renderId only — no invented numbers, HTML, SQL, or paths
 * - Output PNG (system Chinese fonts) + optional XLSX for long tables
 * - Empty/invalid data degrades to table/explanation — never fake charts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { RENDER_IDS, PNG_LIMITS, resolveRenderId } from "./catalog.mjs";
import { validateRenderRequest } from "./validate.mjs";
import { svgToPng, resvgAvailable } from "./svg-to-png.mjs";
import { datasetToXlsxBuffer, shouldExportXlsx } from "./xlsx-export.mjs";
import { listSystemChineseFonts, primaryChineseFontFamily } from "./fonts.mjs";
import { renderTableBasic, renderExplanation } from "./renderers/table-basic.mjs";
import { renderBarCompare } from "./renderers/bar-compare.mjs";
import { renderLineTrend } from "./renderers/line-trend.mjs";
import { renderPieShare } from "./renderers/pie-share.mjs";
import { renderDeltaBeforeAfter } from "./renderers/delta-before-after.mjs";
import { renderKpiTiles } from "./renderers/kpi-tiles.mjs";

export {
  RENDER_IDS,
  PNG_LIMITS,
  resolveRenderId,
  validateRenderRequest,
  listSystemChineseFonts,
  primaryChineseFontFamily,
  resvgAvailable,
};

const RENDERERS = {
  "table.basic": renderTableBasic,
  "bar.compare": renderBarCompare,
  "line.trend": renderLineTrend,
  "pie.share": renderPieShare,
  "delta.before_after": renderDeltaBeforeAfter,
  "kpi.tiles": renderKpiTiles,
};

/**
 * Render a whitelist template from an authorized dataset.
 *
 * @param {object} request { renderId, datasetRef?, dataset?, schemaVersion? }
 * @param {object} [opts] { outDir?, writeFiles?, maxPngRows?, exportXlsx? }
 * @returns {Promise<object>}
 */
export async function renderDataset(request, opts = {}) {
  const checked = validateRenderRequest(request);

  if (!checked.ok && checked.degrade === "explanation") {
    return finalize(
      renderExplanation(
        checked.meta || {
          title: "无法渲染",
          sourceLabel: "ERP",
          generatedAtZh: new Date().toISOString(),
        },
        checked.reason,
      ),
      checked,
      opts,
      { forceDegraded: true },
    );
  }

  let renderId = checked.renderId;
  let dataset = checked.dataset;
  let meta = checked.meta;
  let degraded = false;
  let degradeReason = null;

  if (!checked.ok && checked.degrade === "table.basic") {
    degraded = true;
    degradeReason = checked.reason;
    renderId = "table.basic";
    dataset = materializeTableDataset(dataset);
    const tableCheck = validateRenderRequest({
      ...request,
      renderId: "table.basic",
      dataset,
      datasetRef: checked.datasetRef || request.datasetRef || { id: "degrade", authorized: true },
    });
    if (!tableCheck.ok) {
      return finalize(
        renderExplanation(meta, degradeReason),
        { ...checked, renderId: "explanation", meta },
        opts,
        { forceDegraded: true, degradeReason },
      );
    }
  }

  const fn = RENDERERS[renderId];
  if (!fn) {
    return finalize(renderExplanation(meta, "renderId_not_whitelisted"), checked, opts, {
      forceDegraded: true,
    });
  }

  const drawn = fn(dataset, meta, { maxPngRows: opts.maxPngRows || PNG_LIMITS.tablePreviewRows });
  return finalize(drawn, { ok: true, renderId, dataset, meta, datasetRef: checked.datasetRef }, opts, {
    degraded,
    degradeReason,
  });
}

async function finalize(drawn, checked, opts, extra = {}) {
  const png = svgToPng(drawn.svg);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const result = {
    ok: true,
    renderId: extra.forceDegraded ? "explanation" : checked.renderId,
    degraded: !!(extra.degraded || extra.forceDegraded || drawn.degraded),
    degradeReason: extra.degradeReason || drawn.degradeReason || null,
    alt: drawn.alt,
    meta: checked.meta,
    png,
    pngSha256: sha256,
    pngBytes: png.length,
    svg: drawn.svg,
    width: drawn.width,
    height: drawn.height,
    previewRows: drawn.previewRows,
    totalRows: drawn.totalRows,
    xlsx: null,
    files: {},
    fonts: {
      family: primaryChineseFontFamily(),
      files: listSystemChineseFonts().map((p) => p.split(/[/\\]/).pop()),
    },
  };

  const wantXlsx =
    opts.exportXlsx !== false &&
    checked.dataset &&
    (shouldExportXlsx(checked.dataset, opts.maxPngRows || PNG_LIMITS.tablePreviewRows) ||
      opts.forceXlsx);
  if (wantXlsx) {
    try {
      result.xlsx = await datasetToXlsxBuffer(checked.dataset, checked.meta || {});
    } catch (err) {
      result.xlsxError = String(err?.message || err).slice(0, 200);
    }
  }

  if (opts.writeFiles && opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    const stem = safeStem(checked.meta?.title || checked.renderId || "render");
    const pngPath = join(opts.outDir, `${stem}.png`);
    writeFileSync(pngPath, png);
    result.files.png = pngPath;
    // Never put absolute path into user-facing alt/text — keep in files only for adapters
    if (result.xlsx) {
      const xlsxPath = join(opts.outDir, `${stem}.xlsx`);
      writeFileSync(xlsxPath, result.xlsx);
      result.files.xlsx = xlsxPath;
    }
    writeFileSync(join(opts.outDir, `${stem}.svg`), drawn.svg, "utf8");
    result.files.svg = join(opts.outDir, `${stem}.svg`);
  }

  return result;
}

function safeStem(s) {
  return String(s || "render")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .slice(0, 40) || "render";
}

/** When a chart cannot be drawn, still show authorized facts as a table — never invent values. */
function materializeTableDataset(dataset) {
  const ds = { ...(dataset || {}) };
  if (Array.isArray(ds.rows) && ds.rows.length) return ds;
  if (Array.isArray(ds.categories) && ds.categories.length) {
    ds.columns = [
      { key: "label", label: "分类" },
      { key: "value", label: "数值", type: "number" },
      { key: "unit", label: "单位" },
    ];
    ds.rows = ds.categories.map((c) => ({
      label: c.label ?? c.name,
      value: c.value ?? c.amount,
      unit: c.unit ?? ds.unit ?? "",
    }));
    return ds;
  }
  if (Array.isArray(ds.series?.[0]?.points) && ds.series[0].points.length) {
    ds.columns = [
      { key: "x", label: "时间" },
      { key: "y", label: "数值", type: "number" },
    ];
    ds.rows = ds.series[0].points.map((p) => ({ x: p.x ?? p.date, y: p.y ?? p.value }));
    return ds;
  }
  if (Array.isArray(ds.deltas) && ds.deltas.length) {
    ds.columns = [
      { key: "label", label: "项目" },
      { key: "before", label: "前", type: "number" },
      { key: "after", label: "后", type: "number" },
      { key: "unit", label: "单位" },
    ];
    ds.rows = ds.deltas;
    return ds;
  }
  if (Array.isArray(ds.kpis) && ds.kpis.length) {
    ds.columns = [
      { key: "label", label: "指标" },
      { key: "value", label: "数值", type: "number" },
      { key: "unit", label: "单位" },
    ];
    ds.rows = ds.kpis;
    return ds;
  }
  return ds;
}

/** Convenience: list catalog for skills / OpenClaw prompts. */
export function listRenderCatalog() {
  return RENDER_IDS.map((id) => ({
    renderId: id,
    aiMayPass: ["renderId", "datasetRef"],
    aiMustNotPass: ["values", "numbers", "html", "sql", "filePath"],
  }));
}
