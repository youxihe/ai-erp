/**
 * SVG → high-DPI PNG using @resvg/resvg-js + system Chinese fonts.
 * Font binaries are never committed; resolved from the OS at runtime.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listSystemChineseFonts } from "./fonts.mjs";
import { PNG_LIMITS } from "./catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

function loadResvg() {
  const candidates = [
    join(ROOT, ".tools", "aierp-020c-render", "package.json"),
    join(ROOT, "node_modules", "@resvg", "resvg-js", "package.json"),
    join(process.cwd(), ".tools", "aierp-020c-render", "package.json"),
    join(process.cwd(), "node_modules", "@resvg", "resvg-js", "package.json"),
  ];
  for (const pkg of candidates) {
    if (!existsSync(pkg)) continue;
    try {
      const req = createRequire(pkg);
      const mod = req("@resvg/resvg-js");
      if (mod?.Resvg) return mod;
    } catch {
      // try next
    }
  }
  throw new Error(
    "缺少 @resvg/resvg-js。请执行: npm install @resvg/resvg-js --prefix .tools/aierp-020c-render",
  );
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
