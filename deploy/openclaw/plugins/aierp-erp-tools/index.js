/**
 * AIERP-012A OpenClaw tool plugin.
 * Trusts only ctx.requesterSenderId when ctx.messageChannel === "wecom".
 * Never accepts wecomUserId / tenantId / erpUserId / token from the model.
 */
import { createHmac } from "node:crypto";

const CHANNEL_ID = "wecom";
const DEFAULT_BASE = "http://127.0.0.1:9999/jshERP-boot";

function emptyPluginConfigSchema() {
  return {
    safeParse(value) {
      return { success: true, data: value ?? {} };
    },
  };
}

function trustedWecomUserId(ctx) {
  if (ctx?.messageChannel !== CHANNEL_ID) {
    return null;
  }
  const id = ctx.requesterSenderId?.trim();
  return id || null;
}

function adapterSecret() {
  return (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
}

function erpBase() {
  return (process.env.AIERP_ERP_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function botId() {
  return (process.env.AIERP_WECOM_BOT_ID || process.env.WECOM_BOT_ID || "default").trim();
}

async function signedPost(path, bodyObj) {
  const secret = adapterSecret();
  if (!secret) {
    throw new Error("AIERP_WECOM_ADAPTER_SECRET missing in OpenClaw environment");
  }
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const method = "POST";
  const urlPath = path.startsWith("/jshERP-boot") ? path : `/jshERP-boot${path}`;
  const payload = `${method}\n${urlPath}\n${ts}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const url = `${erpBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Aierp-Adapter-Timestamp": ts,
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
    details: { ok, ...(details || {}) },
  };
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

function registerErpTools(api) {
  const make =
    (name, description, path, buildBody, format) => {
      api.registerTool(
        (ctx) => ({
          name,
          description,
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "物料中文名/编码关键字（仅 stock 使用）" },
              barCode: { type: "string", description: "物料编码（可选）" },
              depotName: { type: "string", description: "仓库名称（可选）" },
            },
            additionalProperties: false,
          },
          async execute(_id, params) {
            const wecomUserId = trustedWecomUserId(ctx);
            if (!wecomUserId) {
              return toolResult(false, "当前会话没有可信的企业微信发送者身份，无法执行 ERP 工具。请在企微私聊中操作。", {
                reason: "NO_TRUSTED_WECOM_SENDER",
                messageChannel: ctx?.messageChannel || null,
              });
            }
            // Explicitly ignore any model-supplied identity fields.
            const safeParams = {
              query: typeof params?.query === "string" ? params.query : undefined,
              barCode: typeof params?.barCode === "string" ? params.barCode : undefined,
              depotName: typeof params?.depotName === "string" ? params.depotName : undefined,
            };
            try {
              const data = await signedPost(path, buildBody(wecomUserId, safeParams));
              return toolResult(true, format(data), { redacted: true });
            } catch (err) {
              return toolResult(false, String(err?.message || err), { reason: "ERP_ADAPTER_ERROR" });
            }
          },
        }),
        { name },
      );
    };

  make(
    "erp_bind_start",
    "为企业微信当前用户签发一次性 ERP 绑定码（5 分钟）。不要索取 ERP 密码。",
    "/aierp/v1/wecom/binding/issue",
    (wecomUserId) => ({ wecomUserId, botId: botId(), channel: CHANNEL_ID }),
    (data) =>
      `绑定码：${data.bindCode}\n有效期 ${data.expiresInSec} 秒。请打开已登录的 ERP 工作台「绑定企业微信」输入该码。勿把 ERP 密码发到聊天。`,
  );

  make(
    "erp_binding_status",
    "查询当前企微用户是否已绑定 ERP。",
    "/aierp/v1/wecom/binding/status",
    (wecomUserId) => ({ wecomUserId, botId: botId(), channel: CHANNEL_ID }),
    (data) =>
      data.bound
        ? `已绑定 ERP 账号 ${data.erpLoginName}（租户 ${data.tenantId}）。`
        : data.hint || "尚未绑定 ERP。",
  );

  make(
    "erp_unbind",
    "解除当前企微用户与 ERP 的绑定。",
    "/aierp/v1/wecom/binding/unbind",
    (wecomUserId) => ({ wecomUserId, botId: botId(), channel: CHANNEL_ID }),
    (data) => (data.unbound ? "已解绑 ERP。" : "当前没有有效绑定。"),
  );

  make(
    "erp_stock_query",
    "按当前已绑定 ERP 用户权限查询实时库存（物料中文名、编码、仓库、单位、数量）。",
    "/aierp/v1/wecom/stock/query",
    (wecomUserId, p) => ({
      wecomUserId,
      botId: botId(),
      channel: CHANNEL_ID,
      query: p.query,
      barCode: p.barCode,
      depotName: p.depotName,
    }),
    formatStock,
  );
}

const plugin = {
  id: "aierp-erp-tools",
  name: "AIERP ERP Tools",
  description: "WeCom trusted-identity ERP bind + read-only stock",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    registerErpTools(api);
  },
};

export default plugin;
