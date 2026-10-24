/**
 * AIERP-020B: WeCom channel adapter for BusinessResult → native card / markdown / plain.
 *
 * Feishu must NOT reuse these JSON payloads — shared semantics only via BusinessResult DTO.
 * Buttons never post stock; confirm remains trusted original user phrase routes
 * (PURCHASE / MIX / SERVICE) in before_dispatch.
 */

import {
  fmtMoney,
  fmtQty,
  normalizePurchaseLine,
  sumLineAmounts,
  renderPurchaseConfirmed,
  renderPurchaseDraftReady,
  renderPurchaseBatchDraftReady,
  renderServiceDraftReady,
  renderServiceConfirmed,
  sanitizeForChannel,
  factsFromConfirm,
  factsFromPurchaseBatch,
} from "./wecom-business.mjs";
import {
  assertNoPostingButtonKeys,
  resolveChannelCapabilities,
  SAFE_CARD_BUTTON_KEYS,
} from "./wecom-capability.mjs";

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function trunc(s, n) {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * Shared BusinessResult semantic DTO (channel-agnostic).
 * schemaVersion keeps Feishu / WeCom adapters aligned on facts, not JSON.
 */
export function toBusinessResult(input = {}, overrides = {}) {
  const bizType = String(overrides.bizType || input.bizType || "PURCHASE").toUpperCase();
  const status = overrides.status || input.status || "UNKNOWN";
  const lines = Array.isArray(overrides.lines)
    ? overrides.lines.map(normalizePurchaseLine)
    : Array.isArray(input.lines)
      ? input.lines.map(normalizePurchaseLine)
      : [];
  const totalAmount =
    numOrNull(overrides.totalAmount ?? input.totalAmount ?? input.amount) ??
    sumLineAmounts(lines);

  return {
    schemaVersion: 1,
    operationId: overrides.operationId || input.operationId || null,
    bizType,
    status,
    billNumber: overrides.billNumber || input.billNumber || input.realBillNumber || null,
    draftId: overrides.draftId ?? input.draftId ?? null,
    confirmPhrase: overrides.confirmPhrase || input.confirmPhrase || null,
    partnerName: overrides.partnerName || input.partnerName || input.organName || null,
    depotName: overrides.depotName || input.depotName || lines[0]?.depotName || null,
    lines,
    totalAmount,
    stockBefore: overrides.stockBefore ?? input.stockBefore ?? null,
    stockAfter: overrides.stockAfter ?? input.stockAfter ?? null,
    bills: overrides.bills || input.bills || null,
    sourceRefs: overrides.sourceRefs || input.sourceRefs || null,
    receiptIds: overrides.receiptIds || input.receiptIds || null,
    ...overrides,
  };
}

/** Markdown body for real msgtype=markdown (not before_dispatch plain). */
export function buildPurchaseMarkdown(result) {
  const r = toBusinessResult(result);
  const lines = r.lines || [];
  const title =
    r.status === "AWAITING_CONFIRM" || r.status === "DRAFT"
      ? `📝 **采购单待确认**`
      : `✅ **采购入库完成**`;
  const idLine =
    r.billNumber != null
      ? `${r.billNumber} · 已审核`
      : r.draftId != null
        ? `#${r.draftId}${r.businessKey ? ` · ${r.businessKey}` : ""}`
        : "";
  const body = [title, idLine, ""];
  for (const ln of lines) {
    const bar = ln.barCode ? `（${ln.barCode}）` : "";
    body.push(
      `${ln.materialName}${bar}  ${fmtQty(ln.qty, ln.unit)}  单价 ${fmtMoney(ln.unitPrice)}  行金额 <font color="info">${fmtMoney(ln.allPrice)}</font>`,
    );
  }
  if (r.partnerName || r.depotName) {
    body.push(`${r.partnerName || "-"} · ${r.depotName || "-"}`);
  }
  if (r.totalAmount != null) {
    body.push(`采购合计：<font color="info">${fmtMoney(r.totalAmount)}</font>`);
  }
  if (r.confirmPhrase) {
    body.push(`回复「${r.confirmPhrase}」完成入库`);
  }
  return body.filter((x, i) => x !== "" || i === 2).join("\n");
}

/**
 * text_notice template_card — display only.
 * Buttons/jump never auto-confirm (no jump type=3 with confirm phrase).
 */
export function buildPurchaseTextNoticeCard(result, { taskId } = {}) {
  const r = toBusinessResult(result);
  const lines = (r.lines || []).slice(0, 4);
  const awaiting = r.status === "AWAITING_CONFIRM" || r.status === "DRAFT" || !!r.confirmPhrase;
  const title = awaiting ? "采购单待确认" : "采购入库完成";
  const total = r.totalAmount;

  const horizontal = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    horizontal.push({
      keyname: trunc(ln.materialName || `行${i + 1}`, 5),
      value: trunc(
        `${fmtQty(ln.qty, ln.unit)} · ${fmtMoney(ln.unitPrice)} · ${fmtMoney(ln.allPrice)}`,
        26,
      ),
    });
  }
  if (r.lines && r.lines.length > 4) {
    horizontal.push({
      keyname: "其余",
      value: `另有 ${r.lines.length - 4} 行，见合计`,
    });
  }
  if (total != null && horizontal.length < 6) {
    horizontal.push({ keyname: "合计", value: fmtMoney(total) });
  }

  const card = {
    card_type: "text_notice",
    source: { desc: "AI ERP", desc_color: 0 },
    main_title: {
      title,
      desc: trunc(
        r.billNumber ||
          (r.draftId != null ? `#${r.draftId}` : "") ||
          r.businessKey ||
          "",
        30,
      ),
    },
    emphasis_content:
      total != null
        ? { title: fmtMoney(total), desc: awaiting ? "待确认合计" : "采购合计" }
        : undefined,
    sub_title_text: trunc(
      [r.partnerName, r.depotName].filter(Boolean).join(" · ") ||
        (awaiting ? "库存未变化" : "已审核"),
      112,
    ),
    horizontal_content_list: horizontal.slice(0, 6),
    card_action: { type: 0 },
    task_id: taskId || `aierp_purchase_${r.draftId || r.billNumber || Date.now()}`,
  };

  if (r.confirmPhrase) {
    card.quote_area = {
      type: 0,
      title: "确认指令（复制后发送）",
      quote_text: r.confirmPhrase,
    };
  }

  return card;
}

/**
 * button_interaction — ONLY safe view/copy keys. Never confirm/post.
 * Handlers of template_card_event for these keys must echo the phrase, not call confirm API.
 */
export function buildPurchasePhraseHintCard(result, { taskId } = {}) {
  const r = toBusinessResult(result);
  if (!r.confirmPhrase) {
    return buildPurchaseTextNoticeCard(r, { taskId });
  }
  const button_list = [
    { text: "查看确认指令", style: 1, key: "view_confirm_phrase" },
    { text: "复制确认指令", style: 2, key: "copy_confirm_phrase" },
  ];
  assertNoPostingButtonKeys(button_list);

  return {
    card_type: "button_interaction",
    source: { desc: "AI ERP", desc_color: 0 },
    main_title: {
      title: "采购确认指令",
      desc: trunc(r.confirmPhrase, 30),
    },
    sub_title_text:
      "按钮仅展示/复制确认原文，不会入库。请在私聊手动发送确认指令完成入库。",
    button_list,
    task_id: taskId || `aierp_phrase_${r.draftId || Date.now()}`,
  };
}

export function buildOutboundMessages(result, caps = {}) {
  const c = resolveChannelCapabilities(caps);
  const r = toBusinessResult(result);
  const plain = (() => {
    if (Array.isArray(r.bills) && r.bills.length > 1) {
      return renderPurchaseBatchDraftReady(r, "plain");
    }
    if (r.status === "AWAITING_CONFIRM" || r.status === "DRAFT" || (r.confirmPhrase && !r.billNumber)) {
      return renderPurchaseDraftReady(r, "plain");
    }
    if (r.bizType === "SERVICE") {
      return r.confirmPhrase && !r.billNumber
        ? renderServiceDraftReady(r, "plain")
        : renderServiceConfirmed(r, "plain");
    }
    return renderPurchaseConfirmed(r, "plain");
  })();

  const text = sanitizeForChannel(plain, { markdown: false });
  const out = {
    channel: "wecom",
    prefer: c.prefer,
    text,
    markdown: null,
    templateCard: null,
    phraseHintCard: null,
    safeButtonKeys: SAFE_CARD_BUTTON_KEYS,
  };

  if (c.markdown && r.bizType === "PURCHASE") {
    out.markdown = {
      msgtype: "markdown",
      markdown: { content: buildPurchaseMarkdown(r) },
    };
  }
  if (c.templateCard && r.bizType === "PURCHASE") {
    out.templateCard = {
      msgtype: "template_card",
      template_card: buildPurchaseTextNoticeCard(r),
    };
    if (r.confirmPhrase) {
      out.phraseHintCard = {
        msgtype: "template_card",
        template_card: buildPurchasePhraseHintCard(r),
      };
    }
  }
  return out;
}

/**
 * Factory: render BusinessResult for WeCom (or shared semantic for Feishu later).
 * Default prefer=plain for before_dispatch safety.
 */
export function renderBusinessResult(result, channelCapabilities = {}) {
  const channel = channelCapabilities.channel || "wecom";
  if (channel === "feishu") {
    // Shared DTO only — do not emit WeCom template_card JSON.
    return {
      channel: "feishu",
      text: sanitizeForChannel(
        renderPurchaseConfirmed(toBusinessResult(result), "plain"),
        { markdown: false },
      ),
      note: "Feishu adapter not implemented; use shared BusinessResult DTO only.",
      businessResult: toBusinessResult(result),
    };
  }
  return buildOutboundMessages(result, channelCapabilities);
}

/** Convenience: confirm API payload → WeCom plain (preserves MIX/SERVICE routing upstream). */
export function renderPurchaseConfirmForWecom(data, caps = {}) {
  const facts = factsFromConfirm(data || {});
  return renderBusinessResult(
    toBusinessResult(facts, {
      status: facts.billNumber ? "CONFIRMED" : "AWAITING_CONFIRM",
      bizType: "PURCHASE",
    }),
    { prefer: "plain", ...caps },
  );
}

export function renderPurchaseBatchForWecom(data, caps = {}) {
  const facts = factsFromPurchaseBatch(data || {});
  if (facts.userSummaryZh && !facts.bills.some((b) => b.lines?.length)) {
    // Structured lines missing — still prefer ERP summary if clean, else our skeleton
    const summary = String(facts.userSummaryZh);
    if (!/[<{]|MEDIA:|[A-Z]:\\/.test(summary) && facts.bills.length === 0) {
      return {
        channel: "wecom",
        text: sanitizeForChannel(summary, { markdown: false }),
        markdown: null,
        templateCard: null,
      };
    }
  }
  return renderBusinessResult(
    toBusinessResult(facts, {
      status: "AWAITING_CONFIRM",
      bizType: "PURCHASE",
      bills: facts.bills,
    }),
    { prefer: "plain", ...caps },
  );
}

export default {
  toBusinessResult,
  buildPurchaseMarkdown,
  buildPurchaseTextNoticeCard,
  buildPurchasePhraseHintCard,
  buildOutboundMessages,
  renderBusinessResult,
  renderPurchaseConfirmForWecom,
  renderPurchaseBatchForWecom,
};
