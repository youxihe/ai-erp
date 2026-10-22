/**
 * SOP registry — priority routing for trusted WeCom inbound.
 * receipt > service_confirm > purchase_confirm > excel cancel/followup > excel file > fallback LLM
 *
 * AIERP-016S: service_confirm is registered here for unified deploy wiring.
 * Do not overwrite shared F: OpenClaw runtime from this branch.
 */
import { canHandleReceipt, isReceiptRequest, isReceiptFollowup } from "./receipt-send.mjs";
import { isServiceConfirmPhrase } from "./service-consume.mjs";

export const SOP_PRIORITY = [
  "receipt_request",
  "receipt_followup",
  "service_confirm",
  "purchase_confirm",
  "excel_cancel",
  "excel_followup",
  "excel_file",
  "service_consume",
  "fallback_llm",
];

/**
 * @returns {{ sopId: string, followup?: boolean } | null}
 */
export function routeTrustedInbound({
  text,
  wecomUserId,
  isConfirmPhrase,
  isExcelCancel,
  isExcelFollowup,
}) {
  const t = String(text || "").trim();
  if (!t) return null;

  const receipt = canHandleReceipt(t, wecomUserId);
  if (receipt) {
    return {
      sopId: receipt.followup || isReceiptFollowup(t) ? "receipt_followup" : "receipt_request",
      followup: !!receipt.followup || isReceiptFollowup(t),
    };
  }

  if (isServiceConfirmPhrase(t)) {
    return { sopId: "service_confirm" };
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

export { isReceiptRequest, isReceiptFollowup, isServiceConfirmPhrase };
