/**
 * AIERP-016M non-post: 1 MIX bill × 3 raw materials → FG-101 1 L DRAFT.
 * Stock unchanged on prepare; insufficient stock fails; replay idempotent;
 * never auto-confirm purchase #119. Confirm path is NOT exercised here.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  routeTrustedInbound,
  isMixConfirmPhrase,
} from "../openclaw/plugins/aierp-erp-tools/sop/registry.mjs";
import {
  extractMixDraftId,
  buildMixPrepareBody,
  buildMixRecipePreviewBody,
} from "../openclaw/plugins/aierp-erp-tools/sop/mix-prepare.mjs";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const WECOM = `m16-${Date.now().toString(36)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
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

function stockOf(barCode, depotId) {
  return Number(
    mysql(
      `SELECT IFNULL(current_number,0) FROM jsh_material_current_stock
       WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='${barCode}' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1)
         AND depot_id=${depotId} LIMIT 1`,
    ) || 0,
  );
}

// --- unit: confirm phrase / registry (no ERP) ---
note("unit_mix_confirm_phrase", isMixConfirmPhrase("确认配制42") && extractMixDraftId("确认配制42") === 42, {});
note("unit_not_purchase_as_mix", !isMixConfirmPhrase("确认采购119"), {});
note(
  "unit_registry_routes_mix_confirm",
  routeTrustedInbound({ text: "确认配制99", wecomUserId: "x" })?.sopId === "mix_confirm",
  {},
);
note(
  "unit_registry_purchase_still",
  routeTrustedInbound({
    text: "确认采购119",
    wecomUserId: "x",
    isConfirmPhrase: (t) => /^\s*确认\s*采购/.test(t),
  })?.sopId === "purchase_confirm",
  {},
);
note(
  "unit_model_boolean_alone_rejected",
  (() => {
    try {
      buildMixPrepareBody({
        wecomUserId: "x",
        recipeUserConfirmed: true,
        userConfirmedRecipe: true,
        finished: { barCode: "FG-101", qty: 1, unit: "L" },
        lines: [{ barCode: "RM-A001", qty: 0.1, unit: "L" }],
      });
      return false;
    } catch (ex) {
      const msg = String(ex?.message || ex);
      return /recipeHash|布尔|recipe-preview/.test(msg) && !/用户已确认/.test(msg);
    }
  })(),
  "model boolean must not skip recipeHash / must not claim 用户已确认",
);

const purchase119Before = mysql(
  "SELECT status, number FROM jsh_depot_head WHERE number='GW-PURCHASE-119' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
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

const issue = await signedPost("/aierp/v1/wecom/binding/issue", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});
await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Access-Token": token },
  body: JSON.stringify({ bindCode: issue.json.data.bindCode }),
});

const DEPOT_RM = 14; // 原料仓 (demo)
const DEPOT_FG = 15; // 成品仓 (demo) — verify below
const depotRmId = Number(
  mysql("SELECT id FROM jsh_depot WHERE name='原料仓' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1") || DEPOT_RM,
);
const depotFgId = Number(
  mysql("SELECT id FROM jsh_depot WHERE name='成品仓' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1") || DEPOT_FG,
);

const stockBefore = {
  "RM-A001": stockOf("RM-A001", depotRmId),
  "RM-B002": stockOf("RM-B002", depotRmId),
  "RM-C003": stockOf("RM-C003", depotRmId),
  "FG-101": stockOf("FG-101", depotFgId),
};

// User-confirmed test formula (not chemistry invention): FG-101 1 L from 0.6/0.1/0.3 L
const bizKey = `PZ-016M-${Date.now().toString(36).toUpperCase()}`;
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

const filled = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "MIX",
  rows: mixRows,
});
note("template_mix_3_raw_fg101", filled.json?.code === 200 && !!filled.json?.data?.fileBase64, {
  code: filled.json?.code,
  scene: filled.json?.data?.scene,
});

const bytes = Buffer.from(filled.json.data.fileBase64, "base64");
const fileSha256 = createHash("sha256").update(bytes).digest("hex");
const preview1 = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "MIX",
  fileName: "配制生产模板.xlsx",
  fileBase64: filled.json.data.fileBase64,
  fileSha256,
  messageMsgId: `mix-msg1-${Date.now()}`,
  openWorkflow: true,
});
const d1 = preview1.json?.data;
const draftId1 = d1?.draftId;
const summary = String(d1?.userSummaryZh || d1?.hintZh || "");
note(
  "preview_auto_mix_draft",
  preview1.json?.code === 200 &&
    !!draftId1 &&
    d1?.bizType === "MIX" &&
    String(d1?.confirmPhrase || "").includes(`确认配制${draftId1}`) &&
    summary.includes("确认配制") &&
    !/用户已确认/.test(summary) &&
    !!d1?.recipeHash,
  {
    draftId: draftId1,
    confirmPhrase: d1?.confirmPhrase,
    recipeHash: String(d1?.recipeHash || "").slice(0, 16),
    summary: summary.slice(0, 280),
  },
);
note(
  "one_bill_three_raw_lines",
  Number(d1?.summary?.rawLineCount) === 3 || summary.includes("RM-A001"),
  { rawLineCount: d1?.summary?.rawLineCount, businessKey: d1?.businessKey },
);
note("posted_false_on_prepare", d1?.posted === false && d1?.stockUnchanged !== false, {
  posted: d1?.posted,
  stockUnchanged: d1?.stockUnchanged,
});

const stockAfterPrepare = {
  "RM-A001": stockOf("RM-A001", depotRmId),
  "RM-B002": stockOf("RM-B002", depotRmId),
  "RM-C003": stockOf("RM-C003", depotRmId),
  "FG-101": stockOf("FG-101", depotFgId),
};
note(
  "prepare_stock_unchanged",
  JSON.stringify(stockBefore) === JSON.stringify(stockAfterPrepare),
  { stockBefore, stockAfterPrepare },
);

const preview2 = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "MIX",
  fileName: "配制生产模板-again.xlsx",
  fileBase64: filled.json.data.fileBase64,
  fileSha256,
  messageMsgId: `mix-msg2-${Date.now()}`,
  openWorkflow: true,
});
const d2 = preview2.json?.data;
note(
  "replay_idempotent_same_draft",
  preview2.json?.code === 200 && String(d2?.draftId) === String(draftId1),
  { draftId1, draftId2: d2?.draftId, replayed: d2?.replayed },
);

const stockAfterReplay = {
  "RM-A001": stockOf("RM-A001", depotRmId),
  "FG-101": stockOf("FG-101", depotFgId),
};
note(
  "replay_stock_still_unchanged",
  stockAfterReplay["RM-A001"] === stockBefore["RM-A001"] && stockAfterReplay["FG-101"] === stockBefore["FG-101"],
  stockAfterReplay,
);

// Model boolean alone must fail with recipeHash message even while Excel DRAFT_READY is open
const boolWhileOpen = await signedPost("/aierp/v1/wecom/mix/prepare", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  recipeUserConfirmed: true,
  userConfirmedRecipe: true,
  idempotencyKey: `mix-bool-open-${Date.now()}`,
  finished: { barCode: "FG-101", qty: "1", unit: "L", depotName: "成品仓" },
  lines: [{ barCode: "RM-A001", qty: "0.1", unit: "L", depotName: "原料仓" }],
});
const boolOpenMsg = String(boolWhileOpen.json?.data?.message || boolWhileOpen.json?.message || "");
note(
  "refuse_model_boolean_while_excel_draft_open",
  boolWhileOpen.json?.code !== 200 &&
    /recipeHash|布尔|recipe-preview|模型/.test(boolOpenMsg) &&
    !/用户已确认/.test(boolOpenMsg) &&
    !/待确认草稿/.test(boolOpenMsg),
  { code: boolWhileOpen.json?.code, msg: boolOpenMsg.slice(0, 240) },
);

// Cross-type: 确认采购 / 确认耗料 on MIX draft must not succeed (non-post probe)
const wrongConfirm = await signedPost("/aierp/v1/wecom/draft/confirm", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  eventSource: "WECOM_BEFORE_DISPATCH",
  rawText: `确认采购${draftId1}`,
  messageMsgId: `mix-wrong-${Date.now()}`,
  draftId: draftId1,
});
note(
  "reject_purchase_phrase_on_mix_draft",
  wrongConfirm.json?.code !== 200,
  { code: wrongConfirm.json?.code, msg: wrongConfirm.json?.data?.message || wrongConfirm.json?.message },
);

const serviceWrong = await signedPost("/aierp/v1/wecom/draft/confirm", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  eventSource: "WECOM_BEFORE_DISPATCH",
  rawText: `确认耗料${draftId1}`,
  messageMsgId: `mix-svc-${Date.now()}`,
  draftId: draftId1,
});
note(
  "reject_service_phrase_on_mix_draft",
  serviceWrong.json?.code !== 200,
  { code: serviceWrong.json?.code, msg: serviceWrong.json?.data?.message || serviceWrong.json?.message },
);

const purchase119After = mysql(
  "SELECT status, number FROM jsh_depot_head WHERE number='GW-PURCHASE-119' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
);
note(
  "never_auto_confirm_purchase_119",
  purchase119Before === purchase119After,
  { before: purchase119Before, after: purchase119After },
);

const stockFinal = {
  "RM-A001": stockOf("RM-A001", depotRmId),
  "RM-B002": stockOf("RM-B002", depotRmId),
  "RM-C003": stockOf("RM-C003", depotRmId),
  "FG-101": stockOf("FG-101", depotFgId),
};
note("final_stock_unchanged_non_post", JSON.stringify(stockBefore) === JSON.stringify(stockFinal), {
  stockBefore,
  stockFinal,
});

// Cancel mix draft, then verify unconfirmed recipe is refused (no open workflow mask)
if (draftId1) {
  try {
    await signedPost("/aierp/v1/wecom/draft/cancel", {
      wecomUserId: WECOM,
      botId: BOT,
      channel: "wecom",
      draftId: draftId1,
    });
    await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
      wecomUserId: WECOM,
      botId: BOT,
      channel: "wecom",
    });
  } catch (ex) {
    console.warn("cleanup skipped:", String(ex?.message || ex).slice(0, 120));
  }
}

// Model boolean alone cannot shortcut recipe confirmation (even with/without open workflow)
const boolOnly = await signedPost("/aierp/v1/wecom/mix/prepare", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  recipeUserConfirmed: true,
  userConfirmedRecipe: true,
  idempotencyKey: `mix-bool-${Date.now()}`,
  finished: { barCode: "FG-101", qty: "1", unit: "L", depotName: "成品仓" },
  lines: [{ barCode: "RM-A001", qty: "0.1", unit: "L", depotName: "原料仓" }],
});
const boolMsg = String(boolOnly.json?.data?.message || boolOnly.json?.message || "");
note(
  "refuse_model_boolean_as_recipe_approval",
  boolOnly.json?.code !== 200 &&
    /recipeHash|布尔|recipe-preview|模型/.test(boolMsg) &&
    !/用户已确认/.test(boolMsg),
  { code: boolOnly.json?.code, msg: boolMsg.slice(0, 240) },
);

const invent = await signedPost("/aierp/v1/wecom/mix/prepare", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  recipeUserConfirmed: false,
  idempotencyKey: `mix-invent-${Date.now()}`,
  finished: { barCode: "FG-101", qty: "1", unit: "L" },
  lines: [{ barCode: "RM-A001", qty: "0.1", unit: "L" }],
});
const inventMsg = String(invent.json?.data?.message || invent.json?.message || "");
note(
  "refuse_prepare_without_recipe_hash",
  invent.json?.code === 400 || /recipeHash|recipe-preview|布尔/.test(inventMsg),
  { code: invent.json?.code, msg: inventMsg.slice(0, 200) },
);

// Insufficient stock: recipe-preview → prepare with registered hash must fail (no invent via boolean)
const insuffFinished = { barCode: "FG-101", qty: "1", unit: "L", depotName: "成品仓" };
const insuffLines = [
  { barCode: "RM-A001", qty: "999999", unit: "L", depotName: "原料仓" },
  { barCode: "RM-B002", qty: "0.1", unit: "L", depotName: "原料仓" },
  { barCode: "RM-C003", qty: "0.3", unit: "L", depotName: "原料仓" },
];
const insuffPrev = await signedPost(
  "/aierp/v1/wecom/mix/recipe-preview",
  buildMixRecipePreviewBody({
    wecomUserId: WECOM,
    botId: BOT,
    finished: insuffFinished,
    lines: insuffLines,
  }),
);
const insuffHash = insuffPrev.json?.data?.recipeHash;
let badPrep = { json: { code: 500, message: "skip: no recipeHash from preview" } };
if (insuffHash) {
  badPrep = await signedPost(
    "/aierp/v1/wecom/mix/prepare",
    buildMixPrepareBody({
      wecomUserId: WECOM,
      botId: BOT,
      recipeHash: insuffHash,
      idempotencyKey: `mix-insuff-${Date.now()}`,
      finished: insuffFinished,
      lines: insuffLines,
      remark: "故意超量测试",
    }),
  );
}
const badCode = badPrep.json?.code;
const badMsg = String(badPrep.json?.data?.message || badPrep.json?.message || "");
note(
  "insufficient_stock_fails_prepare",
  insuffPrev.json?.code === 200 &&
    !!insuffHash &&
    (badCode === 400 || badCode === 409 || /库存不足/.test(badMsg)),
  {
    previewCode: insuffPrev.json?.code,
    recipeHash: String(insuffHash || "").slice(0, 16),
    code: badCode,
    msg: badMsg.slice(0, 200),
  },
);

const pass = results.every((r) => r.ok);
const out = {
  ticket: "AIERP-016M",
  kind: "non-post-mix-prepare",
  pass,
  wecomUserIdMasked: WECOM.slice(0, 6) + "***",
  draftId: draftId1,
  businessKey: bizKey,
  confirmPhrase: d1?.confirmPhrase,
  stockBefore,
  stockFinal,
  purchase119: purchase119After,
  results,
  uatNotes: [
    "自动化仅准备未审核 MIX 草稿，未执行「确认配制」过账。",
    "真人 UAT：上传同配制单号 3 行原料 Excel → 得草稿号 → 本人私聊「确认配制{id}」→ 核对 FG-101 成品仓 +1L 与原料扣减。",
    "禁止用采购 PDF 冒充配制回执；配制回执以文字为准（无 MIX 专用 PDF 模板时）。",
    "勿自动确认 GW-PURCHASE-119。",
  ],
};
writeFileSync(join(evidenceDir, "aierp-016m-mix-prepare.json"), JSON.stringify(out, null, 2), "utf8");
writeFileSync(
  join(evidenceDir, "aierp-016m-mix-prepare.md"),
  [
    "# AIERP-016M evidence (non-post)",
    "",
    `- pass: **${pass}**`,
    `- draftId: ${draftId1}`,
    `- businessKey: ${bizKey}`,
    `- confirmPhrase: ${d1?.confirmPhrase}`,
    `- stock unchanged: ${JSON.stringify(stockBefore) === JSON.stringify(stockFinal)}`,
    `- GW-PURCHASE-119 untouched: ${purchase119Before === purchase119After}`,
    "",
    "## Results",
    ...results.map((r) => `- ${r.ok ? "PASS" : "FAIL"} ${r.name}`),
    "",
    "## UAT",
    ...out.uatNotes.map((n) => `- ${n}`),
    "",
  ].join("\n"),
  "utf8",
);
console.log(pass ? "ALL PASS" : "SOME FAILED");
process.exit(pass ? 0 : 1);
