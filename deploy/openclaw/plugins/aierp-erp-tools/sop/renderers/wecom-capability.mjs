/**
 * AIERP-020B: Installed Bot WS capability matrix (read-only probe notes).
 * Source of truth: F:\aierp-openclaw @wecom/wecom-openclaw-plugin@2026.7.2
 * + @wecom/aibot-node-sdk@1.0.7 — not marketing docs.
 *
 * PC/mobile client visual UAT is separate; SDK-supported ≠ client-verified.
 */

export const INSTALLED_WECOM_PLUGIN = {
  package: "@wecom/wecom-openclaw-plugin",
  version: "2026.7.2",
  stateRootHint:
    "F:/aierp-openclaw/state/npm/projects/wecom-wecom-openclaw-plugin-*/node_modules/@wecom/wecom-openclaw-plugin",
  aibotSdk: { package: "@wecom/aibot-node-sdk", version: "1.0.7" },
};

/**
 * Static matrix from installed dist source (channel.js / message-sender.js /
 * template-card-manager.js / media-uploader.js / aibot SendMsgBody).
 */
export const WECOM_BOT_WS_CAPABILITY_MATRIX = [
  {
    capability: "markdown",
    msgtype: "markdown",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "wsClient.sendMessage / channel.outbound.sendText (always markdown body)",
    beforeDispatchText: "plain string only — do NOT embed markdown/HTML expecting color",
    pcClient: "SUPPORTED_NEEDS_UAT",
    mobileClient: "SUPPORTED_NEEDS_UAT",
    notes: "font color tags info/comment/warning only inside real markdown msgtype",
  },
  {
    capability: "template_card.text_notice",
    msgtype: "template_card",
    card_type: "text_notice",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "wsClient.sendMessage({msgtype:template_card}) via sendTemplateCards",
    beforeDispatchText: false,
    pcClient: "SUPPORTED_NEEDS_UAT",
    mobileClient: "SUPPORTED_NEEDS_UAT",
    notes: "horizontal_content_list max 6; card_action required",
  },
  {
    capability: "template_card.news_notice",
    msgtype: "template_card",
    card_type: "news_notice",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "sendTemplateCards",
    beforeDispatchText: false,
    pcClient: "SUPPORTED_NEEDS_UAT",
    mobileClient: "SUPPORTED_NEEDS_UAT",
    notes: "image + vertical_content; unused for purchase P0",
  },
  {
    capability: "template_card.button_interaction",
    msgtype: "template_card",
    card_type: "button_interaction",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "sendTemplateCards + event.template_card_event",
    beforeDispatchText: false,
    pcClient: "SUPPORTED_NEEDS_UAT",
    mobileClient: "SUPPORTED_NEEDS_UAT",
    notes:
      "AIERP-020B: buttons ONLY view/copy confirm phrase — NEVER post stock. Ban jump_list type=3 with confirm phrase.",
  },
  {
    capability: "template_card.vote_interaction",
    msgtype: "template_card",
    card_type: "vote_interaction",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "sendTemplateCards",
    beforeDispatchText: false,
    pcClient: "NOT_USED",
    mobileClient: "NOT_USED",
    notes: "SDK listed; ERP adapter does not emit",
  },
  {
    capability: "template_card.multiple_interaction",
    msgtype: "template_card",
    card_type: "multiple_interaction",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "sendTemplateCards",
    beforeDispatchText: false,
    pcClient: "NOT_USED",
    mobileClient: "NOT_USED",
    notes: "SDK listed; ERP adapter does not emit",
  },
  {
    capability: "image",
    msgtype: "image",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "uploadAndSendMedia (MIME image/* → image)",
    beforeDispatchText: false,
    pcClient: "SUPPORTED_NEEDS_UAT",
    mobileClient: "SUPPORTED_NEEDS_UAT",
    notes: "for table/chart PNG (020C); never MEDIA: path text",
  },
  {
    capability: "file",
    msgtype: "file",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "uploadAndSendMedia → file (PDF receipts)",
    beforeDispatchText: false,
    pcClient: "SUPPORTED_NEEDS_UAT",
    mobileClient: "SUPPORTED_NEEDS_UAT",
    notes: "015C path; refuse 📎 F:\\ path fallback",
  },
  {
    capability: "mixed_inbound",
    msgtype: "mixed",
    sdkSupport: true,
    installedPluginSupport: true,
    outboundPath: "inbound parse only (text+image items)",
    beforeDispatchText: false,
    pcClient: "N/A",
    mobileClient: "N/A",
    notes: "inbound mixed supported; outbound SendMsgBody is markdown|template_card|media",
  },
  {
    capability: "html_font_in_plain_text",
    msgtype: "text/plain-via-before_dispatch",
    sdkSupport: false,
    installedPluginSupport: false,
    outboundPath: "none — tags show literally",
    beforeDispatchText: "FORBIDDEN",
    pcClient: "SHOWS_LITERAL_TAGS",
    mobileClient: "SHOWS_LITERAL_TAGS",
    notes: "Never emit <font> / MEDIA: in before_dispatch replies",
  },
];

/** Safe button keys — handlers must never call draft/confirm. */
export const SAFE_CARD_BUTTON_KEYS = Object.freeze([
  "view_confirm_phrase",
  "copy_confirm_phrase",
  "view_receipt",
  "download_receipt",
]);

export function isSafeCardButtonKey(key) {
  return SAFE_CARD_BUTTON_KEYS.includes(String(key || "").trim());
}

/** Keys that would imply posting — adapter must never emit these. */
export const FORBIDDEN_POST_BUTTON_KEYS = Object.freeze([
  "confirm",
  "confirm_purchase",
  "confirm_mix",
  "confirm_service",
  "post",
  "approve",
  "入库",
  "过账",
  "审核",
]);

export function assertNoPostingButtonKeys(buttonList = []) {
  for (const b of buttonList || []) {
    const key = String(b?.key || "").trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    // Exact / token match only — do not ban "view_confirm_phrase" via substring "confirm".
    const forbidden = FORBIDDEN_POST_BUTTON_KEYS.some((f) => {
      const fl = String(f).toLowerCase();
      return lower === fl || lower === `btn_${fl}` || lower.startsWith(`${fl}_`) || lower.endsWith(`_${fl}`);
    });
    // Allow explicit safe keys even if they contain the word "confirm".
    if (forbidden && !isSafeCardButtonKey(key)) {
      throw new Error(`AIERP-020B: forbidden posting button key "${key}"`);
    }
    if (!isSafeCardButtonKey(key)) {
      throw new Error(`AIERP-020B: button key "${key}" not in SAFE_CARD_BUTTON_KEYS`);
    }
  }
  return true;
}

/**
 * Runtime channel capabilities for renderBusinessResult.
 * before_dispatch path forces plain; native WS can enable markdown/card when probed.
 */
export function resolveChannelCapabilities(overrides = {}) {
  return {
    channel: "wecom",
    // before_dispatch returns {handled,text} — always plain-safe
    beforeDispatchPlainOnly: true,
    markdown: overrides.markdown === true,
    templateCard: overrides.templateCard === true,
    image: overrides.image === true,
    file: overrides.file === true,
    // Prefer card when native send available; else markdown; else plain
    prefer: overrides.prefer || "plain",
    ...overrides,
  };
}

export function capabilityMatrixSummary() {
  return {
    ticket: "AIERP-020B",
    installed: INSTALLED_WECOM_PLUGIN,
    matrix: WECOM_BOT_WS_CAPABILITY_MATRIX,
    safeButtonKeys: SAFE_CARD_BUTTON_KEYS,
    forbiddenPostButtonKeys: FORBIDDEN_POST_BUTTON_KEYS,
    probedAt: "2026-10-24",
    liveSendVerified: false,
    note: "SDK/plugin source probe only; PC+mobile delivery screenshots are separate UAT.",
  };
}

export default {
  INSTALLED_WECOM_PLUGIN,
  WECOM_BOT_WS_CAPABILITY_MATRIX,
  SAFE_CARD_BUTTON_KEYS,
  FORBIDDEN_POST_BUTTON_KEYS,
  isSafeCardButtonKey,
  assertNoPostingButtonKeys,
  resolveChannelCapabilities,
  capabilityMatrixSummary,
};
