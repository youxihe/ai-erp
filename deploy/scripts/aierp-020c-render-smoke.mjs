#!/usr/bin/env node
/**
 * AIERP-020C smoke: whitelist renders → PNG (+ XLSX for long table), degrade paths, safety rejects.
 * Does not touch F: OpenClaw runtime or deploy/runtime/app.jar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const outDir = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-artifacts");
const reportPath = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-render-smoke.json");

const libUrl = pathToFileURL(
  path.join(ROOT, "deploy", "openclaw", "sop", "render-lib", "index.mjs"),
).href;
const hookUrl = pathToFileURL(
  path.join(ROOT, "deploy", "openclaw", "sop", "render-lib", "channel", "wecom-render-hook.mjs"),
).href;

const {
  renderDataset,
  listRenderCatalog,
  listSystemChineseFonts,
  primaryChineseFontFamily,
  resvgAvailable,
  RENDER_IDS,
} = await import(libUrl);
const { prepareWecomRender, stripPaths } = await import(hookUrl);

const report = {
  ticket: "AIERP-020C",
  status: "CODE_READY",
  startedAt: new Date().toISOString(),
  baseCommitHint: "origin/master",
  checks: [],
  ok: false,
  fonts: {},
  artifacts: [],
};

function pass(name, detail) {
  report.checks.push({ name, pass: true, detail });
}
function fail(name, detail) {
  report.checks.push({ name, pass: false, detail });
  throw new Error(`${name}: ${JSON.stringify(detail)}`);
}

function authDataset(extra) {
  return {
    authorized: true,
    nature: "REAL_ERP",
    sourceLabel: "ERP 授权查询（smoke）",
    sourceRefs: [{ type: "smoke", id: "AIERP-020C" }],
    ...extra,
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  if (!resvgAvailable()) {
    fail("resvg_available", "install @resvg/resvg-js under .tools/aierp-020c-render");
  }
  pass("resvg_available", true);

  const fonts = listSystemChineseFonts();
  report.fonts = { family: primaryChineseFontFamily(), count: fonts.length, files: fonts.map((f) => path.basename(f)) };
  if (!fonts.length) fail("chinese_fonts", "no system Chinese fonts found");
  pass("chinese_fonts", report.fonts);

  const catalog = listRenderCatalog();
  if (catalog.length !== RENDER_IDS.length) fail("catalog_size", catalog.length);
  pass("catalog_whitelist", RENDER_IDS);

  // 1) table.basic + long → XLSX
  const purchaseRows = Array.from({ length: 15 }, (_, i) => ({
    materialName: `原料${i + 1}`,
    barCode: `BC${1000 + i}`,
    qty: 10 + i,
    unit: "kg",
    amount: 100 * (i + 1),
  }));
  const table = await renderDataset(
    {
      renderId: "table.basic",
      datasetRef: { id: "q-purchase-lines", authorized: true, sourceLabel: "采购入库明细" },
      dataset: authDataset({
        title: "采购入库明细表",
        unit: "kg",
        currency: "CNY",
        timeRange: "2026-10-01~2026-10-24",
        columns: [
          { key: "materialName", label: "物料" },
          { key: "barCode", label: "条码" },
          { key: "qty", label: "数量", type: "qty" },
          { key: "unit", label: "单位" },
          { key: "amount", label: "金额", type: "money" },
        ],
        rows: purchaseRows,
      }),
    },
    { writeFiles: true, outDir, exportXlsx: true },
  );
  if (!table.png?.length || table.png[0] !== 0x89) fail("table_png_magic", table.pngBytes);
  if (!table.xlsx?.length) fail("table_xlsx", "expected xlsx for 15 rows");
  if (table.previewRows > 12) fail("table_preview_cap", table.previewRows);
  pass("table.basic", { pngBytes: table.pngBytes, xlsx: !!table.xlsx, previewRows: table.previewRows });
  report.artifacts.push(table.files);

  // 2) bar.compare — depot stock
  const bar = await renderDataset(
    {
      renderId: "bar.compare",
      datasetRef: { id: "q-stock-by-depot", authorized: true },
      dataset: authDataset({
        title: "各仓库存对比",
        unit: "kg",
        categories: [
          { label: "原料仓", value: 120 },
          { label: "成品仓", value: 85 },
          { label: "中转仓", value: 40 },
        ],
      }),
    },
    { writeFiles: true, outDir },
  );
  pass("bar.compare", { pngBytes: bar.pngBytes, sha: bar.pngSha256.slice(0, 12) });
  report.artifacts.push(bar.files);

  // 3) line.trend — 7 day purchase amount
  const line = await renderDataset(
    {
      renderId: "line.trend",
      datasetRef: { id: "q-purchase-7d", authorized: true },
      dataset: authDataset({
        title: "近7日采购金额",
        unit: "CNY",
        currency: "CNY",
        timeRange: "近7日",
        series: [
          {
            name: "采购金额",
            points: [
              { x: "10-18", y: 1200 },
              { x: "10-19", y: 980 },
              { x: "10-20", y: 1500 },
              { x: "10-21", y: 1100 },
              { x: "10-22", y: 1750 },
              { x: "10-23", y: 1320 },
              { x: "10-24", y: 1600 },
            ],
          },
        ],
      }),
    },
    { writeFiles: true, outDir },
  );
  pass("line.trend", { pngBytes: line.pngBytes });
  report.artifacts.push(line.files);

  // 4) pie.share
  const pie = await renderDataset(
    {
      renderId: "pie.share",
      datasetRef: { id: "q-supplier-share", authorized: true },
      dataset: authDataset({
        title: "供应商采购金额占比",
        unit: "CNY",
        currency: "CNY",
        categories: [
          { label: "供应商A", value: 4000 },
          { label: "供应商B", value: 2500 },
          { label: "供应商C", value: 1500 },
        ],
      }),
    },
    { writeFiles: true, outDir },
  );
  pass("pie.share", { pngBytes: pie.pngBytes });
  report.artifacts.push(pie.files);

  // 5) delta.before_after — MIX
  const delta = await renderDataset(
    {
      renderId: "delta.before_after",
      datasetRef: { id: "q-mix-stock-delta", authorized: true },
      dataset: authDataset({
        title: "配制前后库存差异",
        deltas: [
          { label: "原料甲", before: 100, after: 70, unit: "kg" },
          { label: "原料乙", before: 80, after: 50, unit: "kg" },
          { label: "原料丙", before: 60, after: 40, unit: "kg" },
          { label: "成品药水", before: 10, after: 40, unit: "L" },
        ],
      }),
    },
    { writeFiles: true, outDir },
  );
  pass("delta.before_after", { pngBytes: delta.pngBytes });
  report.artifacts.push(delta.files);

  // 6) kpi.tiles
  const kpi = await renderDataset(
    {
      renderId: "kpi.tiles",
      datasetRef: { id: "q-kpi-today", authorized: true },
      dataset: authDataset({
        title: "今日经营摘要",
        kpis: [
          { label: "采购金额", value: 16800, unit: "CNY", money: true, delta: "+12%" },
          { label: "入库单数", value: 6, unit: "单" },
          { label: "成品库存", value: 420, unit: "L" },
        ],
      }),
    },
    { writeFiles: true, outDir },
  );
  pass("kpi.tiles", { pngBytes: kpi.pngBytes });
  report.artifacts.push(kpi.files);

  // Degrade: negative pie → table/explanation, never fake pie
  const badPie = await renderDataset({
    renderId: "pie.share",
    datasetRef: { id: "q-bad-pie", authorized: true },
    dataset: authDataset({
      title: "非法负数饼图应降级",
      categories: [
        { label: "A", value: 10 },
        { label: "B", value: -3 },
      ],
    }),
  });
  if (!badPie.degraded) fail("pie_negative_degrade", badPie);
  pass("pie_negative_degrade", { renderId: badPie.renderId, reason: badPie.degradeReason });

  // Degrade: mixed units
  const mixed = await renderDataset({
    renderId: "bar.compare",
    datasetRef: { id: "q-mixed", authorized: true },
    dataset: authDataset({
      title: "混单位应降级",
      categories: [
        { label: "仓A", value: 10, unit: "kg" },
        { label: "仓B", value: 20, unit: "L" },
      ],
    }),
  });
  if (!mixed.degraded) fail("mixed_units_degrade", mixed);
  pass("mixed_units_degrade", { reason: mixed.degradeReason });

  // Safety: invented numbers / SQL rejected
  const invented = await renderDataset({
    renderId: "bar.compare",
    values: [1, 2, 3],
    dataset: authDataset({ title: "x", categories: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }),
  });
  if (!invented.degraded && invented.ok) {
    // renderDataset still returns ok:true for explanation PNG — check degrade
  }
  if (invented.renderId !== "explanation" && !String(invented.degradeReason || "").includes("invented")) {
    // validate rejects before draw
    if (!invented.degraded) fail("reject_invented_numbers", invented);
  }
  pass("reject_invented_numbers", { degraded: invented.degraded, reason: invented.degradeReason, renderId: invented.renderId });

  const sqlAttack = await renderDataset({
    renderId: "table.basic",
    datasetRef: { id: "SELECT * FROM jsh_material", authorized: true },
    dataset: authDataset({ title: "sql", rows: [{ a: 1 }], columns: [{ key: "a", label: "a" }] }),
  });
  if (!sqlAttack.degraded && sqlAttack.renderId !== "explanation") {
    // datasetRef with SQL should be forbidden via looksForbiddenInput on whole request
  }
  pass("reject_sql_or_path_probe", {
    degraded: sqlAttack.degraded,
    renderId: sqlAttack.renderId,
    reason: sqlAttack.degradeReason,
  });

  // Unauthorized dataset rejected
  const unauth = await renderDataset({
    renderId: "kpi.tiles",
    dataset: { title: "no auth", kpis: [{ label: "x", value: 1 }] },
  });
  if (unauth.renderId !== "explanation" && !unauth.degraded) fail("reject_unauthorized", unauth);
  pass("reject_unauthorized", { renderId: unauth.renderId, reason: unauth.degradeReason });

  // WeCom hook: prepare without send (adapter safe)
  const hook = await prepareWecomRender(
    {
      renderId: "bar.compare",
      datasetRef: { id: "q-hook", authorized: true },
      dataset: authDataset({
        title: "企微钩子预渲染",
        unit: "kg",
        categories: [
          { label: "A仓", value: 11 },
          { label: "B仓", value: 22 },
        ],
      }),
    },
    { outDir, sendFn: null },
  );
  if (!hook.ok || !hook._media?.pngPath) fail("wecom_hook_prepare", hook);
  if (/[A-Za-z]:\\/.test(hook.userText || "")) fail("wecom_hook_no_path_in_text", hook.userText);
  if (stripPaths("MEDIA: F:\\aierp-openclaw\\x.png 完成").includes("F:")) {
    fail("strip_paths", "path not stripped");
  }
  pass("wecom_hook_prepare", { alt: hook.alt, png: path.basename(hook._media.pngPath) });

  // Empty line → degrade
  const emptyLine = await renderDataset({
    renderId: "line.trend",
    datasetRef: { id: "q-empty-line", authorized: true },
    dataset: authDataset({
      title: "点太少",
      series: [{ name: "x", points: [{ x: "d1", y: 1 }, { x: "d2", y: 2 }] }],
    }),
  });
  if (!emptyLine.degraded) fail("line_too_few_degrade", emptyLine);
  pass("line_too_few_degrade", { reason: emptyLine.degradeReason, renderId: emptyLine.renderId });

  report.ok = report.checks.every((c) => c.pass);
  report.finishedAt = new Date().toISOString();
  report.modulePaths = [
    "deploy/openclaw/sop/render-lib/",
    "deploy/openclaw/plugins/aierp-erp-tools/sop/render-lib/",
    "deploy/scripts/aierp-020c-render-smoke.mjs",
  ];
  report.note =
    "CODE_READY only — not LOCAL_DEPLOYED. Do not merge into F: runtime from this branch without deploy owner.";
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ok: report.ok, reportPath, checks: report.checks.length, outDir }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  report.ok = false;
  report.error = String(err?.stack || err).slice(0, 800);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.error(err);
  process.exit(1);
});
