/**
 * AIERP-020C reusable table/chart render library.
 *
 * Contract:
 * - Data only from server-sealed ERP datasetRef (opaque id)
 * - AI picks renderId only — no invented numbers, HTML, SQL, or paths
 * - Output PNG (system Chinese fonts) + optional XLSX for long tables
 * - Media files are identity-scoped under a fixed root (no model outDir)
 * - Empty/invalid data degrades to table/explanation — never fake charts
 */
import { mkdirSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { RENDER_IDS, PNG_LIMITS, resolveRenderId } from "./catalog.mjs";
import { validateRenderRequest } from "./validate.mjs";
import { sealDataset } from "./dataset-registry.mjs";
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
  sealDataset,
};
export {
  resolveSealedDataset,
  __clearDatasetRegistryForTests,
  __registrySizeForTests,
} from "./dataset-registry.mjs";

const RENDERERS = {
  "table.basic": renderTableBasic,
  "bar.compare": renderBarCompare,
  "line.trend": renderLineTrend,
  "pie.share": renderPieShare,
  "delta.before_after": renderDeltaBeforeAfter,
  "kpi.tiles": renderKpiTiles,
};

const DEFAULT_MEDIA_ROOT = join(
  process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state"),
  "media",
  "aierp-render",
);

function safeSeg(v) {
  return String(v || "x")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 48) || "x";
}

/**
 * Fixed media root; optional override must realpath under the default root.
 */
export function resolveMediaRoot(requested) {
  const base = resolve(DEFAULT_MEDIA_ROOT);
  mkdirSync(base, { recursive: true });
  if (!requested) return base;
  const abs = resolve(String(requested));
  let realBase = base;
  let realAbs = abs;
  try {
    if (existsSync(base)) realBase = realpathSync(base);
    if (existsSync(abs)) realAbs = realpathSync(abs);
  } catch {
    // use resolve() paths
  }
  const prefix = realBase.endsWith(sep) ? realBase : realBase + sep;
  if (realAbs !== realBase && !realAbs.startsWith(prefix)) {
    throw new Error("outDir_outside_allowlisted_media_root");
  }
  return abs;
}

/**
 * Per-tenant / per-actor isolation directory.
 */
export function identityMediaDir(authCtx, requestedRoot) {
  const root = resolveMediaRoot(requestedRoot);
  const tenant = safeSeg(authCtx?.tenantId ?? authCtx?.tenant_id ?? "unknown");
  const actor = safeSeg(authCtx?.actorUserId ?? authCtx?.erpUserId ?? authCtx?.userId ?? "unknown");
  const dir = join(root, tenant, actor);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function uniqueStem(authCtx, renderId, pngSha) {
  const tenant = safeSeg(authCtx?.tenantId ?? "t");
  const actor = safeSeg(authCtx?.actorUserId ?? authCtx?.erpUserId ?? "a");
  const rnd = randomBytes(6).toString("hex");
  const sha8 = String(pngSha || createHash("sha256").update(rnd).digest("hex")).slice(0, 8);
  return `${tenant}_${actor}_${Date.now()}_${rnd}_${safeSeg(renderId)}_${sha8}`;
}

/**
 * Trusted ERP adapter entry: seal query result, then render by opaque ref only.
 *
 * @param {object} authCtx tenantId, actorUserId, wecomUserId, botId, bindingVersion
 * @param {object} plan { renderId, dataset, sourceKind?, sourcePath?, depotScope?, ttlMs? }
 * @param {object} [opts] writeFiles, exportXlsx, maxPngRows (outDir ignored unless under media root)
 */
export async function sealAndRender(authCtx, plan, opts = {}) {
  if (!plan?.dataset || typeof plan.dataset !== "object") {
    throw new Error("sealAndRender_requires_dataset_from_trusted_erp_query");
  }
  const seal = sealDataset(authCtx, plan.dataset, {
    sourceKind: plan.sourceKind || "ERP_QUERY",
    sourcePath: plan.sourcePath,
    depotScope: plan.depotScope,
    ttlMs: plan.ttlMs,
  });
  return renderDataset(
    {
      renderId: plan.renderId,
      datasetRef: { id: seal.id },
      schemaVersion: plan.schemaVersion,
    },
    { ...opts, authCtx },
  );
}

/**
 * Model / channel path: renderId + opaque datasetRef.id + authCtx.
 *
 * @param {object} request { renderId, datasetRef }
 * @param {object} [opts] { authCtx, writeFiles?, exportXlsx?, maxPngRows? }
 */
export async function renderDataset(request, opts = {}) {
  const authCtx = opts.authCtx || request?.authCtx;
  const checked = validateRenderRequest(request, { authCtx });

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
      { ...opts, authCtx },
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
    // Re-validate shape only — dataset already sealed; skip auth re-entry by using sealed body
    const tableCheck = validateShapeOnly("table.basic", dataset);
    if (!tableCheck.ok) {
      return finalize(
        renderExplanation(meta, degradeReason),
        { ...checked, renderId: "explanation", meta },
        { ...opts, authCtx },
        { forceDegraded: true, degradeReason },
      );
    }
  }

  const fn = RENDERERS[renderId];
  if (!fn) {
    return finalize(renderExplanation(meta, "renderId_not_whitelisted"), checked, { ...opts, authCtx }, {
      forceDegraded: true,
    });
  }

  const drawn = fn(dataset, meta, { maxPngRows: opts.maxPngRows || PNG_LIMITS.tablePreviewRows });
  return finalize(
    drawn,
    { ok: true, renderId, dataset, meta, datasetRef: checked.datasetRef, sealMeta: checked.sealMeta },
    { ...opts, authCtx },
    { degraded, degradeReason },
  );
}

/** Shape-only check used after degrade materialization (dataset already sealed). */
function validateShapeOnly(renderId, dataset) {
  // Lightweight: reuse validateRenderRequest path is blocked without seal; check rows present
  if (renderId === "table.basic") {
    const rows = Array.isArray(dataset?.rows) ? dataset.rows : Array.isArray(dataset?.lines) ? dataset.lines : [];
    if (!rows.length && !(Array.isArray(dataset?.columns) && dataset.columns.length)) {
      return { ok: false, reason: "empty_table" };
    }
    return { ok: true };
  }
  return { ok: true };
}

async function finalize(drawn, checked, opts, extra = {}) {
  const authCtx = opts.authCtx;
  const png = svgToPng(drawn.svg);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const result = {
    ok: true,
    renderId: extra.forceDegraded ? "explanation" : checked.renderId,
    degraded: !!(extra.degraded || extra.forceDegraded || drawn.degraded),
    degradeReason: extra.degradeReason || drawn.degradeReason || null,
    alt: drawn.alt,
    meta: checked.meta,
    sealMeta: checked.sealMeta || null,
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

  if (opts.writeFiles) {
    if (!authCtx) {
      result.writeError = "authCtx_required_for_media_write";
    } else {
      try {
        // Model cannot choose arbitrary outDir; only identity-scoped under allowlisted root.
        const outDir = identityMediaDir(authCtx, opts.outDir);
        const stem = uniqueStem(authCtx, result.renderId, sha256);
        const pngPath = join(outDir, `${stem}.png`);
        writeFileSync(pngPath, png);
        result.files.png = pngPath;
        if (result.xlsx) {
          const xlsxPath = join(outDir, `${stem}.xlsx`);
          writeFileSync(xlsxPath, result.xlsx);
          result.files.xlsx = xlsxPath;
        }
        const svgPath = join(outDir, `${stem}.svg`);
        writeFileSync(svgPath, drawn.svg, "utf8");
        result.files.svg = svgPath;
        result.files.stem = stem;
        result.files.outDir = outDir;
      } catch (err) {
        result.writeError = String(err?.message || err).slice(0, 200);
      }
    }
  }

  return result;
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
    aiMayPass: ["renderId", "datasetRef.id"],
    aiMustNotPass: ["values", "numbers", "html", "sql", "filePath", "outDir", "authorized", "nature", "dataset"],
  }));
}
