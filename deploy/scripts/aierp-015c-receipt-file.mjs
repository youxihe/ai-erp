/**
 * AIERP-015C non-posting: trusted WeCom receipt find/file for GW-PURCHASE-119.
 * Never confirms drafts, never posts stock. Verifies PDF bytes + sha256.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const WECOM = process.env.AIERP_TEST_WECOM_USER || "sid";
function loadBotId() {
  if (process.env.AIERP_WECOM_BOT_ID) return process.env.AIERP_WECOM_BOT_ID.trim();
  try {
    const envPath = join(__dirname, "..", ".env");
    const line = readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("AIERP_WECOM_BOT_ID="));
    if (line) {
      const v = line.slice("AIERP_WECOM_BOT_ID=".length).trim();
      // Demo binding for sid uses the live WeCom bot id, not the placeholder "default".
      if (v && v !== "default") return v;
    }
  } catch {
    // ignore
  }
  return process.env.AIERP_LIVE_WECOM_BOT_ID || "aib8ZNDXJ9jrokrIdKVFI3924mpY59TqETG";
}
const BOT = loadBotId();
const BILL = "GW-PURCHASE-119";
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  results.push({
    name,
    ok,
    detail: typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600),
  });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = join(__dirname, "..", ".env");
    const line = readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
    secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
  }
  return secret;
}
const SECRET = loadSecret();

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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
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
      "-paierp_root_change_me",
      "-N",
      "--default-character-set=utf8mb4",
      "jsh_erp",
      "-e",
      sql,
    ],
    { encoding: "utf8" },
  );
  return (r.stdout || "").trim();
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const stockBefore = mysql(
  "SELECT current_number FROM jsh_material_current_stock WHERE material_id=(SELECT id FROM jsh_material WHERE name LIKE '%表面活性%' LIMIT 1) LIMIT 1",
);

// Intent-shaped find
{
  const r = await signedPost("/aierp/v1/wecom/receipt/find", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
    billNumber: BILL,
  });
  const d = r.json?.data;
  note(
    "find_by_bill_119",
    r.status === 200 && r.json?.code === 200 && d?.billNumber === BILL && d?.count === 1,
    { status: r.status, code: r.json?.code, bill: d?.billNumber, count: d?.count, summary: d?.userSummaryZh },
  );
}

// Latest without bill (should prefer recent authorized)
{
  const r = await signedPost("/aierp/v1/wecom/receipt/find", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
  });
  const d = r.json?.data;
  const ok =
    r.status === 200 &&
    r.json?.code === 200 &&
    (d?.count === 1 ? d?.billNumber === BILL : Array.isArray(d?.candidates) && d.candidates.length >= 1);
  note("find_latest_or_list", ok, {
    count: d?.count,
    ambiguous: d?.ambiguous,
    bill: d?.billNumber,
    candidates: (d?.candidates || []).map((c) => c.billNumber),
  });
}

// File bytes for #119
let pdfPath = null;
{
  const r = await signedPost("/aierp/v1/wecom/receipt/file", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
    billNumber: BILL,
  });
  const d = r.json?.data;
  const bytes = d?.fileBase64 ? Buffer.from(d.fileBase64, "base64") : null;
  const hashOk = bytes && d.pdfSha256 && sha256(bytes) === String(d.pdfSha256).toLowerCase();
  const headerOk = bytes && bytes.slice(0, 4).toString("utf8") === "%PDF";
  if (bytes && headerOk) {
    pdfPath = join(evidenceDir, "aierp-015c-GW-PURCHASE-119.pdf");
    writeFileSync(pdfPath, bytes);
  }
  note(
    "file_pdf_119",
    r.status === 200 && r.json?.code === 200 && d?.found === true && hashOk && headerOk && d?.mime === "application/pdf",
    {
      found: d?.found,
      bill: d?.billNumber,
      bytes: bytes?.length,
      hashOk,
      headerOk,
      delivery: d?.deliveryStatus,
      summary: d?.userSummaryZh,
      file: pdfPath,
    },
  );
}

// Negative: forged path/bill must fail
{
  const r = await signedPost("/aierp/v1/wecom/receipt/file", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
    billNumber: "GW-PURCHASE-999999",
  });
  const d = r.json?.data;
  note(
    "file_missing_bill",
    r.status === 200 && r.json?.code === 200 && d?.found === false,
    { found: d?.found, summary: d?.userSummaryZh },
  );
}

// Negative: other wecom user
{
  const r = await signedPost("/aierp/v1/wecom/receipt/file", {
    wecomUserId: `other-${Date.now().toString(36)}`,
    botId: BOT,
    channel: "wecom",
    billNumber: BILL,
  });
  const denied =
    r.json?.code !== 200 ||
    (r.json?.data && r.json.data.found === false) ||
    String(r.json?.data?.message || r.json?.message || "").includes("绑定");
  note("file_other_wecom_denied", denied, { status: r.status, code: r.json?.code, msg: r.json?.data?.message || r.json?.message });
}

// Path injection rejected by bill sanitize
{
  const r = await signedPost("/aierp/v1/wecom/receipt/file", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
    billNumber: "../etc/passwd",
  });
  note(
    "bill_path_injection_rejected",
    r.json?.code !== 200,
    { code: r.json?.code, msg: r.json?.data?.message || r.json?.message || r.json?.raw },
  );
}

const stockAfter = mysql(
  "SELECT current_number FROM jsh_material_current_stock WHERE material_id=(SELECT id FROM jsh_material WHERE name LIKE '%表面活性%' LIMIT 1) LIMIT 1",
);
note("stock_unchanged", stockBefore === stockAfter && stockBefore !== "", {
  before: stockBefore,
  after: stockAfter,
});

const billStatus = mysql(`SELECT status FROM jsh_depot_head WHERE number='${BILL}' LIMIT 1`);
note("bill_still_approved", billStatus === "1", { status: billStatus });

const out = {
  ticket: "AIERP-015C",
  at: new Date().toISOString(),
  wecomUserId: WECOM,
  bill: BILL,
  pdfEvidence: pdfPath,
  stockBefore,
  stockAfter,
  results,
  pass: results.every((r) => r.ok),
};
writeFileSync(join(evidenceDir, "aierp-015c-receipt-file.json"), JSON.stringify(out, null, 2), "utf8");
console.log(out.pass ? "ALL_PASS" : "HAS_FAIL");
process.exit(out.pass ? 0 : 1);
