/**
 * AIERP-017B2 purchase-batch-prepare SOP.
 * Calls controlled Java /excel/purchase-batch-prepare (alias prepare-verified-batch).
 * Never excel.confirm / never LLM confirm tool. Batch confirm is 017C1.
 * AIERP-020B: multi-line / multi-bill plain render when drafts carry structured lines.
 */

import { sanitizeForChannel } from "./renderers/wecom-business.mjs";
import { renderPurchaseBatchForWecom } from "./renderers/wecom-adapter.mjs";

export const SOP_ID = "purchase_batch_prepare";
export const PURCHASE_BATCH_PREPARE_PATH = "/aierp/v1/wecom/excel/purchase-batch-prepare";

/** Explicit follow-up after preview when some rows have errors, or user asks to prepare batch drafts. */
export function canHandlePurchaseBatchFollowup(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/(确认采购|确认批次|发回执|取消文件)/.test(t)) return false;
  return /^(?:生成草稿|办理有效单|只办有效|按有效单办理|准备批量采购)$/.test(t)
    || /(?:两张|多张|批量).{0,12}采购|(?:核对|准备).{0,12}(?:采购|批次)|这是两张采购|先帮我核对/.test(t);
}

export function isPurchaseBatchPrepareIntent(text) {
  return canHandlePurchaseBatchFollowup(text);
}

/**
 * @param {object} opts
 * @param {(path:string, body:object)=>Promise<object>} opts.signedPost
 * @param {string} opts.wecomUserId
 * @param {string} opts.botId
 * @param {string} [opts.previewId]
 * @param {string} [opts.fileSha256]
 * @param {string[]} [opts.selectedBusinessKeys]
 */
export async function runPurchaseBatchPrepare({
  signedPost,
  wecomUserId,
  botId,
  previewId,
  fileSha256,
  selectedBusinessKeys,
  channel = "wecom",
}) {
  if (typeof signedPost !== "function") {
    throw new Error("purchase-batch-prepare requires signedPost");
  }
  const body = {
    wecomUserId,
    botId,
    channel,
  };
  if (previewId) body.previewId = previewId;
  if (fileSha256) body.fileSha256 = fileSha256;
  if (Array.isArray(selectedBusinessKeys) && selectedBusinessKeys.length) {
    body.selectedBusinessKeys = selectedBusinessKeys;
  }
  const raw = await signedPost(PURCHASE_BATCH_PREPARE_PATH, body);
  const data = raw && raw.data !== undefined ? raw.data : raw;
  return {
    handled: true,
    text: formatPurchaseBatchReply(data),
    data,
  };
}

export function formatPurchaseBatchReply(data) {
  if (!data) return "暂时无法准备采购草稿，请重新发送 Excel。";
  const awaiting = data.awaitingDrafts ?? 0;
  const posted = data.alreadyPosted ?? 0;
  const total = data.totalBills ?? data.drafts?.length ?? 0;
  if (posted > 0 && awaiting === 0) {
    const bill = data.billNumber || data.drafts?.[0]?.nativeBillNumber;
    if (bill) {
      return sanitizeForChannel(
        `批量采购已核对：${total} 张全部已审核完成（${bill}），无需再次入库。可回复「发 ${bill} 回执」领取 PDF。`,
        { markdown: false },
      );
    }
    return sanitizeForChannel(
      `批量采购已核对：${total} 张全部已审核完成，无需再次入库。可回复「发回执」领取 PDF。`,
      { markdown: false },
    );
  }
  // Prefer structured multi-line render when drafts include lines (2 bills / 3 lines etc.)
  const drafts = Array.isArray(data.drafts) ? data.drafts : [];
  const hasLines = drafts.some(
    (d) => Array.isArray(d?.lines) && d.lines.length > 0,
  );
  if (hasLines || (awaiting > 0 && drafts.length > 0)) {
    try {
      const rendered = renderPurchaseBatchForWecom(data, { prefer: "plain" });
      if (rendered?.text && /确认采购|本单合计|采购合计|行金额/.test(rendered.text)) {
        return sanitizeForChannel(rendered.text, { markdown: false });
      }
    } catch {
      // fall through to userSummaryZh / skeleton
    }
  }
  if (data.userSummaryZh) {
    return sanitizeForChannel(String(data.userSummaryZh), { markdown: false });
  }
  if (data.hintZh) return sanitizeForChannel(String(data.hintZh), { markdown: false });
  if (awaiting > 0) {
    return sanitizeForChannel(
      `批量采购已核对：${total} 张；${awaiting} 张可办理。库存未变化。请逐张回复「确认采购{数字草稿号}」。`,
      { markdown: false },
    );
  }
  return "文件已核对，库存未变化。";
}

export default {
  sopId: SOP_ID,
  SOP_ID,
  canHandlePurchaseBatchFollowup,
  isPurchaseBatchPrepareIntent,
  runPurchaseBatchPrepare,
  formatPurchaseBatchReply,
  PURCHASE_BATCH_PREPARE_PATH,
};
