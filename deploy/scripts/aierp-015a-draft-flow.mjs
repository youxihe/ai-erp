/**
 * AIERP-015A: purchase DRAFT create/status/cancel under WeCom HMAC (no posting).
 * Verifies stock unchanged and rejects spoofed identity / confirm-style misuse.
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const MIN_SECRET_LEN = 32;
const WECOM = `aierp015a-${Date.now().toString(36)}`;

function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
      if (line) secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
    }
  }
  if (!secret || secret.length < MIN_SECRET_LEN || /change-me|changeme|example|placeholder/i.test(secret)) {
    console.error("AIERP_WECOM_ADAPTER_SECRET required");
    process.exit(2);
  }
  return secret;
}

const SECRET = loadSecret();
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: redact(d).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${redact(d).slice(0, 220)}`);
}
function redact(s) {
  return String(s)
    .replace(/[A-Z0-9]{8}/g, (m) => (m.match(/[A-Z]/) && m.match(/[0-9]/) ? "CODE****" : m))
    .replace(/[0-9a-f]{32,}/gi, (m) => (m.length >= 32 ? m.slice(0, 6) + "…" : m));
}
function md5(s) {
  return createHash("md5").update(String(s), "utf8").digest("hex");
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
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

async function login() {
  const res = await fetch(`${BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
  });
  const json = await res.json();
  const token = json?.data?.token || json?.token;
  if (!token) throw new Error("login failed");
  return token;
}

async function claim(token, code) {
  const res = await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "X-Access-Token": token },
    body: JSON.stringify({ bindCode: code }),
  });
  return res.json();
}

function stockOf(barCode, depotId) {
  const rows = mysql(
    `SELECT IFNULL(mcs.current_number,0) FROM jsh_material_extend e
     JOIN jsh_material_current_stock mcs ON mcs.material_id=e.material_id AND mcs.depot_id=${depotId}
     WHERE e.bar_code='${barCode}' AND IFNULL(e.delete_flag,'0')<>'1' LIMIT 1`,
  );
  return rows[0] || "0";
}

async function main() {
  dockerExecCaptchaOff();
  const stockBefore = stockOf("RM-A001", 14);

  {
    const r = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
      barCode: "RM-A001", qty: 1, unit: "L", depotName: "原料仓", organName: "华东化工",
      idempotencyKey: `wecom:unbound:${Date.now()}`,
    }));
    note("unbound_prepare_401", r.json?.code === 401 || /尚未绑定/.test(JSON.stringify(r)), r.json);
  }

  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const code = issue.json?.data?.bindCode;
  note("bind_issue", !!code, { codeLen: code?.length });
  const token = await login();
  const claimed = await claim(token, code);
  note("bind_claim", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed?.data?.status);

  {
    const r = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
      barCode: "RM-A001", qty: 1, unit: "L", depotName: "原料仓", organName: "华东化工",
      idempotencyKey: `wecom:spoof:${Date.now()}`, erpUserId: 1,
    }));
    note("spoof_rejected", r.json?.code === 400 || /伪造/.test(JSON.stringify(r)), r.json);
  }

  const key = `wecom:${BOT}:${WECOM}:purchase:rm-a001:v1`;
  const prep = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
    barCode: "RM-A001",
    qty: 10,
    unit: "L",
    depotName: "原料仓",
    organName: "华东化工",
    idempotencyKey: key,
    remark: "015a-test",
  }));
  const draftId = prep.json?.data?.draftId;
  note(
    "purchase_prepare_real_draft",
    prep.json?.code === 200 &&
      prep.json.data?.status === "DRAFT" &&
      prep.json.data?.posted === false &&
      prep.json.data?.stockUnchanged === true &&
      prep.json.data?.nature === "REAL_ERP" &&
      !!draftId &&
      prep.json.data?.summary?.barCode === "RM-A001",
    {
      draftId,
      status: prep.json?.data?.status,
      amount: prep.json?.data?.summary?.amount,
      label: prep.json?.data?.statusLabel,
    },
  );

  const replay = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
    barCode: "RM-A001", qty: 10, unit: "L", depotName: "原料仓", organName: "华东化工",
    idempotencyKey: key, remark: "015a-test",
  }));
  note(
    "prepare_idempotent_replay",
    replay.json?.code === 200 && replay.json.data?.draftId === draftId && replay.json.data?.replayed === true,
    { code: replay.json?.code, draftId: replay.json?.data?.draftId, replayed: replay.json?.data?.replayed },
  );

  {
    const r = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
      barCode: "RM-A001", qty: 11, unit: "L", depotName: "原料仓", organName: "华东化工", idempotencyKey: key,
    }));
    note("prepare_idempotent_conflict", r.json?.code === 409 || /幂等/.test(JSON.stringify(r)), r.json?.code);
  }

  {
    const r = await signedPost("/aierp/v1/wecom/draft/status", idBody({ draftId }));
    note(
      "draft_status",
      r.json?.code === 200 && r.json.data?.draftId === draftId && r.json.data?.status === "DRAFT",
      { status: r.json?.data?.status, label: r.json?.data?.statusLabel },
    );
  }

  {
    // No confirm endpoint should exist on wecom adapter.
    const r = await signedPost("/aierp/v1/wecom/draft/confirm", idBody({ draftId, phrase: "确认-FAKE" }));
    note(
      "no_confirm_route",
      r.status === 404 || r.json?.code !== 200 || /loginOut|Not Found|404/i.test(JSON.stringify(r)),
      { status: r.status, code: r.json?.code },
    );
  }

  {
    const r = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
      barCode: "RM-A001", qty: 1, unit: "L", depotName: "不存在的仓库XYZ", organName: "华东化工",
      idempotencyKey: `wecom:${BOT}:${WECOM}:bad-depot`,
    }));
    note("bad_depot_rejected", r.json?.code === 400 || r.json?.code === 403, r.json?.code);
  }

  const stockAfterPrepare = stockOf("RM-A001", 14);
  note("stock_unchanged_after_prepare", stockBefore === stockAfterPrepare, { stockBefore, stockAfterPrepare });

  const dbStatus = mysql(`SELECT status, bill_number FROM aierp_gateway_draft WHERE id=${draftId}`)[0];
  note("db_draft_unposted", /^DRAFT\t?$/.test(dbStatus) || dbStatus?.startsWith("DRAFT"), dbStatus);

  {
    const r = await signedPost("/aierp/v1/wecom/draft/cancel", idBody({ draftId }));
    note("draft_cancel", r.json?.code === 200 && r.json.data?.status === "CANCELLED", r.json?.data?.status);
  }

  const stockAfterCancel = stockOf("RM-A001", 14);
  note("stock_unchanged_after_cancel", stockBefore === stockAfterCancel, { stockBefore, stockAfterCancel });

  await signedPost("/aierp/v1/wecom/binding/unbind", idBody());

  const passed = results.filter((x) => x.ok).length;
  const out = {
    task: "AIERP-015A",
    at: new Date().toISOString(),
    base: BASE,
    passed,
    total: results.length,
    dualUserUat: "NOT_VERIFIED",
    confirmToolRegistered: false,
    results,
  };
  writeFileSync(join(evidenceDir, "aierp-015a-draft-flow.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(`\n${passed}/${results.length} PASS`);
  if (passed !== results.length) process.exit(1);
}

function dockerExecCaptchaOff() {
  try {
    mysql("UPDATE jsh_platform_config SET platform_value='0' WHERE platform_key='checkcode_flag'");
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
