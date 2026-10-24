/**
 * Thin registration for AIERP-016M MIX confirm phrase.
 * Registers a dedicated before_dispatch handler — avoids rewriting plugin/index.js confirm block.
 * AIERP-022B: after successful MIX post, auto-deliver matching receipt PDF (never purchase retitle;
 * resend never re-posts).
 */
import { isMixConfirmPhrase, runMixConfirm } from "./mix-prepare.mjs";
import { sanitizeForChannel } from "./renderers/wecom-business.mjs";
import { autoDeliverReceiptPdf, appendDeliveryHint } from "./receipt-auto-delivery.mjs";

/**
 * @param {object} api OpenClaw plugin API
 * @param {object} deps
 * @param {() => string} deps.botId
 * @param {(path: string, body: object) => Promise<object>} deps.signedPost
 * @param {(ctx: object) => string|null} deps.trustedWecomUserId
 * @param {(ctx: object) => boolean} deps.isWecomGroupChat
 * @param {string} [deps.channelId]
 */
export function registerMixConfirmDispatch(api, deps) {
  const {
    botId,
    signedPost,
    trustedWecomUserId,
    isWecomGroupChat,
    channelId = "wecom",
  } = deps;

  const handler = async (event, ctx) => {
    if (ctx?.messageChannel && ctx.messageChannel !== channelId) return;
    if (typeof isWecomGroupChat === "function" && isWecomGroupChat(ctx)) return;

    const text = String(event?.content ?? event?.body ?? ctx?.content ?? "").trim();
    if (!isMixConfirmPhrase(text)) return;

    const senderId = (typeof trustedWecomUserId === "function" ? trustedWecomUserId(ctx) : null)
      || String(ctx?.requesterSenderId || ctx?.senderId || "").trim();
    if (!senderId) {
      return { handled: true, text: "无法识别企微发送者，配制确认未执行。" };
    }

    const messageId = event?.messageId || ctx?.messageId || undefined;
    try {
      const { replyText, data } = await runMixConfirm({
        text,
        wecomUserId: senderId,
        botId: typeof botId === "function" ? botId() : botId,
        messageId,
        signedPost,
        channel: channelId,
      });
      let reply = sanitizeForChannel(replyText, { markdown: false });

      // Auto-deliver MIX receipt PDF when available; never re-post; never use purchase PDF title.
      if (data?.billNumber && (data?.status === "CONFIRMED" || data?.status === "POSTED")) {
        const delivery = await autoDeliverReceiptPdf({
          confirmData: { ...data, receiptKind: data.receiptKind || "MIX", bizType: data.bizType || "MIX" },
          wecomUserId: senderId,
          botId,
          signedPost,
          cfg: api?.config || {},
          mediaLocalRoots: api?.config?.channels?.wecom?.mediaLocalRoots || [],
          messageId,
          markdown: false,
        });
        reply = appendDeliveryHint(reply, delivery);
      }

      return { handled: true, text: reply };
    } catch (err) {
      return {
        handled: true,
        text: `配制确认未完成：${String(err?.message || err).slice(0, 300)}`,
      };
    }
  };

  try {
    api.on("before_dispatch", handler, { priority: 55 });
  } catch {
    api.on("before_dispatch", handler);
  }
}
