/**
 * Thin registration for AIERP-016M MIX recipe-hash ack phrase.
 * Trusted before_dispatch「确认配方{hash}」→ USER_ACKED; does not post inventory.
 * Distinct from「确认配制{draftId}」and from PURCHASE confirm+PDF paths.
 */
import { isMixRecipeAckPhrase, runMixRecipeAck } from "./mix-prepare.mjs";
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
export function registerMixRecipeAckDispatch(api, deps) {
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
    if (!isMixRecipeAckPhrase(text)) return;

    const senderId = (typeof trustedWecomUserId === "function" ? trustedWecomUserId(ctx) : null)
      || String(ctx?.requesterSenderId || ctx?.senderId || "").trim();
    if (!senderId) {
      return { handled: true, text: "无法识别企微发送者，配方确认未执行。" };
    }

    const messageId = event?.messageId || ctx?.messageId || undefined;
    try {
      const { replyText } = await runMixRecipeAck({
        text,
        wecomUserId: senderId,
        botId: typeof botId === "function" ? botId() : botId,
        messageId,
        signedPost,
        channel: channelId,
      });
      // Recipe ack only — no inventory post, no purchase PDF.
      return {
        handled: true,
        text: sanitizeForChannel(replyText, { markdown: false }),
      };
    } catch (err) {
      return {
        handled: true,
        text: `配方确认未完成：${String(err?.message || err).slice(0, 300)}`,
      };
    }
  };

  // Priority above mix confirm (55) so「确认配方」is not confused with「确认配制」.
  try {
    api.on("before_dispatch", handler, { priority: 56 });
  } catch {
    api.on("before_dispatch", handler);
  }
}
