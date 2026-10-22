# -*- coding: utf-8 -*-
"""AIERP-015C: inject receipt intent + MEDIA PDF send into aierp-erp-tools plugin."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "deploy" / "openclaw" / "plugins" / "aierp-erp-tools" / "index.js"
text = PLUGIN.read_text(encoding="utf-8")

# --- helpers after isConfirmPhrase ---
HELPERS = r'''
function isReceiptRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  // Template / Excel asks without 回执 → not receipt
  if (/(模板|excel|\.xlsx|批量进货|进货模板)/i.test(t) && !/回执/.test(t)) return false;
  return /(?:采购入库业务回执|业务回执|入库回执|回执\s*PDF|PDF\s*(?:回执|凭证)|(?:发|给我|把|再发|要|下载).{0,16}回执|回执.{0,12}(?:发我|给我|发一下|PDF))/i.test(
    t,
  );
}

function extractReceiptBillNumber(text) {
  const m = String(text || "").match(/\b(GW-PURCHASE-\d+)\b/i);
  if (!m) return undefined;
  return m[1].toUpperCase();
}

function receiptMediaDir() {
  const state =
    process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state");
  const dir = join(state, "media", "aierp-receipt");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeReceiptPdfFile(fileName, base64) {
  const safe = basename(String(fileName || "receipt.pdf")).replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
  const path = join(receiptMediaDir(), `${Date.now()}_${safe}`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
}

async function handleReceiptRequest(senderId, text, messageId) {
  const billNumber = extractReceiptBillNumber(text);
  const data = await signedPost("/aierp/v1/wecom/receipt/file", {
    wecomUserId: senderId,
    botId: botId(),
    channel: CHANNEL_ID,
    billNumber: billNumber || undefined,
    messageMsgId: messageId || undefined,
    isGroup: false,
    eventSource: "WECOM_BEFORE_DISPATCH",
  });
  if (data?.needChoice || (data?.ambiguous && Array.isArray(data?.candidates) && data.candidates.length > 1)) {
    return { handled: true, text: String(data.userSummaryZh || "找到多张回执，请回复单号。") };
  }
  if (!data?.found || !data?.fileBase64) {
    return {
      handled: true,
      text: String(data?.userSummaryZh || "暂未找到可访问的已审核采购入库回执。"),
    };
  }
  const mediaPath = writeReceiptPdfFile(data.fileName || `采购入库业务回执_${data.billNumber || "bill"}.pdf`, data.fileBase64);
  const summary = String(data.userSummaryZh || `已找到采购单 ${data.billNumber}，已审核。`);
  // Channel strips MEDIA: and sends the file (same path as Excel templates).
  return { handled: true, text: `${summary}\nMEDIA: ${mediaPath}` };
}

'''

marker = "function isConfirmPhrase(text) {"
if "function isReceiptRequest(text)" not in text:
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("isConfirmPhrase not found")
    # insert after isConfirmPhrase function body
    end = text.find("\nfunction formatStock", idx)
    if end < 0:
        raise SystemExit("formatStock not found")
    text = text[:end] + "\n" + HELPERS + text[end:]

# --- excel template description guard ---
old_desc = (
    '"按场景生成真实 ERP Excel 并落盘，供企微 MEDIA 发送。scene=PURCHASE|MIX|SERVICE|SALE|INITIAL|PACK。"'
)
# try flexible replace on description line
import re

text2, n = re.subn(
    r'(name:\s*"erp_excel_template",\s*description:\s*")([^"]*)(")',
    r'\1按场景生成真实 ERP Excel 并落盘，供企微 MEDIA 发送。scene=PURCHASE|MIX|SERVICE|SALE|INITIAL|PACK。'
    r'仅用于「采购/配制模板」；用户要《采购入库业务回执》PDF 时禁止调用本工具（由渠道回执链路处理）。'
    r'\3',
    text,
    count=1,
    flags=re.S,
)
if n:
    text = text2

# --- before_dispatch receipt early claim ---
HOOK = '''
    // AIERP-015C: trusted receipt PDF request (never excel template / never re-post)
    if (isReceiptRequest(text)) {
      try {
        return await handleReceiptRequest(senderId, text, messageId);
      } catch (err) {
        return {
          handled: true,
          text:
            `暂无法发送回执：${String(err?.message || err).slice(0, 160)}。` +
            "入库结果以已审核单为准，可稍后重试或登录 ERP 下载回执。",
        };
      }
    }

'''

anchor = "    if (CANCEL_EXCEL.test(text)) {"
if "AIERP-015C: trusted receipt PDF request" not in text:
    if anchor not in text:
        raise SystemExit("CANCEL_EXCEL anchor not found")
    text = text.replace(anchor, HOOK + anchor, 1)

# description / header comment
text = text.replace(
    " * Confirm: before_dispatch trusted inbound",
    " * Confirm + receipt PDF: before_dispatch trusted inbound",
    1,
)
text = text.replace(
    "before_dispatch confirm + excel template/preview (no model confirm tools)",
    "before_dispatch confirm/receipt-PDF + excel template/preview (no model confirm tools)",
    1,
)

PLUGIN.write_text(text, encoding="utf-8")
print("patched", PLUGIN)

live = Path(r"F:/aierp-openclaw/state/extensions/aierp-erp-tools/index.js")
if live.parent.exists():
    # caller will backup + copy; just note
    print("live_target", live)
