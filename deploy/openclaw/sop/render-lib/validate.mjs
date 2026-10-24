/**
 * Schema / safety validation for AIERP-020C render plans.
 *
 * Authorization is server-authoritative:
 * - Model may pass renderId + opaque datasetRef.id only
 * - Caller-supplied authorized / nature / sourceRefs / inline dataset are NEVER trusted
 * - Dataset body comes only from resolveSealedDataset(authCtx, ref)
 */
import { isAllowedRenderId, resolveRenderId } from "./catalog.mjs";
import { resolveSealedDataset } from "./dataset-registry.mjs";

const FORBIDDEN =
  /<\s*script|<\s*html|javascript:|data:text\/html|\bselect\s+.+\bfrom\b|\bdrop\s+table\b|\bunion\s+select\b|[A-Za-z]:\\|\.\.\/|file:\/\//i;

export const MAX_ROWS = 500;
export const MAX_SERIES_POINTS = 120;
export const MAX_CATEGORIES = 120;
export const MAX_DELTAS = 40;
export const MAX_KPIS = 8;
export const MAX_ABS_NUMBER = 1e12;

export function looksForbiddenInput(value) {
  if (value == null) return false;
  if (typeof value === "string") return FORBIDDEN.test(value);
  if (typeof value === "object") {
    try {
      return FORBIDDEN.test(JSON.stringify(value));
    } catch {
      return true;
    }
  }
  return false;
}

/** Excel formula / CSV injection — neutralize leading formula chars. */
export function sanitizeSpreadsheetCell(value) {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) > MAX_ABS_NUMBER) return String(MAX_ABS_NUMBER);
    return value;
  }
  let s = String(value);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (/^[=+\-@\t\r]/.test(s) || /^\s*[=+\-@]/.test(s)) {
    return `'${s}`;
  }
  return s.slice(0, 500);
}

function assertFiniteBounded(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v)) {
    return { ok: false, reason: `invalid_number_${label}` };
  }
  if (Math.abs(v) > MAX_ABS_NUMBER) {
    return { ok: false, reason: `number_out_of_range_${label}` };
  }
  return { ok: true, value: v };
}

function rejectForgedAuthClaims(obj, label) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.authorized === true) {
    return {
      ok: false,
      reason: `forged_authorized_claim_on_${label}`,
      degrade: "explanation",
    };
  }
  if (obj.nature === "REAL_ERP") {
    return {
      ok: false,
      reason: `forged_nature_REAL_ERP_on_${label}`,
      degrade: "explanation",
    };
  }
  if (Array.isArray(obj.sourceRefs) && obj.sourceRefs.length) {
    return {
      ok: false,
      reason: `forged_sourceRefs_on_${label}`,
      degrade: "explanation",
    };
  }
  return null;
}

/**
 * @param {object} input { renderId, datasetRef }
 * @param {object} [opts] { authCtx }
 * @returns {{ ok: true, renderId, dataset, meta, datasetRef, sealMeta } | { ok: false, reason, degrade? }}
 */
export function validateRenderRequest(input, opts = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "missing_render_request", degrade: "explanation" };
  }
  if (looksForbiddenInput(input)) {
    return { ok: false, reason: "forbidden_html_sql_or_path", degrade: "explanation" };
  }

  // Model must not invent free-form numbers outside sealed dataset
  if (input.values != null || input.invented != null || input.numbers != null) {
    return { ok: false, reason: "ai_invented_numbers_rejected", degrade: "explanation" };
  }

  // Reject caller-supplied absolute paths / outDir / filePath (isolation is server-side)
  if (input.outDir != null || input.filePath != null || input.toUserId != null) {
    return { ok: false, reason: "model_must_not_pass_outDir_filePath_toUserId", degrade: "explanation" };
  }

  const renderId = resolveRenderId(input.renderId || input.templateId);
  if (!renderId || !isAllowedRenderId(renderId)) {
    return { ok: false, reason: "renderId_not_whitelisted", degrade: "explanation" };
  }

  const datasetRef = input.datasetRef || input.sourceRef || null;
  const inlineDataset = input.dataset || input.data || null;

  // Any caller claim of authorized/REAL_ERP on ref or inline body is forgery
  const forgedRef = rejectForgedAuthClaims(datasetRef, "datasetRef");
  if (forgedRef) return forgedRef;
  const forgedDs = rejectForgedAuthClaims(inlineDataset, "dataset");
  if (forgedDs) return forgedDs;

  // Inline dataset from the model is never accepted on the public path
  if (inlineDataset != null) {
    return {
      ok: false,
      reason: "inline_dataset_rejected_use_opaque_datasetRef",
      degrade: "explanation",
    };
  }

  const authCtx = opts.authCtx || input.authCtx;
  if (!authCtx || typeof authCtx !== "object") {
    return { ok: false, reason: "authCtx_required", degrade: "explanation" };
  }

  const resolved = resolveSealedDataset(authCtx, datasetRef);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason || "datasetRef_not_authorized",
      degrade: "explanation",
    };
  }

  const dataset = resolved.dataset;
  if (looksForbiddenInput(dataset)) {
    return { ok: false, reason: "dataset_contains_forbidden_content", degrade: "explanation" };
  }

  const meta = buildMeta(input, dataset, resolved.meta);
  const shape = validateShape(renderId, dataset);
  if (!shape.ok) {
    return {
      ok: false,
      reason: shape.reason,
      degrade: shape.degrade || "table.basic",
      renderId,
      dataset,
      meta,
      sealMeta: resolved.meta,
      datasetRef: { id: resolved.meta.datasetRefId },
    };
  }

  return {
    ok: true,
    renderId,
    dataset,
    meta,
    sealMeta: resolved.meta,
    datasetRef: { id: resolved.meta.datasetRefId },
  };
}

function buildMeta(input, dataset, sealMeta) {
  const now = new Date();
  const ds = dataset || {};
  return {
    title: String(ds.title || input.title || "ERP 数据展示").slice(0, 120),
    unit: ds.unit != null ? String(ds.unit) : input.unit != null ? String(input.unit) : "",
    currency: ds.currency || input.currency || "",
    timeRange: ds.timeRange || input.timeRange || "",
    sourceLabel: String(
      sealMeta?.sourcePath ||
        ds.sourceLabel ||
        ds.source ||
        "ERP 授权查询",
    ).slice(0, 120),
    provenance: sealMeta?.provenance || "SERVER_SEALED_ERP",
    datasetRefId: sealMeta?.datasetRefId,
    datasetSha256: sealMeta?.datasetSha256,
    generatedAt: now.toISOString(),
    generatedAtZh: formatZhTime(now),
    schemaVersion: String(input.schemaVersion || ds.schemaVersion || "1.0"),
  };
}

function formatZhTime(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rowsOf(dataset) {
  if (Array.isArray(dataset.rows)) return dataset.rows;
  if (Array.isArray(dataset.lines)) return dataset.lines;
  return [];
}

function categoriesOf(dataset) {
  if (Array.isArray(dataset.categories)) return dataset.categories;
  if (Array.isArray(dataset.series) && dataset.series[0]?.points) {
    return dataset.series[0].points.map((p) => ({
      label: p.x ?? p.label,
      value: p.y ?? p.value,
    }));
  }
  return [];
}

function validateShape(renderId, dataset) {
  const rows = rowsOf(dataset);
  const cats = categoriesOf(dataset);

  if (rows.length > MAX_ROWS) {
    return { ok: false, reason: `rows_exceed_${MAX_ROWS}`, degrade: "explanation" };
  }
  if (cats.length > MAX_CATEGORIES) {
    return { ok: false, reason: `categories_exceed_${MAX_CATEGORIES}`, degrade: "explanation" };
  }

  // Bound numeric fields used by charts
  for (const r of rows) {
    for (const [k, v] of Object.entries(r || {})) {
      if (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) && /^-?\d/.test(v.trim()))) {
        if (typeof v === "number" || (["qty", "amount", "value", "price", "total", "before", "after", "y"].includes(k))) {
          const n = Number(v);
          if (Number.isFinite(n) && Math.abs(n) > MAX_ABS_NUMBER) {
            return { ok: false, reason: `number_out_of_range_${k}`, degrade: "explanation" };
          }
        }
      }
    }
  }

  switch (renderId) {
    case "table.basic": {
      if (!rows.length && !(Array.isArray(dataset.columns) && dataset.columns.length)) {
        return { ok: false, reason: "empty_table", degrade: "explanation" };
      }
      return { ok: true };
    }
    case "bar.compare": {
      if (cats.length < 2 && rows.length < 2) {
        return { ok: false, reason: "bar_needs_two_plus_categories", degrade: "table.basic" };
      }
      const unitCheck = sameUnitOrFail(cats.length ? cats : rows, dataset);
      if (!unitCheck.ok) return unitCheck;
      return { ok: true };
    }
    case "line.trend": {
      const points = extractTrendPoints(dataset);
      if (points.length < 3) {
        return { ok: false, reason: "line_needs_three_plus_time_points", degrade: "table.basic" };
      }
      if (points.length > MAX_SERIES_POINTS) {
        return { ok: false, reason: `line_points_exceed_${MAX_SERIES_POINTS}`, degrade: "explanation" };
      }
      for (const p of points) {
        const chk = assertFiniteBounded(p.y, "line_y");
        if (!chk.ok) return { ok: false, reason: chk.reason, degrade: "explanation" };
      }
      return { ok: true };
    }
    case "pie.share": {
      const slices = cats.length ? cats : rows.map(rowToCat);
      if (slices.length < 2 || slices.length > 6) {
        return { ok: false, reason: "pie_needs_2_to_6_slices", degrade: "table.basic" };
      }
      if (slices.some((s) => Number(s.value) < 0)) {
        return { ok: false, reason: "pie_rejects_negative", degrade: "table.basic" };
      }
      const unitCheck = sameUnitOrFail(slices, dataset);
      if (!unitCheck.ok) return unitCheck;
      const sum = slices.reduce((a, s) => a + (Number(s.value) || 0), 0);
      if (!(sum > 0)) {
        return { ok: false, reason: "pie_empty_sum", degrade: "table.basic" };
      }
      return { ok: true };
    }
    case "delta.before_after": {
      const deltas = Array.isArray(dataset.deltas) ? dataset.deltas : rows;
      if (!deltas.length) {
        return { ok: false, reason: "delta_empty", degrade: "explanation" };
      }
      if (deltas.length > MAX_DELTAS) {
        return { ok: false, reason: `deltas_exceed_${MAX_DELTAS}`, degrade: "explanation" };
      }
      return { ok: true };
    }
    case "kpi.tiles": {
      const kpis = Array.isArray(dataset.kpis) ? dataset.kpis : rows;
      if (!kpis.length) {
        return { ok: false, reason: "kpi_empty", degrade: "explanation" };
      }
      if (kpis.length > MAX_KPIS) {
        return { ok: false, reason: `kpis_exceed_${MAX_KPIS}`, degrade: "explanation" };
      }
      return { ok: true };
    }
    default:
      return { ok: false, reason: "unknown_render", degrade: "explanation" };
  }
}

function rowToCat(r) {
  return {
    label: r.label ?? r.name ?? r.category ?? r.depotName ?? r.partnerName ?? "-",
    value: r.value ?? r.amount ?? r.qty ?? r.total ?? 0,
    unit: r.unit,
  };
}

function sameUnitOrFail(items, dataset) {
  const units = new Set();
  for (const it of items) {
    const u = it.unit != null ? String(it.unit) : dataset.unit != null ? String(dataset.unit) : "";
    if (u) units.add(u);
  }
  if (units.size > 1) {
    return { ok: false, reason: "mixed_units_cannot_chart", degrade: "table.basic" };
  }
  const currencies = new Set();
  for (const it of items) {
    const c = it.currency != null ? String(it.currency) : dataset.currency != null ? String(dataset.currency) : "";
    if (c) currencies.add(c);
  }
  if (currencies.size > 1) {
    return { ok: false, reason: "mixed_currency_cannot_chart", degrade: "table.basic" };
  }
  return { ok: true };
}

export function extractTrendPoints(dataset) {
  if (Array.isArray(dataset.series) && dataset.series[0]?.points) {
    return dataset.series[0].points
      .map((p) => ({ x: p.x ?? p.date ?? p.t, y: Number(p.y ?? p.value) }))
      .filter((p) => p.x != null && Number.isFinite(p.y))
      .sort((a, b) => String(a.x).localeCompare(String(b.x)));
  }
  if (Array.isArray(dataset.points)) {
    return dataset.points
      .map((p) => ({ x: p.x ?? p.date, y: Number(p.y ?? p.value) }))
      .filter((p) => p.x != null && Number.isFinite(p.y))
      .sort((a, b) => String(a.x).localeCompare(String(b.x)));
  }
  return rowsOf(dataset)
    .map((r) => ({
      x: r.date ?? r.day ?? r.x ?? r.label,
      y: Number(r.value ?? r.amount ?? r.y),
    }))
    .filter((p) => p.x != null && Number.isFinite(p.y))
    .sort((a, b) => String(a.x).localeCompare(String(b.x)));
}

export function extractCategories(dataset) {
  const cats = categoriesOf(dataset);
  if (cats.length) {
    return cats.map((c) => ({
      label: String(c.label ?? c.name ?? "-"),
      value: Number(c.value ?? c.amount ?? c.y ?? 0),
      unit: c.unit,
    }));
  }
  return rowsOf(dataset)
    .map(rowToCat)
    .map((c) => ({
      label: String(c.label),
      value: Number(c.value) || 0,
      unit: c.unit,
    }));
}

export { rowsOf, categoriesOf };
