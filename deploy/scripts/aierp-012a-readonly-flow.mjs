/**
 * AIERP-012A automated isolation tests (single synthetic WeCom user; no live WeCom chat).
 * Covers HMAC (missing/wrong/correct/replay), bind lifecycle, delegated stock,
 * live user/tenant disable checks. Does NOT mutate real inventory qty.
 *
 * Distinct from dual real-ERP-user WeCom UAT (documented separately as NOT_VERIFIED).
 *
 * Usage:
 *   node deploy/scripts/aierp-012a-readonly-flow.mjs
 * Env (required):
 *   AIERP_WECOM_ADAPTER_SECRET=...  (high-entropy; no placeholders)
 * Optional:
 *   AIERP_ERP_BASE_URL=http://127.0.0.1:9999/jshERP-boot
 *   AIERP_LOGIN_NAME / AIERP_LOGIN_PASSWORD
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
  if (!secret) {
    console.error("AIERP_WECOM_ADAPTER_SECRET required (no default). Set in env or deploy/.env");
    process.exit(2);
  }
  if (secret.length < MIN_SECRET_LEN || /change-me|changeme|example|placeholder/i.test(secret)) {
    console.error("AIERP_WECOM_ADAPTER_SECRET rejected: too short or placeholder");
    process.exit(2);
  }
  return secret;
}

const SECRET = loadSecret();

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
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${redact(String(detail)).slice(0, 220)}`);
}

function redact(s) {
  return String(s)
    .replace(/[A-Z0-9]{8}/g, (m) => (m.match(/[A-Z]/) && m.match(/[0-9]/) ? "CODE****" : m))
    .replace(/sk-[a-zA-Z0-9]+/g, "sk-***")
    .replace(/"bindCode"\s*:\s*"[^"]+"/g, '"bindCode":"***"')
    .replace(/AIERP_WECOM_ADAPTER_SECRET=\S+/g, "AIERP_WECOM_ADAPTER_SECRET=***")
    .replace(/[0-9a-f]{32,}/gi, (m) => (m.length >= 32 ? m.slice(0, 6) + "…" : m));
}

async function signedPost(path, bodyObj, opts = {}) {
  const secret = opts.secret ?? SECRET;
  const body = JSON.stringify(bodyObj ?? {});
  const ts = opts.ts ?? String(Date.now());
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${path}`;
  const payload = `POST\n${uri}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "X-Aierp-Adapter-Timestamp": ts,
    "X-Aierp-Adapter-Nonce": nonce,
    "X-Aierp-Adapter-Signature": sig,
  };
  if (opts.omitNonce) delete headers["X-Aierp-Adapter-Nonce"];
  if (opts.omitSig) delete headers["X-Aierp-Adapter-Signature"];
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, json: null, text };
  }
  return { status: res.status, json, text, nonce, ts };
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

function msgOf(json, text) {
  return JSON.stringify(json || {}) + (text || "");
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

  let userId = null;
  let tenantId = null;
  let userStatusBefore = null;
  let tenantEnabledBefore = null;
  let tenantExpireBefore = null;

  try {
    // --- P0-1 HMAC ---
    {
      const res = await fetch(`${BASE}/aierp/v1/wecom/binding/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wecomUserId: wecomA, botId: BOT }),
      });
      const text = await res.text();
      note(
        "hmac_missing_rejected",
        res.status !== 200 || /loginOut|签名|密钥|401|503/i.test(text),
        text.slice(0, 140),
      );
    }

    {
      const { json, text } = await signedPost(
        "/aierp/v1/wecom/binding/issue",
        { wecomUserId: wecomA, botId: BOT },
        { secret: "definitely-wrong-secret-not-matching-erp-xxxxxx" },
      );
      const blob = msgOf(json, text);
      note("hmac_wrong_key_rejected", json?.code !== 200, blob.slice(0, 160));
    }

    {
      const { json } = await signedPost("/aierp/v1/wecom/binding/issue", { wecomUserId: wecomA, botId: BOT });
      note("hmac_correct_key_ok", json?.code === 200 && !!json?.data?.bindCode, `codeLen=${json?.data?.bindCode?.length || 0}`);
    }

    {
      const body = { wecomUserId: wecomA, botId: BOT };
      const first = await signedPost("/aierp/v1/wecom/binding/status", body);
      const replay = await signedPost("/aierp/v1/wecom/binding/status", body, {
        ts: first.ts,
        nonce: first.nonce,
      });
      note(
        "hmac_nonce_replay_rejected",
        replay.json?.code !== 200 || /nonce|重放|401/i.test(msgOf(replay.json, replay.text)),
        msgOf(replay.json, replay.text).slice(0, 160),
      );
    }

    // --- bind / stock isolation ---
    let code;
    {
      const { json } = await signedPost("/aierp/v1/wecom/binding/issue", { wecomUserId: wecomA, botId: BOT });
      code = json?.data?.bindCode;
      note("issue_bind_code", json?.code === 200 && !!code, `codeLen=${code ? code.length : 0}`);
    }

    {
      const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
        wecomUserId: wecomA,
        botId: BOT,
        query: "表面活性剂",
      });
      const msg = JSON.stringify(json);
      note("stock_unbound_rejected", json?.code !== 200 || msg.includes("尚未绑定") || msg.includes("401"), msg.slice(0, 160));
    }

    const token = await login();
    {
      const json = await claim(token, code);
      note("claim_ok", json?.code === 200 && json?.data?.status === "ACTIVE", JSON.stringify(json?.data || json).slice(0, 160));
    }

    {
      const json = await claim(token, code);
      note("claim_reuse_rejected", json?.code !== 200, JSON.stringify(json).slice(0, 160));
    }

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

    {
      const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
        wecomUserId: wecomB,
        botId: BOT,
        query: "表面活性剂",
      });
      note("other_wecom_unbound", json?.code !== 200, JSON.stringify(json).slice(0, 160));
    }

    // --- P0-2 live user/tenant ---
    const bindRows = mysql(
      `SELECT erp_user_id, tenant_id FROM aierp_wecom_binding WHERE wecom_user_id='${wecomA}' AND status='ACTIVE' LIMIT 1`,
    );
    if (bindRows.length) {
      const parts = bindRows[0].split(/\t/);
      userId = parts[0];
      tenantId = parts[1];
    }
    if (!userId || !tenantId) {
      note("p0_2_binding_lookup", false, "ACTIVE binding missing for fixture wecomA");
    } else {
      userStatusBefore = mysql(`SELECT status FROM jsh_user WHERE id=${userId}`)[0];
      const ten = mysql(`SELECT enabled+0, IFNULL(DATE_FORMAT(expire_time,'%Y-%m-%d %H:%i:%s'),'') FROM jsh_tenant WHERE tenant_id=${tenantId}`);
      tenantEnabledBefore = ten[0]?.split(/\t/)[0];
      tenantExpireBefore = ten[0]?.split(/\t/)[1] || "";

      mysql(`UPDATE jsh_user SET status=1 WHERE id=${userId}`);
      {
        const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
          wecomUserId: wecomA,
          botId: BOT,
          query: "表面活性剂",
        });
        note(
          "stock_disabled_user_rejected",
          json?.code !== 200 && /禁用|403/i.test(JSON.stringify(json)),
          JSON.stringify(json).slice(0, 180),
        );
      }
      mysql(`UPDATE jsh_user SET status=${userStatusBefore == null ? 0 : userStatusBefore} WHERE id=${userId}`);

      mysql(`UPDATE jsh_tenant SET enabled=0 WHERE tenant_id=${tenantId}`);
      {
        const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
          wecomUserId: wecomA,
          botId: BOT,
          query: "表面活性剂",
        });
        note(
          "stock_disabled_tenant_rejected",
          json?.code !== 200 && /停用|租户|403/i.test(JSON.stringify(json)),
          JSON.stringify(json).slice(0, 180),
        );
      }
      const enRest = tenantEnabledBefore === "0" ? "0" : "1";
      mysql(`UPDATE jsh_tenant SET enabled=${enRest} WHERE tenant_id=${tenantId}`);

      mysql(`UPDATE jsh_tenant SET expire_time=DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE tenant_id=${tenantId}`);
      {
        const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
          wecomUserId: wecomA,
          botId: BOT,
          query: "表面活性剂",
        });
        note(
          "stock_expired_tenant_rejected",
          json?.code !== 200 && /过期|租户|403/i.test(JSON.stringify(json)),
          JSON.stringify(json).slice(0, 180),
        );
      }
      if (tenantExpireBefore) {
        mysql(`UPDATE jsh_tenant SET expire_time='${tenantExpireBefore}' WHERE tenant_id=${tenantId}`);
      } else {
        mysql(`UPDATE jsh_tenant SET expire_time=DATE_ADD(NOW(), INTERVAL 5 YEAR) WHERE tenant_id=${tenantId}`);
      }

      {
        const { json } = await signedPost("/aierp/v1/wecom/stock/query", {
          wecomUserId: wecomA,
          botId: BOT,
          query: "表面活性剂",
        });
        const rows = json?.data?.rows || [];
        const hit = rows.find((r) => r.barCode === "RM-A001" || (r.materialName && String(r.materialName).includes("表面")));
        note(
          "stock_after_reenable_ok",
          json?.code === 200 && !!hit,
          JSON.stringify(hit || json).slice(0, 200),
        );
      }
    }

    {
      const { json } = await signedPost("/aierp/v1/wecom/binding/unbind", { wecomUserId: wecomA, botId: BOT });
      note("unbind_ok", json?.code === 200 && json?.data?.status === "UNBOUND", JSON.stringify(json?.data || json).slice(0, 120));
    }

    {
      const json = await claim(token, "ZZZZZZZZ");
      note("claim_unknown_rejected", json?.code !== 200, JSON.stringify(json).slice(0, 120));
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    const out = {
      suite: "aierp-012a-readonly-flow",
      kind: "single_user_automated_isolation",
      dual_real_user_wecom_uat: "NOT_VERIFIED",
      passed,
      failed,
      results,
      note: "Live dual WeCom / dual ERP-user permission UAT is separate and remains NOT_VERIFIED. This suite does not write inventory.",
    };
    const file = join(evidenceDir, "aierp-012a-readonly-flow.json");
    writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
    console.log(`SUMMARY passed=${passed} failed=${failed} evidence=${file}`);
    if (failed) process.exit(1);
  } finally {
    try {
      if (userId != null && userStatusBefore != null) {
        mysql(`UPDATE jsh_user SET status=${userStatusBefore} WHERE id=${userId}`);
      }
      if (tenantId != null) {
        if (tenantEnabledBefore != null) {
          mysql(`UPDATE jsh_tenant SET enabled=${tenantEnabledBefore === "0" ? 0 : 1} WHERE tenant_id=${tenantId}`);
        }
        if (tenantExpireBefore) {
          mysql(`UPDATE jsh_tenant SET expire_time='${tenantExpireBefore}' WHERE tenant_id=${tenantId}`);
        }
      }
    } catch (e) {
      console.error("fixture restore warning:", e?.message || e);
    }
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
