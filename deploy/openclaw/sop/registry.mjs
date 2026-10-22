/**
 * SOP registry — priority routing for trusted WeCom inbound.
 * receipt > partner_confirm > purchase_confirm > excel > fallback LLM
 */
import { canHandleReceipt, isReceiptRequest, isReceiptFollowup } from "./receipt-send.mjs";
import { canHandlePartnerConfirm, isPartnerConfirmPhrase } from "./partner-upsert.mjs";

export const SOP_PRIORITY = [
  "receipt_request",
  "receipt_followup",
  "partner_confirm",
  "purchase_confirm",
  "excel_cancel",
  "excel_followup",
  "excel_file",
  "fallback_llm",
];

/**
 * @returns {{ sopId: string, followup?: boolean } | null}
 */
export function routeTrustedInbound({ text, wecomUserId, isConfirmPhrase, isExcelCancel, isExcelFollowup }) {
  const t = String(text || "").trim();
  if (!t) return null;

  const receipt = canHandleReceipt(t, wecomUserId);
  if (receipt) {
    return {
      sopId: receipt.followup || isReceiptFollowup(t) ? "receipt_followup" : "receipt_request",
      followup: !!receipt.followup || isReceiptFollowup(t),
    };
  }

  if (canHandlePartnerConfirm(t) || isPartnerConfirmPhrase(t)) {
    return { sopId: "partner_confirm" };
  }

  if (typeof isConfirmPhrase === "function" && isConfirmPhrase(t)) {
    return { sopId: "purchase_confirm" };
  }
  if (typeof isExcelCancel === "function" && isExcelCancel(t)) {
    return { sopId: "excel_cancel" };
  }
  if (typeof isExcelFollowup === "function" && isExcelFollowup(t)) {
    return { sopId: "excel_followup" };
  }
  return null;
}

export { isReceiptRequest, isReceiptFollowup };
