/**
 * AIERP-016M · MIX 配制/组装 SOP（独立模块；plugin/index.js 仅薄注册）
 *
 * - 仅准备未审核 DRAFT / 读状态；不过账
 * - 槽位：recipe-preview 展示草案+recipeHash → prepare(recipeHash) → 未审核草稿
 * - 过账只能是可信企微原文「确认配制{draftId}」（before_dispatch），LLM 无 confirm 工具
 * - 模型布尔 recipeUserConfirmed 永不等于用户批准；禁止擅自推导化学比例
 * - MIX 回执为文字；不附带采购 PDF
 */
import { createHash } from "node:crypto";

export const CONFIRM_MIX = /^\s*确认\s*配制\s*[：:#＃]?\s*(\d+)\s*$/;

export function isMixConfirmPhrase(text) {
  return CONFIRM_MIX.test(String(text || "").trim());
}

export function extractMixDraftId(text) {
  const m = String(text || "")
    .trim()
    .match(CONFIRM_MIX);
  return m ? Number(m[1]) : null;
}

/**
 * Canonical recipe hash (aligned with server AierpWecomMixService.computeRecipeHash).
 * Used for local unit checks; server hash is authoritative.
 */
export function computeRecipeHash(finished, lines) {
  const normQty = (q) => {
    try {
      const n = Number(String(q).trim());
      if (!Number.isFinite(n)) return String(q).trim();
      // Approximate BigDecimal.stripTrailingZeros().toPlainString()
      return String(n);
    } catch {
      return String(q).trim();
    }
  };
  const normTok = (s) => String(s || "").trim().toUpperCase();
  const fgDepot = finished?.depotName || "成品仓";
  let canon = `FG|${normTok(finished?.barCode)}|${normQty(finished?.qty)}|${normTok(finished?.unit)}|${normTok(fgDepot)}\n`;
  const sorted = [...(lines || [])].sort((a, b) =>
    String(a.barCode || "").localeCompare(String(b.barCode || "")),
  );
  for (const l of sorted) {
    canon += `RM|${normTok(l.barCode)}|${normQty(l.qty)}|${normTok(l.unit)}|${normTok(l.depotName || "原料仓")}\n`;
  }
  return createHash("sha256").update(canon, "utf8").digest("hex");
}

/** @deprecated alias */
export const computeRecipeHashLocal = computeRecipeHash;

/**
 * Build body for POST /aierp/v1/wecom/mix/recipe-preview.
 * Never sets recipeUserConfirmed — booleans are not acceptance evidence.
 */
export function buildMixRecipePreviewBody({
  wecomUserId,
  botId,
  channel = "wecom",
  finished,
  lines,
}) {
  if (!finished?.barCode || finished.qty == null || !finished.unit) {
    throw new Error("成品需要 barCode / qty / unit");
  }
  if (!Array.isArray(lines) || lines.length < 1) {
    throw new Error("至少一行原料");
  }
  return {
    wecomUserId,
    botId,
    channel,
    finished: {
      barCode: String(finished.barCode).trim(),
      qty: String(finished.qty),
      unit: String(finished.unit).trim(),
      depotName: finished.depotName || "成品仓",
    },
    lines: lines.map((l) => ({
      barCode: String(l.barCode).trim(),
      qty: String(l.qty),
      unit: String(l.unit).trim(),
      depotName: l.depotName || "原料仓",
    })),
  };
}

/**
 * Build body for POST /aierp/v1/wecom/mix/prepare.
 * Requires server-registered recipeHash from prior recipe-preview — never model booleans.
 */
export function buildMixPrepareBody({
  wecomUserId,
  botId,
  channel = "wecom",
  finished,
  lines,
  idempotencyKey,
  remark,
  recipeHash,
  recipeConfirmHash,
  recipeUserConfirmed,
  userConfirmedRecipe,
}) {
  const hash = String(recipeHash || recipeConfirmHash || "")
    .trim()
    .toLowerCase();
  if (
    (recipeUserConfirmed === true || userConfirmedRecipe === true) &&
    !/^[0-9a-f]{64}$/.test(hash)
  ) {
    throw new Error(
      "模型布尔 recipeUserConfirmed/userConfirmedRecipe 不能证明用户已核对配方。请先 recipe-preview 取得 recipeHash。",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(
      "缺少有效 recipeHash。请先 /mix/recipe-preview 展示完整成品/原料配比后再准备草稿。系统不会自动推导化学比例。",
    );
  }
  const body = {
    wecomUserId,
    botId,
    channel,
    recipeHash: hash,
    recipeConfirmHash: hash,
    idempotencyKey:
      idempotencyKey ||
      `mix-${createHash("sha256")
        .update(JSON.stringify({ hash, wecomUserId }))
        .digest("hex")
        .slice(0, 24)}`,
    remark: remark || "企微对话配制（测试配方草案，已展示待原文确认配制）",
  };
  if (finished && Array.isArray(lines) && lines.length >= 1) {
    body.finished = {
      barCode: String(finished.barCode).trim(),
      qty: String(finished.qty),
      unit: String(finished.unit).trim(),
      depotName: finished.depotName || "成品仓",
    };
    body.lines = lines.map((l) => ({
      barCode: String(l.barCode).trim(),
      qty: String(l.qty),
      unit: String(l.unit).trim(),
      depotName: l.depotName || "原料仓",
    }));
  }
  return body;
}

/** POST /aierp/v1/wecom/mix/recipe-preview — proposed DRAFT display only. */
export async function previewMixRecipe(signedPost, body) {
  return signedPost("/aierp/v1/wecom/mix/recipe-preview", body);
}

/** POST /aierp/v1/wecom/mix/prepare — unposted DRAFT only. */
export async function prepareMixSlots(signedPost, body) {
  return signedPost("/aierp/v1/wecom/mix/prepare", body);
}

export async function prepareMixVerified(signedPost, body) {
  return signedPost("/aierp/v1/wecom/mix/prepare-verified", body);
}

export function formatMixDraftReady(data) {
  if (!data) return "配制草稿未就绪。";
  if (data.userSummaryZh) return String(data.userSummaryZh);
  if (data.hintZh) return String(data.hintZh);
  if (data.recipeDisplayZh && !data.draftId) return String(data.recipeDisplayZh);
  if (data.hint) return String(data.hint);
  const id = data.draftId ?? "?";
  const phrase = data.confirmPhrase || `确认配制${id}`;
  const fg = data.summary?.finishedBarCode || data.summary?.finishedName || "成品";
  const qty = data.summary?.finishedQty ?? "";
  const unit = data.summary?.finishedUnit || "";
  const hash = data.recipeHash ? String(data.recipeHash).slice(0, 12) : "";
  return [
    `配制待确认单 #${id}`,
    hash ? `配方草案 recipeHash=${hash}` : null,
    `成品 ${fg} ${qty}${unit} → ${data.summary?.finishedDepot || "成品仓"}`,
    "未过账，库存未变。",
    `请回复「${phrase}」完成配制（须本人核对已展示配方；模型布尔无效）。`,
    "配制回执为文字；无 MIX 专用采购 PDF。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Post-confirm WeCom text; never claim purchase PDF. */
export function formatMixConfirmed(data) {
  const bill = data?.billNumber || data?.number || "?";
  const replay = data?.stockUnchanged === true ? "（重放，库存未再变）" : "";
  return [
    "组装配制已完成（已审核）",
    `原生单号：${bill}${replay}`,
    "文字回执已生成；配制场景不附带《采购入库业务回执》PDF（pdfStatus=NONE）。",
  ].join("\n");
}

/**
 * Trusted confirm handoff (caller must already match before_dispatch + CONFIRM_MIX).
 */
export async function runMixConfirm({
  text,
  wecomUserId,
  botId,
  messageId,
  signedPost,
  channel = "wecom",
}) {
  if (!isMixConfirmPhrase(text)) {
    throw new Error("不是有效的确认配制原文");
  }
  const draftId = extractMixDraftId(text);
  const res = await signedPost("/aierp/v1/wecom/draft/confirm", {
    wecomUserId,
    botId,
    channel,
    eventSource: "WECOM_BEFORE_DISPATCH",
    rawText: String(text || "").trim(),
    messageMsgId: messageId,
    draftId,
    isGroup: false,
  });
  const data = res?.json?.data || res?.data || res;
  return {
    data,
    replyText: formatMixConfirmed(data),
  };
}

export const MIX_SOP = {
  id: "mix_prepare",
  confirmSopId: "mix_confirm",
  description:
    "药水配制/组装：Excel 或 recipe-preview→recipeHash→未审核 DRAFT；过账仅 确认配制{id}；无采购 PDF",
  tools: ["erp_excel_template", "erp_excel_preview"], // no confirm tool for LLM
  endpoints: {
    recipePreview: "/aierp/v1/wecom/mix/recipe-preview",
    prepare: "/aierp/v1/wecom/mix/prepare",
    prepareVerified: "/aierp/v1/wecom/mix/prepare-verified",
    confirm: "/aierp/v1/wecom/draft/confirm", // trusted before_dispatch only
  },
};
