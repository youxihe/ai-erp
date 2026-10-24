/**
 * Minimal WeCom hook for later image send (AIERP-020C).
 *
 * Safety:
 * - Does not invent numbers or accept HTML/SQL/paths from the model
 * - Caption/alt never include Windows paths or MEDIA: dumps
 * - Actual Bot WS image send is optional; adapters call send when ready
 * - Keeps channel adapter thin — rendering stays in render-lib
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderDataset, validateRenderRequest } from "../index.mjs";
import { looksForbiddenInput } from "../validate.mjs";

function stateMediaDir() {
  const root =
    process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state");
  const dir = join(root, "media", "aierp-render");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stripPaths(text) {
  return String(text || "")
    .replace(/MEDIA:\s*[A-Za-z]:\\[^\n]*/gi, "")
    .replace(/📎\s*[A-Za-z]:\\[^\n]*/g, "")
    .replace(/[A-Za-z]:\\[^\n]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Build a channel-safe payload from an authorized render request.
 * Does NOT send yet unless `sendFn` is provided (keeps adapter safe for later wiring).
 *
 * @param {object} request render plan (renderId + dataset / datasetRef)
 * @param {object} [opts]
 * @param {(args: { mediaPath: string, captionText?: string, toUserId?: string }) => Promise<{ok:boolean,error?:string}>} [opts.sendFn]
 * @param {string} [opts.toUserId]
 * @returns {Promise<object>}
 */
export async function prepareWecomRender(request, opts = {}) {
  if (looksForbiddenInput(request)) {
    return {
      ok: false,
      error: "forbidden_input",
      userText: "无法渲染：输入包含不被允许的内容。",
    };
  }

  const gate = validateRenderRequest(request);
  if (!gate.ok && gate.degrade === "explanation" && !gate.dataset) {
    return {
      ok: false,
      error: gate.reason,
      userText: "无法渲染：需要授权的 ERP 查询结果或 datasetRef，且只能选择白名单 renderId。",
    };
  }

  const outDir = opts.outDir || stateMediaDir();
  const rendered = await renderDataset(request, {
    writeFiles: true,
    outDir,
    exportXlsx: opts.exportXlsx !== false,
    maxPngRows: opts.maxPngRows,
  });

  const caption = stripPaths(rendered.alt || rendered.meta?.title || "ERP 图表");
  const payload = {
    ok: true,
    renderId: rendered.renderId,
    degraded: rendered.degraded,
    degradeReason: rendered.degradeReason,
    alt: caption,
    // Adapter-internal only — never echo into before_dispatch text
    _media: {
      pngPath: rendered.files?.png || null,
      xlsxPath: rendered.files?.xlsx || null,
      pngSha256: rendered.pngSha256,
      pngBytes: rendered.pngBytes,
    },
    userText: caption,
    sent: null,
  };

  if (typeof opts.sendFn === "function" && payload._media.pngPath && existsSync(payload._media.pngPath)) {
    try {
      const sent = await opts.sendFn({
        toUserId: opts.toUserId,
        mediaPath: payload._media.pngPath,
        captionText: caption,
      });
      payload.sent = sent;
      if (rendered.files?.xlsx && opts.sendXlsx !== false) {
        payload.sentXlsx = await opts.sendFn({
          toUserId: opts.toUserId,
          mediaPath: rendered.files.xlsx,
          captionText: "完整表格见附件（XLSX）",
        });
      }
    } catch (err) {
      payload.sent = { ok: false, error: String(err?.message || err).slice(0, 200) };
    }
  }

  return payload;
}

/**
 * Persist PNG buffer to the controlled media root (for adapters that already rendered).
 */
export function stagePngBuffer(pngBuffer, name = "chart.png") {
  const dir = stateMediaDir();
  const safe = String(name).replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 64) || "chart.png";
  const path = join(dir, safe.endsWith(".png") ? safe : `${safe}.png`);
  writeFileSync(path, pngBuffer);
  return path;
}

export { stripPaths };
