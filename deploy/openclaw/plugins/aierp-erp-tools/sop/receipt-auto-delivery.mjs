/**
 * AIERP-022B · Unified post-success PDF auto-delivery SOP.
 *
 * After PURCHASE / MIX / SERVICE (and future 022A partner/material/batch) commit,
 * send the matching authorized receipt PDF via Bot WS. Resend uses receipt-send
 * only — never re-posts inventory.
 *
 * Delivery ladder:
 *   PDF_READY → CHANNEL_ACCEPTED → CLIENT_OPEN_VERIFIED (human UAT only)
 */
import { runReceiptSend } from "./receipt-send.mjs";
import { DELIVERY_STATUS } from "./wecom-outbound.mjs";
import { sanitizeForChannel } from "./renderers/wecom-business.mjs";
import {
  RECEIPT_KIND,
  AUTO_DELIVER_KINDS,
  FUTURE_HOOK_KINDS,
  resolveReceiptKind,
  isPostSuccess,
  receiptFileTitle,
} from "./receipt-kinds.mjs";

export {
  DELIVERY_STATUS,
  RECEIPT_KIND,
  AUTO_DELIVER_KINDS,
  FUTURE_HOOK_KINDS,
  resolveReceiptKind,
  isPostSuccess,
  receiptFileTitle,
};

/**
 * Append auto-delivery footnote without claiming CLIENT_OPEN_VERIFIED.
 */
export function appendDeliveryHint(replyText, delivery) {
  const base = String(replyText || "").trim();
  if (!delivery) return base;
  if (delivery.skipped && delivery.reason === "PDF_NOT_READY") {
    const hint =
      delivery.receiptKind === RECEIPT_KIND.MIX || delivery.receiptKind === RECEIPT_KIND.SERVICE
        ? "文字回执已生成；PDF 尚未就绪时可稍后回复「发回执」。"
        : "PDF 尚未就绪，请稍后回复「发回执」。";
    return sanitizeForChannel(`${base}\n\n${hint}`, { markdown: false });
  }
  if (delivery.skipped && delivery.reason === "HOOK_NOT_WIRED") {
    return base;
  }
  if (delivery.sent && delivery.deliveryStatus === DELIVERY_STATUS.CHANNEL_ACCEPTED) {
    // Confirm text already covers PDF; do not claim client-open verified.
    return base;
  }
  if (delivery.error || delivery.sent === false) {
    return sanitizeForChannel(
      `${base}\n\nPDF 暂未发送成功，请回复「重发回执」（不会再次入库）。`,
      { markdown: false },
    );
  }
  return base;
}

/**
 * Post-success auto PDF delivery. Never posts / never re-confirms.
 *
 * @param {object} deps
 * @param {object} deps.confirmData ERP confirm / mutation DTO
 * @param {string} deps.wecomUserId
 * @param {string|(()=>string)} deps.botId
 * @param {(path:string,body:object)=>Promise<object>} deps.signedPost
 * @param {object} [deps.cfg]
 * @param {string[]} [deps.mediaLocalRoots]
 * @param {string} [deps.messageId]
 * @param {boolean} [deps.markdown]
 */
export async function autoDeliverReceiptPdf(deps) {
  const {
    confirmData,
    wecomUserId,
    botId,
    signedPost,
    cfg,
    mediaLocalRoots,
    messageId,
    markdown = false,
  } = deps;

  const kind = resolveReceiptKind(confirmData);
  const billNumber = confirmData?.billNumber || confirmData?.realBillNumber;

  if (!isPostSuccess(confirmData) || !billNumber) {
    return {
      attempted: false,
      skipped: true,
      reason: "NOT_POST_SUCCESS",
      receiptKind: kind,
      deliveryStatus: null,
    };
  }

  if (kind && FUTURE_HOOK_KINDS.has(kind) && !AUTO_DELIVER_KINDS.has(kind)) {
    // Hook point for 022A partner/material/batch — PDF path lands with those DTOs.
    const hook = futureDeliveryHooks.get(kind);
    if (typeof hook === "function") {
      return hook(deps);
    }
    return {
      attempted: false,
      skipped: true,
      reason: "HOOK_NOT_WIRED",
      receiptKind: kind,
      billNumber,
      deliveryStatus: null,
      hook: `receipt-auto-delivery:${kind}`,
    };
  }

  if (kind && !AUTO_DELIVER_KINDS.has(kind)) {
    return {
      attempted: false,
      skipped: true,
      reason: "KIND_NOT_SUPPORTED",
      receiptKind: kind,
      billNumber,
      deliveryStatus: null,
    };
  }

  try {
    const sent = await runReceiptSend({
      wecomUserId,
      text: `发 ${billNumber} 回执`,
      billNumber, // explicit override — do not rely on PURCHASE-only regex
      botId: typeof botId === "function" ? botId() : botId,
      messageId,
      signedPost,
      cfg,
      mediaLocalRoots,
      followup: false,
      markdown,
      receiptKindHint: kind,
      autoDelivery: true,
    });

    if (sent?.needChoice) {
      return {
        attempted: true,
        sent: false,
        skipped: false,
        reason: "NEED_CHOICE",
        receiptKind: kind,
        billNumber,
        deliveryStatus: sent.deliveryStatus || DELIVERY_STATUS.PDF_READY,
        text: sent.text,
      };
    }

    if (sent?.pdfMissing || sent?.reason === "PDF_NOT_READY") {
      return {
        attempted: true,
        sent: false,
        skipped: true,
        reason: "PDF_NOT_READY",
        receiptKind: kind || sent.receiptKind,
        billNumber,
        deliveryStatus: null,
        text: sent.text,
      };
    }

    if (sent?.sent) {
      return {
        attempted: true,
        sent: true,
        skipped: false,
        receiptKind: kind || sent.receiptKind,
        billNumber: sent.billNumber || billNumber,
        receiptId: sent.receiptId,
        mediaPath: sent.mediaPath,
        messageId: sent.messageId,
        // CHANNEL_ACCEPTED ≠ CLIENT_OPEN_VERIFIED
        deliveryStatus: sent.deliveryStatus || DELIVERY_STATUS.CHANNEL_ACCEPTED,
        text: sent.text,
      };
    }

    return {
      attempted: true,
      sent: false,
      skipped: false,
      reason: sent?.error || "SEND_FAILED",
      error: sent?.error,
      receiptKind: kind || sent?.receiptKind,
      billNumber: sent?.billNumber || billNumber,
      deliveryStatus: sent?.deliveryStatus || DELIVERY_STATUS.PDF_READY,
      text: sent?.text,
      mediaPath: sent?.mediaPath,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    const pdfNotReady =
      /PDF\s*尚未生成|pdf.*not.*(ready|generated)|专用 PDF/i.test(msg) ||
      /该回执 PDF/i.test(msg);
    return {
      attempted: true,
      sent: false,
      skipped: pdfNotReady,
      reason: pdfNotReady ? "PDF_NOT_READY" : "ERROR",
      error: msg.slice(0, 240),
      receiptKind: kind,
      billNumber,
      deliveryStatus: null,
    };
  }
}

/**
 * Register a future kind handler (022A). Default is no-op skip.
 * @type {Map<string, Function>}
 */
export const futureDeliveryHooks = new Map();

export function registerFutureDeliveryHook(receiptKind, handler) {
  if (!receiptKind || typeof handler !== "function") return;
  futureDeliveryHooks.set(String(receiptKind).toUpperCase(), handler);
}
