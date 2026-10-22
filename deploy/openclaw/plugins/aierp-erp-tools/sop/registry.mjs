/**
 * SOP registry — priority routing for trusted WeCom inbound.
 * receipt > mix/purchase confirm > excel cancel/followup > excel file > fallback LLM
 *
 * AIERP-016M: mix_confirm / mix_prepare; keep PURCHASE confirm+PDF paths intact.
 * Confirm/post for MIX is only 「确认配制{id}」— no second recipe-ack phrase.
 */
import { canHandleReceipt, isReceiptRequest, isReceiptFollowup } from "./receipt-send.mjs";
import { isMixConfirmPhrase, MIX_SOP } from "./mix-prepare.mjs";

export const SOP_PRIORITY = [
  "receipt_request",
  "receipt_followup",
  "mix_confirm",
  "purchase_confirm",
  "mix_prepare",
  "excel_cancel",
  "excel_followup",
  "excel_file",
  "fallback_llm",
];

export const SOP_MODULES = {
  mix_prepare: MIX_SOP,
};

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

  if (isMixConfirmPhrase(t)) {
    return { sopId: "mix_confirm" };
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

export {
  isReceiptRequest,
  isReceiptFollowup,
  isMixConfirmPhrase,
  MIX_SOP,
};
