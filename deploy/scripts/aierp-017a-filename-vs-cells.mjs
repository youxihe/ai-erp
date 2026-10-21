/**
 * Non-posting: basename contains ---100L--- but cells qty=20.
 * Assert preview reports 20, workflow blocks prepare, stock unchanged.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const WECOM = `fn20-${Date.now().toString(36)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  results.push({ name, ok, detail: typeof detail === "string" ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = join(__dirname, "..", ".env");
    const line = readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
    secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
  }
  return secret;
}
const SECRET = loadSecret();
function md5(s) {
  return createHash("md5").update(String(s), "utf8").digest("hex");
}
async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${path}`;
  const sig = createHmac("sha256", SECRET).update(`POST\n${uri}\n${ts}\n${nonce}\n${body}`, "utf8").digest("hex");
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
  const json = await res.json();
  return { status: res.status, json };
}
function mysql(sql) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", "aierp-mysql", "mysql", "-uroot", "-paierp_root_change_me", "-N", "jsh_erp", "-e", sql],
    { encoding: "utf8" },
  );
  return (r.stdout || "").trim();
}

const token = (
  await (
    await fetch(`${BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginName: "jsh", password: md5("123456") }),
    })
  ).json()
).data.token;
const issue = await signedPost("/aierp/v1/wecom/binding/issue", { wecomUserId: WECOM, botId: BOT, channel: "wecom" });
await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Access-Token": token },
  body: JSON.stringify({ bindCode: issue.json.data.bindCode }),
});

const stockBefore = Number(mysql(
  "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
) || 0);
const draftsBefore = Number(mysql("SELECT COUNT(*) FROM aierp_wecom_draft WHERE tenant_id=63 AND status='DRAFT'") || 0);

const filled = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: "FN-20",
      date: "2026-10-21",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "20",
      unit: "L",
      price: "12.5",
      remark: "cell-20-not-filename-100",
    },
  ],
});
note("template_20L_cells", filled.json?.code === 200 && !!filled.json?.data?.fileBase64, filled.json?.code);

const trickyName = "采购入库模板---100L---.xlsx";
const bytes = Buffer.from(filled.json.data.fileBase64, "base64");
const outXlsx = join(evidenceDir, trickyName);
writeFileSync(outXlsx, bytes);

const preview = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: trickyName,
  fileBase64: filled.json.data.fileBase64,
  fileSha256: createHash("sha256").update(bytes).digest("hex"),
  messageMsgId: `msg-${Date.now()}`,
  openWorkflow: true,
});
const pdata = preview.json?.data;
const qtyLine = JSON.stringify(pdata?.records || []);
const has20 = qtyLine.includes('"qty":"20"') || qtyLine.includes('"qty":20');
const has100Cell = /"qty"\s*:\s*"?100"?/.test(qtyLine);
note(
  "preview_qty_from_cells_20_not_filename_100",
  preview.json?.code === 200 && !!pdata?.previewId && has20 && !has100Cell,
  { previewId: pdata?.previewId, has20, has100Cell, qtySource: pdata?.qtySource },
);

const wf = await signedPost("/aierp/v1/wecom/excel/workflow/status", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});
note("workflow_blocks_prepare", wf.json?.data?.blocksPurchasePrepare === true && wf.json?.data?.status === "PREVIEWED", wf.json?.data);

const prep = await signedPost("/aierp/v1/wecom/purchase/prepare", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  barCode: "RM-A001",
  qty: 100,
  unit: "L",
  depotName: "原料仓",
  organName: "华东化工",
  idempotencyKey: `evil-filename-${Date.now()}`,
  remark: "must-be-blocked",
});
note(
  "prepare_blocked_while_workflow_open",
  prep.json?.code === 409 || (prep.json?.code !== 200 && /Excel|文件|workflow|409/i.test(JSON.stringify(prep.json))),
  { code: prep.json?.code, msg: prep.json?.data?.message || prep.json?.message },
);

const cancel = await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});
note("workflow_cancel", cancel.json?.code === 200 && cancel.json?.data?.blocksPurchasePrepare === false, cancel.json?.data);

const stockAfter = Number(mysql(
  "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
) || 0);
const draftsAfter = Number(mysql("SELECT COUNT(*) FROM aierp_wecom_draft WHERE tenant_id=63 AND status='DRAFT'") || 0);
note("stock_unchanged", stockBefore === stockAfter, { stockBefore, stockAfter });
note("no_new_draft_from_blocked_prepare", draftsAfter === draftsBefore, { draftsBefore, draftsAfter });

await signedPost("/aierp/v1/wecom/binding/unbind", { wecomUserId: WECOM, botId: BOT, channel: "wecom" });

const out = {
  suite: "aierp-017a-filename-vs-cells",
  at: new Date().toISOString(),
  trickyName,
  previewId: pdata?.previewId || null,
  results,
  pass: results.filter((x) => x.ok).length,
  fail: results.filter((x) => !x.ok).length,
  LIVE_WECOM_FILE_PREVIEW: "PENDING_USER_DM",
  note: "Do not confirm draft #113. Filename ---100L--- must not become qty.",
};
writeFileSync(join(evidenceDir, "aierp-017a-filename-vs-cells.json"), JSON.stringify(out, null, 2));
if (out.fail) {
  console.error(`FAILED ${out.fail}`);
  process.exit(1);
}
console.log(`ALL_PASS ${results.length}`);
