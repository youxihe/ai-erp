/**
 * AIERP-012A automated isolation tests (no WeCom live chat).
 * Verifies adapter HMAC, bind code lifecycle, delegated stock, spoof rejection.
 *
 * Usage:
 *   node deploy/scripts/aierp-012a-readonly-flow.mjs
 * Env:
 *   AIERP_ERP_BASE_URL=http://127.0.0.1:9999/jshERP-boot
 *   AIERP_WECOM_ADAPTER_SECRET=...
 *   AIERP_LOGIN_NAME / AIERP_LOGIN_PASSWORD (ERP user for claim)
 */
import { createHmac, createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const SECRET = process.env.AIERP_WECOM_ADAPTER_SECRET || "aierp-local-wecom-adapter-change-me";
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";

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

function captchaBypassAllowed() {
  if (process.env.AIERP_CAPTCHA_TEST_BYPASS === "0") return false;
  try {
    const host = new URL(BASE).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const results = [];
function note(name, ok, detail) {
  results.push({ name, ok, detail: redact(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${redact(String(detail)).slice(0, 200)}`);
}

function redact(s) {
  return String(s)
    .replace(/[A-Z0-9]{8}/g, (m) => (m.match(/[A-Z]/) && m.match(/[0-9]/) ? "CODE****" : m))
    .replace(/sk-[a-zA-Z0-9]+/g, "sk-***")
    .replace(/"bindCode"\s*:\s*"[^"]+"/g, '"bindCode":"***"');
}

async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const uri = `/jshERP-boot${path}`;
  const payload = `POST\n${uri}\n${ts}\n${body}`;
  const sig = createHmac("sha256", SECRET).update(payload, "utf8").digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Aierp-Adapter-Timestamp": ts,
      "X-Aierp-Adapter-Signature": sig,
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json ${res.status}: ${text.slice(0, 160)}`);
  }
  return { status: res.status, json };
}

async function login() {
  const res = await fetch(`${BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
  });
  const json = await res.json();
  const token = json?.data?.token || json?.token;
  if (!token) throw new Error("login failed: " + JSON.stringify(json).slice(0, 200));
  return token;
}

async function claim(token, code) {
  const res = await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Access-Token": token,
    },
    body: JSON.stringify({ bindCode: code }),
  });
  return res.json();
}

async function main() {
  const wecomA = "aierp-test-wecom-A";
  const wecomB = "aierp-test-wecom-B";
  const bypass = captchaBypassAllowed();
  const captchaBefore = bypass
    ? (mysql("SELECT platform_value FROM jsh_platform_config WHERE platform_key='checkcode_flag'")[0] || "0")
    : null;
  if (bypass) {
    mysql("UPDATE jsh_platform_config SET platform_value='0' WHERE platform_key='checkcode_flag'");
  }

  try {
  // 1) unsigned adapter rejected
  {
    const res = await fetch(`${BASE}/aierp/v1/wecom/binding/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wecomUserId: wecomA, botId: BOT }),
    });
    const text = await res.text();
    note("unsigned_adapter_rejected", res.status !== 200 || text.includes("loginOut") || text.includes("签名"), text.slice(0, 120));
  }

  // 2) issue bind code
  let code;
  {
    const { json } = await signedPost("/aierp/v1/wecom/binding/issue", { wecomUserId: wecomA, botId: BOT });
    code = json?.data?.bindCode;
    note("issue_bind_code", json?.code === 200 && !!code, `codeLen=${code ? code.length : 0}`);
  }

  // 3) stock before bind
  {
    const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
      wecomUserId: wecomA,
      botId: BOT,
      query: "表面活性剂",
    });
    const msg = JSON.stringify(json);
    note("stock_unbound_rejected", json?.code !== 200 || msg.includes("尚未绑定") || msg.includes("401"), msg.slice(0, 160));
  }

  // 4) claim with session
  const token = await login();
  {
    const json = await claim(token, code);
    note("claim_ok", json?.code === 200 && json?.data?.status === "ACTIVE", JSON.stringify(json?.data || json).slice(0, 160));
  }

  // 5) reuse code rejected
  {
    const json = await claim(token, code);
    note("claim_reuse_rejected", json?.code !== 200, JSON.stringify(json).slice(0, 160));
  }

  // 6) spoof identity fields rejected
  {
    const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
      wecomUserId: wecomA,
      botId: BOT,
      query: "表面活性剂",
      erpUserId: 1,
      tenantId: 999,
      token: "fake",
    });
    note("spoof_fields_rejected", json?.code !== 200, JSON.stringify(json).slice(0, 160));
  }

  // 7) stock query as bound user
  {
    const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
      wecomUserId: wecomA,
      botId: BOT,
      query: "表面活性剂",
    });
    const rows = json?.data?.rows || [];
    const hit = rows.find((r) => r.barCode === "RM-A001" || (r.materialName && String(r.materialName).includes("表面")));
    note(
      "stock_bound_ok",
      json?.code === 200 && !!hit && hit.materialName && hit.depotName && hit.unit != null && hit.currentStock != null,
      JSON.stringify(hit || json).slice(0, 200),
    );
  }

  // 8) unbound B cannot query
  {
    const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
      wecomUserId: wecomB,
      botId: BOT,
      query: "表面活性剂",
    });
    note("other_wecom_unbound", json?.code !== 200, JSON.stringify(json).slice(0, 160));
  }

  // 9) unbind
  {
    const { json } = await signedPost("/aierp/v1/wecom/binding/unbind", { wecomUserId: wecomA, botId: BOT });
    note("unbind_ok", json?.code === 200 && json?.data?.status === "UNBOUND", JSON.stringify(json?.data || json).slice(0, 120));
  }

  // 10) expired code (issue then claim with wrong/expired simulation via fake hash path — issue second and don't claim; force expire in DB not available)
  // Instead: issue and claim with wrong code
  {
    const json = await claim(token, "ZZZZZZZZ");
    note("claim_unknown_rejected", json?.code !== 200, JSON.stringify(json).slice(0, 120));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const out = {
    suite: "aierp-012a-readonly-flow",
    passed,
    failed,
    results,
    note: "Live WeCom multi-user UAT NOT_VERIFIED in this script; adapter/isolation covered.",
  };
  const file = join(evidenceDir, "aierp-012a-readonly-flow.json");
  writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
  console.log(`SUMMARY passed=${passed} failed=${failed} evidence=${file}`);
  if (failed) process.exit(1);
  } finally {
    if (bypass && captchaBefore != null) {
      const safe = captchaBefore === "1" ? "1" : "0";
      try {
        mysql(`UPDATE jsh_platform_config SET platform_value='${safe}' WHERE platform_key='checkcode_flag'`);
      } catch {}
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
