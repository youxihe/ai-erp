/**
 * AIERP-021B: WeCom material prepare/commit (Material+Extend, stock stays 0).
 * Review-fix: namespaced confirms, WECOM_BEFORE_DISPATCH required, RoleFunctions authz.
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
const LOW_LOGIN = process.env.AIERP_LOW_LOGIN_NAME || "test123";
const LOW_PASS = process.env.AIERP_LOW_LOGIN_PASSWORD || "123456";
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const MIN_SECRET_LEN = 32;
const stamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 12);
const BAR = `RM-TEST-${stamp}`;
const BAR_RACE = `RM-RACE-${stamp}`;
const WECOM = `aierp021b-${Date.now().toString(36)}`;
const WECOM_LOW = `aierp021b-low-${Date.now().toString(36)}`;
const WECOM_RACE_A = `aierp021b-ra-${Date.now().toString(36)}`;
const WECOM_RACE_B = `aierp021b-rb-${Date.now().toString(36)}`;

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

function idBody(wecomUserId, extra = {}) {
  return { wecomUserId, botId: BOT, channel: "wecom", ...extra };
}

async function login(loginName = LOGIN, password = PASS) {
  const res = await fetch(`${BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ loginName, password: md5(password) }),
  });
  const json = await res.json();
  const token = json?.data?.token || json?.token;
  if (!token) throw new Error(`login failed for ${loginName}: ${JSON.stringify(json).slice(0, 200)}`);
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

async function bindUser(wecomUserId, loginName, password) {
  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody(wecomUserId));
  const code = issue.json?.data?.bindCode;
  if (!code) throw new Error(`bind issue failed: ${JSON.stringify(issue.json)}`);
  const token = await login(loginName, password);
  const claimed = await claim(token, code);
  return { code, claimed };
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
  note("sop_confirm_phrase_namespaced", isMaterialConfirmPhrase("确认建档物料12"), "确认建档物料12");
  note(
    "sop_reject_bare_partner_phrase",
    !isMaterialConfirmPhrase("确认建档12") && !isMaterialConfirmPhrase("确认修改99"),
    "bare 确认建档/确认修改 must not route as material",
  );
  note(
    "sop_route_material_confirm",
    routeTrustedInbound({ text: "确认建档物料99", isConfirmPhrase: () => true })?.sopId === "material_confirm",
    routeTrustedInbound({ text: "确认建档物料99", isConfirmPhrase: () => true }),
  );
  note(
    "sop_bare_confirm_not_material",
    routeTrustedInbound({ text: "确认建档99", isConfirmPhrase: () => true })?.sopId !== "material_confirm",
    routeTrustedInbound({ text: "确认建档99", isConfirmPhrase: () => true }),
  );
  note(
    "sop_strip_stock",
    sanitizeMaterialFields({ name: "x", stock: [{ initStock: 100 }] }).rejected.includes("stock"),
    sanitizeMaterialFields({ name: "x", stock: 1 }),
  );

  applySql();
  note("sql_table", mysql("SHOW TABLES LIKE 'aierp_master_material_request'").length === 1, "table");

  const bound = await bindUser(WECOM, LOGIN, PASS);
  note("bind_claim", bound.claimed?.code === 200 || bound.claimed?.data?.status === "ACTIVE", bound.claimed?.data?.status);

  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
      rawText: "确认建档物料1",
      eventSource: "LLM_SELF_REPORT",
      isGroup: false,
    }));
    note("reject_llm_self_report", r.json?.code === 403 || r.json?.code !== 200, { code: r.json?.code, data: r.json?.data });
  }
  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
      rawText: "确认建档物料1",
      isGroup: false,
      // null / omitted eventSource must fail (not optional)
    }));
    note(
      "reject_null_event_source",
      r.json?.code === 403 || /WECOM_BEFORE_DISPATCH/.test(JSON.stringify(r.json)),
      { code: r.json?.code, data: r.json?.data || r.json },
    );
  }
  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
      rawText: "确认建档物料1",
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: true,
    }));
    note("reject_group_confirm", r.json?.code === 403 || r.json?.code !== 200, { code: r.json?.code });
  }
  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
      rawText: "确认建档1",
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: false,
    }));
    note(
      "reject_bare_confirm_phrase",
      r.json?.code === 400 || /确认建档物料/.test(JSON.stringify(r.json)),
      { code: r.json?.code, data: r.json?.data || r.json },
    );
  }

  // Low-role / stock-read-ish bound user (销售代表 role 17: no funId 23 商品信息)
  {
    const lowBound = await bindUser(WECOM_LOW, LOW_LOGIN, LOW_PASS);
    note(
      "low_role_bind",
      lowBound.claimed?.code === 200 || lowBound.claimed?.data?.status === "ACTIVE",
      lowBound.claimed?.data?.status,
    );
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM_LOW, {
      opType: "CREATE",
      name: `低权限拒绝-${stamp}`,
      barCode: `RM-LOW-${stamp}`,
      unit: "L",
      categoryId: 901,
    }));
    note(
      "low_role_prepare_denied",
      r.json?.code === 403 || /无权|商品信息/.test(JSON.stringify(r.json)),
      { code: r.json?.code, data: r.json?.data || r.json },
    );
  }

  {
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM, {
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

  const prep = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM, {
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
    prep.json?.code === 200 && !!requestId && phrase === `确认建档物料${requestId}` && prep.json.data?.stockUnchanged === true,
    { requestId, phrase, summary: prep.json?.data?.summaryZh },
  );

  const beforeMat = mysql(`SELECT COUNT(*) FROM jsh_material_extend WHERE bar_code='${BAR}'`);
  note("prepare_no_write", beforeMat[0] === "0", { count: beforeMat[0] });

  // Cross-binding: low-role user tries to commit admin's pending request
  {
    const r = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM_LOW, {
      rawText: phrase,
      phrase,
      requestId,
      messageMsgId: `msg-cross-${BAR}`,
      isGroup: false,
      eventSource: "WECOM_BEFORE_DISPATCH",
    }));
    note(
      "cross_binding_commit_denied",
      r.json?.code === 403 || r.json?.code === 404 || r.json?.code !== 200,
      { code: r.json?.code, data: r.json?.data || r.json },
    );
  }

  const commit = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
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
      code: commit.json?.code,
      materialId,
      barCode: commit.json?.data?.barCode,
      stock: commit.json?.data?.currentStockTotal,
      initRows: commit.json?.data?.initialStockRows ?? commit.json?.data?.material?.initialStockRows,
      err: commit.json?.data || commit.json,
    },
  );
  if (!materialId) {
    throw new Error(`commit_create missing materialId: ${JSON.stringify(commit.json)}`);
  }

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
  // Every warehouse must read as zero stock for this material (missing row ≡ 0).
  const depotZero = mysql(
    `SELECT COUNT(*) FROM (`
      + `SELECT d.id, IFNULL(SUM(IFNULL(cs.current_number,0)),0) AS qty `
      + `FROM jsh_depot d `
      + `LEFT JOIN jsh_material_current_stock cs ON cs.depot_id=d.id AND cs.material_id=${materialId} `
      + `AND IFNULL(cs.delete_flag,'0')<>'1' `
      + `WHERE IFNULL(d.delete_flag,'0')<>'1' GROUP BY d.id`
      + `) t WHERE qty<>0`,
  );
  note(
    "zero_stock_every_warehouse",
    depotZero[0] === "0" && stockRows[0] === "0" && initRows[0] === "0",
    { nonzeroDepots: depotZero[0], stockRows: stockRows[0], initRows: initRows[0] },
  );  const replay = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
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
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM, {
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

  // Parallel create race: two admin bindings prepare same new barcode, commit concurrently.
  {
    await bindUser(WECOM_RACE_A, LOGIN, PASS);
    await bindUser(WECOM_RACE_B, LOGIN, PASS);
    const prepA = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM_RACE_A, {
      opType: "CREATE",
      name: `竞态A-${stamp}`,
      barCode: BAR_RACE,
      unit: "L",
      categoryId: 901,
    }));
    const prepB = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM_RACE_B, {
      opType: "CREATE",
      name: `竞态B-${stamp}`,
      barCode: BAR_RACE,
      unit: "L",
      categoryId: 901,
    }));
    const idA = prepA.json?.data?.requestId;
    const idB = prepB.json?.data?.requestId;
    const phA = prepA.json?.data?.challenge?.phrase;
    const phB = prepB.json?.data?.challenge?.phrase;
    note(
      "race_prepare_both",
      prepA.json?.code === 200 && prepB.json?.code === 200 && !!idA && !!idB,
      { idA, idB, codeA: prepA.json?.code, codeB: prepB.json?.code },
    );
    const [cA, cB] = await Promise.all([
      signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM_RACE_A, {
        rawText: phA,
        phrase: phA,
        requestId: idA,
        messageMsgId: `msg-race-a-${BAR_RACE}`,
        isGroup: false,
        eventSource: "WECOM_BEFORE_DISPATCH",
      })),
      signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM_RACE_B, {
        rawText: phB,
        phrase: phB,
        requestId: idB,
        messageMsgId: `msg-race-b-${BAR_RACE}`,
        isGroup: false,
        eventSource: "WECOM_BEFORE_DISPATCH",
      })),
    ]);
    const okA = cA.json?.code === 200 && !!cA.json?.data?.materialId;
    const okB = cB.json?.code === 200 && !!cB.json?.data?.materialId;
    const failA = cA.json?.code === 409 || /条码已存在|繁忙/.test(JSON.stringify(cA.json));
    const failB = cB.json?.code === 409 || /条码已存在|繁忙/.test(JSON.stringify(cB.json));
    const exactlyOne = (okA && failB) || (okB && failA);
    const raceCount = mysql(
      `SELECT COUNT(*) FROM jsh_material_extend WHERE bar_code='${BAR_RACE}' AND IFNULL(delete_flag,'0')<>'1'`,
    );
    note(
      "barcode_race_one_winner",
      exactlyOne && raceCount[0] === "1",
      {
        okA,
        okB,
        failA,
        failB,
        codeA: cA.json?.code,
        codeB: cB.json?.code,
        count: raceCount[0],
        dataA: cA.json?.data,
        dataB: cB.json?.data,
      },
    );
  }

  const updPrep = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM, {
    opType: "UPDATE",
    barCode: BAR,
    remark: "Demo 测试原料",
  }));
  const updId = updPrep.json?.data?.requestId;
  const updPhrase = updPrep.json?.data?.challenge?.phrase;
  note(
    "prepare_update_remark",
    updPrep.json?.code === 200 && updPhrase === `确认修改物料${updId}`,
    { updId, updPhrase, summary: updPrep.json?.data?.summaryZh },
  );

  const updCommit = await signedPost("/aierp/v1/wecom/master/material/commit", idBody(WECOM, {
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
    const r = await signedPost("/aierp/v1/wecom/master/material/prepare", idBody(WECOM, {
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

  const search = await signedPost("/aierp/v1/wecom/material/search", idBody(WECOM, { query: BAR }));
  const hit = (search.json?.data?.rows || []).find((x) => x.barCode === BAR);
  note("searchable_after_create", search.json?.code === 200 && !!hit, hit);

  const failed = results.filter((x) => !x.ok);
  const report = {
    ticket: "AIERP-021B",
    reviewFix: "REVIEW_FIX_PUSHED",
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
