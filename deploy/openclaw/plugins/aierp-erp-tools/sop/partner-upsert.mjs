/**
 * AIERP-021A partner upsert SOP: intent + whitelist field collect + approval prompt.
 * Prepare via signed API / future tool; commit ONLY via trusted before_dispatch phrase.
 * LLM must never call commit — only 确认建档{id} / 确认修改{id} from raw WeCom DM.
 */

export const CONFIRM_PARTNER_CREATE = /^\s*确认\s*建档\s*[：:#＃]?\s*(\d+)\s*$/;
export const CONFIRM_PARTNER_UPDATE = /^\s*确认\s*修改\s*[：:#＃]?\s*(\d+)\s*$/;

export const WHITELIST_FIELDS = Object.freeze(["name", "contacts", "phone", "address", "remark"]);
export const FORBIDDEN_FIELDS = Object.freeze([
  "bankName",
  "accountNumber",
  "taxNum",
  "taxRate",
  "beginNeedPay",
  "beginNeedGet",
  "advanceIn",
  "enabled",
]);

/** Detect create/update supplier|customer intent from user text (slot hint only). */
export function detectPartnerIntent(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (isPartnerConfirmPhrase(t)) return null;

  let type = null;
  if (/供应商|厂商|供货商/.test(t)) type = "供应商";
  else if (/客户|买方/.test(t)) type = "客户";

  let op = null;
  if (/新增|新建|增加|添加|建档|录入/.test(t)) op = "CREATE";
  else if (/修改|更改|更新|改成|改一下|把.+改/.test(t)) op = "UPDATE";

  if (!type && !op) return null;
  return { op: op || null, type: type || null, needsSlots: true };
}

/** Keep only whitelist keys; throw-style result if forbidden present. */
export function collectWhitelistFields(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  for (const key of FORBIDDEN_FIELDS) {
    if (src[key] != null && String(src[key]).trim() !== "") {
      return { ok: false, error: `禁止经聊天写入敏感字段：${key}`, fields: {} };
    }
  }
  const fields = {};
  for (const key of WHITELIST_FIELDS) {
    if (src[key] == null) continue;
    const v = String(src[key]).trim();
    if (v) fields[key] = v;
  }
  if (src.supplier && !fields.name) fields.name = String(src.supplier).trim();
  if (src.description && !fields.remark) fields.remark = String(src.description).trim();
  return { ok: true, fields };
}

export function isPartnerConfirmPhrase(text) {
  const t = String(text || "").trim();
  return CONFIRM_PARTNER_CREATE.test(t) || CONFIRM_PARTNER_UPDATE.test(t);
}

export function canHandlePartnerConfirm(text) {
  if (!isPartnerConfirmPhrase(text)) return null;
  return { sopId: "partner_confirm" };
}

export function parsePartnerConfirm(text) {
  const t = String(text || "").trim();
  let m = t.match(CONFIRM_PARTNER_CREATE);
  if (m) return { op: "CREATE", requestId: Number(m[1]), phrase: `确认建档${m[1]}` };
  m = t.match(CONFIRM_PARTNER_UPDATE);
  if (m) return { op: "UPDATE", requestId: Number(m[1]), phrase: `确认修改${m[1]}` };
  return null;
}

export function formatPartnerPrepare(data) {
  if (!data) return "主数据准备失败。";
  const challenge = data.challenge || {};
  const phrase = challenge.phrase || "";
  const summary = data.summary || "";
  const diffs = Array.isArray(data.fieldDiffs) ? data.fieldDiffs : [];
  const lines = [];
  lines.push(summary || `${data.type || "往来单位"}待确认`);
  if (diffs.length) {
    for (const d of diffs) {
      lines.push(`- ${d.field}: ${d.oldValue || "-"} → ${d.newValue || "-"}`);
    }
  }
  lines.push(`未写入 ERP。请本人私聊回复「${phrase || "确认建档/确认修改{申请号}"}」生效。`);
  if (data.hint && !String(data.hint).includes(phrase)) {
    lines.push(String(data.hint).slice(0, 120));
  }
  return lines.join("\n");
}

export function formatPartnerCommit(data) {
  if (!data) return "主数据确认失败。";
  if (data.hint && !String(data.hint).includes("{")) {
    return String(data.hint).slice(0, 400);
  }
  const name = data.name || "?";
  const id = data.partnerId ?? "?";
  const type = data.type || "往来单位";
  if (data.idempotentReplay) {
    return `${type}确认已处理过（ID=${id} ${name}），未重复写入。`;
  }
  return `${type}已生效：${name}（ID=${id}）。未过账、库存未变。`;
}

/**
 * Trusted commit entry used by before_dispatch only (wired at F: unified integrate).
 * Not an LLM tool.
 */
export async function runPartnerCommit({ wecomUserId, text, botId, messageId, signedPost }) {
  const data = await signedPost("/aierp/v1/wecom/master/partner/commit", {
    wecomUserId,
    botId,
    channel: "wecom",
    rawText: text,
    messageMsgId: messageId || undefined,
    isGroup: false,
    eventSource: "WECOM_BEFORE_DISPATCH",
  });
  return { text: formatPartnerCommit(data), data };
}

/** Prepare helper for agents / future tool binding (no DB write on ERP side until commit). */
export async function runPartnerPrepare({ wecomUserId, botId, signedPost, op, type, partnerId, fields }) {
  const collected = collectWhitelistFields(fields || {});
  if (!collected.ok) {
    return { text: collected.error, data: null };
  }
  const body = {
    wecomUserId,
    botId,
    channel: "wecom",
    op,
    type,
    partnerId,
    ...collected.fields,
  };
  const data = await signedPost("/aierp/v1/wecom/master/partner/prepare", body);
  return { text: formatPartnerPrepare(data), data };
}
