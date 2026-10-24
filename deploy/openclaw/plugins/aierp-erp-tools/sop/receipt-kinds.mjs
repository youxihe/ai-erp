/**
 * Shared receiptKind constants + helpers (AIERP-022B / 022A DTO hooks).
 * Kept separate to avoid circular imports between receipt-send and auto-delivery.
 */

export const RECEIPT_KIND = Object.freeze({
  PURCHASE: "PURCHASE",
  MIX: "MIX",
  SERVICE: "SERVICE",
  PARTNER_CREATE: "PARTNER_CREATE",
  PARTNER_UPDATE: "PARTNER_UPDATE",
  MATERIAL_CREATE: "MATERIAL_CREATE",
  MATERIAL_UPDATE: "MATERIAL_UPDATE",
  BATCH: "BATCH",
  DRAFT_CANCEL: "DRAFT_CANCEL",
});

export const AUTO_DELIVER_KINDS = new Set([
  RECEIPT_KIND.PURCHASE,
  RECEIPT_KIND.MIX,
  RECEIPT_KIND.SERVICE,
]);

export const FUTURE_HOOK_KINDS = new Set([
  RECEIPT_KIND.PARTNER_CREATE,
  RECEIPT_KIND.PARTNER_UPDATE,
  RECEIPT_KIND.MATERIAL_CREATE,
  RECEIPT_KIND.MATERIAL_UPDATE,
  RECEIPT_KIND.BATCH,
  RECEIPT_KIND.DRAFT_CANCEL,
]);

/**
 * Resolve receiptKind from confirm / mutation DTO (022A-compatible).
 */
export function resolveReceiptKind(data) {
  if (!data || typeof data !== "object") return null;
  const explicit = String(data.receiptKind || data.bizType || data.mutationKind || "").toUpperCase();
  if (explicit && Object.values(RECEIPT_KIND).includes(explicit)) return explicit;
  const bill = String(data.billNumber || data.realBillNumber || "");
  if (/^GW-PURCHASE-\d+/i.test(bill)) return RECEIPT_KIND.PURCHASE;
  if (/^GW-MIX-\d+/i.test(bill)) return RECEIPT_KIND.MIX;
  if (/^GW-SERVICE-\d+/i.test(bill)) return RECEIPT_KIND.SERVICE;
  return null;
}

export function isPostSuccess(data) {
  const st = String(data?.status || "").toUpperCase();
  return st === "CONFIRMED" || st === "POSTED" || st === "COMMITTED";
}

/** Kind-aware default PDF file name (never retitle MIX/SERVICE as purchase). */
export function receiptFileTitle(receiptKind, billNumber) {
  const bill = billNumber || "bill";
  switch (receiptKind) {
    case RECEIPT_KIND.MIX:
      return `配制业务回执_${bill}.pdf`;
    case RECEIPT_KIND.SERVICE:
      return `服务耗料出库回执_${bill}.pdf`;
    case RECEIPT_KIND.PARTNER_CREATE:
    case RECEIPT_KIND.PARTNER_UPDATE:
      return `主数据往来回执_${bill}.pdf`;
    case RECEIPT_KIND.MATERIAL_CREATE:
    case RECEIPT_KIND.MATERIAL_UPDATE:
      return `主数据物料回执_${bill}.pdf`;
    case RECEIPT_KIND.BATCH:
      return `批次入库回执_${bill}.pdf`;
    case RECEIPT_KIND.DRAFT_CANCEL:
      return `草稿取消回执_${bill}.pdf`;
    case RECEIPT_KIND.PURCHASE:
    default:
      return `采购入库业务回执_${bill}.pdf`;
  }
}
