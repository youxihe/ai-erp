/**
 * AIERP-013 automated read-only query tests (no inventory posting).
 * Includes P0 mixed-depot bill authorization: user with only 原料仓 must not
 * see GW-MIX-95 header/amount (bill spans 原料仓+成品仓).
 *
 * Usage: node deploy/scripts/aierp-013-query-flow.mjs
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
const WECOM = `aierp013-${Date.now().toString(36)}`;
const ERP_USER_ID = 63; // jsh demo user — depot rights temporarily narrowed then restored

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
    console.error("AIERP_WECOM_ADAPTER_SECRET required (high-entropy)");
    process.exit(2);
  }
  return secret;
}

const SECRET = loadSecret();
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const results = [];

function summarize(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  const j = detail.json ?? detail;
  if (!j || typeof j !== "object") return String(detail);
  const d = j.data;
  if (d && typeof d === "object") {
    return JSON.stringify({
      code: j.code,
      billNumber: d.bill?.billNumber || d.rows?.[0]?.billNumber,
      billType: d.billType || d.bill?.billType,
      rowCount: d.rowCount ?? d.lineCount,
      hint: d.hint,
      message: typeof d === "string" ? d : d.message,
      nature: d.nature,
      depots: (d.lines || d.rows || []).slice(0, 3).map((x) => x.depotName || x.barCode).filter(Boolean),
    });
  }
  return JSON.stringify({ code: j.code, data: typeof j.data === "string" ? j.data : undefined, status: detail.status });
}

function note(name, ok, detail) {
  const summary = redact(summarize(detail));
  results.push({ name, ok, detail: summary });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${summary.slice(0, 240)}`);
}

function redact(s) {
  return String(s)
    .replace(/[A-Z0-9]{8}/g, (m) => (m.match(/[A-Z]/) && m.match(/[0-9]/) ? "CODE****" : m))
    .replace(/"bindCode"\s*:\s*"[^"]+"/g, '"bindCode":"***"')
    .replace(/AIERP_WECOM_ADAPTER_SECRET=\S+/g, "AIERP_WECOM_ADAPTER_SECRET=***")
    .replace(/[0-9a-f]{32,}/gi, (m) => (m.length >= 32 ? m.slice(0, 6) + "…" : m));
}

function md5(s) {
  return createHash("md5").update(String(s), "utf8").digest("hex");
}

function mysql(sql) {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "aierp-mysql",
      "mysql",
      "-uroot",
      `-p${MYSQL_ROOT_PASSWORD}`,
      "-N",
      "--default-character-set=utf8mb4",
      "jsh_erp",
      "-e",
      sql,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "mysql failed");
  return (r.stdout || "").trim().split(/\r?\n/).filter(Boolean);
}

async function signedPost(path, bodyObj, opts = {}) {
  const secret = opts.secret ?? SECRET;
  const body = JSON.stringify(bodyObj ?? {});
  const ts = opts.ts ?? String(Date.now());
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const uri = `/jshERP-boot${path}`;
  const payload = `POST\n${uri}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
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
    return { status: res.status, raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function erpLogin() {
  const res = await fetch(`${BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
  });
  const json = await res.json();
  const token = json?.data?.token || json?.token;
  if (!token) throw new Error("ERP login failed: " + JSON.stringify(json).slice(0, 200));
  return token;
}

async function claim(token, bindCode) {
  const res = await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Access-Token": token,
    },
    body: JSON.stringify({ bindCode }),
  });
  return res.json();
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

function getUserDepot() {
  const rows = mysql(
    `SELECT IFNULL(value,'') FROM jsh_user_business WHERE type='UserDepot' AND key_id='${ERP_USER_ID}' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1`,
  );
  return rows[0] || "";
}

function setUserDepot(value) {
  const cur = mysql(
    `SELECT id FROM jsh_user_business WHERE type='UserDepot' AND key_id='${ERP_USER_ID}' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1`,
  );
  if (cur.length) {
    mysql(`UPDATE jsh_user_business SET value='${value}' WHERE id=${cur[0]}`);
  } else {
    mysql(
      `INSERT INTO jsh_user_business (type, key_id, value, delete_flag) VALUES ('UserDepot','${ERP_USER_ID}','${value}','0')`,
    );
  }
}

async function main() {
  const depotBefore = getUserDepot();
  // Ensure full access for baseline tests (原料仓+成品仓).
  setUserDepot("[14][15]");

  try {
    {
      const r = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面" }));
      note("unbound_material_401", r.json?.code === 401 || /尚未绑定|401/.test(JSON.stringify(r)), r);
    }

    const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
    const code = issue.json?.data?.bindCode;
    note("bind_issue", !!code && String(code).length === 8, { json: { code: issue.json?.code, data: { bindCode: "***" } } });
    const token = await erpLogin();
    const claimed = await claim(token, code);
    note("bind_claim", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed);

    {
      const r = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面", erpUserId: 1 }));
      note("spoof_identity_rejected", r.json?.code === 400 || /伪造/.test(JSON.stringify(r)), r);
    }

    {
      const r = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面活性剂" }));
      const rows = r.json?.data?.rows || [];
      note(
        "material_search",
        r.json?.code === 200 && rows.some((x) => x.barCode === "RM-A001") && r.json.data.nature === "REAL_ERP",
        r,
      );
    }

    {
      const r = await signedPost("/aierp/v1/wecom/partner/search", idBody({ partnerType: "supplier", query: "华东" }));
      const rows = r.json?.data?.rows || [];
      note("partner_supplier", r.json?.code === 200 && rows.some((x) => String(x.partnerName).includes("华东")), r);
    }
    {
      const r = await signedPost("/aierp/v1/wecom/partner/search", idBody({ partnerType: "customer", query: "苏州" }));
      const rows = r.json?.data?.rows || [];
      note("partner_customer", r.json?.code === 200 && rows.some((x) => String(x.partnerName).includes("苏州")), r);
    }
    {
      const r = await signedPost("/aierp/v1/wecom/partner/search", idBody({ partnerType: "hack" }));
      note("partner_bad_type", r.json?.code === 400 || /partnerType/.test(JSON.stringify(r)), r);
    }

    {
      const r = await signedPost(
        "/aierp/v1/wecom/bill/search",
        idBody({ billType: "purchase", days: 90, limit: 20, status: "已审核" }),
      );
      const rows = r.json?.data?.rows || [];
      note(
        "bill_search_purchase",
        r.json?.code === 200 &&
          rows.some((x) => x.billType === "purchase" && x.billTypeLabel === "采购入库") &&
          !rows.some((x) => /销售/.test(String(x.billTypeLabel))),
        r,
      );
    }
    {
      const r = await signedPost("/aierp/v1/wecom/bill/search", idBody({ billType: "mix", days: 90, limit: 20 }));
      const rows = r.json?.data?.rows || [];
      note(
        "bill_search_mix_full_depots",
        r.json?.code === 200 && rows.some((x) => x.billNumber === "GW-MIX-95"),
        r,
      );
    }
    {
      const r = await signedPost("/aierp/v1/wecom/bill/search", idBody({ billType: "service", days: 90, limit: 10 }));
      note("bill_search_service", r.json?.code === 200 && r.json.data.billType === "service", r);
    }

    {
      const r = await signedPost("/aierp/v1/wecom/bill/detail", idBody({ billNumber: "GW-PURCHASE-94" }));
      const lines = r.json?.data?.lines || [];
      note(
        "bill_detail_purchase",
        r.json?.code === 200 &&
          r.json.data.bill?.billNumber === "GW-PURCHASE-94" &&
          lines.some((x) => x.barCode === "RM-A001"),
        r,
      );
    }
    {
      const r = await signedPost("/aierp/v1/wecom/bill/detail", idBody({ billNumber: "GW-MIX-95" }));
      note(
        "bill_detail_mix_full_depots",
        r.json?.code === 200 && r.json.data.bill?.billNumber === "GW-MIX-95",
        r,
      );
    }
    {
      const r = await signedPost("/aierp/v1/wecom/bill/detail", idBody({ billNumber: "NO-SUCH-BILL-999" }));
      note("bill_detail_missing", r.json?.code === 404 || /不存在/.test(JSON.stringify(r)), r);
    }

    {
      const r = await signedPost(
        "/aierp/v1/wecom/bill/search",
        idBody({ billType: "purchase", fromDate: "2020-01-01", toDate: "2020-06-01" }),
      );
      note("bill_range_reject", r.json?.code === 400 || /90/.test(JSON.stringify(r)), r);
    }

    {
      const r = await signedPost(
        "/aierp/v1/wecom/report/query",
        idBody({ report: "purchase_in_summary", days: 90 }),
      );
      note(
        "report_purchase_summary",
        r.json?.code === 200 &&
          r.json.data.nature === "REAL_ERP" &&
          (r.json.data.totals?.billCount >= 0 || r.json.data.hint),
        r,
      );
    }
    {
      const r = await signedPost(
        "/aierp/v1/wecom/report/query",
        idBody({ report: "service_consume_by_customer", days: 90 }),
      );
      note("report_service_by_customer", r.json?.code === 200 && Array.isArray(r.json.data.rows), r);
    }
    {
      const r = await signedPost("/aierp/v1/wecom/report/query", idBody({ report: "fake_ledger" }));
      note("report_unsupported", r.json?.code === 400 || /不支持/.test(JSON.stringify(r)), r);
    }

    {
      const r = await signedPost("/aierp/v1/wecom/stock/query", idBody({ query: "表面活性剂", depotName: "原料仓" }));
      note("stock_compat", r.json?.code === 200 && Array.isArray(r.json.data.rows), r);
    }

    // --- P0: low-privilege (原料仓 only) must not leak mixed-depot MIX header/amount ---
    setUserDepot("[14]");
    {
      const r = await signedPost("/aierp/v1/wecom/bill/search", idBody({ billType: "mix", days: 90, limit: 50 }));
      const rows = r.json?.data?.rows || [];
      const leaked = rows.some((x) => x.billNumber === "GW-MIX-95");
      note(
        "mixed_depot_mix_hidden_from_raw_only",
        r.json?.code === 200 && !leaked,
        { json: { code: r.json?.code, data: { rowCount: rows.length, numbers: rows.map((x) => x.billNumber) } } },
      );
    }
    {
      const r = await signedPost("/aierp/v1/wecom/bill/detail", idBody({ billNumber: "GW-MIX-95" }));
      const blob = JSON.stringify(r.json || {});
      const leakedAmount = /totalAmount|total_price|partnerName|苏州|精密/i.test(blob) && r.json?.code === 200;
      note(
        "mixed_depot_mix_detail_forbidden",
        r.json?.code === 403 && !leakedAmount && /未授权仓库|无权/.test(blob),
        r,
      );
    }
    {
      // Single-depot purchase on 原料仓 remains visible.
      const r = await signedPost("/aierp/v1/wecom/bill/detail", idBody({ billNumber: "GW-PURCHASE-94" }));
      note(
        "raw_only_still_sees_purchase",
        r.json?.code === 200 && r.json.data.bill?.billNumber === "GW-PURCHASE-94",
        r,
      );
    }

    {
      const r = await signedPost("/aierp/v1/wecom/binding/unbind", idBody());
      note("unbind", r.json?.code === 200 && r.json.data.unbound === true, r);
    }
  } finally {
    // Always restore demo user depot rights.
    setUserDepot(depotBefore || "[14][15]");
  }

  const passed = results.filter((x) => x.ok).length;
  const out = {
    task: "AIERP-013",
    reviewFix: "mixed-depot-full-authorization",
    at: new Date().toISOString(),
    base: BASE,
    wecomUserIdMasked: WECOM.slice(0, 2) + "***",
    passed,
    total: results.length,
    dualUserUat: "NOT_VERIFIED",
    results,
  };
  const path = join(evidenceDir, "aierp-013-query-flow.json");
  writeFileSync(path, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n${passed}/${results.length} PASS → ${path}`);
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  try {
    setUserDepot("[14][15]");
  } catch {
    /* ignore */
  }
  process.exit(1);
});
