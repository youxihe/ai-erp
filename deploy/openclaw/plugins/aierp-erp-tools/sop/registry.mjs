/**
 * SOP registry — priority routing for trusted WeCom inbound.
 * receipt > material_confirm > purchase_confirm > excel > material_upsert > fallback LLM
 */
import { canHandleReceipt, isReceiptRequest, isReceiptFollowup } from "./receipt-send.mjs";
import { canHandleMaterial, isMaterialConfirmPhrase } from "./material-upsert.mjs";

export const SOP_PRIORITY = [
  "receipt_request",
  "receipt_followup",
  "material_confirm",
  "purchase_confirm",
  "excel_cancel",
  "excel_followup",
  "excel_file",
  "material_upsert",
  "fallback_llm",
];

/**
 * @returns {{ sopId: string, followup?: boolean, slots?: object } | null}
 */
export function routeTrustedInbound({
  text,
  wecomUserId,
  isConfirmPhrase,
  isExcelCancel,
  isExcelFollowup,
  slots,
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

  // Master-data confirm phrases must not fall into purchase_confirm.
  if (isMaterialConfirmPhrase(t)) {
    return { sopId: "material_confirm", followup: false };
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

  const material = canHandleMaterial(t, slots);
  if (material) {
    return material;
  }

  return null;
}

export { isReceiptRequest, isReceiptFollowup, isMaterialConfirmPhrase, canHandleMaterial };
