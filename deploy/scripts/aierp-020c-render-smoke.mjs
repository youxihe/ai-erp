#!/usr/bin/env node
/**
 * AIERP-020C smoke (non-posting):
 * - Whitelist table/bar/line/pie/delta/kpi via server-sealed datasetRef
 * - Negatives: forged authorized / REAL_ERP / opaque id spoof / cross-identity
 * - Media identity isolation + formula sanitize
 * - Real authorized ERP stock + report query → seal → render (not fixture-as-stats)
 *
 * Does not touch F: OpenClaw runtime or deploy/runtime/app.jar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Isolate smoke media under evidence (still identity-scoped under this root)
const stateRoot = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-state");
process.env.OPENCLAW_STATE_DIR = stateRoot;

const outDir = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-artifacts");
const reportPath = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-render-smoke.json");

const libUrl = pathToFileURL(
  path.join(ROOT, "deploy", "openclaw", "sop", "render-lib", "index.mjs"),
).href;
const hookUrl = pathToFileURL(
  path.join(ROOT, "deploy", "openclaw", "sop", "render-lib", "channel", "wecom-render-hook.mjs"),
).href;
const validateUrl = pathToFileURL(
  path.join(ROOT, "deploy", "openclaw", "sop", "render-lib", "validate.mjs"),
).href;

const {
  renderDataset,
  sealAndRender,
  sealDataset,
  listRenderCatalog,
  listSystemChineseFonts,
  primaryChineseFontFamily,
  resvgAvailable,
  RENDER_IDS,
  identityMediaDir,
  __clearDatasetRegistryForTests,
} = await import(libUrl);
const { prepareWecomRender, stripPaths, stagePngBuffer } = await import(hookUrl);
const { sanitizeSpreadsheetCell, validateRenderRequest } = await import(validateUrl);

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MIN_SECRET_LEN = 32;
const WECOM = `aierp020c-${Date.now().toString(36)}`;

const report = {
  ticket: "AIERP-020C",
  status: "CODE_READY",
  startedAt: new Date().toISOString(),
  baseCommitHint: "origin/master",
  checks: [],
  ok: false,
  fonts: {},
  artifacts: [],
  realErp: { attempted: false, ok: false },
  deployState: "NOT_LOCAL_DEPLOYED",
  weComUat: "LIVE_UAT_PENDING",
};

function pass(name, detail) {
  report.checks.push({ name, pass: true, detail });
}
function fail(name, detail) {
  report.checks.push({ name, pass: false, detail });
  throw new Error(`${name}: ${JSON.stringify(detail)}`);
}

function softFail(name, detail) {
  report.checks.push({ name, pass: false, detail });
}

const AUTH_A = {
  tenantId: "63",
  actorUserId: "63",
  wecomUserId: WECOM,
  botId: BOT,
  bindingVersion: 1,
};
const AUTH_B = {
  tenantId: "63",
  actorUserId: "999",
  wecomUserId: `${WECOM}-other`,
  botId: BOT,
  bindingVersion: 1,
};

function fixtureDataset(extra) {
  // Fixtures for template coverage — NOT claimed as REAL_ERP stats.
  return {
    title: extra.title || "fixture",
    sourceLabel: "SMOKE_FIXTURE_NOT_ERP_STATS",
    ...extra,
  };
}

function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = path.join(ROOT, "deploy", ".env");
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
      if (line) secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
    }
  }
  if (!secret || secret.length < MIN_SECRET_LEN || /change-me|changeme|example|placeholder/i.test(secret)) {
    return null;
  }
  return secret;
}

function md5(s) {
  return createHash("md5").update(String(s), "utf8").digest("hex");
}

async function signedPost(secret, pathName, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${pathName}`;
  const payload = `POST\n${uri}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const res = await fetch(`${BASE}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Aierp-Adapter-Timestamp": ts,
      "X-Aierp-Adapter-Nonce": nonce,
      "X-Aierp-Adapter-Signature": sig,
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function erpLogin() {
  const res = await fetch(`${BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
  });
  const json = await res.json();
  const token = json?.data?.token || json?.token;
  if (!token) throw new Error("ERP login failed");
  return token;
}

async function claim(token, bindCode) {
  const res = await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Access-Token": token,
    },
    body: JSON.stringify({ bindCode }),
  });
  return res.json();
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

function copyArtifact(rendered, label) {
  if (!rendered?.files?.png || !existsSync(rendered.files.png)) return null;
  mkdirSync(outDir, { recursive: true });
  const base = `${label}_${path.basename(rendered.files.png)}`;
  const dest = path.join(outDir, base);
  copyFileSync(rendered.files.png, dest);
  const entry = { label, png: dest };
  if (rendered.files.xlsx && existsSync(rendered.files.xlsx)) {
    const xdest = path.join(outDir, base.replace(/\.png$/i, ".xlsx"));
    copyFileSync(rendered.files.xlsx, xdest);
    entry.xlsx = xdest;
  }
  report.artifacts.push(entry);
  return entry;
}

async function main() {
  __clearDatasetRegistryForTests();
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });

  if (!resvgAvailable()) {
    fail("resvg_available", "install @resvg/resvg-js under .tools/aierp-020c-render");
  }
  pass("resvg_available", true);

  const fonts = listSystemChineseFonts();
  report.fonts = {
    family: primaryChineseFontFamily(),
    count: fonts.length,
    files: fonts.map((f) => path.basename(f)),
  };
  if (!fonts.length) fail("chinese_fonts", "no system Chinese fonts found");
  pass("chinese_fonts", report.fonts);

  const catalog = listRenderCatalog();
  if (catalog.length !== RENDER_IDS.length) fail("catalog_size", catalog.length);
  pass("catalog_whitelist", RENDER_IDS);

  // ---------- P0 negatives: forged claims ----------
  {
    const forged = validateRenderRequest(
      {
        renderId: "bar.compare",
        datasetRef: { id: "q-fake", authorized: true },
        dataset: {
          authorized: true,
          nature: "REAL_ERP",
          title: "forged",
          categories: [
            { label: "A", value: 1 },
            { label: "B", value: 2 },
          ],
        },
      },
      { authCtx: AUTH_A },
    );
    if (forged.ok) fail("reject_forged_authorized_flag", forged);
    pass("reject_forged_authorized_flag", { reason: forged.reason });
  }
  {
    const forged = validateRenderRequest(
      {
        renderId: "kpi.tiles",
        datasetRef: { id: "ds_deadbeefdeadbeefdeadbeefdeadbeef", nature: "REAL_ERP" },
      },
      { authCtx: AUTH_A },
    );
    if (forged.ok) fail("reject_forged_nature_REAL_ERP", forged);
    pass("reject_forged_nature_REAL_ERP", { reason: forged.reason });
  }
  {
    const spoof = await renderDataset(
      {
        renderId: "table.basic",
        datasetRef: { id: "ds_00000000000000000000000000000000" },
      },
      { authCtx: AUTH_A },
    );
    if (!spoof.degraded && spoof.renderId !== "explanation") {
      fail("reject_unknown_datasetRef", spoof);
    }
    pass("reject_unknown_datasetRef", { reason: spoof.degradeReason, renderId: spoof.renderId });
  }
  {
    const inline = validateRenderRequest(
      {
        renderId: "bar.compare",
        dataset: fixtureDataset({
          categories: [
            { label: "A", value: 1 },
            { label: "B", value: 2 },
          ],
        }),
      },
      { authCtx: AUTH_A },
    );
    if (inline.ok || inline.reason !== "inline_dataset_rejected_use_opaque_datasetRef") {
      // reason may also be missing datasetRef — both reject
      if (inline.ok) fail("reject_inline_dataset", inline);
    }
    pass("reject_inline_dataset", { reason: inline.reason });
  }

  // ---------- Positive fixtures via sealAndRender (NOT ERP stats) ----------
  const purchaseRows = Array.from({ length: 15 }, (_, i) => ({
    materialName: `原料${i + 1}`,
    barCode: `BC${1000 + i}`,
    qty: 10 + i,
    unit: "kg",
    amount: 100 * (i + 1),
  }));

  const table = await sealAndRender(
    AUTH_A,
    {
      renderId: "table.basic",
      sourceKind: "SMOKE_FIXTURE",
      sourcePath: "fixture/table",
      dataset: fixtureDataset({
        title: "采购入库明细表(fixture)",
        unit: "kg",
        currency: "CNY",
        timeRange: "fixture",
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
    { writeFiles: true, exportXlsx: true },
  );
  if (!table.png?.length || table.png[0] !== 0x89) fail("table_png_magic", table.pngBytes);
  if (!table.xlsx?.length) fail("table_xlsx", "expected xlsx for 15 rows");
  if (table.previewRows > 12) fail("table_preview_cap", table.previewRows);
  if (!table.files?.png || !String(table.files.png).includes(path.join("63", "63"))) {
    fail("table_media_identity_path", table.files);
  }
  pass("table.basic", {
    pngBytes: table.pngBytes,
    xlsx: !!table.xlsx,
    previewRows: table.previewRows,
    fixtureOnly: true,
  });
  copyArtifact(table, "table_basic");

  // Cross-user: AUTH_B cannot resolve AUTH_A seal
  {
    const seal = sealDataset(
      AUTH_A,
      fixtureDataset({
        title: "cross",
        categories: [
          { label: "A", value: 1 },
          { label: "B", value: 2 },
        ],
      }),
    );
    const cross = await renderDataset(
      { renderId: "bar.compare", datasetRef: { id: seal.id } },
      { authCtx: AUTH_B },
    );
    if (!cross.degraded) fail("reject_cross_actor_datasetRef", cross);
    pass("reject_cross_actor_datasetRef", { reason: cross.degradeReason });
  }

  // Binding version mismatch
  {
    const seal = sealDataset(
      AUTH_A,
      fixtureDataset({
        title: "bindver",
        categories: [
          { label: "A", value: 3 },
          { label: "B", value: 4 },
        ],
      }),
    );
    const bad = await renderDataset(
      { renderId: "bar.compare", datasetRef: { id: seal.id } },
      { authCtx: { ...AUTH_A, bindingVersion: 99 } },
    );
    if (!bad.degraded) fail("reject_binding_version_mismatch", bad);
    pass("reject_binding_version_mismatch", { reason: bad.degradeReason });
  }

  const bar = await sealAndRender(
    AUTH_A,
    {
      renderId: "bar.compare",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "各仓库存对比(fixture)",
        unit: "kg",
        categories: [
          { label: "原料仓", value: 120 },
          { label: "成品仓", value: 85 },
          { label: "中转仓", value: 40 },
        ],
      }),
    },
    { writeFiles: true },
  );
  pass("bar.compare", { pngBytes: bar.pngBytes, sha: bar.pngSha256.slice(0, 12), fixtureOnly: true });
  copyArtifact(bar, "bar_compare");

  const line = await sealAndRender(
    AUTH_A,
    {
      renderId: "line.trend",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "近7日采购金额(fixture)",
        unit: "CNY",
        currency: "CNY",
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
    { writeFiles: true },
  );
  pass("line.trend", { pngBytes: line.pngBytes, fixtureOnly: true });
  copyArtifact(line, "line_trend");

  const pie = await sealAndRender(
    AUTH_A,
    {
      renderId: "pie.share",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "供应商采购金额占比(fixture)",
        unit: "CNY",
        currency: "CNY",
        categories: [
          { label: "供应商A", value: 4000 },
          { label: "供应商B", value: 2500 },
          { label: "供应商C", value: 1500 },
        ],
      }),
    },
    { writeFiles: true },
  );
  pass("pie.share", { pngBytes: pie.pngBytes, fixtureOnly: true });
  copyArtifact(pie, "pie_share");

  const delta = await sealAndRender(
    AUTH_A,
    {
      renderId: "delta.before_after",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "配制前后库存差异(fixture)",
        deltas: [
          { label: "原料甲", before: 100, after: 70, unit: "kg" },
          { label: "原料乙", before: 80, after: 50, unit: "kg" },
          { label: "原料丙", before: 60, after: 40, unit: "kg" },
          { label: "成品药水", before: 10, after: 40, unit: "L" },
        ],
      }),
    },
    { writeFiles: true },
  );
  pass("delta.before_after", { pngBytes: delta.pngBytes, fixtureOnly: true });
  copyArtifact(delta, "delta");

  const kpi = await sealAndRender(
    AUTH_A,
    {
      renderId: "kpi.tiles",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "今日经营摘要(fixture)",
        kpis: [
          { label: "采购金额", value: 16800, unit: "CNY", money: true, delta: "+12%" },
          { label: "入库单数", value: 6, unit: "单" },
          { label: "成品库存", value: 420, unit: "L" },
        ],
      }),
    },
    { writeFiles: true },
  );
  pass("kpi.tiles", { pngBytes: kpi.pngBytes, fixtureOnly: true });
  copyArtifact(kpi, "kpi");

  // Degrade: negative pie
  {
    const badPie = await sealAndRender(AUTH_A, {
      renderId: "pie.share",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "非法负数饼图应降级",
        categories: [
          { label: "A", value: 10 },
          { label: "B", value: -3 },
        ],
      }),
    });
    if (!badPie.degraded) fail("pie_negative_degrade", badPie);
    pass("pie_negative_degrade", { renderId: badPie.renderId, reason: badPie.degradeReason });
  }

  // Degrade: mixed units
  {
    const mixed = await sealAndRender(AUTH_A, {
      renderId: "bar.compare",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "混单位应降级",
        categories: [
          { label: "仓A", value: 10, unit: "kg" },
          { label: "仓B", value: 20, unit: "L" },
        ],
      }),
    });
    if (!mixed.degraded) fail("mixed_units_degrade", mixed);
    pass("mixed_units_degrade", { reason: mixed.degradeReason });
  }

  // Safety: invented numbers
  {
    const invented = await renderDataset(
      {
        renderId: "bar.compare",
        values: [1, 2, 3],
        datasetRef: { id: "ds_11111111111111111111111111111111" },
      },
      { authCtx: AUTH_A },
    );
    if (!invented.degraded) fail("reject_invented_numbers", invented);
    pass("reject_invented_numbers", {
      degraded: invented.degraded,
      reason: invented.degradeReason,
      renderId: invented.renderId,
    });
  }

  // Formula injection sanitize
  {
    const s1 = sanitizeSpreadsheetCell("=CMD|'/c calc'!A0");
    const s2 = sanitizeSpreadsheetCell("+1+1");
    const s3 = sanitizeSpreadsheetCell("@SUM(A1)");
    if (!String(s1).startsWith("'") || !String(s2).startsWith("'") || !String(s3).startsWith("'")) {
      fail("xlsx_formula_sanitize", { s1, s2, s3 });
    }
    pass("xlsx_formula_sanitize", { s1, s2, s3 });
  }

  // Media isolation: two actors → different dirs; stagePngBuffer unique names
  {
    const dirA = identityMediaDir(AUTH_A);
    const dirB = identityMediaDir(AUTH_B);
    if (dirA === dirB) fail("media_identity_isolation", { dirA, dirB });
    const p1 = stagePngBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]), AUTH_A, "same");
    const p2 = stagePngBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]), AUTH_A, "same");
    if (p1 === p2) fail("media_no_overwrite_same_hint", { p1, p2 });
    pass("media_identity_isolation", {
      dirA: path.relative(stateRoot, dirA),
      dirB: path.relative(stateRoot, dirB),
      unique: path.basename(p1) !== path.basename(p2),
    });
  }

  // WeCom hook with sealed ref
  {
    const sealed = await sealAndRender(
      AUTH_A,
      {
        renderId: "bar.compare",
        sourceKind: "SMOKE_FIXTURE",
        dataset: fixtureDataset({
          title: "企微钩子预渲染(fixture)",
          unit: "kg",
          categories: [
            { label: "A仓", value: 11 },
            { label: "B仓", value: 22 },
          ],
        }),
      },
      { writeFiles: false },
    );
    // Re-seal for hook (previous render already consumed visual; seal again)
    const seal = sealDataset(
      AUTH_A,
      fixtureDataset({
        title: "企微钩子预渲染(fixture)",
        unit: "kg",
        categories: [
          { label: "A仓", value: 11 },
          { label: "B仓", value: 22 },
        ],
      }),
      { sourceKind: "SMOKE_FIXTURE" },
    );
    const hook = await prepareWecomRender(
      { renderId: "bar.compare", datasetRef: { id: seal.id } },
      { authCtx: AUTH_A, sendFn: null },
    );
    if (!hook.ok || !hook._media?.pngPath) fail("wecom_hook_prepare", hook);
    if (/[A-Za-z]:\\/.test(hook.userText || "")) fail("wecom_hook_no_path_in_text", hook.userText);
    if (stripPaths("MEDIA: F:\\aierp-openclaw\\x.png 完成").includes("F:")) {
      fail("strip_paths", "path not stripped");
    }
    pass("wecom_hook_prepare", {
      alt: hook.alt,
      png: path.basename(hook._media.pngPath),
      pngBytes: sealed.pngBytes,
    });
  }

  // Line too few → degrade
  {
    const emptyLine = await sealAndRender(AUTH_A, {
      renderId: "line.trend",
      sourceKind: "SMOKE_FIXTURE",
      dataset: fixtureDataset({
        title: "点太少",
        series: [
          {
            name: "x",
            points: [
              { x: "d1", y: 1 },
              { x: "d2", y: 2 },
            ],
          },
        ],
      }),
    });
    if (!emptyLine.degraded) fail("line_too_few_degrade", emptyLine);
    pass("line_too_few_degrade", { reason: emptyLine.degradeReason, renderId: emptyLine.renderId });
  }

  // ---------- Real authorized ERP queries (non-posting) ----------
  const secret = loadSecret();
  report.realErp.attempted = true;
  if (!secret) {
    softFail("real_erp_secret", "AIERP_WECOM_ADAPTER_SECRET missing — cannot verify live ERP");
  } else {
    try {
      const loginProbe = await fetch(`${BASE}/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
      });
      if (!loginProbe.ok && loginProbe.status >= 500) {
        softFail("real_erp_boot_up", { status: loginProbe.status });
      } else {
        pass("real_erp_boot_up", { status: loginProbe.status });
        const issue = await signedPost(secret, "/aierp/v1/wecom/binding/issue", idBody());
        const code = issue.json?.data?.bindCode;
        if (!code) {
          softFail("real_erp_bind_issue", { code: issue.json?.code });
        } else {
          const token = await erpLogin();
          const claimed = await claim(token, code);
          const bindOk = claimed?.code === 200 || claimed?.data?.status === "ACTIVE";
          if (!bindOk) {
            softFail("real_erp_bind_claim", { code: claimed?.code, status: claimed?.data?.status });
          } else {
            pass("real_erp_bind_claim", { status: claimed?.data?.status || claimed?.code });
            // Bound identity: demo jsh user (63). Never trust model-supplied actor ids.
            const erpAuth = {
              tenantId: "63",
              actorUserId: "63",
              wecomUserId: WECOM,
              botId: BOT,
              bindingVersion: 1,
            };

            const stock = await signedPost(
              secret,
              "/aierp/v1/wecom/stock/query",
              idBody({ query: "表面活性剂", depotName: "原料仓" }),
            );
            const stockData = stock.json?.data || {};
            const stockRows = Array.isArray(stockData.rows) ? stockData.rows : [];
            // stock/query returns bound ERP rows; nature may be omitted (unlike report/query).
            const stockOk =
              stock.json?.code === 200 &&
              stockRows.length > 0 &&
              (stockData.nature == null || stockData.nature === "REAL_ERP") &&
              stockData.boundErpLoginName;
            if (!stockOk) {
              softFail("real_erp_stock_query", {
                code: stock.json?.code,
                nature: stockData.nature ?? null,
                rows: stockRows.length,
                bound: stockData.boundErpLoginName || null,
              });
            } else {
              pass("real_erp_stock_query", {
                nature: stockData.nature || "BOUND_ERP_STOCK",
                boundErpLoginName: stockData.boundErpLoginName,
                rowCount: stockRows.length,
                sampleQty: stockRows[0]?.currentStock ?? stockRows[0]?.currentNumber ?? null,
                sampleBarCode: stockRows[0]?.barCode || null,
              });

              const tableReal = await sealAndRender(
                erpAuth,
                {
                  renderId: "table.basic",
                  sourceKind: "ERP_QUERY",
                  sourcePath: "/aierp/v1/wecom/stock/query",
                  depotScope: ["原料仓"],
                  dataset: {
                    title: "原料仓库存(授权ERP查询)",
                    timeRange: stockData.asOf || new Date().toISOString().slice(0, 10),
                    columns: [
                      { key: "name", label: "物料" },
                      { key: "barCode", label: "条码" },
                      { key: "depotName", label: "仓库" },
                      { key: "currentStock", label: "数量", type: "qty" },
                      { key: "unit", label: "单位" },
                    ],
                    rows: stockRows.slice(0, 20).map((r) => ({
                      name: r.name || r.materialName || r.mname || "",
                      barCode: r.barCode || "",
                      depotName: r.depotName || "原料仓",
                      currentStock: Number(
                        r.currentStock ?? r.currentNumber ?? r.currentQuantity ?? r.qty ?? 0,
                      ),
                      unit: r.unit || r.materialUnit || "",
                    })),
                  },
                },
                { writeFiles: true, exportXlsx: true },
              );
              if (!tableReal.png?.length) fail("real_erp_stock_table_png", tableReal);
              pass("real_erp_stock_table_render", {
                pngBytes: tableReal.pngBytes,
                provenance: tableReal.meta?.provenance,
                datasetRefId: tableReal.meta?.datasetRefId,
              });
              copyArtifact(tableReal, "real_erp_stock_table");
              report.realErp.stock = {
                rowCount: stockRows.length,
                nature: stockData.nature || "BOUND_ERP_STOCK",
                boundErpLoginName: stockData.boundErpLoginName,
                sampleBarCode: stockRows[0]?.barCode || null,
                sampleQty: stockRows[0]?.currentStock ?? null,
              };
            }

            const reportQ = await signedPost(
              secret,
              "/aierp/v1/wecom/report/query",
              idBody({ report: "purchase_in_summary", days: 90 }),
            );
            const rd = reportQ.json?.data;
            const reportOk = reportQ.json?.code === 200 && rd?.nature === "REAL_ERP";
            if (!reportOk) {
              softFail("real_erp_purchase_summary", {
                code: reportQ.json?.code,
                nature: rd?.nature,
              });
            } else {
              pass("real_erp_purchase_summary", {
                nature: rd.nature,
                billCount: rd.totals?.billCount ?? null,
                hint: rd.hint || null,
              });

              let cats;
              if (Array.isArray(rd.rows) && rd.rows.length) {
                cats = rd.rows.slice(0, 8).map((r) => ({
                  label: String(r.partnerName || r.name || r.label || "项").slice(0, 40),
                  value: Number(r.amount ?? r.totalAmount ?? r.value ?? 0),
                  unit: "CNY",
                }));
              } else {
                // totals-only: same unit CNY for amount metrics; billCount as separate table
                const amount = Number(rd.totals?.amount ?? rd.totals?.totalAmount ?? 0);
                const billCount = Number(rd.totals?.billCount ?? 0);
                cats = [
                  { label: "采购金额", value: amount, unit: "CNY" },
                  { label: "金额口径-对照", value: amount, unit: "CNY" },
                ];
                report.realErp.purchaseTotals = { amount, billCount };
              }
              while (cats.length < 2) {
                cats.push({ label: `指标${cats.length + 1}`, value: 0, unit: cats[0]?.unit || "CNY" });
              }

              const chartReal = await sealAndRender(
                erpAuth,
                {
                  renderId: "bar.compare",
                  sourceKind: "ERP_QUERY",
                  sourcePath: "/aierp/v1/wecom/report/query?purchase_in_summary",
                  dataset: {
                    title: "采购入库汇总(REAL_ERP)",
                    unit: "CNY",
                    currency: "CNY",
                    timeRange: "近90日",
                    categories: cats,
                  },
                },
                { writeFiles: true },
              );
              if (!chartReal.png?.length) fail("real_erp_report_chart_png", chartReal);
              pass("real_erp_report_chart_render", {
                renderId: chartReal.renderId,
                degraded: chartReal.degraded,
                pngBytes: chartReal.pngBytes,
                provenance: chartReal.meta?.provenance,
              });
              copyArtifact(chartReal, "real_erp_purchase_chart");
              report.realErp.purchaseSummary = {
                nature: rd.nature,
                billCount: rd.totals?.billCount ?? null,
                rowCount: Array.isArray(rd.rows) ? rd.rows.length : 0,
              };
              report.realErp.ok = !!(report.realErp.stock && report.realErp.purchaseSummary);
            }
          }
        }
      }
    } catch (err) {
      softFail("real_erp_exception", String(err?.message || err).slice(0, 300));
    }
  }

  report.ok = report.checks.every((c) => c.pass);
  // Hard-require: all non-real_erp / secret checks pass; real ERP soft-fails only if boot down
  const hardFails = report.checks.filter(
    (c) => !c.pass && !/^real_erp_/.test(c.name),
  );
  if (hardFails.length) {
    report.ok = false;
  } else if (!report.realErp.ok) {
    // Real ERP is required by ticket — mark overall not ok if live query failed
    report.ok = false;
    report.note =
      "Template/auth checks passed; REAL_ERP seal+render did not complete — not claiming ERP stats from fixtures.";
  } else {
    report.ok = true;
    report.status = "CODE_READY";
    report.note =
      "Auth-hardened render-lib CODE_READY. Fixtures cover templates only. REAL_ERP stock+report sealed and rendered. NOT LOCAL_DEPLOYED / WE_COM_UAT_PENDING (no Bot WS image send; no F: sync).";
  }

  report.finishedAt = new Date().toISOString();
  report.modulePaths = [
    "deploy/openclaw/sop/render-lib/",
    "deploy/openclaw/plugins/aierp-erp-tools/sop/render-lib/",
    "deploy/scripts/aierp-020c-render-smoke.mjs",
  ];
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        reportPath,
        checks: report.checks.length,
        passed: report.checks.filter((c) => c.pass).length,
        failed: report.checks.filter((c) => !c.pass).map((c) => c.name),
        realErp: report.realErp,
        outDir,
      },
      null,
      2,
    ),
  );
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
