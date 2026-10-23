/**
 * AIERP-016S service-consume SOP.
 *
 * Collect slots / call backend prepare / read DRAFT result.
 * Confirm is trusted WeCom before_dispatch「确认耗料{draftId}」→ /aierp/v1/wecom/draft/confirm only.
 * Never LLM confirm tool. Never SALE / 应收.
 * Unified F: runtime deploy is separate — do not overwrite shared F: from this branch.
 */
import {
  renderServiceDraftReady,
  renderServiceConfirmed,
  sanitizeForChannel,
} from "./renderers/wecom-business.mjs";

export const CONFIRM_SERVICE = /^\s*确认\s*耗料\s*[：:#＃]?\s*(\d+)\s*$/;

export function isServiceConfirmPhrase(text) {
  return CONFIRM_SERVICE.test(String(text || "").trim());
}

export function parseServiceConfirmDraftId(text) {
  const m = String(text || "").trim().match(CONFIRM_SERVICE);
  return m ? Number(m[1]) : null;
}

/** Plugin/tool formatter for SERVICE draft (stock unchanged). */
export function formatServiceDraft(data) {
  if (data?.userSummaryZh && !String(data.userSummaryZh).includes("{")) {
    return sanitizeForChannel(String(data.userSummaryZh), { markdown: false });
  }
  return sanitizeForChannel(renderServiceDraftReady(factsFromPrepare(data || {})), { markdown: false });
}

/** Plugin/tool formatter for SERVICE confirm / receipt text. */
export function formatServiceConfirmed(data) {
  if (data?.receiptText && String(data.receiptText).includes("服务耗料")) {
    return sanitizeForChannel(String(data.receiptText).slice(0, 800), { markdown: false });
  }
  return sanitizeForChannel(renderServiceConfirmed(factsFromConfirm(data || {})), { markdown: false });
}

/**
 * Prepare unposted SERVICE draft from explicit slots.
 * @param {(path:string,body:object)=>Promise<object>} signedPost
 */
export async function prepareServiceSlots(signedPost, {
  wecomUserId,
  botId,
  barCode = "FG-101",
  depotName = "成品仓",
  unit = "L",
  qty = 1,
  organName,
  serviceProject,
  idempotencyKey,
  remark,
}) {
  if (!organName) throw new Error("服务耗料需要真实 ERP 客户名称（organName）");
  if (!idempotencyKey) throw new Error("缺少 idempotencyKey");
  const data = await signedPost("/aierp/v1/wecom/service/prepare", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode,
    depotName,
    unit,
    qty,
    organName,
    serviceProject,
    idempotencyKey,
    remark,
  });
  return {
    data,
    text: sanitizeForChannel(renderServiceDraftReady(factsFromPrepare(data))),
  };
}

/**
 * Prepare from persisted Excel SERVICE preview (1 canConfirm bill).
 */
export async function prepareServiceVerified(signedPost, {
  wecomUserId,
  botId,
  previewId,
  fileSha256,
}) {
  const data = await signedPost("/aierp/v1/wecom/service/prepare-verified", {
    wecomUserId,
    botId,
    channel: "wecom",
    previewId,
    fileSha256,
  });
  return {
    data,
    text: sanitizeForChannel(
      data?.userSummaryZh || renderServiceDraftReady(factsFromPrepare(data)),
    ),
  };
}

/**
 * Trusted confirm handoff (caller must already match before_dispatch + CONFIRM_SERVICE).
 */
export async function confirmServiceConsume(signedPost, {
  wecomUserId,
  botId,
  rawText,
  messageMsgId,
  draftId,
  isGroup = false,
}) {
  if (!isServiceConfirmPhrase(rawText)) {
    throw new Error("不是有效的确认耗料原文");
  }
  const id = draftId ?? parseServiceConfirmDraftId(rawText);
  const data = await signedPost("/aierp/v1/wecom/draft/confirm", {
    wecomUserId,
    botId,
    channel: "wecom",
    rawText,
    messageMsgId,
    eventSource: "WECOM_BEFORE_DISPATCH",
    isGroup: !!isGroup,
    draftId: id,
  });
  return {
    data,
    text: sanitizeForChannel(
      data?.receiptText || renderServiceConfirmed(factsFromConfirm(data)),
    ),
  };
}

export function factsFromPrepare(data) {
  const s = data?.summary || {};
  return {
    draftId: data?.draftId,
    confirmPhrase: data?.confirmPhrase || (data?.draftId ? `确认耗料${data.draftId}` : ""),
    partnerName: s.partnerName,
    serviceProject: s.serviceProject,
    materialName: s.materialName,
    barCode: s.barCode,
    qty: s.qty,
    unit: s.unit,
    depotName: s.depotName,
    currentStock: s.currentStock,
    stockUnchanged: data?.stockUnchanged !== false,
    statusLabel: data?.statusLabel || "待确认、未出库",
  };
}

export function factsFromConfirm(data) {
  const line = Array.isArray(data?.lines) && data.lines[0] ? data.lines[0] : {};
  const before = data?.stockBefore;
  const after = data?.stockAfter;
  let stockBefore;
  let stockAfter;
  if (before && typeof before === "object") {
    stockBefore = Object.values(before)[0];
  }
  if (after && typeof after === "object") {
    stockAfter = Object.values(after)[0];
  }
  return {
    billNumber: data?.billNumber,
    partnerName: data?.partnerName,
    serviceProject: data?.serviceProject,
    materialName: line.material_name || line.materialName,
    barCode: line.bar_code || line.barCode,
    qty: line.oper_number || line.operNumber || line.qty,
    unit: line.material_unit || line.unit,
    depotName: line.depot_name || line.depotName,
    stockBefore,
    stockAfter,
    receiptText: data?.receiptText,
    pdfStatus: data?.pdfStatus,
  };
}

export const sopMeta = {
  id: "service_consume",
  label: "服务耗料出库",
  bizType: "SERVICE",
  confirmPhrasePrefix: "确认耗料",
  endpoints: {
    prepare: "/aierp/v1/wecom/service/prepare",
    prepareVerified: "/aierp/v1/wecom/service/prepare-verified",
    confirm: "/aierp/v1/wecom/draft/confirm",
  },
  notes: [
    "SERVICE = 其它出库，≠ 销售出库/开票/应收",
    "Prepare 不改库存；仅本人原文确认耗料后扣成品仓",
    "PDF：无独立服务模板时仅文字《服务耗料出库回执》，禁止采购 PDF 改标题",
  ],
};
