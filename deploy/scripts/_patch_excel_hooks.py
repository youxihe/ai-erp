# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"deploy/openclaw/plugins/aierp-erp-tools/index.js")
text = path.read_bytes().decode("utf-8")

cut = text.find("\nfunction registerExcelInboundHook")
if cut < 0:
    cut = text.find("\n/**\n * Trusted inbound xlsx")
if cut < 0:
    raise SystemExit("cannot find cut point")

new_tail = r'''

/**
 * AIERP-017A Round3: reliable Excel ingest via before_dispatch claim + message_received stash.
 * message_received is OBSERVE (do not rely on mutating event.content for LLM).
 * inbound_claim only runs for the conversation-owner plugin (WeCom), not us.
 * Filename is display-only — never a business qty source.
 */

const MEDIA_DOCUMENT = "<media:document>";
const CANCEL_EXCEL = /^\s*(取消文件|取消Excel|取消excel|不用文件了|放弃文件|关闭文件流程)\s*$/i;
const excelByMessage = new Map();
const excelBySession = new Map();
const previewDedup = new Map();

function maskSender(id) {
  const s = String(id || "");
  if (s.length < 4) return "***";
  return s.slice(0, 2) + "***";
}

function hashMsg(id) {
  if (!id) return "none";
  return createHash("sha256").update(String(id), "utf8").digest("hex").slice(0, 12);
}

function redactExcelLog(fields) {
  try {
    console.info("[aierp-excel]", JSON.stringify(fields));
  } catch {
    // ignore
  }
}

function collectXlsxPaths(event, ctx) {
  const paths = []
    .concat(event?.mediaPaths || [])
    .concat(event?.media?.map?.((m) => m?.path) || [])
    .concat(event?.originalMedia?.map?.((m) => m?.path) || [])
    .concat(event?.metadata?.mediaPaths || [])
    .concat(ctx?.mediaPaths || [])
    .concat(event?.MediaPaths || [])
    .filter(Boolean)
    .map((p) => String(p));
  return paths.filter((p) => p.toLowerCase().endsWith(".xlsx"));
}

function attachmentCount(event) {
  return (
    (Array.isArray(event?.media) ? event.media.length : 0) ||
    (Array.isArray(event?.mediaPaths) ? event.mediaPaths.length : 0) ||
    (Array.isArray(event?.MediaPaths) ? event.MediaPaths.length : 0) ||
    0
  );
}

function storeWorkflow(wf) {
  if (wf.messageId) excelByMessage.set(String(wf.messageId), wf);
  if (wf.sessionKey) excelBySession.set(String(wf.sessionKey), wf);
}

function getWorkflow(messageId, sessionKey) {
  if (messageId && excelByMessage.has(String(messageId))) return excelByMessage.get(String(messageId));
  if (sessionKey && excelBySession.has(String(sessionKey))) return excelBySession.get(String(sessionKey));
  return null;
}

function workflowBlocksPrepare(wf) {
  if (!wf) return false;
  return wf.status === "PENDING" || wf.status === "PREVIEWED" || wf.status === "FAILED";
}

function formatPreviewLines(data) {
  const lines = [];
  lines.push("status=PREVIEWED");
  lines.push(`previewId=${data?.previewId || "?"}`);
  lines.push("posted=false");
  lines.push("stockUnchanged=true");
  lines.push("说明：以下数量/金额来自 XLSX 单元格，不是文件名。本阶段仅预览，不会入库，不会创建采购草稿。");
  if (data?.hintZh || data?.hint) lines.push(String(data.hintZh || data.hint));
  const records = Array.isArray(data?.records) ? data.records : [];
  for (const rec of records.slice(0, 20)) {
    const errs = Array.isArray(rec?.errors) ? rec.errors.filter(Boolean) : [];
    const norm = rec?.normalized || {};
    const purchaseLines = Array.isArray(norm.lines) ? norm.lines : [];
    lines.push(`— 业务单 ${rec?.businessKey || "?"} scene=${rec?.scene || "?"} canConfirm=${!!rec?.canConfirm}`);
    if (norm.organName) lines.push(`  供应商/客户: ${norm.organName}`);
    for (const ln of purchaseLines.slice(0, 10)) {
      lines.push(
        `  行: 物料=${ln.barCode || "?"} 仓库=${ln.depotName || "?"} 数量=${ln.qty || "?"} ${ln.unit || ""} 单价=${ln.unitPrice || ln.price || "-"}`,
      );
    }
    if (norm.finished) {
      const f = norm.finished;
      lines.push(`  成品: ${f.barCode || "?"} 仓库=${f.depotName || "?"} 数量=${f.qty || "?"} ${f.unit || ""}`);
    }
    if (errs.length) lines.push(`  错误: ${errs.join("; ")}`);
  }
  if (!records.length) lines.push("（无明细行）");
  lines.push("若要放弃文件流程并改口头采购，请回复：取消文件");
  return lines.join("\n");
}

async function runExcelPreview({ wecomUserId, xlsxPath, messageId, sessionKey, stagingPending }) {
  const displayName = xlsxPath ? basename(xlsxPath) : "upload.xlsx";
  const wfBase = {
    status: "PENDING",
    messageId: messageId || null,
    sessionKey: sessionKey || null,
    wecomUserId,
    displayName,
    stagingPending: !!stagingPending,
    at: Date.now(),
  };
  storeWorkflow(wfBase);
  redactExcelLog({
    phase: "ingest_start",
    messageIdHash: hashMsg(messageId),
    senderMasked: maskSender(wecomUserId),
    attachmentCount: 1,
    pathReady: !!(xlsxPath && existsSync(xlsxPath)),
    stagingPending: !!stagingPending,
    nameHasXlsx: displayName.toLowerCase().endsWith(".xlsx"),
  });

  if (stagingPending) {
    const failed = {
      ...wfBase,
      status: "FAILED",
      reason: "FILE_STAGING_PENDING",
      replyText:
        "FILE_PARSE_FAILED：附件仍在暂存中，尚未取得可用字节。请稍后重新发送同一个 .xlsx（不要根据文件名猜数量）。",
    };
    storeWorkflow(failed);
    await signedPost("/aierp/v1/wecom/excel/workflow/status", {
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      status: "FAILED",
      reason: "FILE_STAGING_PENDING",
      messageMsgId: messageId || undefined,
    }).catch(() => {});
    return failed;
  }

  if (!xlsxPath || !existsSync(xlsxPath)) {
    const failed = {
      ...wfBase,
      status: "FAILED",
      reason: "FILE_BYTES_MISSING",
      replyText:
        "FILE_PARSE_FAILED：未取得可信附件本地路径/字节，无法解析。禁止根据文件名或聊天猜测数量。请重新发送 .xlsx。",
    };
    storeWorkflow(failed);
    await signedPost("/aierp/v1/wecom/excel/workflow/status", {
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      status: "FAILED",
      reason: "FILE_BYTES_MISSING",
      messageMsgId: messageId || undefined,
    }).catch(() => {});
    return failed;
  }

  if (messageId && previewDedup.has(String(messageId))) {
    const existing = getWorkflow(messageId, sessionKey);
    if (existing?.status === "PREVIEWED") return existing;
  }

  try {
    const buf = readFileSync(xlsxPath);
    if (buf.length > 2 * 1024 * 1024) {
      const failed = {
        ...wfBase,
        status: "FAILED",
        reason: "FILE_TOO_LARGE",
        replyText: "FILE_PARSE_FAILED：Excel 超过 2MB。库存未变化，未创建草稿。",
      };
      storeWorkflow(failed);
      return failed;
    }
    const fileSha256 = createHash("sha256").update(buf).digest("hex");
    const data = await signedPost("/aierp/v1/wecom/excel/preview", {
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      fileName: displayName,
      fileBase64: buf.toString("base64"),
      fileSha256,
      messageMsgId: messageId || null,
      openWorkflow: true,
    });
    if (!data?.previewId) {
      const failed = {
        ...wfBase,
        status: "FAILED",
        reason: "NO_PREVIEW_ID",
        fileSha256,
        replyText: "FILE_PARSE_FAILED：ERP 未返回 previewId，不能宣称已解析。库存未变。",
      };
      storeWorkflow(failed);
      redactExcelLog({
        phase: "parse_failed",
        messageIdHash: hashMsg(messageId),
        senderMasked: maskSender(wecomUserId),
        fileSha256,
        reason: "NO_PREVIEW_ID",
      });
      return failed;
    }
    const replyText = formatPreviewLines(data);
    const ok = {
      ...wfBase,
      status: "PREVIEWED",
      previewId: data.previewId,
      fileSha256,
      byteLength: buf.length,
      replyText,
      data,
    };
    storeWorkflow(ok);
    if (messageId) previewDedup.set(String(messageId), data.previewId);
    redactExcelLog({
      phase: "parse_ok",
      messageIdHash: hashMsg(messageId),
      senderMasked: maskSender(wecomUserId),
      fileSha256,
      byteLength: buf.length,
      previewId: data.previewId,
      recordCount: Array.isArray(data?.records) ? data.records.length : 0,
    });
    return ok;
  } catch (err) {
    const failed = {
      ...wfBase,
      status: "FAILED",
      reason: "ERP_PREVIEW_ERROR",
      replyText: `FILE_PARSE_FAILED：${String(err?.message || err)}。未根据文件名推断业务数据；库存未变；未创建草稿。`,
    };
    storeWorkflow(failed);
    redactExcelLog({
      phase: "parse_error",
      messageIdHash: hashMsg(messageId),
      senderMasked: maskSender(wecomUserId),
      reason: String(err?.message || err).slice(0, 160),
    });
    return failed;
  }
}

async function waitForWorkflow(messageId, sessionKey, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const wf = getWorkflow(messageId, sessionKey);
    if (wf && wf.status !== "PENDING") return wf;
    await new Promise((r) => setTimeout(r, 200));
  }
  return getWorkflow(messageId, sessionKey);
}

function registerExcelObserveHook(api) {
  const handler = async (event, ctx) => {
    try {
      const channel = String(ctx?.channelId || ctx?.messageChannel || event?.channel || "").toLowerCase();
      if (channel && channel !== CHANNEL_ID && !channel.includes("wecom")) return;
      if (event?.isGroup || ctx?.isGroup) return;
      const stagingPending = !!(event?.mediaStagingPending || event?.metadata?.mediaStagingPending);
      const paths = collectXlsxPaths(event, ctx);
      if (!paths.length && !stagingPending) return;
      const wecomUserId = String(event?.senderId || ctx?.senderId || ctx?.requesterSenderId || "").trim();
      if (!wecomUserId) {
        redactExcelLog({ phase: "observe_no_sender", messageIdHash: hashMsg(event?.messageId) });
        return;
      }
      const messageId = event?.messageId || event?.MessageSid || null;
      const sessionKey = ctx?.sessionKey || event?.sessionKey || null;
      redactExcelLog({
        phase: "observe",
        messageIdHash: hashMsg(messageId),
        senderMasked: maskSender(wecomUserId),
        attachmentCount: attachmentCount(event) || paths.length,
        pathReady: paths.some((p) => existsSync(p)),
        stagingPending,
      });
      await runExcelPreview({
        wecomUserId,
        xlsxPath: paths[0] || "",
        messageId,
        sessionKey,
        stagingPending,
      });
    } catch (err) {
      redactExcelLog({ phase: "observe_error", reason: String(err?.message || err).slice(0, 160) });
    }
  };
  try {
    api.on("message_received", handler, { priority: 100 });
  } catch {
    try {
      api.on("message_received", handler);
    } catch {
      // ignore
    }
  }
}

function registerConfirmAndExcelDispatchHook(api) {
  const handler = async (event, ctx) => {
    const channelId = ctx?.channelId || event?.channel;
    if (channelId !== CHANNEL_ID) return;
    const senderId = String(event?.senderId || ctx?.senderId || "").trim();
    if (!senderId) return;
    if (event?.isGroup) return;
    const text = String(event?.content || event?.body || "").trim();
    const messageId = event?.messageId || ctx?.messageId || null;
    const sessionKey = ctx?.sessionKey || event?.sessionKey || null;

    if (CANCEL_EXCEL.test(text)) {
      const cleared = {
        status: "CANCELLED",
        messageId,
        sessionKey,
        wecomUserId: senderId,
        at: Date.now(),
        replyText: "已关闭 Excel 文件流程。现在可以重新发起独立的口头采购（不使用文件名/旧预览）。",
      };
      storeWorkflow(cleared);
      try {
        await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
          wecomUserId: senderId,
          botId: botId(),
          channel: CHANNEL_ID,
          messageMsgId: messageId || undefined,
        });
      } catch {
        // ignore
      }
      return { handled: true, text: cleared.replyText };
    }

    if (isConfirmPhrase(text)) {
      try {
        const data = await signedPost("/aierp/v1/wecom/draft/confirm", {
          wecomUserId: senderId,
          botId: botId(),
          channel: CHANNEL_ID,
          rawText: text,
          messageMsgId: messageId || undefined,
          isGroup: false,
          eventSource: "WECOM_BEFORE_DISPATCH",
        });
        return { handled: true, text: formatConfirm(data) };
      } catch (err) {
        return { handled: true, text: `确认未完成：${String(err?.message || err)}` };
      }
    }

    const paths = collectXlsxPaths(event, ctx);
    const looksLikeDoc =
      text === MEDIA_DOCUMENT ||
      text.includes(MEDIA_DOCUMENT) ||
      /\.xlsx\b/i.test(text) ||
      paths.length > 0;

    if (!looksLikeDoc) return;

    let wf = getWorkflow(messageId, sessionKey);
    if ((!wf || wf.status === "PENDING") && paths.length) {
      wf = await runExcelPreview({
        wecomUserId: senderId,
        xlsxPath: paths[0],
        messageId,
        sessionKey,
        stagingPending: false,
      });
    } else if (!wf || wf.status === "PENDING") {
      wf = (await waitForWorkflow(messageId, sessionKey, 8000)) || wf;
    }

    if (!wf || wf.status === "PENDING") {
      redactExcelLog({
        phase: "dispatch_no_bytes",
        messageIdHash: hashMsg(messageId),
        senderMasked: maskSender(senderId),
        attachmentCount: paths.length,
        pathReady: false,
      });
      return {
        handled: true,
        text:
          "FILE_PARSE_FAILED：未在 LLM 前取得可信 XLSX 字节（观察钩子未完成或附件路径缺失）。" +
          "不能根据文件名中的数量创建草稿。请重新发送 .xlsx 文件。",
      };
    }

    return { handled: true, text: wf.replyText || formatPreviewLines(wf.data || {}) };
  };
  try {
    api.on("before_dispatch", handler, { priority: 50 });
  } catch {
    api.on("before_dispatch", handler);
  }
}

function registerPrepareGate(api) {
  const handler = async (event, ctx) => {
    const name = event?.toolName || event?.name || event?.tool || "";
    if (name !== "erp_purchase_prepare") return;
    const sessionKey = ctx?.sessionKey || event?.sessionKey || null;
    const wf = getWorkflow(null, sessionKey);
    let serverBlocks = false;
    try {
      const wecomUserId = trustedWecomUserId(ctx) || String(ctx?.senderId || "").trim();
      if (wecomUserId) {
        const st = await signedPost("/aierp/v1/wecom/excel/workflow/status", {
          wecomUserId,
          botId: botId(),
          channel: CHANNEL_ID,
        });
        if (st && (st.status === "PENDING" || st.status === "PREVIEWED" || st.status === "FAILED")) {
          serverBlocks = true;
        }
      }
    } catch {
      // local gate still applies
    }
    if (!workflowBlocksPrepare(wf) && !serverBlocks) return;
    return {
      block: true,
      blockReason:
        "Excel 文件流程未关闭：禁止用口头/文件名猜测调用 erp_purchase_prepare 创建“文件草稿”。" +
        "请等待 PREVIEWED（含 previewId 与单元格数量）或回复「取消文件」后重新口头下单。不要确认草稿 #113。",
    };
  };
  try {
    api.on("before_tool_call", handler, { matcher: ["erp_purchase_prepare"], priority: 100 });
  } catch {
    try {
      api.on("before_tool_call", handler);
    } catch {
      // ignore
    }
  }
}

const plugin = {
  id: "aierp-erp-tools",
  name: "AIERP ERP Tools",
  description:
    "WeCom trusted-identity ERP: queries + purchase draft + before_dispatch confirm + excel template/preview (no model confirm tools)",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    registerErpTools(api);
    registerExcelObserveHook(api);
    registerConfirmAndExcelDispatchHook(api);
    registerPrepareGate(api);
  },
};

export default plugin;
'''

out = text[:cut] + new_tail
path.write_bytes(out.encode("utf-8"))
print("ok", len(out), "cells" in out, "registerPrepareGate" in out)
