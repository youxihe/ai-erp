/**
 * End-to-end HMAC path as the real bound WeCom user `sid` (same APIs tools call).
 * Proves prepare/status/cancel + stock unchanged for the live binding.
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const __dirname = dirname(fileURLToPath(import.meta.url));

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

function mysql(sql) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", "aierp-mysql", "mysql", "-uroot", `-p${MYSQL_ROOT_PASSWORD}`, "-N", "--default-character-set=utf8mb4", "jsh_erp", "-e", sql],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "mysql failed");
  return (r.stdout || "").trim().split(/\r?\n/).filter(Boolean);
}

const SECRET = loadSecret();
const binding = mysql(
  "SELECT wecom_user_id, bot_id, erp_login_name FROM aierp_wecom_binding WHERE status='ACTIVE' AND wecom_user_id='sid' ORDER BY id DESC LIMIT 1",
)[0];
if (!binding) throw new Error("no ACTIVE binding for wecom user sid");
const [WECOM, BOT, LOGIN] = binding.split("\t");
console.log("binding", { wecom: WECOM.slice(0, 3) + "***", bot: BOT.slice(0, 8) + "...", login: LOGIN });

async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${path}`;
  const payload = `POST\n${uri}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", SECRET).update(payload, "utf8").digest("hex");
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
  const json = await res.json();
  return { status: res.status, json };
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

function stockOf() {
  return mysql(
    `SELECT IFNULL(mcs.current_number,0) FROM jsh_material_extend e
     JOIN jsh_material_current_stock mcs ON mcs.material_id=e.material_id AND mcs.depot_id=14
     WHERE e.bar_code='RM-A001' AND IFNULL(e.delete_flag,'0')<>'1' LIMIT 1`,
  )[0];
}

const before = stockOf();
const partners = await signedPost("/aierp/v1/wecom/partner/search", idBody({ partnerType: "supplier", query: "华东", limit: 5 }));
const materials = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面活性剂", limit: 5 }));
const bills = await signedPost("/aierp/v1/wecom/bill/search", idBody({ billType: "purchase", days: 90, limit: 5 }));
const key = `w:sid:uat:${Date.now().toString(36)}`;
const prep = await signedPost(
  "/aierp/v1/wecom/purchase/prepare",
  idBody({
    barCode: "RM-A001",
    qty: 10,
    unit: "L",
    depotName: "原料仓",
    organName: "华东化工",
    idempotencyKey: key,
    remark: "wecom-sid-uat-015a-reviewfix",
  }),
);
const draftId = prep.json?.data?.draftId;
const status = await signedPost("/aierp/v1/wecom/draft/status", idBody({ draftId }));
const after = stockOf();
const cancel = await signedPost("/aierp/v1/wecom/draft/cancel", idBody({ draftId }));
const afterCancel = stockOf();

const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const out = {
  task: "AIERP-015A-REVIEW-FIX-WECOM-SID-UAT",
  at: new Date().toISOString(),
  wecomUserMasked: WECOM.slice(0, 3) + "***",
  erpLogin: LOGIN,
  partnerRowCount: partners.json?.data?.rowCount ?? null,
  materialRows: (materials.json?.data?.rows || []).map((r) => ({ barCode: r.barCode, name: r.materialName })),
  billRowCount: bills.json?.data?.rowCount ?? null,
  draftId,
  status: status.json?.data?.status,
  statusLabel: status.json?.data?.statusLabel,
  posted: status.json?.data?.posted,
  summary: status.json?.data?.summary,
  stockBefore: before,
  stockAfterPrepare: after,
  stockAfterCancel: afterCancel,
  cancelled: cancel.json?.data?.status,
  ok:
    prep.json?.code === 200 &&
    status.json?.data?.status === "DRAFT" &&
    status.json?.data?.posted === false &&
    before === after &&
    before === afterCancel &&
    cancel.json?.data?.status === "CANCELLED",
};
writeFileSync(join(evidenceDir, "aierp-015a-wecom-sid-uat.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
