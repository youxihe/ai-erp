# -*- coding: utf-8 -*-
"""Patch aierp-erp-tools for real WeCom PDF send + SOP routing + confirm formatting."""
from pathlib import Path
import re

PLUGIN = Path("deploy/openclaw/plugins/aierp-erp-tools/index.js")
text = PLUGIN.read_text(encoding="utf-8")

# --- 1) Add ESM imports after existing imports ---
IMPORT_BLOCK = """import {
  runReceiptSend,
  canHandleReceipt,
  getPending,
  isReceiptFollowup,
} from "./sop/receipt-send.mjs";
import {
  renderPurchaseConfirmed,
  factsFromConfirm,
  sanitizeForChannel,
} from "./sop/renderers/wecom-business.mjs";
"""

if 'from "./sop/receipt-send.mjs"' not in text:
    # insert after last import line
    m = re.search(r"(import \{[^}]+\} from \"node:path\";\n)", text)
    if not m:
        raise SystemExit("import anchor missing")
    text = text[: m.end()] + IMPORT_BLOCK + text[m.end() :]

# --- 2) Replace old isReceiptRequest / handleReceiptRequest helpers if present ---
# Remove function isReceiptRequest through handleReceiptRequest (old 015C helpers)
old_helpers = re.search(
    r"\nfunction isReceiptRequest\(text\) \{[\s\S]*?\nasync function handleReceiptRequest\([\s\S]*?\n\}\n",
    text,
)
if old_helpers:
    text = text[: old_helpers.start()] + "\n" + text[old_helpers.end() :]

# Also remove writeReceiptPdfFile / receiptMediaDir / extractReceiptBillNumber if left
for name in ("function receiptMediaDir", "function writeReceiptPdfFile", "function extractReceiptBillNumber", "function isReceiptRequest", "async function handleReceiptRequest"):
    while True:
        i = text.find("\n" + name)
        if i < 0:
            break
        # find end of function (next \nfunction or \nasync function at column 0-ish)
        rest = text[i + 1 :]
        m = re.search(r"\n(?:async )?function |\nconst [A-Z_]|\nexport ", rest[20:])
        end = i + 1 + 20 + m.start() if m else len(text)
        text = text[:i] + "\n" + text[end:]

# --- 3) Replace formatConfirm to use renderer ---
fmt = re.search(r"function formatConfirm\(data\) \{[\s\S]*?\n\}\n", text)
NEW_CONFIRM = '''function formatConfirm(data) {
  try {
    const facts = factsFromConfirm(data || {});
    if (facts.billNumber) {
      return sanitizeForChannel(renderPurchaseConfirmed(facts, "markdown"), { markdown: true });
    }
  } catch {
    // fall through
  }
  const bill = data?.billNumber || "?";
  const hint = data?.hint || data?.receiptText;
  if (hint && !String(hint).includes("{") && !/MEDIA:/i.test(String(hint))) {
    return String(hint).slice(0, 500);
  }
  return `✅ 采购入库完成\\n${bill} · 已审核`;
}

'''
if fmt:
    text = text[: fmt.start()] + NEW_CONFIRM + text[fmt.end() :]
elif "function formatConfirm" not in text:
    # insert before formatStock
    fs = text.find("function formatStock")
    text = text[:fs] + NEW_CONFIRM + text[fs:]

# --- 4) Replace before_dispatch receipt block ---
# Remove old AIERP-015C block if present
text = re.sub(
    r"\n\s*// AIERP-015C: trusted receipt PDF request[\s\S]*?if \(isReceiptRequest\(text\)\) \{[\s\S]*?\n    \}\n\n",
    "\n",
    text,
    count=1,
)

RECEIPT_HOOK = '''
    // AIERP-015C/020A: receipt SOP — real WeCom sendMedia (never MEDIA: text, never excel template)
    {
      const route = canHandleReceipt(text, senderId);
      if (route) {
        try {
          const result = await runReceiptSend({
            wecomUserId: senderId,
            text,
            botId: botId(),
            messageId,
            signedPost,
            cfg: apiRef?.config || {},
            mediaLocalRoots: apiRef?.config?.channels?.wecom?.mediaLocalRoots || [],
            followup: !!route.followup || isReceiptFollowup(text),
            markdown: true,
          });
          return { handled: true, text: result.text || "回执处理完成。" };
        } catch (err) {
          return {
            handled: true,
            text:
              `暂无法发送回执：${String(err?.message || err).slice(0, 160)}。` +
              "入库结果以已审核单为准，可稍后回复「重发回执」。",
          };
        }
      }
    }

'''

# Need apiRef in registerConfirmAndExcelDispatchHook — capture api
# Change function to close over api from register()
if "function registerConfirmAndExcelDispatchHook(api)" in text:
    text = text.replace(
        "function registerConfirmAndExcelDispatchHook(api) {\n  const handler = async (event, ctx) => {",
        "function registerConfirmAndExcelDispatchHook(api) {\n  const apiRef = api;\n  const handler = async (event, ctx) => {",
        1,
    )

anchor = "    if (CANCEL_EXCEL.test(text)) {"
if "AIERP-015C/020A: receipt SOP" not in text:
    if anchor not in text:
        raise SystemExit("CANCEL_EXCEL anchor missing")
    text = text.replace(anchor, RECEIPT_HOOK + anchor, 1)

# --- 5) Gate excel template when receipt pending ---
GATE = '''
function registerReceiptExcelGate(api) {
  const handler = async (event, ctx) => {
    const name = event?.toolName || event?.name || event?.tool || "";
    if (name !== "erp_excel_template") return;
    const wecomUserId = trustedWecomUserId(ctx) || String(ctx?.senderId || "").trim();
    if (!wecomUserId) return;
    const pending = getPending(wecomUserId);
    if (!pending || !pending.billNumber) return;
    if (pending.status === "SEND_ACCEPTED" || pending.status === "FILE_READY" || pending.status === "SEND_FAILED") {
      return {
        block: true,
        blockReason:
          `当前有待发送/可重发的已审核回执 ${pending.billNumber}。` +
          "请回复「重发回执」或「文件直接发我」，不要索取采购 Excel 模板。",
      };
    }
  };
  try {
    api.on("before_tool_call", handler, { matcher: ["erp_excel_template"], priority: 100 });
  } catch {
    try {
      api.on("before_tool_call", handler);
    } catch {
      // ignore
    }
  }
}

'''

if "function registerReceiptExcelGate" not in text:
    text = text.replace(
        "const plugin = {",
        GATE + "const plugin = {",
        1,
    )

if "registerReceiptExcelGate(api)" not in text:
    text = text.replace(
        "    registerPrepareGate(api);\n  },\n};",
        "    registerPrepareGate(api);\n    registerReceiptExcelGate(api);\n  },\n};",
        1,
    )

# header comment
text = text.replace(
    " * Confirm + receipt PDF: before_dispatch trusted inbound",
    " * Confirm + receipt SOP (real WeCom sendMedia, not MEDIA text)",
    1,
)

PLUGIN.write_text(text, encoding="utf-8")
print("patched", PLUGIN)
print("has runReceiptSend import", 'receipt-send.mjs' in text)
print("has receipt SOP hook", "AIERP-015C/020A: receipt SOP" in text)
print("has formatConfirm renderer", "renderPurchaseConfirmed" in text)
print("has excel gate", "registerReceiptExcelGate" in text)
