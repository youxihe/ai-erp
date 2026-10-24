/**
 * SOP registry — priority routing for trusted WeCom inbound.
 * receipt > mix recipe-ack > service/mix/purchase confirm > purchase_batch_prepare >
 * mix_prepare > excel cancel/followup > excel file > fallback LLM
 *
 * AIERP-016S: service_confirm registered for unified deploy wiring.
 * AIERP-016M: mix_recipe_ack / mix_confirm / mix_prepare; keep PURCHASE confirm+PDF paths intact.
 * AIERP-017B2: purchase_batch_prepare (DRAFT only); preview auto-prepare + HMAC batch API cover the path.
 * Do not overwrite shared F: OpenClaw runtime from this branch.
 */
import {
  canHandleReceipt,
  isReceiptRequest,
  isReceiptFollowup,
  isBareBillPick,
} from "./receipt-send.mjs";
import { isServiceConfirmPhrase } from "./service-consume.mjs";
import { isMixConfirmPhrase, isMixRecipeAckPhrase, MIX_SOP } from "./mix-prepare.mjs";
import {
  SOP_ID as PURCHASE_BATCH_SOP,
  canHandlePurchaseBatchFollowup,
  runPurchaseBatchPrepare,
  formatPurchaseBatchReply,
} from "./purchase-batch-prepare.mjs";

export const SOP_PRIORITY = [
  "receipt_request",
  "receipt_followup",
  "receipt_bill_pick",
  "mix_recipe_ack",
  "mix_confirm",
  "service_confirm",
  "purchase_confirm",
  "purchase_batch_prepare",
  "mix_prepare",
  "excel_cancel",
  "excel_followup",
  "excel_file",
  "service_consume",
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
    if (receipt.billPick || (isBareBillPick(t) && receipt.sopId === "receipt-send")) {
      return { sopId: "receipt_bill_pick", followup: false, billPick: true };
    }
    return {
      sopId: receipt.followup || isReceiptFollowup(t) ? "receipt_followup" : "receipt_request",
      followup: !!receipt.followup || isReceiptFollowup(t),
    };
  }

  if (isMixRecipeAckPhrase(t)) {
    return { sopId: "mix_recipe_ack" };
  }
  if (isMixConfirmPhrase(t)) {
    return { sopId: "mix_confirm" };
  }
  if (isServiceConfirmPhrase(t)) {
    return { sopId: "service_confirm" };
  }
  if (typeof isConfirmPhrase === "function" && isConfirmPhrase(t)) {
    return { sopId: "purchase_confirm" };
  }
  if (canHandlePurchaseBatchFollowup(t)) {
    return { sopId: PURCHASE_BATCH_SOP };
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
  isBareBillPick,
  isServiceConfirmPhrase,
  isMixConfirmPhrase,
  isMixRecipeAckPhrase,
  MIX_SOP,
  canHandlePurchaseBatchFollowup,
  runPurchaseBatchPrepare,
  formatPurchaseBatchReply,
  PURCHASE_BATCH_SOP,
};
