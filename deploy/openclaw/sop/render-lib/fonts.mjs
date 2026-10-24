/**
 * Discover system Chinese fonts. Never commit font binaries into git.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const WIN_FONT_DIR = process.env.WINDIR
  ? join(process.env.WINDIR, "Fonts")
  : "C:/Windows/Fonts";

const CANDIDATES = [
  "msyh.ttc",
  "msyhbd.ttc",
  "msyhl.ttc",
  "NotoSansSC-VF.ttf",
  "NotoSansSC-Regular.otf",
  "simhei.ttf",
  "simsun.ttc",
  "SourceHanSansSC-Regular.otf",
];

let cached = null;

export function listSystemChineseFonts() {
  if (cached) return cached;
  const found = [];
  for (const name of CANDIDATES) {
    const p = join(WIN_FONT_DIR, name);
    if (existsSync(p)) found.push(p);
  }
  // Linux / macOS common paths (optional)
  for (const p of [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
  ]) {
    if (existsSync(p)) found.push(p);
  }
  cached = found;
  return found;
}

export function primaryChineseFontFamily() {
  const fonts = listSystemChineseFonts();
  if (fonts.some((f) => /msyh/i.test(f))) return "Microsoft YaHei";
  if (fonts.some((f) => /NotoSansSC|NotoSansCJK/i.test(f))) return "Noto Sans SC";
  if (fonts.some((f) => /simhei/i.test(f))) return "SimHei";
  if (fonts.some((f) => /simsun/i.test(f))) return "SimSun";
  return "sans-serif";
}

export function fontCssStack() {
  return `"${primaryChineseFontFamily()}", "Microsoft YaHei", "SimHei", "Noto Sans SC", sans-serif`;
}
