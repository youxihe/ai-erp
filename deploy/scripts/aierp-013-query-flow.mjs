/**
 * AIERP-013 automated read-only query tests (no inventory posting).
 * Covers material / partner / bill / report under WeCom HMAC + binding.
 *
 * Usage:
 *   node deploy/scripts/aierp-013-query-flow.mjs
 * Env:
 *   AIERP_WECOM_ADAPTER_SECRET (or deploy/.env)
 *   AIERP_ERP_BASE_URL=http://127.0.0.1:9999/jshERP-boot
 *   AIERP_LOGIN_NAME / AIERP_LOGIN_PASSWORD (for claim)
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MIN_SECRET_LEN = 32;
const WECOM = `aierp013-${Date.now().toString(36)}`;

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
function note(name, ok, detail) {
  results.push({ name, ok, detail: redact(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${redact(String(detail)).slice(0, 240)}`);
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

async function main() {
  // unbound rejects
  {
    const r = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面" }));
    note("unbound_material_401", r.json?.code === 401 || /尚未绑定|401/.test(JSON.stringify(r)), r);
  }

  // bind
  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const code = issue.json?.data?.bindCode;
  note("bind_issue", !!code && String(code).length === 8, issue);
  const token = await erpLogin();
  const claimed = await claim(token, code);
  note("bind_claim", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed);

  // spoof reject
  {
    const r = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面", erpUserId: 1 }));
    note("spoof_identity_rejected", r.json?.code === 400 || /伪造/.test(JSON.stringify(r)), r);
  }

  // material
  {
    const r = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: "表面活性剂" }));
    const rows = r.json?.data?.rows || [];
    note(
      "material_search",
      r.json?.code === 200 && rows.some((x) => x.barCode === "RM-A001") && r.json.data.nature === "REAL_ERP",
      r,
    );
  }

  // partner supplier + customer
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

  // bills
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
    const r = await signedPost("/aierp/v1/wecom/bill/search", idBody({ billType: "mix", days: 90, limit: 10 }));
    note("bill_search_mix", r.json?.code === 200 && (r.json.data.rowCount >= 0), r);
  }
  {
    const r = await signedPost("/aierp/v1/wecom/bill/search", idBody({ billType: "service", days: 90, limit: 10 }));
    note("bill_search_service", r.json?.code === 200 && r.json.data.billType === "service", r);
  }

  // detail
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
    const r = await signedPost("/aierp/v1/wecom/bill/detail", idBody({ billNumber: "NO-SUCH-BILL-999" }));
    note("bill_detail_missing", r.json?.code === 404 || /不存在/.test(JSON.stringify(r)), r);
  }

  // range reject
  {
    const r = await signedPost(
      "/aierp/v1/wecom/bill/search",
      idBody({ billType: "purchase", fromDate: "2020-01-01", toDate: "2020-06-01" }),
    );
    note("bill_range_reject", r.json?.code === 400 || /90/.test(JSON.stringify(r)), r);
  }

  // reports
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

  // stock still works
  {
    const r = await signedPost("/aierp/v1/wecom/stock/query", idBody({ query: "表面活性剂", depotName: "原料仓" }));
    note("stock_compat", r.json?.code === 200 && Array.isArray(r.json.data.rows), r);
  }

  // cleanup unbind
  {
    const r = await signedPost("/aierp/v1/wecom/binding/unbind", idBody());
    note("unbind", r.json?.code === 200 && r.json.data.unbound === true, r);
  }

  const passed = results.filter((x) => x.ok).length;
  const out = {
    task: "AIERP-013",
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
  process.exit(1);
});
