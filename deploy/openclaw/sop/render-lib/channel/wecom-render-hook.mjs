/**
 * Minimal WeCom hook for later image send (AIERP-020C).
 *
 * Safety:
 * - Does not invent numbers or accept HTML/SQL/paths from the model
 * - Caption/alt never include Windows paths or MEDIA: dumps
 * - Model cannot pass outDir / toUserId / filePath (server authCtx drives isolation)
 * - Actual Bot WS image send is optional; adapters call send when ready
 * - Keeps channel adapter thin — rendering stays in render-lib
 */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  renderDataset,
  sealAndRender,
  validateRenderRequest,
  identityMediaDir,
} from "../index.mjs";
import { looksForbiddenInput } from "../validate.mjs";

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
 * Requires authCtx; model only supplies renderId + opaque datasetRef.id.
 *
 * @param {object} request { renderId, datasetRef }
 * @param {object} opts { authCtx (required), sendFn?, exportXlsx?, maxPngRows? }
 */
export async function prepareWecomRender(request, opts = {}) {
  const authCtx = opts.authCtx || request?.authCtx;
  if (!authCtx || typeof authCtx !== "object") {
    return {
      ok: false,
      error: "authCtx_required",
      userText: "无法渲染：缺少当前用户/租户授权上下文。",
    };
  }

  // Strip model attempts to set destinations / paths
  const safeRequest = {
    renderId: request?.renderId || request?.templateId,
    datasetRef: request?.datasetRef || request?.sourceRef,
    schemaVersion: request?.schemaVersion,
  };

  if (looksForbiddenInput(safeRequest)) {
    return {
      ok: false,
      error: "forbidden_input",
      userText: "无法渲染：输入包含不被允许的内容。",
    };
  }

  const gate = validateRenderRequest(safeRequest, { authCtx });
  if (!gate.ok && gate.degrade === "explanation" && !gate.dataset) {
    return {
      ok: false,
      error: gate.reason,
      userText: "无法渲染：需要服务端密封的 datasetRef，且只能选择白名单 renderId。",
    };
  }

  const rendered = await renderDataset(safeRequest, {
    writeFiles: true,
    authCtx,
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
      outDir: rendered.files?.outDir || null,
      pngSha256: rendered.pngSha256,
      pngBytes: rendered.pngBytes,
    },
    userText: caption,
    sent: null,
  };

  // toUserId must come from verified session, never from model request
  const toUserId = opts.toUserId || authCtx.wecomUserId;
  if (typeof opts.sendFn === "function" && payload._media.pngPath && existsSync(payload._media.pngPath)) {
    try {
      const sent = await opts.sendFn({
        toUserId,
        mediaPath: payload._media.pngPath,
        captionText: caption,
      });
      payload.sent = sent;
      if (rendered.files?.xlsx && opts.sendXlsx !== false) {
        payload.sentXlsx = await opts.sendFn({
          toUserId,
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
 * Persist PNG buffer under identity-scoped media root (adapters that already rendered).
 * Name is randomized — never overwrite by caller title.
 */
export function stagePngBuffer(pngBuffer, authCtx, nameHint = "chart") {
  if (!authCtx || typeof authCtx !== "object") {
    throw new Error("stagePngBuffer_requires_authCtx");
  }
  const dir = identityMediaDir(authCtx);
  const hint = String(nameHint || "chart")
    .replace(/[^\w.\u4e00-\u9fff-]+/g, "_")
    .slice(0, 24) || "chart";
  const safe = `${hint}_${Date.now()}_${randomBytes(6).toString("hex")}.png`;
  const path = join(dir, safe);
  writeFileSync(path, pngBuffer);
  return path;
}

export { stripPaths, sealAndRender, identityMediaDir };
