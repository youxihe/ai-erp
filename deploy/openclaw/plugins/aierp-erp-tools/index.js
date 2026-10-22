/**
 * AIERP-012A/013/015A/015B/017A OpenClaw tool plugin.
 * Trusts only ctx.requesterSenderId when ctx.messageChannel === "wecom".
 * Confirm + receipt SOP (real WeCom sendMedia, not MEDIA text) → Java (never LLM erp_draft_confirm).
 * Excel: erp_excel_template (+ optional prefill rows) + inbound xlsx preview (never excel.confirm).
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
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

const CHANNEL_ID = "wecom";
const DEFAULT_BASE = "http://127.0.0.1:9999/jshERP-boot";
const MIN_SECRET_LEN = 32;
const BANNED_SECRET_SNIPPETS = ["change-me", "changeme", "example", "placeholder", "aierp-local-wecom-adapter"];
const CONFIRM_PURCHASE = /^\s*确认\s*采购\s*[：:#＃]?\s*(\d+)\s*$/;
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

function excelMediaDir() {
  const state =
    process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state");
  const dir = join(state, "media", "aierp-excel");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeExcelFile(fileName, base64) {
  const safe = basename(String(fileName || "template.xlsx")).replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
  const path = join(excelMediaDir(), `${Date.now()}_${safe}`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
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
  return `✅ 采购入库完成\n${bill} · 已审核`;
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

  // AIERP-017A: template download → local MEDIA path (never confirm / never excel.confirm tool)
  api.registerTool(
    (ctx) => ({
      name: "erp_excel_template",
      description:
        "按场景生成真实 ERP Excel 并落盘，供企微 MEDIA 发送。scene=PURCHASE|MIX|SERVICE|SALE|INITIAL|PACK。仅用于「采购/配制模板」；用户要《采购入库业务回执》PDF 时禁止调用本工具（由渠道回执链路处理）。" +
        "用户要求「填上去/预填」时必须先查物料/往来/历史，再传入 rows（经核实的 barCode/organName/depotName/qty/unit/price 等），禁止编造。" +
        "SALE/INITIAL 仅模板不可过账。不改变库存。禁止 excel.confirm。" +
        "回执PDF由渠道处理，禁止用本工具冒充回执。",
      parameters: {
        type: "object",
        properties: {
          scene: {
            type: "string",
            description: "PURCHASE（默认）/ MIX / SERVICE / SALE / INITIAL / PACK",
          },
          rows: {
            type: "array",
            description:
              "可选预填行。PURCHASE 字段：businessKey,date,organName,barCode,name,depotName,qty,unit,price,remark。" +
              "须来自已授权查询结果，不得虚构供应商或单价。",
            items: {
              type: "object",
              properties: {
                businessKey: { type: "string" },
                date: { type: "string" },
                organName: { type: "string" },
                barCode: { type: "string" },
                name: { type: "string" },
                depotName: { type: "string" },
                qty: { type: "string" },
                unit: { type: "string" },
                price: { type: "string" },
                remark: { type: "string" },
                finishedCode: { type: "string" },
                finishedName: { type: "string" },
                finishedQty: { type: "string" },
                finishedUnit: { type: "string" },
                serviceName: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        const wecomUserId = trustedWecomUserId(ctx);
        if (!wecomUserId) {
          return toolResult(false, "当前会话没有可信的企业微信发送者身份。", { reason: "NO_TRUSTED_WECOM_SENDER" });
        }
        if (isWecomGroupChat(ctx)) {
          return toolResult(false, "Excel 模板仅支持企微私聊。", { reason: "WECOM_GROUP_NOT_ALLOWED" });
        }
        try {
          const scene = str(params?.scene) || "PURCHASE";
          const rows = Array.isArray(params?.rows) ? params.rows.slice(0, 200) : undefined;
          const body = {
            wecomUserId,
            botId: botId(),
            channel: CHANNEL_ID,
            scene,
          };
          if (rows && rows.length) {
            body.rows = rows.map((r) => ({
              businessKey: str(r?.businessKey),
              date: str(r?.date),
              organName: str(r?.organName),
              barCode: str(r?.barCode),
              name: str(r?.name),
              depotName: str(r?.depotName),
              qty: str(r?.qty),
              unit: str(r?.unit),
              price: str(r?.price),
              remark: str(r?.remark),
              finishedCode: str(r?.finishedCode),
              finishedName: str(r?.finishedName),
              finishedQty: str(r?.finishedQty),
              finishedUnit: str(r?.finishedUnit),
              serviceName: str(r?.serviceName),
            }));
          }
          const data = await signedPost("/aierp/v1/wecom/excel/template", body);
          const mediaPath = writeExcelFile(data.fileName, data.fileBase64);
          const mediaLine = `MEDIA: ${mediaPath}`;
          const prefillNote = rows && rows.length ? `已预填 ${rows.length} 行（请核对后修改再回传）。` : "";
          const note = data.confirmSupported
            ? `${prefillNote}请下载核对/修改后，在本对话直接发回 xlsx；系统将仅预览，不会入库、不会批量过账。`
            : "该场景当前仅提供模板（销售出库/期初不可经本通道预览过账）。";
          const text = `${data.summary || data.hint}\n${note}\n请在回复中原样附带下一行以便企微发送文件：\n${mediaLine}`;
          return toolResult(true, text, {
            tool: "erp_excel_template",
            scene: data.scene,
            fileName: data.fileName,
            mediaPath,
            mediaDirective: mediaLine,
            confirmSupported: !!data.confirmSupported,
            prefilledRows: rows ? rows.length : 0,
            posted: false,
            stockUnchanged: true,
            byteLength: data.byteLength,
          });
        } catch (err) {
          return toolResult(false, String(err?.message || err), { reason: "ERP_ADAPTER_ERROR", tool: "erp_excel_template" });
        }
      },
    }),
    { name: "erp_excel_template" },
  );
}

/**
 * Trusted inbound xlsx → ERP preview (no confirm). Mutates event content so the model sees REAL_ERP summary.
 */

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
  if (data?.userSummaryZh) return String(data.userSummaryZh);
  if (data?.hintZh) return String(data.hintZh);
  if (data?.draftId && data?.confirmPhrase) {
    const bk = data.businessKey || "";
    return (
      `采购单 ${bk}\n待确认单 #${data.draftId}\n请回复「${data.confirmPhrase}」完成入库`
    );
  }
  const records = Array.isArray(data?.records) ? data.records : [];
  const errors = [];
  for (const rec of records) {
    const sourceRows = Array.isArray(rec?.sourceRows) ? rec.sourceRows : [];
    const errs = Array.isArray(rec?.errors) ? rec.errors.filter(Boolean) : [];
    if (errs.length || rec?.canConfirm === false) {
      const rowLabel = sourceRows.length ? sourceRows[0] : "?";
      errors.push(`第${rowLabel}行：${errs.join("；") || "数据有误"}`);
    }
  }
  if (errors.length) {
    return [`文件已收到，但还有 ${errors.length} 处需要修改：`, ...errors.slice(0, 5).map((e) => `- ${e}`), "请改好后重新发回 Excel。"].join("\n");
  }
  return "文件已核对。若未生成待确认单，请稍后再试或重新发送。";
}

function formatParseFailed(reason) {
  const map = {
    FILE_STAGING_PENDING: "文件还在接收中，请稍后再发一次同一份 Excel。",
    FILE_BYTES_MISSING: "没有收到可用的 Excel 文件，请重新发送 .xlsx。",
    FILE_TOO_LARGE: "Excel 超过 2MB，请精简后重发。",
    NO_PREVIEW_ID: "文件未能完成核对，请重新发送 .xlsx。",
  };
  return map[reason] || `文件未能完成核对：${reason || "未知原因"}。库存未变化，也未创建采购单。`;
}

const EXCEL_FOLLOWUP = /^\s*(入库吧|确认入库|按文件|按刚才的?文件|按文件(里面|内容)|继续(入库|处理)|提交入库|生成草稿|按文件处理.*)\s*$/i;

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
      replyText: formatParseFailed("FILE_STAGING_PENDING"),
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
      replyText: formatParseFailed("FILE_BYTES_MISSING"),
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
        replyText: formatParseFailed("FILE_TOO_LARGE"),
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
        replyText: formatParseFailed("NO_PREVIEW_ID"),
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
      replyText: formatParseFailed(String(err?.message || err).slice(0, 120)),
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
  const apiRef = api;
  const handler = async (event, ctx) => {
    const channelId = ctx?.channelId || event?.channel;
    if (channelId !== CHANNEL_ID) return;
    const senderId = String(event?.senderId || ctx?.senderId || "").trim();
    if (!senderId) return;
    if (event?.isGroup) return;
    const text = String(event?.content || event?.body || "").trim();
    const messageId = event?.messageId || ctx?.messageId || null;
    const sessionKey = ctx?.sessionKey || event?.sessionKey || null;

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

    if (CANCEL_EXCEL.test(text)) {
      const cleared = {
        status: "CANCELLED",
        messageId,
        sessionKey,
        wecomUserId: senderId,
        at: Date.now(),
        replyText: "已关闭文件流程。现在可以重新口头下采购单。",
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

    // Durable preview follow-up: user says 入库吧 after session/model reset.
    if (EXCEL_FOLLOWUP.test(text) && !isConfirmPhrase(text)) {
      try {
        let st = await signedPost("/aierp/v1/wecom/excel/workflow/status", {
          wecomUserId: senderId,
          botId: botId(),
          channel: CHANNEL_ID,
        });
        if (st && st.status === "PREVIEWED" && st.previewId && !st.draftId) {
          try {
            const drafted = await signedPost("/aierp/v1/wecom/excel/prepare-verified", {
              wecomUserId: senderId,
              botId: botId(),
              channel: CHANNEL_ID,
              previewId: st.previewId,
              fileSha256: st.fileSha256 || undefined,
            });
            if (drafted?.userSummaryZh || drafted?.draftId) {
              return { handled: true, text: drafted.userSummaryZh || formatPreviewLines(drafted) };
            }
          } catch (err) {
            return {
              handled: true,
              text: String(err?.message || err).slice(0, 200) || "暂时无法生成待确认采购单，请重新发送 Excel。",
            };
          }
          st = await signedPost("/aierp/v1/wecom/excel/workflow/status", {
            wecomUserId: senderId,
            botId: botId(),
            channel: CHANNEL_ID,
          });
        }
        if (st && (st.status === "DRAFT_READY" || st.hasAwaitingDraft) && (st.userSummaryZh || st.draftId)) {
          const phrase = st.confirmPhrase || (st.draftId ? `确认采购${st.draftId}` : "");
          const body =
            (st.userSummaryZh ? String(st.userSummaryZh) : `待确认单 #${st.draftId}`) +
            (phrase && !(st.userSummaryZh || "").includes(phrase) ? `\n请回复「${phrase}」完成入库` : "");
          return { handled: true, text: body };
        }
        if (st && st.status === "PREVIEWED" && st.userSummaryZh) {
          return { handled: true, text: String(st.userSummaryZh) };
        }
        if (st && (st.status === "PENDING" || st.status === "FAILED")) {
          return {
            handled: true,
            text: "刚才的文件还没核对成功。请重新发送 .xlsx，或回复「取消文件」后口头下单。",
          };
        }
      } catch {
        // fall through
      }
      return {
        handled: true,
        text: "当前没有待确认的采购单。请先发送填写好的 Excel。",
      };
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
        text: formatParseFailed("FILE_BYTES_MISSING"),
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
        if (st && (st.status === "PENDING" || st.status === "PREVIEWED" || st.status === "FAILED" || st.status === "DRAFT_READY")) {
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
        "当前有未关闭的 Excel 文件核对流程，不能用口头或文件名猜测创建采购草稿。" +
        "请按已核对的文件继续，或回复「取消文件」后再口头下单。不要确认草稿 #113。",
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

const plugin = {
  id: "aierp-erp-tools",
  name: "AIERP ERP Tools",
  description:
    "WeCom trusted-identity ERP: queries + purchase draft + before_dispatch confirm/receipt-PDF + excel template/preview (no model confirm tools)",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    registerErpTools(api);
    registerExcelObserveHook(api);
    registerConfirmAndExcelDispatchHook(api);
    registerPrepareGate(api);
  },
};

export default plugin;
