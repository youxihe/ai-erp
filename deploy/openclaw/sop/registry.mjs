/**
 * SOP registry — priority routing for trusted WeCom inbound.
 * Mirror of plugins/aierp-erp-tools/sop/registry.mjs for workspace import paths.
 * receipt > mix recipe-ack > mix/purchase confirm > purchase_batch_prepare >
 * mix_prepare > excel cancel/followup > excel file > fallback LLM
 *
 * AIERP-016M: mix_recipe_ack / mix_confirm / mix_prepare; keep PURCHASE confirm+PDF paths intact.
 * AIERP-017B2: purchase_batch_prepare (DRAFT only).
 */
import { canHandleReceipt, isReceiptRequest, isReceiptFollowup } from "./receipt-send.mjs";
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
  "mix_recipe_ack",
  "mix_confirm",
  "purchase_confirm",
  "purchase_batch_prepare",
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

  if (isMixRecipeAckPhrase(t)) {
    return { sopId: "mix_recipe_ack" };
  }
  if (isMixConfirmPhrase(t)) {
    return { sopId: "mix_confirm" };
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
  isMixConfirmPhrase,
  isMixRecipeAckPhrase,
  MIX_SOP,
  canHandlePurchaseBatchFollowup,
  runPurchaseBatchPrepare,
  formatPurchaseBatchReply,
  PURCHASE_BATCH_SOP,
};
