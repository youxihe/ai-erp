/**
 * SVG → high-DPI PNG using @resvg/resvg-js + system Chinese fonts.
 * Font binaries are never committed; resolved from the OS at runtime.
 */
import { listSystemChineseFonts } from "./fonts.mjs";
import { PNG_LIMITS } from "./catalog.mjs";
import { loadFromRenderHomes } from "./deps.mjs";

function loadResvg() {
  try {
    return loadFromRenderHomes("@resvg/resvg-js", (mod) => !!mod?.Resvg);
  } catch (err) {
    throw new Error(
      `缺少 @resvg/resvg-js（渲染依赖未就位）。请执行: npm install @resvg/resvg-js --prefix .tools/aierp-020c-render，或设置环境变量 AIERP_020C_RENDER_HOME 指向已安装目录。${err && err.message ? ` [${err.message}]` : ""}`,
    );
  }
}

/**
 * @param {string} svg
 * @param {{ scale?: number }} [opts]
 * @returns {Buffer} PNG bytes
 */
export function svgToPng(svg, opts = {}) {
  const { Resvg } = loadResvg();
  const scale = opts.scale || PNG_LIMITS.dpiScale;
  const fontFiles = listSystemChineseFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: {
      fontFiles,
      loadSystemFonts: true,
      defaultFontFamily: fontFiles.length ? undefined : "sans-serif",
    },
    background: "transparent",
  });
  const rendered = resvg.render();
  const png = Buffer.from(rendered.asPng());
  if (png.length > PNG_LIMITS.maxBytes) {
    // retry at lower scale
    if (scale > 1) return svgToPng(svg, { ...opts, scale: 1 });
    throw new Error(`png_too_large:${png.length}`);
  }
  return png;
}

export function resvgAvailable() {
  try {
    loadResvg();
    return true;
  } catch {
    return false;
  }
}
