/**
 * Trusted WeCom file outbound via installed @wecom/wecom-openclaw-plugin@2026.7.2
 *
 * Prefer uploadAndSendMedia + Bot WS (real file message).
 * Never rely on before_dispatch "MEDIA:" text, and never accept the
 * channel sendMedia path-as-text fallback (📎 F:\...).
 *
 * AIERP-022B: mediaLocalRoots are fixed configured roots only — never
 * dynamically widen with dirname(abs). Paths must realpath under a root.
 */
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const CHANNEL_ID = "wecom";
const DEFAULT_ACCOUNT_ID = "default";

/** Channel delivery ladder (adapter never auto-marks CLIENT_OPEN_VERIFIED). */
export const DELIVERY_STATUS = Object.freeze({
  PDF_READY: "PDF_READY",
  CHANNEL_ACCEPTED: "CHANNEL_ACCEPTED",
  CLIENT_OPEN_VERIFIED: "CLIENT_OPEN_VERIFIED",
});

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

function normReal(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(String(p));
  }
}

/**
 * Ensure abs path realpath is under one of the fixed configured roots.
 * @returns {{ ok: true, realFile: string } | { ok: false, error: string }}
 */
export function assertMediaUnderRoots(mediaPath, mediaLocalRoots = []) {
  const abs = mediaPath ? resolve(String(mediaPath)) : "";
  if (!abs || !existsSync(abs)) return { ok: false, error: "media file missing" };

  const roots = receiptMediaRoots(mediaLocalRoots);
  if (!roots.length) return { ok: false, error: "no configured mediaLocalRoots" };

  let realFile;
  try {
    realFile = realpathSync(abs);
  } catch {
    return { ok: false, error: "media path unresolvable" };
  }

  const realLower = realFile.toLowerCase();
  const under = roots.some((root) => {
    const realRoot = normReal(root);
    const rootLower = realRoot.toLowerCase();
    if (realLower === rootLower) return true;
    const prefix = rootLower.endsWith(sep) || rootLower.endsWith("/") || rootLower.endsWith("\\")
      ? rootLower
      : rootLower + sep;
    return realLower.startsWith(prefix);
  });

  if (!under) {
    return { ok: false, error: "media path outside configured mediaLocalRoots" };
  }
  return { ok: true, realFile };
}

/**
 * Send a local file as a real WeCom file message (Bot WS upload).
 * @returns {{ ok: boolean, messageId?: string, error?: string, deliveryStatus?: string }}
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

  // Fixed configured roots only — do NOT append dirname(abs).
  const roots = receiptMediaRoots([
    ...(Array.isArray(mediaLocalRoots) ? mediaLocalRoots : []),
    ...(cfg?.channels?.wecom?.mediaLocalRoots || []),
  ]);

  const gate = assertMediaUnderRoots(mediaPath, roots);
  if (!gate.ok) return { ok: false, error: gate.error };
  const abs = gate.realFile;

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
      return {
        ok: true,
        messageId: result.messageId || "sent",
        deliveryStatus: DELIVERY_STATUS.CHANNEL_ACCEPTED,
      };
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
    return {
      ok: true,
      messageId: result.messageId || result.chatId || "sent",
      deliveryStatus: DELIVERY_STATUS.CHANNEL_ACCEPTED,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 240) };
  }
}

/**
 * Fixed media roots: state media/aierp-receipt + aierp-excel + explicit extras.
 * Never adds an arbitrary file's parent directory.
 */
export function receiptMediaRoots(extra = []) {
  const receiptDirs = candidateStateDirs().map((s) => join(s, "media", "aierp-receipt"));
  const excelDirs = candidateStateDirs().map((s) => join(s, "media", "aierp-excel"));
  const configured = Array.isArray(extra) ? extra : [];
  return [...new Set([...receiptDirs, ...excelDirs, ...configured].map((p) => resolve(String(p))))];
}

export { CHANNEL_ID, findWecomPluginRoot, loadWecomMods, candidateStateDirs };
