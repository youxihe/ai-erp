/**
 * Thin registration for AIERP-016M MIX confirm phrase.
 * Registers a dedicated before_dispatch handler — avoids rewriting plugin/index.js confirm block.
 */
import { isMixConfirmPhrase, runMixConfirm } from "./mix-prepare.mjs";
import { sanitizeForChannel } from "./renderers/wecom-business.mjs";

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
      const { replyText } = await runMixConfirm({
        text,
        wecomUserId: senderId,
        botId: typeof botId === "function" ? botId() : botId,
        messageId,
        signedPost,
        channel: channelId,
      });
      // MIX: do not auto-send purchase receipt PDF.
      return {
        handled: true,
        text: sanitizeForChannel(replyText, { markdown: false }),
      };
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
