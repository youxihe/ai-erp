# -*- coding: utf-8 -*-
"""Generate AIERP-015B OpenClaw plugin (UTF-8) into deploy + F: extension."""
from pathlib import Path

PLUGIN = r'''/**
 * AIERP-012A/013/015A/015B OpenClaw tool plugin.
 * Trusts only ctx.requesterSenderId when ctx.messageChannel === "wecom".
 * Confirm: before_dispatch trusted inbound → Java (never LLM erp_draft_confirm tool).
 */
import { createHmac, randomBytes } from "node:crypto";

const CHANNEL_ID = "wecom";
const DEFAULT_BASE = "http://127.0.0.1:9999/jshERP-boot";
const MIN_SECRET_LEN = 32;
const BANNED_SECRET_SNIPPETS = ["change-me", "changeme", "example", "placeholder", "aierp-local-wecom-adapter"];
const CONFIRM_PURCHASE = /^\s*确认\s*采购\s*[#＃]?\s*(\d+)\s*$/;
const CONFIRM_SIMPLE = /^\s*确认\s*$/;

function emptyPluginConfigSchema() {
  return {
    safeParse(value) {
      return { success: true, data: value ?? {} };
    },
  };
}

function trustedWecomUserId(ctx) {
  if (ctx?.messageChannel !== CHANNEL_ID) return null;
  const id = ctx.requesterSenderId?.trim();
  return id || null;
}

function isWecomGroupChat(ctx) {
  const candidates = [ctx?.chatType, ctx?.deliveryContext?.chatType, ctx?.deliveryContext?.target?.chatType]
    .filter((v) => v != null)
    .map((v) => String(v).toLowerCase());
  for (const ct of candidates) {
    if (ct === "group" || ct === "channel") return true;
    if (ct === "direct" || ct === "dm" || ct === "single" || ct === "private") return false;
  }
  const hay = [ctx?.sessionKey, ctx?.nativeChannelId, ctx?.deliveryContext?.to, ctx?.groupId, ctx?.groupChannel]
    .filter((v) => v != null)
    .map((v) => String(v).toLowerCase())
    .join("|");
  if (!hay) return false;
  return /(?:^|[|:/])group(?:[|:/]|$)/.test(hay) || /(?:^|[|:/])channel(?:[|:/]|$)/.test(hay);
}

function adapterSecret() {
  const secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) throw new Error("AIERP_WECOM_ADAPTER_SECRET missing in OpenClaw environment");
  if (secret.length < MIN_SECRET_LEN) throw new Error(`AIERP_WECOM_ADAPTER_SECRET too short (min ${MIN_SECRET_LEN})`);
  const lower = secret.toLowerCase();
  for (const banned of BANNED_SECRET_SNIPPETS) {
    if (lower.includes(banned) || lower === "secret" || lower === "password" || lower === "default") {
      throw new Error("AIERP_WECOM_ADAPTER_SECRET is a banned placeholder; rotate to a high-entropy value");
    }
  }
  return secret;
}

function erpBase() {
  return (process.env.AIERP_ERP_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function botId() {
  const aierp = (process.env.AIERP_WECOM_BOT_ID || "").trim();
  if (aierp && aierp !== "default") return aierp;
  const wecom = (process.env.WECOM_BOT_ID || "").trim();
  if (wecom) return wecom;
  return "default";
}

async function signedPost(path, bodyObj) {
  const secret = adapterSecret();
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const method = "POST";
  const urlPath = path.startsWith("/jshERP-boot") ? path : `/jshERP-boot${path}`;
  const payload = `${method}\n${urlPath}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const url = `${erpBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Aierp-Adapter-Timestamp": ts,
      "X-Aierp-Adapter-Nonce": nonce,
      "X-Aierp-Adapter-Signature": sig,
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ERP adapter non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 500 && text === "loginOut") {
    throw new Error("ERP session filter rejected adapter call — check allowlist for /aierp/v1/wecom/*");
  }
  if (json.code !== 200) {
    const msg = json.data?.message || json.message || JSON.stringify(json).slice(0, 240);
    throw new Error(msg);
  }
  return json.data;
}

function toolResult(ok, text, details) {
  return {
    content: [{ type: "text", text }],
    details: {
      ok,
      summary: text,
      nature: details?.nature || (ok ? "REAL_ERP" : "ERROR"),
      ...(details || {}),
    },
  };
}

function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function isConfirmPhrase(text) {
  const t = String(text || "").trim();
  return CONFIRM_PURCHASE.test(t) || CONFIRM_SIMPLE.test(t);
}

function formatStock(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) {
    return `未查到库存。登录用户 ${data?.boundErpLoginName || data?.loginName || "?"}。`;
  }
  const lines = rows.map((r) => {
    const qty = r.currentStock == null ? "?" : String(r.currentStock);
    return `- ${r.materialName}（${r.barCode}）@ ${r.depotName}：${qty} ${r.unit || ""}`.trim();
  });
  const asOf = data.asOf ? `\n时间：${data.asOf}` : "";
  return `ERP 实时库存（账号 ${data.boundErpLoginName || data.loginName}）：\n${lines.join("\n")}${asOf}`;
}

function formatMaterial(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return data?.hint || "未找到物料。";
  const lines = rows.map(
    (r) =>
      `- ${r.materialName}（${r.barCode}）单位 ${r.unit || "?"}，分类 ${r.categoryName || "?"}，${r.enabled ? "启用" : "停用"}`,
  );
  return (data.ambiguous ? "找到多个候选，请用编码确认：\n" : "物料：\n") + lines.join("\n");
}

function formatPartner(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return data?.hint || `未找到${data?.partnerType || "往来单位"}。`;
  const lines = rows.map((r) => `- ${r.partnerName}（${r.partnerType}${r.enabled ? "" : "，停用"}）`);
  return `${data.partnerType}：\n${lines.join("\n")}`;
}

function formatBills(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return data?.hint || "暂无单据。";
  const lines = rows.map(
    (r) =>
      `- ${r.billNumber} ${r.billTypeLabel} ${r.statusLabel} ${r.operTime}${r.partnerName ? " · " + r.partnerName : ""} 金额 ${r.totalAmount}`,
  );
  return `${data.billTypeLabel || "单据"}（${data.fromDate}~${data.toDate}）：\n${lines.join("\n")}`;
}

function formatBillDetail(data) {
  const b = data?.bill || {};
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const head = `${b.billNumber || "?"} ${b.billTypeLabel || ""} ${b.statusLabel || ""} ${b.operTime || ""}${
    b.partnerName ? " · " + b.partnerName : ""
  } 金额 ${b.totalAmount ?? "?"}`;
  if (!lines.length) return head + "\n（无可视明细行）";
  const body = lines.map(
    (r) =>
      `- ${r.materialName}（${r.barCode}）@ ${r.depotName}：${r.qty} ${r.unit || ""} 单价 ${r.unitPrice ?? "-"}`,
  );
  return `${head}\n${body.join("\n")}`;
}

function formatReport(data) {
  if (data?.hint && (!data.rowCount || data.rowCount === 0)) return data.hint;
  const label = data?.reportLabel || data?.report || "经营摘要";
  const range = `${data?.fromDate || "?"}~${data?.toDate || "?"}`;
  if (data?.report === "purchase_in_summary" && data?.totals) {
    const t = data.totals;
    return `${label}（${range}，${data.statusFilter || "已审核"}）：单据 ${t.billCount} 张，数量合计 ${t.totalQty}，金额合计 ${t.totalAmount}。数据来自 ERP，非模型估算。`;
  }
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return data?.hint || `${label}：暂无数据。`;
  const lines = rows.map(
    (r) => `- ${r.partnerName || "合计"}：单据 ${r.billCount}，数量 ${r.totalQty}，金额 ${r.totalAmount}`,
  );
  return `${label}（${range}）：\n${lines.join("\n")}\n数据来自 ERP，非模型估算。`;
}

function formatPurchaseDraft(data) {
  const s = data?.summary || {};
  const ch = data?.challenge || {};
  const lines = [
    `采购草稿 #${data?.draftId ?? "?"} · ${data?.statusLabel || data?.status || "DRAFT"}`,
    `- 物料：${s.materialName || "?"}（${s.barCode || "?"}）`,
    `- 数量：${s.qty ?? "?"} ${s.unit || ""} → ${s.depotName || "?"}`,
    `- 供应商：${s.partnerName || "?"}`,
    s.amount != null ? `- 参考金额：${s.amount}` : null,
    `- 库存：${s.stockDeltaHint || "确认后才会变化"}`,
    `- 账号：${data?.boundErpLoginName || "?"}`,
    data?.hint || ch.hint || `待确认、未入库。请回复「确认采购${data?.draftId ?? "?"}」。`,
  ].filter(Boolean);
  return lines.join("\n");
}

function formatConfirm(data) {
  if (data?.receiptText) return String(data.receiptText);
  if (data?.hint) return String(data.hint);
  const before = data?.stockBefore ? JSON.stringify(data.stockBefore) : "?";
  const after = data?.stockAfter ? JSON.stringify(data.stockAfter) : "?";
  return `采购入库已完成（已审核）\n原生单号：${data?.billNumber || "?"}\n库存：${before} → ${after}`;
}

function registerErpTools(api) {
  const make = (name, description, path, paramSchema, buildBody, format) => {
    api.registerTool(
      (ctx) => ({
        name,
        description,
        parameters: paramSchema,
        async execute(_id, params) {
          const wecomUserId = trustedWecomUserId(ctx);
          if (!wecomUserId) {
            return toolResult(false, "当前会话没有可信的企业微信发送者身份，无法执行 ERP 工具。请在企微私聊中操作。", {
              reason: "NO_TRUSTED_WECOM_SENDER",
              messageChannel: ctx?.messageChannel || null,
            });
          }
          if (isWecomGroupChat(ctx)) {
            return toolResult(false, "ERP 工具仅支持企微私聊，请勿在群聊中查询或绑定。", {
              reason: "WECOM_GROUP_NOT_ALLOWED",
              chatType: ctx?.chatType || null,
            });
          }
          try {
            const data = await signedPost(path, buildBody(wecomUserId, params || {}));
            const formatted = format(data);
            const text = typeof formatted === "string" ? formatted : formatted.text;
            const extra = typeof formatted === "string" ? {} : formatted.details || {};
            return toolResult(true, text, { tool: name, nature: data?.nature || "REAL_ERP", ...extra });
          } catch (err) {
            return toolResult(false, String(err?.message || err), { reason: "ERP_ADAPTER_ERROR", tool: name });
          }
        },
      }),
      { name },
    );
  };

  const stockParams = {
    type: "object",
    properties: {
      query: { type: "string", description: "物料中文名/编码关键字" },
      barCode: { type: "string", description: "物料编码（可选）" },
      depotName: { type: "string", description: "仓库名称（可选）" },
    },
    additionalProperties: false,
  };

  make(
    "erp_bind_start",
    "为企业微信当前用户签发一次性 ERP 绑定码（5 分钟）。仅私聊。不要索取 ERP 密码。",
    "/aierp/v1/wecom/binding/issue",
    { type: "object", properties: {}, additionalProperties: false },
    (wecomUserId) => ({ wecomUserId, botId: botId(), channel: CHANNEL_ID }),
    (data) => ({
      text: `绑定码：${data.bindCode}\n有效期 ${data.expiresInSec ?? 300} 秒。请打开已登录的 ERP 工作台「绑定企业微信」输入该码。勿把 ERP 密码发到聊天。`,
      details: { bindCode: data.bindCode, expiresInSec: data.expiresInSec ?? 300, nature: "REAL_ERP" },
    }),
  );

  make(
    "erp_binding_status",
    "查询当前企微用户是否已绑定 ERP（仅私聊）。",
    "/aierp/v1/wecom/binding/status",
    { type: "object", properties: {}, additionalProperties: false },
    (wecomUserId) => ({ wecomUserId, botId: botId(), channel: CHANNEL_ID }),
    (data) => ({
      text: data.bound
        ? `已绑定 ERP 账号 ${data.erpLoginName}（租户 ${data.tenantId}）。`
        : data.hint || "尚未绑定 ERP。",
      details: { bound: !!data.bound, erpLoginName: data.erpLoginName || null, tenantId: data.tenantId ?? null },
    }),
  );

  make(
    "erp_unbind",
    "解除当前企微用户与 ERP 的绑定（仅私聊）。",
    "/aierp/v1/wecom/binding/unbind",
    { type: "object", properties: {}, additionalProperties: false },
    (wecomUserId) => ({ wecomUserId, botId: botId(), channel: CHANNEL_ID }),
    (data) => ({
      text: data.unbound ? "已解绑 ERP。" : "当前没有有效绑定。",
      details: { unbound: !!data.unbound },
    }),
  );

  make(
    "erp_stock_query",
    "按当前已绑定 ERP 用户权限查询实时库存（仅私聊；物料中文名、编码、仓库、单位、数量）。",
    "/aierp/v1/wecom/stock/query",
    stockParams,
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      query: str(p.query),
      barCode: str(p.barCode),
      depotName: str(p.depotName),
    }),
    (data) => ({
      text: formatStock(data),
      details: {
        boundErpLoginName: data?.boundErpLoginName || data?.loginName || null,
        rowCount: Array.isArray(data?.rows) ? data.rows.length : 0,
        rows: Array.isArray(data?.rows) ? data.rows : [],
        asOf: data?.asOf || null,
      },
    }),
  );

  make(
    "erp_material_search",
    "查询物料主数据：中文名、编码、单位、分类、启停用。模糊多候选时请用户确认编码。只读。",
    "/aierp/v1/wecom/material/search",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "物料中文名或编码关键字" },
        barCode: { type: "string", description: "精确物料编码" },
        limit: { type: "number", description: "返回行数，默认 10，最大 50" },
      },
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      query: str(p.query),
      barCode: str(p.barCode),
      limit: num(p.limit),
    }),
    (data) => ({
      text: formatMaterial(data),
      details: { rowCount: data?.rowCount ?? 0, ambiguous: !!data?.ambiguous, rows: data?.rows || [] },
    }),
  );

  make(
    "erp_partner_search",
    "查询供应商或客户主数据（名称、类型、启停用）。partnerType=supplier|customer。不含电话地址成本。只读。",
    "/aierp/v1/wecom/partner/search",
    {
      type: "object",
      properties: {
        partnerType: { type: "string", description: "supplier 或 customer" },
        query: { type: "string", description: "名称关键字" },
        limit: { type: "number", description: "返回行数，默认 10，最大 50" },
      },
      required: ["partnerType"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      partnerType: str(p.partnerType),
      query: str(p.query),
      limit: num(p.limit),
    }),
    (data) => ({
      text: formatPartner(data),
      details: { partnerType: data?.partnerType || null, rowCount: data?.rowCount ?? 0, rows: data?.rows || [] },
    }),
  );

  make(
    "erp_bill_search",
    "查询采购入库/组装配制/服务耗料单据列表。billType=purchase|mix|service。可按日期、状态、单号、往来单位过滤。只读，不把采购/组装当成销售收入。",
    "/aierp/v1/wecom/bill/search",
    {
      type: "object",
      properties: {
        billType: { type: "string", description: "purchase | mix | service" },
        fromDate: { type: "string", description: "yyyy-MM-dd" },
        toDate: { type: "string", description: "yyyy-MM-dd" },
        days: { type: "number", description: "近 N 天（1-90），与 from/to 二选一" },
        status: { type: "string", description: "已审核|未审核 或 1|0" },
        query: { type: "string", description: "单号关键字" },
        partnerName: { type: "string", description: "供应商或客户名称关键字" },
        limit: { type: "number", description: "默认 10，最大 50" },
      },
      required: ["billType"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      billType: str(p.billType),
      fromDate: str(p.fromDate),
      toDate: str(p.toDate),
      days: num(p.days),
      status: str(p.status),
      query: str(p.query),
      partnerName: str(p.partnerName),
      limit: num(p.limit),
    }),
    (data) => ({
      text: formatBills(data),
      details: {
        billType: data?.billType,
        fromDate: data?.fromDate,
        toDate: data?.toDate,
        rowCount: data?.rowCount ?? 0,
        rows: data?.rows || [],
      },
    }),
  );

  make(
    "erp_bill_detail",
    "按单据编号查询采购/组装/服务耗料明细行（物料、仓库、数量、单价）。须当前租户且仓库授权。只读。",
    "/aierp/v1/wecom/bill/detail",
    {
      type: "object",
      properties: { billNumber: { type: "string", description: "原生单据编号，如 GW-PURCHASE-94" } },
      required: ["billNumber"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      billNumber: str(p.billNumber),
    }),
    (data) => ({
      text: formatBillDetail(data),
      details: { bill: data?.bill || null, lineCount: data?.lineCount ?? 0, lines: data?.lines || [] },
    }),
  );

  make(
    "erp_report_query",
    "经营摘要（后端聚合，禁止模型编造）。report=purchase_in_summary（采购入库汇总）或 service_consume_by_customer（按客户服务耗料）。仅已审核；跨度≤90天。",
    "/aierp/v1/wecom/report/query",
    {
      type: "object",
      properties: {
        report: { type: "string", description: "purchase_in_summary | service_consume_by_customer" },
        fromDate: { type: "string", description: "yyyy-MM-dd" },
        toDate: { type: "string", description: "yyyy-MM-dd" },
        days: { type: "number", description: "近 N 天，默认 7" },
        partnerName: { type: "string", description: "客户名称过滤（服务耗料报表）" },
      },
      required: ["report"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      report: str(p.report),
      fromDate: str(p.fromDate),
      toDate: str(p.toDate),
      days: num(p.days),
      partnerName: str(p.partnerName),
    }),
    (data) => ({
      text: formatReport(data),
      details: {
        report: data?.report,
        fromDate: data?.fromDate,
        toDate: data?.toDate,
        totals: data?.totals || null,
        rowCount: data?.rowCount ?? 0,
        rows: data?.rows || [],
        hint: data?.hint || null,
      },
    }),
  );

  make(
    "erp_purchase_prepare",
    "创建真实未审核采购草稿（不改库存、不审核）。需要物料编码、数量、单位、仓库、供应商与幂等键。缺字段先追问。禁止声称已入库。确认请用户回复「确认采购{草稿号}」。",
    "/aierp/v1/wecom/purchase/prepare",
    {
      type: "object",
      properties: {
        barCode: { type: "string", description: "物料编码，如 RM-A001" },
        qty: { type: "number", description: "采购数量" },
        unit: { type: "string", description: "单位，如 L" },
        depotName: { type: "string", description: "入库仓库，如 原料仓" },
        organName: { type: "string", description: "供应商名称" },
        idempotencyKey: { type: "string", description: "幂等键，同一对话同一意图保持稳定" },
        remark: { type: "string", description: "备注（可选）" },
      },
      required: ["barCode", "qty", "unit", "depotName", "organName", "idempotencyKey"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      barCode: str(p.barCode),
      qty: num(p.qty),
      unit: str(p.unit),
      depotName: str(p.depotName),
      organName: str(p.organName),
      idempotencyKey: str(p.idempotencyKey),
      remark: str(p.remark),
    }),
    (data) => ({
      text: formatPurchaseDraft(data),
      details: {
        draftId: data?.draftId ?? null,
        status: data?.status || null,
        statusLabel: data?.statusLabel || null,
        posted: !!data?.posted,
        stockUnchanged: data?.stockUnchanged !== false,
        summary: data?.summary || null,
        challenge: data?.challenge || null,
        replayed: !!data?.replayed,
      },
    }),
  );

  make(
    "erp_draft_status",
    "查询当前绑定用户名下采购草稿状态与摘要（只读）。",
    "/aierp/v1/wecom/draft/status",
    {
      type: "object",
      properties: { draftId: { type: "number", description: "草稿 ID" } },
      required: ["draftId"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      draftId: num(p.draftId),
    }),
    (data) => ({
      text: formatPurchaseDraft(data),
      details: {
        draftId: data?.draftId ?? null,
        status: data?.status || null,
        statusLabel: data?.statusLabel || null,
        posted: !!data?.posted,
        stockUnchanged: data?.stockUnchanged !== false,
        summary: data?.summary || null,
      },
    }),
  );

  make(
    "erp_draft_cancel",
    "取消尚未过账的采购草稿。不能取消已确认单据。不改变库存。",
    "/aierp/v1/wecom/draft/cancel",
    {
      type: "object",
      properties: { draftId: { type: "number", description: "草稿 ID" } },
      required: ["draftId"],
      additionalProperties: false,
    },
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      draftId: num(p.draftId),
    }),
    (data) => ({
      text: data?.hint || `草稿 #${data?.draftId} 已取消，未入库。`,
      details: {
        draftId: data?.draftId ?? null,
        status: data?.status || "CANCELLED",
        cancelled: true,
        posted: false,
        stockUnchanged: true,
      },
    }),
  );
}

function registerConfirmHook(api) {
  // Trusted raw inbound (before LLM). Do NOT register erp_draft_confirm as a model tool.
  api.on("before_dispatch", async (event, ctx) => {
    const channelId = ctx?.channelId || event?.channel;
    if (channelId !== CHANNEL_ID) return;
    const senderId = String(event?.senderId || ctx?.senderId || "").trim();
    if (!senderId) return;
    if (event?.isGroup) return;
    const text = String(event?.content || event?.body || "").trim();
    if (!isConfirmPhrase(text)) return;
    try {
      const data = await signedPost("/aierp/v1/wecom/draft/confirm", {
        wecomUserId: senderId,
        botId: botId(),
        channel: CHANNEL_ID,
        rawText: text,
        messageMsgId: event?.messageId || undefined,
        isGroup: false,
        eventSource: "WECOM_BEFORE_DISPATCH",
      });
      return { handled: true, text: formatConfirm(data) };
    } catch (err) {
      return { handled: true, text: `确认未完成：${String(err?.message || err)}` };
    }
  });
}

const plugin = {
  id: "aierp-erp-tools",
  name: "AIERP ERP Tools",
  description: "WeCom trusted-identity ERP bind + queries + purchase draft + before_dispatch confirm",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    registerErpTools(api);
    registerConfirmHook(api);
  },
};

export default plugin;
'''

def main():
    targets = [
        Path(r"D:/ERP/ai-erp/deploy/openclaw/plugins/aierp-erp-tools/index.js"),
        Path(r"F:/aierp-openclaw/state/extensions/aierp-erp-tools/index.js"),
    ]
    for t in targets:
        t.parent.mkdir(parents=True, exist_ok=True)
        t.write_text(PLUGIN, encoding="utf-8")
        print(f"wrote {t} bytes={t.stat().st_size}")

if __name__ == "__main__":
    main()
