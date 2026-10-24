/**
 * Plugin-side re-export of AIERP-020C render library.
 * Implementation lives in deploy/openclaw/sop/render-lib (keep in sync via same API).
 */
export * from "../../../../sop/render-lib/index.mjs";
export { prepareWecomRender, stagePngBuffer, stripPaths } from "../../../../sop/render-lib/channel/wecom-render-hook.mjs";
