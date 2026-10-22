/**
 * AIERP-021B material master-data SOP (create/update).
 * Collect whitelist fields → prepare → trusted phrase commit.
 * LLM has no commit tool; stock fields never forwarded.
 * Do not edit plugins/aierp-erp-tools/index.js here — registry + this module only.
 */

/** Material-namespaced — must not match partner 确认建档{id} / 确认修改{id}. */
export const MATERIAL_CONFIRM =
  /^\s*确认(?:建档|修改)物料(\d+)\s*$/;

export const MATERIAL_CREATE_INTENT =
  /(?:新增|增加|创建|建档).{0,12}(?:原料|物料|商品)|(?:原料|物料).{0,8}(?:新增|增加|建档)/i;

export const MATERIAL_UPDATE_INTENT =
  /(?:修改|更改|把).{0,24}(?:原料|物料|备注|规格|品牌)|(?:原料|物料).{0,16}(?:改成|改为|备注)/i;

const FORBIDDEN_STOCK_KEYS = new Set([
  "stock",
  "initStock",
  "initialStock",
  "currentStock",
  "lowSafeStock",
  "highSafeStock",
  "depotHead",
  "库存",
  "期初库存",
  "初始库存",
]);

export function isMaterialConfirmPhrase(text) {
  return MATERIAL_CONFIRM.test(String(text || "").trim());
}

/** @returns {{ op: 'CREATE'|'UPDATE', requestId: number, phrase: string } | null} */
export function parseMaterialConfirm(text) {
  const t = String(text || "").trim();
  const m = t.match(/^\s*确认(建档|修改)物料(\d+)\s*$/);
  if (!m) return null;
  const op = m[1] === "建档" ? "CREATE" : "UPDATE";
  const requestId = Number(m[2]);
  return { op, requestId, phrase: `确认${m[1]}物料${requestId}` };
}

export function detectMaterialIntent(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (isMaterialConfirmPhrase(t)) return { kind: "confirm", phrase: t };
  if (MATERIAL_CREATE_INTENT.test(t)) return { kind: "create" };
  if (MATERIAL_UPDATE_INTENT.test(t)) return { kind: "update" };
  return null;
}

/** Strip / reject stock-ish keys before any ERP call. */
export function sanitizeMaterialFields(input = {}) {
  const out = {};
  const rejected = [];
  for (const [k, v] of Object.entries(input || {})) {
    if (FORBIDDEN_STOCK_KEYS.has(k) || FORBIDDEN_STOCK_KEYS.has(String(k).toLowerCase())) {
      rejected.push(k);
      continue;
    }
    out[k] = v;
  }
  return { fields: out, rejected };
}

export function missingCreateSlots(fields = {}) {
  const miss = [];
  if (!fields.name) miss.push("name");
  if (!fields.barCode) miss.push("barCode");
  if (!fields.unit) miss.push("unit");
  if (!fields.categoryId && !fields.categoryName) miss.push("categoryId|categoryName");
  return miss;
}

/**
 * @param {object} deps
 * @param {(path:string,body:object)=>Promise<object>} deps.signedPost
 */
export async function runMaterialUpsert(deps) {
  const {
    wecomUserId,
    botId,
    text,
    messageId,
    signedPost,
    slots = {},
    markdown = true,
  } = deps;

  const intent = detectMaterialIntent(text);
  if (!intent) {
    return { handled: false };
  }

  if (intent.kind === "confirm") {
    const data = await signedPost("/aierp/v1/wecom/master/material/commit", {
      wecomUserId,
      botId,
      channel: "wecom",
      rawText: intent.phrase,
      phrase: intent.phrase,
      messageMsgId: messageId || undefined,
      isGroup: false,
      eventSource: "WECOM_BEFORE_DISPATCH",
    });
    const ok = data?.materialId || data?.replayed;
    const lines = [
      ok ? "✅ 物料主数据已提交" : "❌ 物料确认失败",
      data?.hint || "",
      data?.barCode ? `编码 ${data.barCode}` : "",
      data?.name ? `名称 ${data.name}` : "",
      data?.materialId != null ? `ID ${data.materialId}` : "",
      `库存不变（合计 ${data?.currentStockTotal ?? 0}）`,
    ].filter(Boolean);
    return {
      handled: true,
      text: lines.join(markdown ? "\n" : "；"),
      data,
      sent: false,
    };
  }

  const { fields, rejected } = sanitizeMaterialFields(slots);
  if (rejected.length) {
    return {
      handled: true,
      text: `主数据接口不能改库存字段（${rejected.join(",")}）。请走采购入库或盘点流程。`,
      sent: false,
    };
  }

  if (intent.kind === "create") {
    const miss = missingCreateSlots(fields);
    if (miss.length) {
      return {
        handled: true,
        text: `新建原料还需：${miss.join("、")}。类别/单位必须选 ERP 已有选项。`,
        needSlots: miss,
        sent: false,
      };
    }
    const data = await signedPost("/aierp/v1/wecom/master/material/prepare", {
      wecomUserId,
      botId,
      channel: "wecom",
      opType: "CREATE",
      ...fields,
    });
    const phrase = data?.challenge?.phrase || "";
    return {
      handled: true,
      text: [
        data?.summaryZh || "请确认新建原料",
        data?.nameHint || "",
        phrase ? `本人回复「${phrase}」后才会写入 ERP（库存保持 0）。` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      data,
      sent: false,
    };
  }

  // update
  if (!fields.barCode && !fields.materialId) {
    return {
      handled: true,
      text: "修改原料请提供编码（barCode）或 materialId，以及要改的名称/规格/品牌/备注。",
      needSlots: ["barCode|materialId"],
      sent: false,
    };
  }
  const data = await signedPost("/aierp/v1/wecom/master/material/prepare", {
    wecomUserId,
    botId,
    channel: "wecom",
    opType: "UPDATE",
    ...fields,
  });
  const phrase = data?.challenge?.phrase || "";
  return {
    handled: true,
    text: [
      data?.summaryZh || "请确认修改原料",
      phrase ? `本人回复「${phrase}」后才会写入 ERP；编码与基础单位不可改。` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    data,
    sent: false,
  };
}

export function canHandleMaterial(text, slots) {
  const intent = detectMaterialIntent(text);
  if (!intent) return null;
  if (intent.kind === "confirm") return { sopId: "material_confirm", followup: false };
  if (intent.kind === "create" || intent.kind === "update") {
    return { sopId: "material_upsert", followup: false, slots: slots || {} };
  }
  return null;
}
