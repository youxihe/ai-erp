/**
 * Non-posting: generate prefilled PURCHASE xlsx (RM-A001 / 华东化工 / 原料仓 / 10L)
 * and assert sheet XML contains those values. Also write plugin MEDIA path like live plugin.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const WECOM = `prefill-${Date.now().toString(36)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });

function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = join(__dirname, "..", ".env");
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
      if (line) secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
    }
  }
  if (!secret || secret.length < 32) throw new Error("secret missing");
  return secret;
}
const SECRET = loadSecret();
function md5(s) {
  return createHash("md5").update(String(s), "utf8").digest("hex");
}
async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${path}`;
  const sig = createHmac("sha256", SECRET).update(`POST\n${uri}\n${ts}\n${nonce}\n${body}`, "utf8").digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Aierp-Adapter-Timestamp": ts,
      "X-Aierp-Adapter-Nonce": nonce,
      "X-Aierp-Adapter-Signature": sig,
    },
    body,
  });
  return res.json();
}

const token = (
  await (
    await fetch(`${BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginName: "jsh", password: md5("123456") }),
    })
  ).json()
).data.token;
const issue = await signedPost("/aierp/v1/wecom/binding/issue", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});
await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Access-Token": token },
  body: JSON.stringify({ bindCode: issue.data.bindCode }),
});

const stockBefore = Number(
  spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "aierp-mysql",
      "mysql",
      "-uroot",
      `-p${process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me"}`,
      "-N",
      "jsh_erp",
      "-e",
      "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
    ],
    { encoding: "utf8" },
  ).stdout.trim() || "0",
);

const tpl = await signedPost("/aierp/v1/wecom/excel/template", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  scene: "PURCHASE",
  rows: [
    {
      businessKey: "PF-DEMO",
      date: "2026-10-21",
      organName: "华东化工",
      barCode: "RM-A001",
      name: "表面活性剂",
      depotName: "原料仓",
      qty: "10",
      unit: "L",
      price: "12.5",
      remark: "user-prefill-demo",
    },
  ],
});
if (tpl.code !== 200 || !tpl.data?.fileBase64) {
  console.error(tpl);
  process.exit(1);
}

const xlsxPath = join(evidenceDir, "aierp-017a-prefill-RM-A001.xlsx");
const bytes = Buffer.from(tpl.data.fileBase64, "base64");
writeFileSync(xlsxPath, bytes);

// Plugin-style MEDIA path under OpenClaw state
const mediaDir = join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state", "media", "aierp-excel");
mkdirSync(mediaDir, { recursive: true });
const mediaPath = join(mediaDir, tpl.data.fileName || "采购入库模板.xlsx");
writeFileSync(mediaPath, bytes);

// Unzip sharedStrings + sheet to verify prefill (no excel lib)
// xlsx is zip; extract sharedStrings via tar for UTF-8 needle checks
const zipCopy = xlsxPath.replace(/\.xlsx$/i, ".zip");
writeFileSync(zipCopy, bytes);
const tmp = join(process.env.TEMP || ".", `xlsx-prefill-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
spawnSync("tar", ["-xf", zipCopy, "-C", tmp], { encoding: "utf8" });
const shared = readFileSync(join(tmp, "xl", "sharedStrings.xml"), "utf8");
const needles = ["RM-A001", "华东化工", "原料仓", "表面活性剂", "10", "12.5"];
const found = Object.fromEntries(needles.map((n) => [n, shared.includes(n)]));

const prev = await signedPost("/aierp/v1/wecom/excel/preview", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
  fileName: tpl.data.fileName,
  fileBase64: tpl.data.fileBase64,
  fileSha256: createHash("sha256").update(bytes).digest("hex"),
  scene: "PURCHASE",
});

const stockAfter = Number(
  spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "aierp-mysql",
      "mysql",
      "-uroot",
      `-p${process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me"}`,
      "-N",
      "jsh_erp",
      "-e",
      "SELECT IFNULL(current_number,0) FROM jsh_material_current_stock WHERE material_id=(SELECT material_id FROM jsh_material_extend WHERE bar_code='RM-A001' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1) AND depot_id=14 LIMIT 1",
    ],
    { encoding: "utf8" },
  ).stdout.trim() || "0",
);

await signedPost("/aierp/v1/wecom/binding/unbind", {
  wecomUserId: WECOM,
  botId: BOT,
  channel: "wecom",
});

const out = {
  suite: "aierp-017a-prefill-evidence",
  at: new Date().toISOString(),
  templateCode: tpl.code,
  byteLength: tpl.data.byteLength,
  xlsxPath,
  mediaPath,
  mediaDirective: `MEDIA: ${mediaPath}`,
  prefillNeedlesFound: found,
  allNeedlesPresent: Object.values(found).every(Boolean),
  previewId: prev.data?.previewId,
  previewPosted: prev.data?.posted === false,
  stockBefore,
  stockAfter,
  stockUnchanged: stockBefore === stockAfter,
  FILE_OUTBOUND_WECOM: "NOT_VERIFIED_IN_THIS_SCRIPT",
  note: "XLSX bytes + MEDIA path ready for WeCom channel; live DM delivery requires user WeCom session.",
};
writeFileSync(join(evidenceDir, "aierp-017a-prefill-evidence.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!out.allNeedlesPresent || !out.stockUnchanged || !out.previewPosted) process.exit(1);
console.log("PREFILL_EVIDENCE_OK");
