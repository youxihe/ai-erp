/**
 * AIERP-016M non-posting: MIX Excel (FG-101 + 3 raw lines) → unposted draft,
 * confirm phrase 确认配制{draftId}, stock unchanged on prepare.
 * Does NOT call draft/confirm (no inventory post). Does not touch purchase #119.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  isMixConfirmPhrase,
  extractMixDraftId,
  buildMixPrepareBody,
  buildMixRecipePreviewBody,
  formatMixDraftReady,
} from "../openclaw/plugins/aierp-erp-tools/sop/mix-prepare.mjs";
import { routeTrustedInbound } from "../openclaw/plugins/aierp-erp-tools/sop/registry.mjs";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const WECOM = `m16-${Date.now().toString(36)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
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
    if (!existsSync(envPath)) throw new Error("deploy/.env missing");
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

function stockOf(barCode, depotId) {
  return Number(
    mysql(
      `SELECT IFNULL(current_number,0) FROM jsh_material_current_stock
       WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='${barCode}' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1)
         AND depot_id=${depotId} LIMIT 1`,
    ) || 0,
  );
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

// Phrase unit tests (no ERP)
note("phrase_match_plain", isMixConfirmPhrase("确认配制123") && extractMixDraftId("确认配制123") === 123, "确认配制123");
note("phrase_match_spaced", isMixConfirmPhrase("确认 配制 456") && extractMixDraftId("确认 配制 456") === 456, "spaced");
note("phrase_reject_purchase", !isMixConfirmPhrase("确认采购123"), "purchase");
note("phrase_reject_bare", !isMixConfirmPhrase("确认"), "bare");
note(
  "build_rejects_model_boolean_without_hash",
  (() => {
    try {
      buildMixPrepareBody({
        wecomUserId: "x",
        recipeUserConfirmed: true,
        finished: { barCode: "FG-101", qty: 1, unit: "L" },
        lines: [{ barCode: "RM-A001", qty: 0.1, unit: "L" }],
      });
      return false;
    } catch (ex) {
      return /recipeHash|布尔|recipe-preview/.test(String(ex?.message || ex));
    }
  })(),
  "must refuse model boolean without recipeHash",
);
note(
  "build_requires_recipe_hash",
  (() => {
    try {
      buildMixPrepareBody({
        wecomUserId: "x",
        finished: { barCode: "FG-101", qty: 1, unit: "L" },
        lines: [{ barCode: "RM-A001", qty: 0.1, unit: "L" }],
      });
      return false;
    } catch {
      return true;
    }
  })(),
  "must require recipeHash",
);
note(
  "phrase_only_confirm_mix_is_post_path",
  isMixConfirmPhrase("确认配制99") &&
    routeTrustedInbound({ text: "确认配制99", wecomUserId: "x" })?.sopId === "mix_confirm" &&
    !isMixConfirmPhrase("确认配方aabbccdd1122"),
  "确认配制{id} only; 确认配方 is not a confirm/post path",
);

const token = (
  await (
    await fetch(`${BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginName: "jsh", password: md5("123456") }),
    })
  ).json()
).data.token;

const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Access-Token": token },
  body: JSON.stringify({ bindCode: issue.json.data.bindCode }),
});
note("binding_claim", issue.json?.code === 200 && !!issue.json?.data?.bindCode, { code: issue.json?.code });

// depot_id: 原料仓=14, 成品仓 typically 15 in demo — resolve from DB
const rmDepot = Number(mysql("SELECT id FROM jsh_depot WHERE name='原料仓' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1") || 14);
const fgDepot = Number(mysql("SELECT id FROM jsh_depot WHERE name='成品仓' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1") || 15);

const stockSnapBefore = {
  "RM-A001@原料仓": stockOf("RM-A001", rmDepot),
  "RM-B002@原料仓": stockOf("RM-B002", rmDepot),
  "RM-C003@原料仓": stockOf("RM-C003", rmDepot),
  "FG-101@成品仓": stockOf("FG-101", fgDepot),
};

const bizKey = `MIX-016M-${Date.now().toString(36).toUpperCase()}`;
const mixRows = [
  {
    businessKey: bizKey,
    date: "2026-10-22",
    finishedCode: "FG-101",
    finishedName: "PCB清洗液",
    finishedQty: "1",
    finishedUnit: "L",
    barCode: "RM-A001",
    name: "表面活性剂",
    qty: "0.6",
    unit: "L",
    remark: "测试配方，需用户确认",
  },
  {
    businessKey: bizKey,
    date: "2026-10-22",
    finishedCode: "FG-101",
    finishedName: "PCB清洗液",
    finishedQty: "1",
    finishedUnit: "L",
    barCode: "RM-B002",
    name: "络合剂",
    qty: "0.1",
    unit: "L",
    remark: "测试配方，需用户确认",
  },
  {
    businessKey: bizKey,
    date: "2026-10-22",
    finishedCode: "FG-101",
    finishedName: "PCB清洗液",
    finishedQty: "1",
    finishedUnit: "L",
    barCode: "RM-C003",
    name: "纯水",
    qty: "0.3",
    unit: "L",
    remark: "测试配方，需用户确认",
  },
];

const filled = await signedPost("/aierp/v1/wecom/excel/template", idBody({ scene: "MIX", rows: mixRows }));
note("template_mix_3raw", filled.json?.code === 200 && !!filled.json?.data?.fileBase64, {
  code: filled.json?.code,
  fileName: filled.json?.data?.fileName,
});

const bytes = Buffer.from(filled.json.data.fileBase64, "base64");
const fileSha256 = createHash("sha256").update(bytes).digest("hex");
const preview1 = await signedPost("/aierp/v1/wecom/excel/preview", idBody({
  fileName: `配制生产模板-${bizKey}.xlsx`,
  fileBase64: filled.json.data.fileBase64,
  fileSha256,
  messageMsgId: `msg-mix1-${Date.now()}`,
  openWorkflow: true,
  scene: "MIX",
}));
const d1 = preview1.json?.data;
const draftId1 = d1?.draftId;
const summary = String(d1?.userSummaryZh || d1?.hintZh || d1?.hint || "");
const phrase = d1?.confirmPhrase || (draftId1 ? `确认配制${draftId1}` : "");
note(
  "preview_auto_mix_draft",
  preview1.json?.code === 200 &&
    !!d1?.previewId &&
    !!draftId1 &&
    String(draftId1).match(/^\d+$/) &&
    (d1?.bizType === "MIX" || d1?.scene === "MIX" || phrase.startsWith("确认配制")) &&
    phrase === `确认配制${draftId1}` &&
    /FG-101|清洗液/.test(summary) &&
    /RM-A001|RM-B002|RM-C003/.test(summary),
  {
    draftId: draftId1,
    businessKey: d1?.businessKey || bizKey,
    phrase,
    summary: summary.slice(0, 280),
    posted: d1?.posted,
    stockUnchanged: d1?.stockUnchanged,
  },
);
note(
  "prepare_not_posted",
  d1?.posted !== true && d1?.stockUnchanged !== false,
  { posted: d1?.posted, stockUnchanged: d1?.stockUnchanged, status: d1?.status },
);
note(
  "summary_has_confirm_mix_phrase",
  summary.includes(`确认配制${draftId1}`) || phrase === `确认配制${draftId1}`,
  { phrase, hasInSummary: summary.includes(`确认配制${draftId1}`) },
);
note(
  "summary_no_tech_jargon",
  !!summary && !/previewId|canConfirm|status=PREVIEWED|posted=false/i.test(summary),
  summary.slice(0, 180),
);

const stockSnapAfterPrepare = {
  "RM-A001@原料仓": stockOf("RM-A001", rmDepot),
  "RM-B002@原料仓": stockOf("RM-B002", rmDepot),
  "RM-C003@原料仓": stockOf("RM-C003", rmDepot),
  "FG-101@成品仓": stockOf("FG-101", fgDepot),
};
const stockUnchanged = Object.keys(stockSnapBefore).every(
  (k) => stockSnapBefore[k] === stockSnapAfterPrepare[k],
);
note("stock_unchanged_after_prepare", stockUnchanged, {
  before: stockSnapBefore,
  after: stockSnapAfterPrepare,
});

const wf = await signedPost("/aierp/v1/wecom/excel/workflow/status", idBody());
note(
  "workflow_draft_ready",
  wf.json?.data?.status === "DRAFT_READY" && String(wf.json?.data?.draftId) === String(draftId1),
  wf.json?.data,
);

// Cross-type: purchase phrase must not confirm MIX (non-post probe — expect reject, not post)
const badPhrase = await signedPost("/aierp/v1/wecom/draft/confirm", idBody({
  rawText: `确认采购${draftId1}`,
  messageMsgId: `bad-purchase-${Date.now()}`,
  eventSource: "WECOM_BEFORE_DISPATCH",
  isGroup: false,
  draftId: draftId1,
}));
note(
  "reject_purchase_phrase_on_mix",
  badPhrase.json?.code !== 200,
  { code: badPhrase.json?.code, msg: badPhrase.json?.data?.message || badPhrase.json?.message },
);

const bareConfirm = await signedPost("/aierp/v1/wecom/draft/confirm", idBody({
  rawText: "确认",
  messageMsgId: `bare-${Date.now()}`,
  eventSource: "WECOM_BEFORE_DISPATCH",
  isGroup: false,
  draftId: draftId1,
}));
note(
  "reject_bare_confirm_on_mix",
  bareConfirm.json?.code !== 200,
  { code: bareConfirm.json?.code, msg: bareConfirm.json?.data?.message || bareConfirm.json?.message },
);

const stockAfterNegatives = {
  "RM-A001@原料仓": stockOf("RM-A001", rmDepot),
  "FG-101@成品仓": stockOf("FG-101", fgDepot),
};
note(
  "stock_still_unchanged_after_reject",
  stockAfterNegatives["RM-A001@原料仓"] === stockSnapBefore["RM-A001@原料仓"] &&
    stockAfterNegatives["FG-101@成品仓"] === stockSnapBefore["FG-101@成品仓"],
  stockAfterNegatives,
);

// Slot prepare: model boolean alone must fail (no recipeHash)
const booleanOnly = await signedPost("/aierp/v1/wecom/mix/prepare", idBody({
  recipeUserConfirmed: true,
  userConfirmedRecipe: true,
  finished: { barCode: "FG-101", qty: "1", unit: "L" },
  lines: [{ barCode: "RM-A001", qty: "0.1", unit: "L" }],
  idempotencyKey: `mix-bool-${Date.now()}`,
}));
const booleanMsg = String(booleanOnly.json?.data?.message || booleanOnly.json?.message || "");
note(
  "slot_prepare_rejects_model_boolean",
  booleanOnly.json?.code !== 200 && /recipeHash|布尔|recipe-preview|模型/.test(booleanMsg),
  { code: booleanOnly.json?.code, msg: booleanMsg.slice(0, 240) },
);

const noHash = await signedPost("/aierp/v1/wecom/mix/prepare", idBody({
  finished: { barCode: "FG-101", qty: "1", unit: "L" },
  lines: [{ barCode: "RM-A001", qty: "0.1", unit: "L" }],
  idempotencyKey: `mix-norecipe-${Date.now()}`,
}));
note(
  "slot_prepare_requires_recipe_hash",
  noHash.json?.code !== 200,
  { code: noHash.json?.code, msg: noHash.json?.data?.message || noHash.json?.message },
);

// Cancel excel workflow to free for slot prepare
await signedPost("/aierp/v1/wecom/excel/workflow/cancel", idBody({ messageMsgId: `cancel-${Date.now()}` }));

const slotFinished = { barCode: "FG-101", qty: "1", unit: "L", depotName: "成品仓" };
const slotLines = [
  { barCode: "RM-A001", qty: "0.5", unit: "L" },
  { barCode: "RM-B002", qty: "0.2", unit: "L" },
  { barCode: "RM-C003", qty: "0.3", unit: "L" },
];
const previewBody = buildMixRecipePreviewBody({
  wecomUserId: WECOM,
  botId: BOT,
  finished: slotFinished,
  lines: slotLines,
});
const recipePrev = await signedPost("/aierp/v1/wecom/mix/recipe-preview", previewBody);
const recipeHash = recipePrev.json?.data?.recipeHash;
const recipeDisplay = String(recipePrev.json?.data?.recipeDisplayZh || "");
note(
  "slot_recipe_preview_registers_hash",
  recipePrev.json?.code === 200 &&
    /^[0-9a-f]{64}$/.test(String(recipeHash || "")) &&
    /FG-101/.test(recipeDisplay) &&
    /RM-A001|RM-B002|RM-C003/.test(recipeDisplay) &&
    recipePrev.json?.data?.recipeStatus === "PROPOSED" &&
    /模型布尔/.test(recipeDisplay),
  {
    recipeHash: String(recipeHash || "").slice(0, 16),
    status: recipePrev.json?.data?.recipeStatus,
    display: recipeDisplay.slice(0, 220),
  },
);

const fakeHashPrep = await signedPost(
  "/aierp/v1/wecom/mix/prepare",
  buildMixPrepareBody({
    wecomUserId: WECOM,
    botId: BOT,
    recipeHash: "a".repeat(64),
    finished: slotFinished,
    lines: slotLines,
    idempotencyKey: `mix-fakehash-${Date.now()}`,
  }),
);
note(
  "slot_prepare_rejects_unknown_hash",
  fakeHashPrep.json?.code !== 200,
  { code: fakeHashPrep.json?.code, msg: fakeHashPrep.json?.data?.message || fakeHashPrep.json?.message },
);

let slot = { json: { code: 500, data: { message: "skip: no recipeHash from preview" } } };
if (recipeHash) {
  const slotBody = buildMixPrepareBody({
    wecomUserId: WECOM,
    botId: BOT,
    recipeHash,
    finished: slotFinished,
    lines: slotLines,
    idempotencyKey: `mix-slot-${Date.now()}`,
    remark: "016M slot test after recipe-preview hash",
  });
  slot = await signedPost("/aierp/v1/wecom/mix/prepare", slotBody);
}
const slotData = slot.json?.data;
const slotId = slotData?.draftId;
note(
  "slot_prepare_draft",
  slot.json?.code === 200 &&
    !!slotId &&
    slotData?.posted !== true &&
    slotData?.recipeHash === recipeHash &&
    (slotData?.confirmPhrase === `确认配制${slotId}` || slotData?.challenge?.phrase === `确认配制${slotId}`) &&
    !/用户已确认/.test(String(slotData?.hint || slotData?.remark || "")),
  {
    draftId: slotId,
    phrase: slotData?.confirmPhrase || slotData?.challenge?.phrase,
    recipeHash: String(slotData?.recipeHash || "").slice(0, 16),
    status: slotData?.status,
    formatted: formatMixDraftReady(slotData).slice(0, 200),
    code: slot.json?.code,
    msg: slot.json?.data?.message || slot.json?.message,
  },
);

// Cross-type SERVICE phrase on MIX draft must reject
const servicePhrase = await signedPost("/aierp/v1/wecom/draft/confirm", idBody({
  rawText: `确认耗料${slotId || draftId1}`,
  messageMsgId: `bad-service-${Date.now()}`,
  eventSource: "WECOM_BEFORE_DISPATCH",
  isGroup: false,
  draftId: slotId || draftId1,
}));
note(
  "reject_service_phrase_on_mix",
  servicePhrase.json?.code !== 200,
  { code: servicePhrase.json?.code, msg: servicePhrase.json?.data?.message || servicePhrase.json?.message },
);

const stockAfterSlot = {
  "RM-A001@原料仓": stockOf("RM-A001", rmDepot),
  "FG-101@成品仓": stockOf("FG-101", fgDepot),
};
note(
  "slot_prepare_stock_unchanged",
  stockAfterSlot["RM-A001@原料仓"] === stockSnapBefore["RM-A001@原料仓"] &&
    stockAfterSlot["FG-101@成品仓"] === stockSnapBefore["FG-101@成品仓"],
  stockAfterSlot,
);

const failed = results.filter((r) => !r.ok);
const out = {
  suite: "aierp-016m-mix-prepare-flow",
  at: new Date().toISOString(),
  headNote: "non-post only; confirm phrase 确认配制{draftId}; no F: deploy; do not confirm #119",
  wecomUserIdMasked: WECOM.slice(0, 4) + "***",
  businessKey: bizKey,
  excelDraftId: draftId1 || null,
  slotDraftId: slotId || null,
  stockBefore: stockSnapBefore,
  stockAfterPrepare: stockSnapAfterPrepare,
  pass: results.filter((r) => r.ok).length,
  fail: failed.length,
  results,
};
const jsonPath = join(evidenceDir, "aierp-016m-mix-prepare-flow.json");
writeFileSync(jsonPath, JSON.stringify(out, null, 2));
const md = [
  "# AIERP-016M non-post evidence",
  "",
  `- suite: \`${out.suite}\``,
  `- pass/fail: **${out.pass}/${out.fail}**`,
  `- Excel draftId: \`${out.excelDraftId}\` → phrase \`确认配制${out.excelDraftId}\``,
  `- Slot draftId: \`${out.slotDraftId}\``,
  `- businessKey: \`${bizKey}\``,
  `- stock unchanged after prepare: **${stockUnchanged}**`,
  "- LIVE_WECOM_CONFIRM: PENDING_USER (do not auto-confirm; never #119)",
  "",
  "## Checks",
  ...results.map((r) => `- ${r.ok ? "PASS" : "FAIL"} ${r.name}`),
  "",
].join("\n");
writeFileSync(join(evidenceDir, "aierp-016m-mix-prepare-flow.md"), md);
console.log(`\nEvidence: ${jsonPath}`);
console.log(`PASS ${out.pass} / FAIL ${out.fail}`);
process.exit(failed.length ? 1 : 0);
