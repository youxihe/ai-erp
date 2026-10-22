/**
 * AIERP-021B: WeCom material prepare/commit (Material+Extend, stock stays 0).
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { routeTrustedInbound, isMaterialConfirmPhrase } from "../openclaw/sop/registry.mjs";
import { sanitizeMaterialFields } from "../openclaw/sop/material-upsert.mjs";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const MIN_SECRET_LEN = 32;
const stamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 12);
const BAR = `RM-TEST-${stamp}`;
const WECOM = `aierp021b-${Date.now().toString(36)}`;

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
  results.push({ name, ok, detail: String(d).slice(0, 500) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${String(d).slice(0, 240)}`);
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
  const err = String(r.stderr || "")
    .split(/\r?\n/)
    .filter((l) => l && !/Using a password on the command line/i.test(l))
    .join("\n");
  if (r.status !== 0) throw new Error(err || r.stdout || "mysql failed");
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

function applySql() {
  const sqlPath = join(__dirname, "..", "sql", "08-aierp-021b-material-master.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const r = spawnSync(
    "docker",
    ["exec", "-i", "aierp-mysql", "mysql", "-uroot", `-p${MYSQL_ROOT_PASSWORD}`, "--default-character-set=utf8mb4", "jsh_erp"],
    { encoding: "utf8", input: sql },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "apply sql failed");
}

async function main() {
  // SOP unit checks (no ERP)
  note("sop_confirm_phrase", isMaterialConfirmPhrase("确认建档12"), "确认建档12");
  note(
    "sop_route_material_confirm",
    routeTrustedInbound({ text: "确认建档99", isConfirmPhrase: () => true })?.sopId === "material_confirm",
    routeTrustedInbound({ text: "确认建档99", isConfirmPhrase: () => true }),
  );
  note(
    "sop_strip_stock",
    sanitizeMaterialFields({ name: "x", stock: [{ initStock: 100 }] }).rejected.includes("stock"),
    sanitizeMaterialFields({ name: "x", stock: 1 }),
  );

  applySql();
  note("sql_table", mysql("SHOW TABLES LIKE 'aierp_master_material_request'").length === 1, "table");

  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const code = issue.json?.data?.bindCode;
  note("bind_issue", !!code, { codeLen: code?.length });
  const token = await login();
  const claimed = await claim(token, code);
  note("bind_claim", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed?.data?.status);

  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody({
      rawText: "确认建档1",
      eventSource: "LLM_SELF_REPORT",
      isGroup: false,
    }));
    note("reject_llm_self_report", r.json?.code !== 200, { code: r.json?.code });
  }
  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody({
      rawText: "确认建档1",
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: true,
    }));
    note("reject_group_confirm", r.json?.code !== 200, { code: r.json?.code });
  }

  {
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody({
      opType: "CREATE",
      name: `测试表面助剂-${stamp}`,
      barCode: BAR,
      unit: "L",
      categoryId: 901,
      stock: [{ id: 14, initStock: "100" }],
    }));
    note(
      "stock_field_rejected",
      r.json?.code === 400 || /库存|stock/i.test(JSON.stringify(r.json)),
      { code: r.json?.code, data: r.json?.data || r.json },
    );
  }

  const prep = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody({
    opType: "CREATE",
    name: `测试表面助剂-${stamp}`,
    barCode: BAR,
    unit: "L",
    categoryId: 901,
    standard: "Demo",
    remark: "021B create",
  }));
  const requestId = prep.json?.data?.requestId;
  const phrase = prep.json?.data?.challenge?.phrase;
  note(
    "prepare_create",
    prep.json?.code === 200 && !!requestId && phrase === `确认建档${requestId}` && prep.json.data?.stockUnchanged === true,
    { requestId, phrase, summary: prep.json?.data?.summaryZh },
  );

  const beforeMat = mysql(`SELECT COUNT(*) FROM jsh_material_extend WHERE bar_code='${BAR}'`);
  note("prepare_no_write", beforeMat[0] === "0", { count: beforeMat[0] });

  const commit = await signedPost("/aierp/v1/wecom/master/material/commit", idBody({
    rawText: phrase,
    phrase,
    requestId,
    messageMsgId: `msg-create-${BAR}`,
    isGroup: false,
    eventSource: "WECOM_BEFORE_DISPATCH",
  }));
  const materialId = commit.json?.data?.materialId;
  note(
    "commit_create",
    commit.json?.code === 200 && !!materialId && commit.json.data?.barCode === BAR
      && Number(commit.json.data?.currentStockTotal) === 0
      && Number(commit.json.data?.initialStockRows || commit.json.data?.material?.initialStockRows) === 0,
    {
      materialId,
      barCode: commit.json?.data?.barCode,
      stock: commit.json?.data?.currentStockTotal,
      initRows: commit.json?.data?.initialStockRows ?? commit.json?.data?.material?.initialStockRows,
    },
  );

  const ext = mysql(
    `SELECT material_id, bar_code, commodity_unit FROM jsh_material_extend WHERE bar_code='${BAR}' AND IFNULL(delete_flag,'0')<>'1'`,
  );
  note("extend_saved", ext.length === 1 && ext[0].includes(BAR) && ext[0].includes("\tL"), ext[0]);

  const stockRows = mysql(
    `SELECT COUNT(*) FROM jsh_material_current_stock WHERE material_id=${materialId} AND IFNULL(delete_flag,'0')<>'1'`,
  );
  const initRows = mysql(
    `SELECT COUNT(*) FROM jsh_material_initial_stock WHERE material_id=${materialId} AND IFNULL(delete_flag,'0')<>'1'`,
  );
  note("no_current_stock_rows", stockRows[0] === "0", stockRows[0]);
  note("no_initial_stock_rows", initRows[0] === "0", initRows[0]);

  const replay = await signedPost("/aierp/v1/wecom/master/material/commit", idBody({
    rawText: phrase,
    phrase,
    requestId,
    messageMsgId: `msg-create-${BAR}-replay`,
    isGroup: false,
    eventSource: "WECOM_BEFORE_DISPATCH",
  }));
  note(
    "commit_replay_idempotent",
    replay.json?.code === 200 && replay.json.data?.replayed === true && replay.json.data?.materialId === materialId,
    { replayed: replay.json?.data?.replayed, id: replay.json?.data?.materialId },
  );
  const extCount = mysql(`SELECT COUNT(*) FROM jsh_material_extend WHERE bar_code='${BAR}' AND IFNULL(delete_flag,'0')<>'1'`);
  note("single_barcode_row", extCount[0] === "1", extCount[0]);

  {
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody({
      opType: "CREATE",
      name: `重复条码-${stamp}`,
      barCode: BAR,
      unit: "L",
      categoryId: 901,
    }));
    note("dup_barcode_fail", r.json?.code === 409 || /条码已存在/.test(JSON.stringify(r.json)), {
      code: r.json?.code,
      data: r.json?.data || r.json,
    });
  }

  const updPrep = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody({
    opType: "UPDATE",
    barCode: BAR,
    remark: "Demo 测试原料",
  }));
  const updId = updPrep.json?.data?.requestId;
  const updPhrase = updPrep.json?.data?.challenge?.phrase;
  note(
    "prepare_update_remark",
    updPrep.json?.code === 200 && updPhrase === `确认修改${updId}`,
    { updId, updPhrase, summary: updPrep.json?.data?.summaryZh },
  );

  const updCommit = await signedPost("/aierp/v1/wecom/master/material/commit", idBody({
    rawText: updPhrase,
    phrase: updPhrase,
    requestId: updId,
    messageMsgId: `msg-upd-${BAR}`,
    isGroup: false,
    eventSource: "WECOM_BEFORE_DISPATCH",
  }));
  note(
    "commit_update_remark",
    updCommit.json?.code === 200 && updCommit.json.data?.barCode === BAR,
    { remark: updCommit.json?.data?.material?.remark, unit: updCommit.json?.data?.unit },
  );
  const remarkDb = mysql(
    `SELECT remark, unit FROM jsh_material WHERE id=${materialId} AND IFNULL(delete_flag,'0')<>'1'`,
  );
  note(
    "remark_updated_unit_same",
    remarkDb[0]?.includes("Demo 测试原料") && remarkDb[0]?.includes("\tL"),
    remarkDb[0],
  );

  {
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody({
      opType: "UPDATE",
      barCode: BAR,
      unit: "kg",
      remark: "should-fail-unit",
    }));
    note(
      "forbid_unit_change",
      r.json?.code === 400 || /禁止修改基础单位/.test(JSON.stringify(r.json)),
      { code: r.json?.code, data: r.json?.data || r.json },
    );
  }

  const search = await signedPost("/aierp/v1/wecom/material/search", idBody({ query: BAR }));
  const hit = (search.json?.data?.rows || []).find((x) => x.barCode === BAR);
  note("searchable_after_create", search.json?.code === 200 && !!hit, hit);

  const failed = results.filter((x) => !x.ok);
  const report = {
    ticket: "AIERP-021B",
    barCode: BAR,
    materialId,
    wecomUserIdMasked: WECOM.slice(0, 4) + "***",
    results,
    ok: failed.length === 0,
    at: new Date().toISOString(),
  };
  const out = join(evidenceDir, `aierp-021b-material-master-${stamp}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nEvidence: ${out}`);
  console.log(failed.length === 0 ? "ALL PASS" : `FAILED ${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
