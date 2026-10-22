/**
 * Trusted WeCom file outbound via installed @wecom/wecom-openclaw-plugin@2026.7.2
 * channel.outbound.sendMedia — NOT by stuffing MEDIA: into before_dispatch text.
 */
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CHANNEL_ID = "wecom";

function findWecomPluginRoot() {
  const npmProjects = join(
    process.env.OPENCLAW_STATE_DIR || join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state"),
    "npm",
    "projects",
  );
  const candidates = [];
  if (existsSync(npmProjects)) {
    for (const name of readdirSync(npmProjects)) {
      if (!name.includes("wecom-wecom-openclaw-plugin")) continue;
      const pkg = join(npmProjects, name, "node_modules", "@wecom", "wecom-openclaw-plugin");
      if (existsSync(join(pkg, "dist", "src", "channel.js"))) candidates.push(pkg);
    }
  }
  // Prefer newest by path name (generation id grows)
  candidates.sort();
  return candidates.length ? candidates[candidates.length - 1] : null;
}

let cachedPlugin = null;

async function loadWecomPlugin() {
  if (cachedPlugin) return cachedPlugin;
  const root = findWecomPluginRoot();
  if (!root) throw new Error("未找到本机 @wecom/wecom-openclaw-plugin，无法发送文件");
  const mod = await import(pathToFileURL(join(root, "dist", "src", "channel.js")).href);
  if (!mod?.wecomPlugin?.outbound?.sendMedia) {
    throw new Error("企微插件未导出 outbound.sendMedia");
  }
  cachedPlugin = mod.wecomPlugin;
  return cachedPlugin;
}

/**
 * Send a local file as WeCom file message, then optional markdown/text separately
 * is handled by caller via before_dispatch text return.
 *
 * @returns {{ ok: boolean, messageId?: string, error?: string }}
 */
export async function sendWecomLocalFile({
  toUserId,
  mediaPath,
  mediaLocalRoots,
  cfg,
  accountId = "default",
  captionText,
}) {
  if (!toUserId) return { ok: false, error: "missing wecom user id" };
  if (!mediaPath || !existsSync(mediaPath)) return { ok: false, error: "media file missing" };
  const roots = Array.isArray(mediaLocalRoots) ? mediaLocalRoots.filter(Boolean) : [];
  const plugin = await loadWecomPlugin();
  const to = `${CHANNEL_ID}:${String(toUserId).trim()}`;
  try {
    const result = await plugin.outbound.sendMedia({
      to,
      text: captionText || undefined,
      mediaUrl: mediaPath,
      mediaLocalRoots: roots,
      accountId,
      cfg: cfg || {},
    });
    if (!result || result.rejected) {
      return { ok: false, error: result?.rejectReason || "sendMedia rejected" };
    }
    return { ok: true, messageId: result.messageId || result.chatId || "sent" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 240) };
  }
}

export function receiptMediaRoots(extra = []) {
  const state =
    process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state");
  const receipt = join(state, "media", "aierp-receipt");
  const excel = join(state, "media", "aierp-excel");
  const configured = Array.isArray(extra) ? extra : [];
  return [...new Set([receipt, excel, ...configured])];
}

export { CHANNEL_ID, findWecomPluginRoot };
