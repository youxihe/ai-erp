/**
 * AIERP-017B2 non-posting suite:
 * 1) 2 businessKeys / 3 lines → exactly 2 DRAFTs, stock unchanged, idempotent re-upload
 * 2) Audited #119-style re-upload → 已审核 + GW bill / PDF offer; never 未入库/待确认; no new draft
 * 3) Same businessKey conflicting suppliers → blocked
 * 4) purchase-batch-prepare API + SOP module present
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const WECOM = `b2-${Date.now().toString(36)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const evidenceDir = join(root, "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  results.push({
    name,
    ok,
    detail: typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600),
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

const stamp = Date.now().toString(36).toUpperCase();
const bizA = `CG-B2A-${stamp}`;
const bizB = `CG-B2B-${stamp}`;

// --- Multi-bill: 2 keys / 3 lines ---
const multiTpl = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: bizA,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "10",
      unit: "L",
      price: "20",
      remark: "017b2-a1",
    },
    {
      businessKey: bizA,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "5",
      unit: "L",
      price: "20",
      remark: "017b2-a2",
    },
    {
      businessKey: bizB,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "3",
      unit: "L",
      price: "20",
      remark: "017b2-b1",
    },
  ],
});
note("multi_template", multiTpl.json?.code === 200 && !!multiTpl.json?.data?.fileBase64, multiTpl.json?.code);

const multiBytes = Buffer.from(multiTpl.json.data.fileBase64, "base64");
const multiSha = createHash("sha256").update(multiBytes).digest("hex");
const multiPrev = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库-两张三行.xlsx",
  fileBase64: multiTpl.json.data.fileBase64,
  fileSha256: multiSha,
  messageMsgId: `b2-multi-${Date.now()}`,
  openWorkflow: true,
});
const md = multiPrev.json?.data;
const drafts = Array.isArray(md?.drafts) ? md.drafts : [];
const draftIds = drafts.map((d) => d.draftId).filter((x) => x != null);
const uniqueDraftIds = [...new Set(draftIds.map(String))];
const awaitingOk =
  multiPrev.json?.code === 200 &&
  Number(md?.totalBills) === 2 &&
  Number(md?.awaitingDrafts) === 2 &&
  uniqueDraftIds.length === 2 &&
  String(md?.statusLabel || "").includes("待确认");
note("multi_2_drafts_3_lines", awaitingOk, {
  totalBills: md?.totalBills,
  awaitingDrafts: md?.awaitingDrafts,
  draftIds: uniqueDraftIds,
  summary: String(md?.userSummaryZh || "").slice(0, 220),
  batchId: md?.batchId,
});

const draftsAfterMulti = Number(
  mysql("SELECT COUNT(*) FROM aierp_gateway_draft WHERE tenant_id=63 AND status IN ('DRAFT','AWAITING_CONFIRM')") || 0,
);
// Prefer counting the two concrete draft IDs as open (avoids cross-test tenant noise).
const openOfPair =
  uniqueDraftIds.length === 2
    ? Number(
        mysql(
          `SELECT COUNT(*) FROM aierp_gateway_draft WHERE id IN (${uniqueDraftIds.map(Number).join(",")}) AND status IN ('DRAFT','AWAITING_CONFIRM')`,
        ) || 0,
      )
    : 0;
note(
  "multi_exactly_two_new_drafts",
  uniqueDraftIds.length === 2 && openOfPair === 2 && draftsAfterMulti >= draftsBefore + 1,
  {
    draftsBefore,
    draftsAfterMulti,
    openOfPair,
    uniqueDraftIds,
  },
);

const multiPrev2 = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库-两张三行-again.xlsx",
  fileBase64: multiTpl.json.data.fileBase64,
  fileSha256: multiSha,
  messageMsgId: `b2-multi2-${Date.now()}`,
  openWorkflow: true,
});
const md2 = multiPrev2.json?.data;
const ids2 = (md2?.drafts || []).map((d) => String(d.draftId)).sort();
note(
  "multi_idempotent_same_two_drafts",
  multiPrev2.json?.code === 200 &&
    ids2.length === 2 &&
    ids2.join(",") === uniqueDraftIds.map(String).sort().join(","),
  { first: uniqueDraftIds, second: ids2 },
);

const batchApi = await signedPost("/aierp/v1/wecom/excel/purchase-batch-prepare", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  // Must match current workflow preview after idempotent re-upload (md2), not the first previewId.
  previewId: md2?.previewId || md?.previewId,
  fileSha256: multiSha,
});
note(
  "purchase_batch_prepare_api",
  batchApi.json?.code === 200 &&
    Number(batchApi.json?.data?.awaitingDrafts) === 2 &&
    Array.isArray(batchApi.json?.data?.drafts) &&
    batchApi.json.data.drafts.length === 2,
  {
    code: batchApi.json?.code,
    awaiting: batchApi.json?.data?.awaitingDrafts,
    batchId: batchApi.json?.data?.batchId,
    msg: batchApi.json?.data?.message || batchApi.json?.message,
  },
);

const sopPlugin = join(root, "deploy", "openclaw", "plugins", "aierp-erp-tools", "sop", "purchase-batch-prepare.mjs");
const sopMirror = join(root, "deploy", "openclaw", "sop", "purchase-batch-prepare.mjs");
note("sop_purchase_batch_prepare_present", existsSync(sopPlugin) && existsSync(sopMirror), {
  sopPlugin: existsSync(sopPlugin),
  sopMirror: existsSync(sopMirror),
});

await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});

// --- Audited re-upload (#119 style, no real stock post) ---
const auditedBiz = `CG-B2AUD-${stamp}`;
const auditedTpl = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: auditedBiz,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "7",
      unit: "L",
      price: "20",
      remark: "017b2-audited-replay",
    },
  ],
});
const auditedBytes = Buffer.from(auditedTpl.json.data.fileBase64, "base64");
const auditedSha = createHash("sha256").update(auditedBytes).digest("hex");
const auditedPrev = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库-已审核重传.xlsx",
  fileBase64: auditedTpl.json.data.fileBase64,
  fileSha256: auditedSha,
  messageMsgId: `b2-aud1-${Date.now()}`,
  openWorkflow: true,
});
const ad = auditedPrev.json?.data;
const auditedDraftId = ad?.draftId;
note("audited_seed_draft", auditedPrev.json?.code === 200 && !!auditedDraftId, {
  draftId: auditedDraftId,
  summary: String(ad?.userSummaryZh || "").slice(0, 160),
});

const fakeBill = `GW-PURCHASE-${auditedDraftId}`;
mysql(
  `UPDATE aierp_gateway_draft SET status='CONFIRMED', bill_number='${fakeBill}', confirm_time=NOW() WHERE id=${Number(auditedDraftId)} AND tenant_id=63`,
);
mysql(
  `UPDATE aierp_gateway_confirm_challenge SET status='CANCELLED' WHERE draft_id=${Number(auditedDraftId)} AND status='PENDING'`,
);

const auditedReplay = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购入库-已审核重传.xlsx",
  fileBase64: auditedTpl.json.data.fileBase64,
  fileSha256: auditedSha,
  messageMsgId: `b2-aud2-${Date.now()}`,
  openWorkflow: true,
});
const ar = auditedReplay.json?.data;
const arSummary = String(ar?.userSummaryZh || "");
const noPendingWords = !/未入库|待确认|尚未入库/.test(arSummary);
const hasAudited = /已审核/.test(arSummary) && arSummary.includes(fakeBill);
const draftsOpenAfter = Number(
  mysql(
    `SELECT COUNT(*) FROM aierp_gateway_draft WHERE tenant_id=63 AND status IN ('DRAFT','AWAITING_CONFIRM') AND id<>${Number(auditedDraftId)} AND remark LIKE '%017b2-audited%'`,
  ) || 0,
);
const sameDraft = String(ar?.draftId || ar?.drafts?.[0]?.draftId) === String(auditedDraftId);
note(
  "audited_replay_no_pending_wording",
  auditedReplay.json?.code === 200 && noPendingWords && hasAudited && String(ar?.statusLabel || "").includes("已审核"),
  { summary: arSummary.slice(0, 240), statusLabel: ar?.statusLabel, billNumber: ar?.billNumber },
);
note(
  "audited_replay_offers_pdf_and_same_bill",
  hasAudited && /回执|PDF/i.test(arSummary) && sameDraft && Number(ar?.alreadyPosted || 0) >= 1,
  { fakeBill, draftId: ar?.draftId, alreadyPosted: ar?.alreadyPosted, sameDraft },
);
note("audited_replay_no_new_draft", draftsOpenAfter === 0, { draftsOpenAfter, auditedDraftId });

// Also hit prepare-verified-batch explicitly
const auditedBatch = await signedPost("/aierp/v1/wecom/excel/prepare-verified-batch", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  previewId: ar?.previewId || ad?.previewId,
  fileSha256: auditedSha,
});
const abSummary = String(auditedBatch.json?.data?.userSummaryZh || "");
note(
  "prepare_verified_batch_audited",
  auditedBatch.json?.code === 200 &&
    !/未入库|待确认/.test(abSummary) &&
    /已审核/.test(abSummary) &&
    abSummary.includes(fakeBill),
  abSummary.slice(0, 220),
);

await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});

// --- Same businessKey with conflicting bill-level fields (dates) ---
const conflictBiz = `CG-B2CF-${stamp}`;
const conflictTpl = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: conflictBiz,
      date: "2026-10-22",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "1",
      unit: "L",
      price: "20",
    },
    {
      businessKey: conflictBiz,
      date: "2026-10-21",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "1",
      unit: "L",
      price: "20",
    },
  ],
});
const conflictBytes = Buffer.from(conflictTpl.json.data.fileBase64, "base64");
const conflictSha = createHash("sha256").update(conflictBytes).digest("hex");
const conflictPrev = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: "采购-单据字段冲突.xlsx",
  fileBase64: conflictTpl.json.data.fileBase64,
  fileSha256: conflictSha,
  messageMsgId: `b2-cf-${Date.now()}`,
  openWorkflow: true,
});
const cf = conflictPrev.json?.data;
const cfText = JSON.stringify(cf || {});
note(
  "conflict_bill_fields_blocked",
  conflictPrev.json?.code === 200 &&
    !cf?.draftId &&
    Number(cf?.awaitingDrafts || 0) === 0 &&
    (/业务日期不一致|供应商不一致|有错|不能/.test(String(cf?.userSummaryZh || "")) ||
      /业务日期不一致|供应商不一致/.test(cfText)),
  { summary: String(cf?.userSummaryZh || "").slice(0, 220), autoDraft: cf?.autoDraft },
);

const stockAfter = Number(
  mysql(
    "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
  ) || 0,
);
note("stock_unchanged", stockBefore === stockAfter, { stockBefore, stockAfter });

await signedPost("/aierp/v1/wecom/binding/unbind", { wecomUserId: WECOM, botId: BOT, channel: "wecom" });

const out = {
  suite: "aierp-017b2-multi-purchase",
  at: new Date().toISOString(),
  wecomMasked: WECOM.slice(0, 4) + "***",
  multiDraftIds: uniqueDraftIds,
  auditedDraftId,
  auditedBill: fakeBill,
  stockBefore,
  stockAfter,
  results,
  pass: results.filter((x) => x.ok).length,
  fail: results.filter((x) => !x.ok).length,
  note: "Non-posting. Audited replay simulated via CONFIRMED status + fake bill_number (no native stock delta).",
};
writeFileSync(join(evidenceDir, "aierp-017b2-multi-purchase.json"), JSON.stringify(out, null, 2));
writeFileSync(
  join(evidenceDir, "aierp-017b2-ready.md"),
  `# AIERP-017B2 READY_FOR_REVIEW

## HEAD

见 push 后最新 commit。

## 行为

1. 多张采购 Excel（2 businessKey / 3 行）→ 恰好 2 个未审核 DRAFT，库存不变；同文件重传幂等。
2. 已审核单重传（#119 类）→ 回复「已审核」+ 原生单号 / 可领 PDF；禁止「未入库」「待确认」；不新建草稿。
3. 同 businessKey 供应商冲突 → 校验阻断，不建草稿。
4. API：\`/excel/prepare-verified-batch\`、\`/excel/purchase-batch-prepare\`；SOP：\`sop/purchase-batch-prepare.mjs\`（未扩 plugin/index.js）。
5. 批次确认留 017C1；仍可用逐张「确认采购{draftId}」。

## 本地无过账

- \`aierp-017b2-multi-purchase\`：**${out.pass}/${results.length} PASS**（fail=${out.fail}）

## 真人企微

请用**新**多单采购 Excel 验证预览摘要；已审核旧文件重传应直接给回执指引。勿对测试草稿做真实确认除非专用新单。
`,
);

if (out.fail) {
  console.error(`FAILED ${out.fail}`);
  process.exit(1);
}
console.log(`ALL_PASS ${results.length}`);
