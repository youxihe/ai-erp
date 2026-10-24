/**
 * AIERP-015C / 022B receipt-send SOP: find authorized PDF → write controlled media → WeCom sendMedia.
 * Never posts inventory. Never calls erp_excel_template.
 *
 * 022B: extractBillNumber accepts GW-PURCHASE|MIX|SERVICE-* (and GW-* generally);
 * billNumber override; bare GW-* after NEED_CHOICE = receipt pick (not re-confirm);
 * deliveryStatus PDF_READY / CHANNEL_ACCEPTED / CLIENT_OPEN_VERIFIED.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  renderReceiptReady,
  renderReceiptSendFailed,
  renderReceiptAmbiguous,
  renderReceiptMissing,
  factsFromReceiptApi,
  sanitizeForChannel,
} from "./renderers/wecom-business.mjs";
import { sendWecomLocalFile, receiptMediaRoots, DELIVERY_STATUS } from "./wecom-outbound.mjs";
import { receiptFileTitle, resolveReceiptKind } from "./receipt-kinds.mjs";

const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Native bill: GW-PURCHASE-119 / GW-MIX-n / GW-SERVICE-n / future GW-* */
export const BILL_NUMBER_RE = /\b(GW-[A-Z]+-\d+)\b/i;
export const BARE_BILL_RE = /^\s*(GW-[A-Z]+-\d+)\s*$/i;

function stateDir() {
  return (
    process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state")
  );
}

function receiptMediaDir() {
  const dir = join(stateDir(), "media", "aierp-receipt");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pendingPath() {
  return join(stateDir(), "aierp-receipt-pending.json");
}

export function loadPendingMap() {
  try {
    if (!existsSync(pendingPath())) return {};
    return JSON.parse(readFileSync(pendingPath(), "utf8") || "{}");
  } catch {
    return {};
  }
}

export function savePending(wecomUserId, entry) {
  const all = loadPendingMap();
  if (!wecomUserId) return;
  if (!entry) {
    delete all[wecomUserId];
  } else {
    all[wecomUserId] = { ...entry, updatedAt: Date.now() };
  }
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(pendingPath(), JSON.stringify(all, null, 2), "utf8");
}

export function getPending(wecomUserId) {
  const all = loadPendingMap();
  const row = all[wecomUserId];
  if (!row) return null;
  if (Date.now() - (row.updatedAt || 0) > PENDING_TTL_MS) {
    savePending(wecomUserId, null);
    return null;
  }
  return row;
}

export const RECEIPT_REQUEST =
  /(?:采购入库业务回执|业务回执|入库回执|配制回执|服务耗料出库回执|回执\s*PDF|PDF\s*(?:回执|凭证)|(?:发|给我|把|再发|要|下载|重发).{0,40}回执|回执.{0,12}(?:发我|给我|发一下|PDF)|重发回执)/i;

export const RECEIPT_FOLLOWUP =
  /^\s*(?:文件直接发我|直接发我|直接发过来|把文件发我|再发一次|没收到|重发|刚才那张\s*PDF|刚才的文件|发文件)\s*$/i;

export function isReceiptRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/(模板|excel|\.xlsx|批量进货|进货模板)/i.test(t) && !/回执/.test(t)) return false;
  return RECEIPT_REQUEST.test(t);
}

export function isReceiptFollowup(text) {
  return RECEIPT_FOLLOWUP.test(String(text || "").trim());
}

/** Extract GW-* bill from free text (PURCHASE / MIX / SERVICE / future). */
export function extractBillNumber(text) {
  const m = String(text || "").match(BILL_NUMBER_RE);
  return m ? m[1].toUpperCase() : undefined;
}

/** Bare `GW-MIX-12` style reply (post NEED_CHOICE pick). */
export function isBareBillPick(text) {
  return BARE_BILL_RE.test(String(text || "").trim());
}

function writeReceiptPdf(fileName, base64) {
  const safe = basename(String(fileName || "receipt.pdf")).replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
  const path = join(receiptMediaDir(), `${Date.now()}_${safe}`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
}

function inferKind(billNumber, data, hint) {
  return (
    hint ||
    resolveReceiptKind(data) ||
    resolveReceiptKind({ billNumber }) ||
    "PURCHASE"
  );
}

/**
 * @param {object} deps
 * @param {(path:string,body:object)=>Promise<object>} deps.signedPost
 * @param {object} [deps.cfg] openclaw config
 * @param {string[]} [deps.mediaLocalRoots]
 * @param {string} [deps.billNumber] explicit override (auto-delivery / pick)
 * @param {string} [deps.receiptKindHint]
 * @param {boolean} [deps.autoDelivery]
 */
export async function runReceiptSend(deps) {
  const {
    wecomUserId,
    text,
    botId,
    messageId,
    signedPost,
    cfg,
    mediaLocalRoots,
    followup = false,
    markdown = true,
    billNumber: billNumberOverride,
    receiptKindHint,
    autoDelivery = false,
  } = deps;

  let billNumber =
    (billNumberOverride && String(billNumberOverride).trim().toUpperCase()) ||
    extractBillNumber(text);
  const pending = getPending(wecomUserId);

  // After NEED_CHOICE, bare GW-* is a receipt pick — never re-confirm.
  if (!billNumber && pending?.status === "NEED_CHOICE" && isBareBillPick(text)) {
    billNumber = extractBillNumber(text);
  }

  if (followup || isReceiptFollowup(text)) {
    if (!pending?.billNumber && !billNumber) {
      return {
        handled: true,
        text: sanitizeForChannel(
          "请先指定已审核单号，例如：发 GW-PURCHASE-119 回执 / 发 GW-MIX-12 回执",
          { markdown },
        ),
        sent: false,
      };
    }
    billNumber = billNumber || pending.billNumber;
  }

  let data;
  try {
    data = await signedPost("/aierp/v1/wecom/receipt/file", {
      wecomUserId,
      botId,
      channel: "wecom",
      billNumber: billNumber || undefined,
      messageMsgId: messageId || undefined,
      isGroup: false,
      eventSource: "WECOM_BEFORE_DISPATCH",
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/PDF\s*尚未生成|该回执 PDF/i.test(msg)) {
      return {
        handled: true,
        sent: false,
        pdfMissing: true,
        reason: "PDF_NOT_READY",
        billNumber,
        receiptKind: receiptKindHint || resolveReceiptKind({ billNumber }),
        text: sanitizeForChannel(
          autoDelivery
            ? "业务已完成；回执 PDF 尚未生成，可稍后回复「发回执」。"
            : msg.slice(0, 200),
          { markdown },
        ),
      };
    }
    throw err;
  }

  if (data?.needChoice || (data?.ambiguous && Array.isArray(data?.candidates) && data.candidates.length > 1)) {
    savePending(wecomUserId, {
      status: "NEED_CHOICE",
      candidates: (data.candidates || []).map((c) => c.billNumber).filter(Boolean),
    });
    return {
      handled: true,
      text: sanitizeForChannel(data.userSummaryZh || renderReceiptAmbiguous(data.candidates), {
        markdown,
      }),
      sent: false,
      needChoice: true,
      deliveryStatus: null,
    };
  }

  if (!data?.found || !data?.fileBase64) {
    const pdfMissing =
      data?.pdfStatus && data.pdfStatus !== "PDF_GENERATED" && data.pdfStatus !== "NONE";
    return {
      handled: true,
      text: sanitizeForChannel(data?.userSummaryZh || renderReceiptMissing(), { markdown }),
      sent: false,
      pdfMissing: !!pdfMissing || data?.found === false,
      reason: data?.found === false ? "NOT_FOUND" : "PDF_NOT_READY",
      billNumber: data?.billNumber || billNumber,
      receiptKind: inferKind(billNumber, data, receiptKindHint),
    };
  }

  const receiptKind = inferKind(data.billNumber || billNumber, data, receiptKindHint);
  const mediaPath = writeReceiptPdf(
    data.fileName || receiptFileTitle(receiptKind, data.billNumber || billNumber),
    data.fileBase64,
  );
  const facts = {
    ...factsFromReceiptApi(data),
    billNumber: data.billNumber,
    receiptKind,
  };
  const caption = sanitizeForChannel(renderReceiptReady(facts, markdown ? "markdown" : "plain"), {
    markdown,
  });

  savePending(wecomUserId, {
    billNumber: data.billNumber,
    receiptId: data.receiptId,
    pdfSha256: data.pdfSha256,
    mediaPath,
    receiptKind,
    status: DELIVERY_STATUS.PDF_READY,
    deliveryStatus: DELIVERY_STATUS.PDF_READY,
  });

  const roots = receiptMediaRoots([
    ...(mediaLocalRoots || []),
    ...(cfg?.channels?.wecom?.mediaLocalRoots || []),
  ]);

  const send = await sendWecomLocalFile({
    toUserId: wecomUserId,
    mediaPath,
    mediaLocalRoots: roots,
    cfg,
    captionText: undefined, // text delivered via before_dispatch return (markdown)
  });

  if (!send.ok) {
    savePending(wecomUserId, {
      billNumber: data.billNumber,
      receiptId: data.receiptId,
      pdfSha256: data.pdfSha256,
      mediaPath,
      receiptKind,
      status: "SEND_FAILED",
      deliveryStatus: DELIVERY_STATUS.PDF_READY,
      lastError: send.error,
    });
    return {
      handled: true,
      text: sanitizeForChannel(renderReceiptSendFailed(facts), { markdown }),
      sent: false,
      error: send.error,
      mediaPath,
      billNumber: data.billNumber,
      receiptKind,
      deliveryStatus: DELIVERY_STATUS.PDF_READY,
    };
  }

  // CHANNEL_ACCEPTED ≠ CLIENT_OPEN_VERIFIED (human client-open UAT only)
  const deliveryStatus = send.deliveryStatus || DELIVERY_STATUS.CHANNEL_ACCEPTED;

  savePending(wecomUserId, {
    billNumber: data.billNumber,
    receiptId: data.receiptId,
    pdfSha256: data.pdfSha256,
    mediaPath,
    receiptKind,
    status: deliveryStatus,
    deliveryStatus,
    messageId: send.messageId,
  });

  return {
    handled: true,
    text: caption,
    sent: true,
    mediaPath,
    billNumber: data.billNumber,
    receiptId: data.receiptId,
    receiptKind,
    messageId: send.messageId,
    deliveryStatus,
    // Never auto-set CLIENT_OPEN_VERIFIED here
  };
}

export function canHandleReceipt(text, wecomUserId) {
  if (isReceiptRequest(text)) return { sopId: "receipt-send", followup: false };
  if (isReceiptFollowup(text) && getPending(wecomUserId)) {
    return { sopId: "receipt-send", followup: true };
  }
  // Follow-up without pending: still claim to block excel template
  if (isReceiptFollowup(text)) return { sopId: "receipt-send", followup: true };

  // After NEED_CHOICE list, bare GW-* = receipt pick (not re-confirm / not LLM)
  const pending = getPending(wecomUserId);
  if (pending?.status === "NEED_CHOICE" && isBareBillPick(text)) {
    return { sopId: "receipt-send", followup: false, billPick: true };
  }
  return null;
}

export { DELIVERY_STATUS };
