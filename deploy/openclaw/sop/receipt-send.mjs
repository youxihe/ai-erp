/**
 * AIERP-015C receipt-send SOP: find authorized PDF → write controlled media → WeCom sendMedia.
 * Never posts inventory. Never calls erp_excel_template.
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
import { sendWecomLocalFile, receiptMediaRoots } from "./wecom-outbound.mjs";

const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // 2h

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
  /(?:采购入库业务回执|业务回执|入库回执|回执\s*PDF|PDF\s*(?:回执|凭证)|(?:发|给我|把|再发|要|下载|重发).{0,40}回执|回执.{0,12}(?:发我|给我|发一下|PDF)|重发回执)/i;

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

export function extractBillNumber(text) {
  const m = String(text || "").match(/\b(GW-PURCHASE-\d+)\b/i);
  return m ? m[1].toUpperCase() : undefined;
}

function writeReceiptPdf(fileName, base64) {
  const safe = basename(String(fileName || "receipt.pdf")).replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
  const path = join(receiptMediaDir(), `${Date.now()}_${safe}`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
}

/**
 * @param {object} deps
 * @param {(path:string,body:object)=>Promise<object>} deps.signedPost
 * @param {object} [deps.cfg] openclaw config
 * @param {string[]} [deps.mediaLocalRoots]
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
  } = deps;

  let billNumber = extractBillNumber(text);
  const pending = getPending(wecomUserId);

  if (followup || isReceiptFollowup(text)) {
    if (!pending?.billNumber && !billNumber) {
      return {
        handled: true,
        text: sanitizeForChannel("请先指定已审核单号，例如：发 GW-PURCHASE-119 回执", { markdown }),
        sent: false,
      };
    }
    billNumber = billNumber || pending.billNumber;
  }

  const data = await signedPost("/aierp/v1/wecom/receipt/file", {
    wecomUserId,
    botId,
    channel: "wecom",
    billNumber: billNumber || undefined,
    messageMsgId: messageId || undefined,
    isGroup: false,
    eventSource: "WECOM_BEFORE_DISPATCH",
  });

  if (data?.needChoice || (data?.ambiguous && Array.isArray(data?.candidates) && data.candidates.length > 1)) {
    return {
      handled: true,
      text: sanitizeForChannel(data.userSummaryZh || renderReceiptAmbiguous(data.candidates), { markdown }),
      sent: false,
    };
  }

  if (!data?.found || !data?.fileBase64) {
    return {
      handled: true,
      text: sanitizeForChannel(data?.userSummaryZh || renderReceiptMissing(), { markdown }),
      sent: false,
    };
  }

  const mediaPath = writeReceiptPdf(
    data.fileName || `采购入库业务回执_${data.billNumber || "bill"}.pdf`,
    data.fileBase64,
  );
  const facts = { ...factsFromReceiptApi(data), billNumber: data.billNumber };
  const caption = sanitizeForChannel(renderReceiptReady(facts, markdown ? "markdown" : "plain"), {
    markdown,
  });

  savePending(wecomUserId, {
    billNumber: data.billNumber,
    receiptId: data.receiptId,
    pdfSha256: data.pdfSha256,
    mediaPath,
    status: "FILE_READY",
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
      status: "SEND_FAILED",
      lastError: send.error,
    });
    return {
      handled: true,
      text: sanitizeForChannel(renderReceiptSendFailed(facts), { markdown }),
      sent: false,
      error: send.error,
      mediaPath,
      billNumber: data.billNumber,
    };
  }

  savePending(wecomUserId, {
    billNumber: data.billNumber,
    receiptId: data.receiptId,
    pdfSha256: data.pdfSha256,
    mediaPath,
    status: "SEND_ACCEPTED",
    messageId: send.messageId,
  });

  return {
    handled: true,
    text: caption,
    sent: true,
    mediaPath,
    billNumber: data.billNumber,
    receiptId: data.receiptId,
    messageId: send.messageId,
    // PDF_SENT_VERIFIED only after client open UAT
    deliveryStatus: "SEND_ACCEPTED",
  };
}

export function canHandleReceipt(text, wecomUserId) {
  if (isReceiptRequest(text)) return { sopId: "receipt-send", followup: false };
  if (isReceiptFollowup(text) && getPending(wecomUserId)) {
    return { sopId: "receipt-send", followup: true };
  }
  // Follow-up without pending: still claim to block excel template
  if (isReceiptFollowup(text)) return { sopId: "receipt-send", followup: true };
  return null;
}
