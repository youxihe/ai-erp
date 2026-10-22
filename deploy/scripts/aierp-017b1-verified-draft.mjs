/**
 * AIERP-017B1 non-posting: single PURCHASE Excel → server draft from cells (80L),
 * idempotent re-upload, verbal prepare blocked, cancel cleans draft. No confirm/post.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const WECOM = `b1-${Date.now().toString(36)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  results.push({
    name,
    ok,
    detail: typeof detail === "string" ? detail.slice(0, 500) : JSON.stringify(detail).slice(0, 500),
  });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = join(__dirname, "..", ".env");
    const line = readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}
function mysql(sql) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", "aierp-mysql", "mysql", "-uroot", "-paierp_root_change_me", "-N", "--default-character-set=utf8mb4", "jsh_erp", "-e", sql],
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

const stockBefore = Number(
  mysql(
    "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
  ) || 0,
);
const draftsBefore = Number(
  mysql("SELECT COUNT(*) FROM aierp_gateway_draft WHERE tenant_id=63 AND status IN ('DRAFT','AWAITING_CONFIRM')") || 0,
);

const bizKey = `CG-B1-${Date.now().toString(36).toUpperCase()}`;
const filled = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: bizKey,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "80",
      unit: "L",
      price: "20",
      remark: "017b1-cell-80L",
    },
  ],
});
note("template_80L", filled.json?.code === 200 && !!filled.json?.data?.fileBase64, filled.json?.code);

const bytes = Buffer.from(filled.json.data.fileBase64, "base64");
const fileSha256 = createHash("sha256").update(bytes).digest("hex");
const preview1 = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库模板---20L-chat---.xlsx",
  fileBase64: filled.json.data.fileBase64,
  fileSha256,
  messageMsgId: `msg1-${Date.now()}`,
  openWorkflow: true,
});
const d1 = preview1.json?.data;
const summary = String(d1?.userSummaryZh || "");
const draftId1 = d1?.draftId;
const qtyOk = summary.includes("80") && !/\b20\s*L\b/.test(summary.replace(/2026-10-22/g, ""));
note(
  "preview_auto_draft_80L_not_filename_or_chat_20",
  preview1.json?.code === 200 && !!d1?.previewId && !!draftId1 && qtyOk && summary.includes(`确认采购${draftId1}`),
  { draftId: draftId1, businessKey: d1?.businessKey, summary: summary.slice(0, 220), qtyOk },
);
note(
  "businessKey_not_used_as_draftId",
  String(draftId1).match(/^\d+$/) && String(d1?.businessKey || "").startsWith("CG-"),
  { draftId: draftId1, businessKey: d1?.businessKey },
);
note(
  "summary_no_tech_jargon",
  !!summary && !/previewId|canConfirm|status=PREVIEWED|posted=false/i.test(summary),
  summary.slice(0, 180),
);

const wf = await signedPost("/aierp/v1/wecom/excel/workflow/status", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});
note(
  "workflow_draft_ready",
  wf.json?.data?.status === "DRAFT_READY" && String(wf.json?.data?.draftId) === String(draftId1),
  wf.json?.data,
);

const prep = await signedPost("/aierp/v1/wecom/purchase/prepare", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  barCode: "RM-A001",
  qty: 20,
  unit: "L",
  depotName: "原料仓",
  organName: "华东化工",
  idempotencyKey: `evil-verbal-${Date.now()}`,
  remark: "must-block",
  excelWorkflowCancel: true,
});
note(
  "verbal_prepare_blocked_while_excel_draft",
  prep.json?.code === 409 || prep.json?.code !== 200,
  { code: prep.json?.code, msg: prep.json?.data?.message || prep.json?.message },
);

const preview2 = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库模板-again.xlsx",
  fileBase64: filled.json.data.fileBase64,
  fileSha256,
  messageMsgId: `msg2-${Date.now()}`,
  openWorkflow: true,
});
const d2 = preview2.json?.data;
note(
  "same_file_idempotent_same_draft",
  preview2.json?.code === 200 && String(d2?.draftId) === String(draftId1),
  { draftId1, draftId2: d2?.draftId, replayed: d2?.replayed },
);

// Changed qty 80 → 50 must invalidate old draft and create new
const filled2 = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: `${bizKey}-V2`,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "50",
      unit: "L",
      price: "20",
    },
  ],
});
const bytes2 = Buffer.from(filled2.json.data.fileBase64, "base64");
const sha2 = createHash("sha256").update(bytes2).digest("hex");
const preview3 = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库模板-50L.xlsx",
  fileBase64: filled2.json.data.fileBase64,
  fileSha256: sha2,
  messageMsgId: `msg3-${Date.now()}`,
  openWorkflow: true,
});
const d3 = preview3.json?.data;
note(
  "changed_file_new_draft_invalidates_old",
  preview3.json?.code === 200 &&
    !!d3?.draftId &&
    String(d3.draftId) !== String(draftId1) &&
    String(d3.userSummaryZh || "").includes("50"),
  { old: draftId1, neu: d3?.draftId, summary: String(d3?.userSummaryZh || "").slice(0, 160) },
);

const oldStatus = await signedPost("/aierp/v1/wecom/draft/status", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  draftId: draftId1,
});
note(
  "old_draft_cancelled_after_file_change",
  oldStatus.json?.code === 200 && String(oldStatus.json?.data?.status) === "CANCELLED",
  oldStatus.json?.data,
);

await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});

const stockAfter = Number(
  mysql(
    "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
  ) || 0,
);
note("stock_unchanged", stockBefore === stockAfter, { stockBefore, stockAfter });

let noConfirmOk = true;
try {
  const noConfirmRoute = await signedPost("/aierp/v1/wecom/excel/confirm", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
    previewId: d1?.previewId,
  });
  noConfirmOk =
    noConfirmRoute.status === 404 ||
    noConfirmRoute.json?.code === 404 ||
    noConfirmRoute.status === 500 ||
    noConfirmRoute.json?.code !== 200;
} catch {
  noConfirmOk = true; // non-JSON / loginOut / missing route
}
note("excel_confirm_not_exposed", noConfirmOk, "route absent or rejected");

await signedPost("/aierp/v1/wecom/binding/unbind", { wecomUserId: WECOM, botId: BOT, channel: "wecom" });

const out = {
  suite: "aierp-017b1-verified-draft",
  at: new Date().toISOString(),
  wecomMasked: WECOM.slice(0, 4) + "***",
  draftId: draftId1,
  businessKey: bizKey,
  stockBefore,
  stockAfter,
  results,
  pass: results.filter((x) => x.ok).length,
  fail: results.filter((x) => !x.ok).length,
  note: "No posting. Do not confirm #113. Live WeCom confirm uses a fresh dedicated draft.",
};
writeFileSync(join(evidenceDir, "aierp-017b1-verified-draft.json"), JSON.stringify(out, null, 2));
if (out.fail) {
  console.error(`FAILED ${out.fail}`);
  process.exit(1);
}
console.log(`ALL_PASS ${results.length}`);
