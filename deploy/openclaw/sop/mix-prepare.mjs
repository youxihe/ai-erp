/**
 * AIERP-016M · MIX 配制/组装 SOP（独立模块；plugin/index.js 集成另 PR）
 *
 * - 仅准备未审核 DRAFT / 读状态；不过账
 * - 确认只能是可信企微原文「确认配制{draftId}」（before_dispatch），LLM 无 confirm 工具
 * - 配方必须用户确认的测试值；禁止模型擅自推导化学比例
 */
import { createHash } from "node:crypto";

export const CONFIRM_MIX = /^\s*确认\s*配制\s*[：:#＃]?\s*(\d+)\s*$/;

/** Trusted inbound phrase only — never treat model tool args as confirm. */
export function isMixConfirmPhrase(text) {
  return CONFIRM_MIX.test(String(text || "").trim());
}

export function extractMixDraftId(text) {
  const m = String(text || "").trim().match(CONFIRM_MIX);
  return m ? Number(m[1]) : undefined;
}

/**
 * Build body for POST /aierp/v1/wecom/mix/prepare from user-confirmed slots.
 * Requires recipeUserConfirmed=true — refuse AI-invented ratios.
 */
export function buildMixPrepareBody({
  wecomUserId,
  botId,
  channel = "wecom",
  finished,
  lines,
  idempotencyKey,
  remark,
  recipeUserConfirmed = false,
}) {
  if (!recipeUserConfirmed) {
    throw new Error("配制配方必须由用户明确确认（测试配方）。系统不会自动推导化学比例。");
  }
  if (!finished?.barCode || finished.qty == null || !finished.unit) {
    throw new Error("成品需要 barCode / qty / unit");
  }
  if (!Array.isArray(lines) || lines.length < 1) {
    throw new Error("至少需要一行原料（barCode / qty / unit）");
  }
  return {
    wecomUserId,
    botId,
    channel,
    recipeUserConfirmed: true,
    idempotencyKey:
      idempotencyKey ||
      `mix-${createHash("sha256")
        .update(JSON.stringify({ finished, lines, wecomUserId }))
        .digest("hex")
        .slice(0, 24)}`,
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
    remark: remark || "企微对话配制（测试配方，用户已确认）",
  };
}

/** POST /aierp/v1/wecom/mix/prepare — unposted DRAFT only. */
export async function prepareMixSlots(signedPost, body) {
  return signedPost("/aierp/v1/wecom/mix/prepare", body);
}

/** POST /aierp/v1/wecom/mix/prepare-verified — from Excel preview payload_json. */
export async function prepareVerifiedMix(signedPost, body) {
  return signedPost("/aierp/v1/wecom/mix/prepare-verified", body);
}

/** User-facing summary; no previewId / canConfirm / PREVIEWED jargon. */
export function formatMixDraftReady(data) {
  if (!data) return "配制草稿未就绪。";
  if (data.userSummaryZh) return String(data.userSummaryZh);
  if (data.hintZh) return String(data.hintZh);
  if (data.hint) return String(data.hint);
  const id = data.draftId ?? "?";
  const phrase = data.confirmPhrase || `确认配制${id}`;
  const fg = data.summary?.finishedBarCode || data.summary?.finishedName || "成品";
  const qty = data.summary?.finishedQty ?? "";
  const unit = data.summary?.finishedUnit || "";
  return [
    `配制待确认单 #${id}`,
    `成品 ${fg} ${qty}${unit} → ${data.summary?.finishedDepot || "成品仓"}`,
    "未过账，库存未变。",
    `请回复「${phrase}」完成配制（测试配方须用户本人确认）。`,
  ].join("\n");
}

/** Post-confirm WeCom text; never claim purchase PDF. */
export function formatMixConfirmed(data) {
  if (!data) return "配制确认结果为空。";
  if (data.receiptText) return String(data.receiptText).slice(0, 1200);
  if (data.hint && !String(data.hint).includes("{")) return String(data.hint).slice(0, 800);
  const bill = data.billNumber || "?";
  const replay = data.replayed ? "（重复确认，库存未再变）" : "";
  return [
    "组装配制已完成（已审核）",
    `原生单号：${bill}${replay}`,
    "文字回执已生成；配制场景不附带《采购入库业务回执》PDF。",
  ].join("\n");
}

/**
 * Trusted before_dispatch confirm only.
 * signedPost must return ERP `data` (plugin adapter style) and throw on non-200.
 */
export async function runMixConfirm({
  text,
  wecomUserId,
  botId,
  messageId,
  signedPost,
  channel = "wecom",
}) {
  const draftId = extractMixDraftId(text);
  if (!draftId) {
    throw new Error("无法解析配制草稿号，请回复「确认配制{数字草稿号}」");
  }
  const data = await signedPost("/aierp/v1/wecom/draft/confirm", {
    wecomUserId,
    botId,
    channel,
    rawText: String(text || "").trim(),
    messageMsgId: messageId || undefined,
    eventSource: "WECOM_BEFORE_DISPATCH",
    isGroup: false,
    draftId,
  });
  return {
    data,
    replyText: formatMixConfirmed(data),
  };
}

export const MIX_SOP = {
  id: "mix_prepare",
  confirmSopId: "mix_confirm",
  description: "药水配制/组装：Excel 或用户确认测试配方 → 未审核 DRAFT；确认仅 确认配制{id}",
  tools: ["erp_excel_template", "erp_excel_preview"], // no confirm tool for LLM
  endpoints: {
    prepare: "/aierp/v1/wecom/mix/prepare",
    prepareVerified: "/aierp/v1/wecom/mix/prepare-verified",
    confirm: "/aierp/v1/wecom/draft/confirm", // trusted before_dispatch only
  },
};
