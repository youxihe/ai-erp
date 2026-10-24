/**
 * Trusted WeCom file outbound via installed @wecom/wecom-openclaw-plugin@2026.7.2
 *
 * Prefer uploadAndSendMedia + Bot WS (real file message).
 * Never rely on before_dispatch "MEDIA:" text, and never accept the
 * channel sendMedia path-as-text fallback (📎 F:\...).
 */
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const CHANNEL_ID = "wecom";
const DEFAULT_ACCOUNT_ID = "default";

function candidateStateDirs() {
  const out = [];
  if (process.env.OPENCLAW_STATE_DIR) out.push(process.env.OPENCLAW_STATE_DIR);
  out.push("F:/aierp-openclaw/state");
  out.push(join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state"));
  return [...new Set(out.map((p) => resolve(p)))];
}

function findWecomPluginRoot() {
  const candidates = [];
  for (const state of candidateStateDirs()) {
    const npmProjects = join(state, "npm", "projects");
    if (!existsSync(npmProjects)) continue;
    for (const name of readdirSync(npmProjects)) {
      if (!name.includes("wecom-wecom-openclaw-plugin")) continue;
      const pkg = join(npmProjects, name, "node_modules", "@wecom", "wecom-openclaw-plugin");
      if (existsSync(join(pkg, "dist", "src", "channel.js"))) candidates.push(pkg);
    }
  }
  candidates.sort();
  return candidates.length ? candidates[candidates.length - 1] : null;
}

let cachedMods = null;

async function loadWecomMods() {
  if (cachedMods) return cachedMods;
  const root = findWecomPluginRoot();
  if (!root) throw new Error("未找到本机 @wecom/wecom-openclaw-plugin，无法发送文件");
  const channel = await import(pathToFileURL(join(root, "dist", "src", "channel.js")).href);
  const uploader = await import(pathToFileURL(join(root, "dist", "src", "media-uploader.js")).href);
  const state = await import(pathToFileURL(join(root, "dist", "src", "state-manager.js")).href);
  if (!uploader?.uploadAndSendMedia || !state?.getWeComWebSocket) {
    throw new Error("企微插件缺少 uploadAndSendMedia / getWeComWebSocket");
  }
  cachedMods = {
    root,
    wecomPlugin: channel.wecomPlugin,
    uploadAndSendMedia: uploader.uploadAndSendMedia,
    getWeComWebSocket: state.getWeComWebSocket,
  };
  return cachedMods;
}

function looksLikePathDump(text) {
  const t = String(text || "");
  return /MEDIA:\s*[A-Za-z]:\\/i.test(t) || /📎\s*[A-Za-z]:\\/.test(t) || /[A-Za-z]:\\[^\n]+\.pdf/i.test(t);
}

/**
 * Send a local file as a real WeCom file message (Bot WS upload).
 * @returns {{ ok: boolean, messageId?: string, error?: string }}
 */
export async function sendWecomLocalFile({
  toUserId,
  mediaPath,
  mediaLocalRoots,
  cfg,
  accountId = DEFAULT_ACCOUNT_ID,
  captionText,
}) {
  if (!toUserId) return { ok: false, error: "missing wecom user id" };
  const abs = mediaPath ? resolve(String(mediaPath)) : "";
  if (!abs || !existsSync(abs)) return { ok: false, error: "media file missing" };

  const roots = [
    ...receiptMediaRoots(mediaLocalRoots),
    dirname(abs),
  ].map((p) => resolve(String(p)));

  let mods;
  try {
    mods = await loadWecomMods();
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 240) };
  }

  const wsClient = mods.getWeComWebSocket(accountId);
  if (wsClient?.isConnected) {
    try {
      const result = await mods.uploadAndSendMedia({
        wsClient,
        mediaUrl: abs,
        chatId: String(toUserId).trim(),
        mediaLocalRoots: roots,
      });
      if (result?.rejected) {
        return { ok: false, error: result.rejectReason || "media rejected" };
      }
      if (!result?.ok) {
        return { ok: false, error: result?.error || "uploadAndSendMedia failed" };
      }
      // Optional caption as separate markdown (never include file path)
      if (captionText && mods.wecomPlugin?.outbound?.sendText && !looksLikePathDump(captionText)) {
        try {
          await mods.wecomPlugin.outbound.sendText({
            to: `${CHANNEL_ID}:${String(toUserId).trim()}`,
            text: captionText,
            accountId,
            cfg: cfg || {},
          });
        } catch {
          // caption optional; file already sent
        }
      }
      return { ok: true, messageId: result.messageId || "sent" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err).slice(0, 240) };
    }
  }

  // Bot WS down: try channel sendMedia but refuse path-text fallback semantics.
  if (!mods.wecomPlugin?.outbound?.sendMedia) {
    return { ok: false, error: "企微 Bot WebSocket 未连接，且无 sendMedia" };
  }
  try {
    const result = await mods.wecomPlugin.outbound.sendMedia({
      to: `${CHANNEL_ID}:${String(toUserId).trim()}`,
      text: undefined, // never pass caption that could be merged with 📎 path fallback
      mediaUrl: abs,
      mediaLocalRoots: roots,
      accountId,
      cfg: cfg || {},
    });
    if (!result || result.rejected) {
      return { ok: false, error: result?.rejectReason || "sendMedia rejected" };
    }
    // Heuristic: official fallback embeds media path into text; treat as failure.
    const blob = JSON.stringify(result);
    if (looksLikePathDump(blob) || /📎/.test(blob)) {
      return { ok: false, error: "sendMedia fell back to path text; refuse" };
    }
    return { ok: true, messageId: result.messageId || result.chatId || "sent" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 240) };
  }
}

export function receiptMediaRoots(extra = []) {
  const receiptDirs = candidateStateDirs().map((s) => join(s, "media", "aierp-receipt"));
  const excelDirs = candidateStateDirs().map((s) => join(s, "media", "aierp-excel"));
  const configured = Array.isArray(extra) ? extra : [];
  return [...new Set([...receiptDirs, ...excelDirs, ...configured].map((p) => resolve(String(p))))];
}

// ---- AIERP-020B: WeCom native template card (Bot WS sendMessage) --------
/** 与企微插件 const.js 保持一致的合法卡片类型 */
export const VALID_CARD_TYPES = [
  "text_notice",
  "news_notice",
  "button_interaction",
  "vote_interaction",
  "multiple_interaction",
];

/**
 * Send a WeCom native template card via Bot WS (msgtype=template_card).
 * 卡片 JSON 必须符合企微模板卡片 schema；发送失败不抛异常，返回 { ok:false, error }。
 * @param {{ toUserId: string, card: object, cfg?: object, accountId?: string }} p
 * @returns {{ ok: boolean, messageId?: string, error?: string }}
 */
export async function sendWecomTemplateCard({ toUserId, card, accountId = DEFAULT_ACCOUNT_ID }) {
  if (!toUserId) return { ok: false, error: "missing wecom user id" };
  const c = card && typeof card === "object" ? card : null;
  if (!c) return { ok: false, error: "card required" };
  if (!VALID_CARD_TYPES.includes(c.card_type)) {
    return { ok: false, error: `invalid card_type: ${String(c.card_type)}` };
  }
  if (typeof c.task_id !== "string" || !c.task_id.trim()) {
    c.task_id = `task_${c.card_type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }
  let wsClient;
  try {
    const mods = await loadWecomMods();
    wsClient = mods.getWeComWebSocket(accountId);
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
  if (!wsClient?.isConnected) {
    return { ok: false, error: "wecom bot ws not connected" };
  }
  try {
    const result = await wsClient.sendMessage(String(toUserId).trim(), {
      msgtype: "template_card",
      template_card: c,
    });
    return { ok: true, messageId: result?.messageId || "sent" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

export { CHANNEL_ID, findWecomPluginRoot, loadWecomMods };
