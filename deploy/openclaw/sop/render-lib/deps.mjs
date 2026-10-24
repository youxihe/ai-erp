/**
 * Runtime dependency resolution for native/optional npm packages.
 *
 * Why this exists:
 *   OpenClaw loads a *copy* of the plugin from a temp capture dir, e.g.
 *   state/tmp/plugin-captures/<uuid>/captures/openclaw-plugin-build-XXX/
 *     package-1/node_modules/aierp-openclaw/state/sop/render-lib
 *   so any `join(__dirname, "../../../..")` based lookup points inside the copy
 *   and never finds the real toolchain installed on disk.
 *
 * Strategy (first hit wins, all absolute, no reliance on layout depth):
 *   1. AIERP_020C_RENDER_HOME (explicit override, set in state/.env)
 *   2. OPENCLAW_HOME / OPENCLAW_STATE_DIR derived .tools
 *   3. walking up from this module (repo layout + deployed layout)
 *   4. walking up from process.cwd() (gateway working dir)
 *   5. plain require from this module (sibling node_modules)
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function pushUnique(list, value) {
  if (!value) return;
  const p = resolve(value);
  if (!list.includes(p)) list.push(p);
}

/**
 * Candidate directories that may contain a package.json whose node_modules
 * holds @resvg/resvg-js and exceljs.
 * @returns {string[]}
 */
export function renderHomeCandidates() {
  const out = [];
  const env = process.env || {};

  if (env.AIERP_020C_RENDER_HOME) pushUnique(out, env.AIERP_020C_RENDER_HOME);

  if (env.OPENCLAW_HOME) {
    pushUnique(out, join(resolve(env.OPENCLAW_HOME), ".tools", "aierp-020c-render"));
    pushUnique(out, join(resolve(env.OPENCLAW_HOME), "node_modules"));
  }
  if (env.OPENCLAW_STATE_DIR) {
    const sd = resolve(env.OPENCLAW_STATE_DIR);
    pushUnique(out, join(sd, ".tools", "aierp-020c-render"));
    pushUnique(out, join(dirname(sd), ".tools", "aierp-020c-render"));
    pushUnique(out, join(sd, "node_modules"));
  }

  // walk up from this module: covers <repo>/.tools and <plugin>/.tools layouts
  let cur = HERE;
  for (let i = 0; i < 6; i += 1) {
    cur = dirname(cur);
    if (!cur || cur === sep || /^[A-Za-z]:\\?$/.test(cur)) break;
    pushUnique(out, join(cur, ".tools", "aierp-020c-render"));
    pushUnique(out, join(cur, "node_modules"));
  }

  // walk up from the process working dir (gateway cwd)
  let cwd = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    pushUnique(out, join(cwd, ".tools", "aierp-020c-render"));
    pushUnique(out, join(cwd, "node_modules"));
    const parent = dirname(cwd);
    if (!parent || parent === cwd) break;
    cwd = parent;
  }

  return out;
}

/**
 * Resolve an npm package from the first candidate home that can load it.
 * @param {string} specifier npm package name
 * @param {(mod: any) => boolean} [accept] optional validity check
 * @returns {any}
 */
export function loadFromRenderHomes(specifier, accept) {
  const errors = [];
  const homes = renderHomeCandidates();
  for (const home of homes) {
    const pkg = join(home, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      const mod = createRequire(pkg)(specifier);
      if (!accept || accept(mod)) return mod;
    } catch (err) {
      errors.push(`${home}: ${err && err.message ? err.message : err}`);
    }
  }
  // last resort: sibling node_modules of this module
  try {
    const mod = createRequire(import.meta.url)(specifier);
    if (!accept || accept(mod)) return mod;
  } catch (err) {
    errors.push(`sibling: ${err && err.message ? err.message : err}`);
  }
  const detail = errors.length ? ` | 已尝试: ${errors.slice(0, 3).join(" ;; ")}` : "";
  throw new Error(`${specifier} 未安装或无法加载${detail}`);
}

/** @returns {string[]} diagnostics for ops/debug output */
export function renderHomeDiagnostics() {
  const homes = renderHomeCandidates();
  return homes
    .filter((h) => existsSync(join(h, "package.json")))
    .map((h) => h.replace(/\\/g, "/"));
}
