/**
 * AIERP-017A: WeCom excel template + preview (no confirm, stock unchanged).
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const WECOM = `aierp017a-${Date.now().toString(36)}`;

function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
      if (line) secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
    }
  }
  if (!secret || secret.length < 32) {
    console.error("AIERP_WECOM_ADAPTER_SECRET required");
    process.exit(2);
  }
  return secret;
}

const SECRET = loadSecret();
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  results.push({ name, ok, detail: typeof detail === "string" ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${JSON.stringify(detail).slice(0, 220)}`);
}
function md5(s) {
  return createHash("md5").update(String(s), "utf8").digest("hex");
}
function mysql(sql) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", "aierp-mysql", "mysql", "-uroot", `-p${MYSQL_ROOT_PASSWORD}`, "-N", "--default-character-set=utf8mb4", "jsh_erp", "-e", sql],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "mysql failed");
  return (r.stdout || "").trim().split(/\r?\n/).filter(Boolean);
}

async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${path}`;
  const payload = `POST\n${uri}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", SECRET).update(payload, "utf8").digest("hex");
  const res = await fetch(`${BASE}${path}`, {
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
    return { status: res.status, raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function login() {
  const res = await fetch(`${BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
  });
  const json = await res.json();
  const token = json?.data?.token || json?.token;
  if (!token) throw new Error("login failed");
  return token;
}

async function claim(token, code) {
  const res = await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "X-Access-Token": token },
    body: JSON.stringify({ bindCode: code }),
  });
  return res.json();
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

function stockOf(barCode, depotId) {
  const row = mysql(
    `SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='${barCode}' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=${depotId} LIMIT 1`,
  )[0];
  return Number(row || 0);
}

async function main() {
  const token = await login();
  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const claimed = await claim(token, issue.json?.data?.bindCode);
  note("fixture_bind", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed?.data?.status);

  const depotId = mysql(`SELECT id FROM jsh_depot WHERE name='原料仓' AND tenant_id=63 LIMIT 1`)[0] || "14";
  const stockBefore = stockOf("RM-A001", depotId);
  const auditedBefore = mysql(
    `SELECT COUNT(*) FROM jsh_depot_head WHERE tenant_id=63 AND status='1' AND IFNULL(delete_flag,'0')<>'1'`,
  )[0];

  // Templates
  for (const scene of ["PURCHASE", "MIX", "SERVICE", "SALE"]) {
    const r = await signedPost("/aierp/v1/wecom/excel/template", idBody({ scene }));
    const ok =
      r.json?.code === 200 &&
      !!r.json?.data?.fileBase64 &&
      r.json.data.fileName?.endsWith(".xlsx") &&
      r.json.data.posted === false;
    note(`template_${scene.toLowerCase()}`, ok, {
      code: r.json?.code,
      fileName: r.json?.data?.fileName,
      confirmSupported: r.json?.data?.confirmSupported,
      bytes: r.json?.data?.byteLength,
    });
    if (scene === "SALE") {
      note("sale_template_only", r.json?.data?.confirmSupported === false, r.json?.data?.confirmSupported);
    }
  }

  // Filled PURCHASE template → preview
  const filled = await signedPost(
    "/aierp/v1/wecom/excel/template",
    idBody({
      scene: "PURCHASE",
      rows: [
        {
          businessKey: `017A-P-${Date.now().toString(36)}`,
          date: "2026-10-21",
          organName: "华东化工",
          barCode: "RM-A001",
          name: "表面活性剂",
          depotName: "原料仓",
          qty: "1",
          unit: "L",
          price: "10",
          remark: "017a-preview-only",
        },
      ],
    }),
  );
  note("template_purchase_filled", filled.json?.code === 200 && !!filled.json?.data?.fileBase64, {
    bytes: filled.json?.data?.byteLength,
  });

  const preview = await signedPost("/aierp/v1/wecom/excel/preview", idBody({
    fileName: filled.json?.data?.fileName || "采购入库模板.xlsx",
    fileBase64: filled.json?.data?.fileBase64,
    fileSha256: createHash("sha256").update(Buffer.from(filled.json?.data?.fileBase64 || "", "base64")).digest("hex"),
    scene: "PURCHASE",
  }));
  const pdata = preview.json?.data;
  note(
    "preview_purchase_ok",
    preview.json?.code === 200 && pdata?.posted === false && pdata?.stockUnchanged === true && !!pdata?.previewId,
    {
      previewId: pdata?.previewId,
      summary: pdata?.summary,
      hintZh: String(pdata?.hintZh || "").slice(0, 160),
      records: Array.isArray(pdata?.records) ? pdata.records.length : 0,
    },
  );

  // MIX / SERVICE filled preview (smoke)
  const mixFilled = await signedPost("/aierp/v1/wecom/excel/template", idBody({
    scene: "MIX",
    rows: [
      {
        businessKey: `017A-M-${Date.now().toString(36)}`,
        date: "2026-10-21",
        finishedCode: "FG-101",
        finishedName: "清洗液",
        finishedQty: "1",
        finishedUnit: "L",
        barCode: "RM-A001",
        name: "表面活性剂",
        qty: "0.1",
        unit: "L",
        remark: "017a-mix-preview",
      },
    ],
  }));
  const mixPrev = await signedPost("/aierp/v1/wecom/excel/preview", idBody({
    fileName: mixFilled.json?.data?.fileName || "mix.xlsx",
    fileBase64: mixFilled.json?.data?.fileBase64,
    scene: "MIX",
  }));
  note("preview_mix_ok", mixPrev.json?.code === 200 && mixPrev.json?.data?.posted === false, {
    code: mixPrev.json?.code,
    previewId: mixPrev.json?.data?.previewId,
    hint: String(mixPrev.json?.data?.hintZh || "").slice(0, 120),
  });

  const svcFilled = await signedPost("/aierp/v1/wecom/excel/template", idBody({
    scene: "SERVICE",
    rows: [
      {
        businessKey: `017A-S-${Date.now().toString(36)}`,
        date: "2026-10-21",
        organName: "苏州精密",
        serviceName: "清洗",
        barCode: "RM-A001",
        name: "表面活性剂",
        qty: "1",
        unit: "L",
        depotName: "原料仓",
        remark: "017a-svc-preview",
      },
    ],
  }));
  const svcPrev = await signedPost("/aierp/v1/wecom/excel/preview", idBody({
    fileName: svcFilled.json?.data?.fileName || "svc.xlsx",
    fileBase64: svcFilled.json?.data?.fileBase64,
    scene: "SERVICE",
  }));
  note("preview_service_ok", svcPrev.json?.code === 200 && svcPrev.json?.data?.posted === false, {
    code: svcPrev.json?.code,
    previewId: svcPrev.json?.data?.previewId,
  });

  // SALE preview should fail or not claim confirmable posting path — template-only scene with SALE sheet may return no purch/mix/service rows
  const saleTpl = await signedPost("/aierp/v1/wecom/excel/template", idBody({ scene: "SALE" }));
  const salePrev = await signedPost("/aierp/v1/wecom/excel/preview", idBody({
    fileName: saleTpl.json?.data?.fileName || "sale.xlsx",
    fileBase64: saleTpl.json?.data?.fileBase64,
    scene: "SALE",
  }));
  note(
    "sale_preview_not_supported",
    salePrev.json?.code !== 200 || /仅模板|没有识别|销售/.test(JSON.stringify(salePrev.json)),
    { code: salePrev.json?.code, msg: salePrev.json?.data || salePrev.json?.message },
  );

  const stockAfter = stockOf("RM-A001", depotId);
  const auditedAfter = mysql(
    `SELECT COUNT(*) FROM jsh_depot_head WHERE tenant_id=63 AND status='1' AND IFNULL(delete_flag,'0')<>'1'`,
  )[0];
  note("stock_unchanged", stockBefore === stockAfter, { stockBefore, stockAfter });
  note("audited_bills_unchanged", auditedBefore === auditedAfter, { auditedBefore, auditedAfter });

  // Confirm endpoint must NOT be exposed on wecom adapter (404/loginOut/forbidden)
  const confirmProbe = await signedPost("/aierp/v1/wecom/excel/confirm", idBody({ previewId: pdata?.previewId }));
  note(
    "wecom_excel_confirm_absent",
    confirmProbe.status === 404 || confirmProbe.json?.code !== 200 || /loginOut|Not Found|404/i.test(JSON.stringify(confirmProbe)),
    { status: confirmProbe.status, code: confirmProbe.json?.code },
  );

  await signedPost("/aierp/v1/wecom/binding/unbind", idBody());

  const out = {
    suite: "aierp-017a-excel-preview-flow",
    at: new Date().toISOString(),
    wecomFixture: WECOM.slice(0, 8) + "***",
    results,
    pass: results.filter((x) => x.ok).length,
    fail: results.filter((x) => !x.ok).length,
  };
  writeFileSync(join(evidenceDir, "aierp-017a-excel-preview-flow.json"), JSON.stringify(out, null, 2));
  if (out.fail) {
    console.error(`FAILED ${out.fail}/${results.length}`);
    process.exit(1);
  }
  console.log(`ALL_PASS ${results.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
