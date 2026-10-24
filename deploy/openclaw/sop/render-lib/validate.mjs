/**
 * Schema / safety validation for AIERP-020C render plans.
 * Rejects invented numbers, HTML, SQL, local paths, and unsafe axes.
 */
import { isAllowedRenderId, resolveRenderId } from "./catalog.mjs";

const FORBIDDEN =
  /<\s*script|<\s*html|javascript:|data:text\/html|\bselect\s+.+\bfrom\b|\bdrop\s+table\b|\bunion\s+select\b|[A-Za-z]:\\|\.\.\/|file:\/\//i;

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

function isAuthorizedDataset(ds) {
  if (!ds || typeof ds !== "object") return false;
  if (ds.authorized === true) return true;
  if (ds.nature === "REAL_ERP") return true;
  if (ds.sourceRefs && Array.isArray(ds.sourceRefs) && ds.sourceRefs.length) return true;
  return false;
}

function hasDatasetRef(ref) {
  if (!ref || typeof ref !== "object") return false;
  const id = ref.id || ref.datasetId || ref.queryId;
  if (!id) return false;
  if (ref.authorized === false) return false;
  if (looksForbiddenInput(ref)) return false;
  return true;
}

/**
 * @returns {{ ok: true, renderId: string, dataset: object, meta: object } | { ok: false, reason: string, degrade?: string }}
 */
export function validateRenderRequest(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "missing_render_request", degrade: "explanation" };
  }
  if (looksForbiddenInput(input)) {
    return { ok: false, reason: "forbidden_html_sql_or_path", degrade: "explanation" };
  }

  const renderId = resolveRenderId(input.renderId || input.templateId);
  if (!renderId || !isAllowedRenderId(renderId)) {
    return { ok: false, reason: "renderId_not_whitelisted", degrade: "explanation" };
  }

  const dataset = input.dataset || input.data || null;
  const datasetRef = input.datasetRef || input.sourceRef || null;

  if (!hasDatasetRef(datasetRef) && !isAuthorizedDataset(dataset)) {
    return {
      ok: false,
      reason: "dataset_must_be_authorized_erp_or_datasetRef",
      degrade: "explanation",
    };
  }

  if (dataset && looksForbiddenInput(dataset)) {
    return { ok: false, reason: "dataset_contains_forbidden_content", degrade: "explanation" };
  }

  // AI must not pass free-form "values" / "numbers" outside the dataset
  if (input.values != null || input.invented != null || input.numbers != null) {
    return { ok: false, reason: "ai_invented_numbers_rejected", degrade: "explanation" };
  }

  const meta = buildMeta(input, dataset, datasetRef);
  const shape = validateShape(renderId, dataset || {});
  if (!shape.ok) {
    return {
      ok: false,
      reason: shape.reason,
      degrade: shape.degrade || "table.basic",
      renderId,
      dataset: dataset || {},
      meta,
    };
  }

  return { ok: true, renderId, dataset: dataset || {}, meta, datasetRef };
}

function buildMeta(input, dataset, datasetRef) {
  const now = new Date();
  const ds = dataset || {};
  return {
    title: String(ds.title || input.title || "ERP 数据展示").slice(0, 120),
    unit: ds.unit != null ? String(ds.unit) : input.unit != null ? String(input.unit) : "",
    currency: ds.currency || input.currency || "",
    timeRange: ds.timeRange || input.timeRange || "",
    sourceLabel:
      ds.sourceLabel ||
      ds.source ||
      datasetRef?.sourceLabel ||
      datasetRef?.id ||
      "ERP 授权查询",
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
      return { ok: true };
    }
    case "kpi.tiles": {
      const kpis = Array.isArray(dataset.kpis) ? dataset.kpis : rows;
      if (!kpis.length) {
        return { ok: false, reason: "kpi_empty", degrade: "explanation" };
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
  return rowsOf(dataset).map(rowToCat).map((c) => ({
    label: String(c.label),
    value: Number(c.value) || 0,
    unit: c.unit,
  }));
}

export { rowsOf, categoriesOf };
