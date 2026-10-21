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

  // --- Review Fix: WeCom ownership + posted replay ---
  // Primary WECOM is still ACTIVE here (unbind happens later).
  const WECOM_B = `${WECOM}-b`;
  const idBodyB = (extra = {}) => ({ wecomUserId: WECOM_B, botId: BOT, channel: "wecom", ...extra });

  const issueB = await signedPost("/aierp/v1/wecom/binding/issue", idBodyB());
  const codeB = issueB.json?.data?.bindCode;
  const claimedB = await claim(token, codeB);
  note("second_wecom_same_erp_bind", claimedB?.code === 200 || claimedB?.data?.status === "ACTIVE", claimedB?.data?.status);

  const keyA2 = `w:${WECOM.slice(-8)}:own-a:${Date.now().toString(36)}`;
  const prepA = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
    barCode: "RM-A001", qty: 3, unit: "L", depotName: "原料仓", organName: "华东化工",
    idempotencyKey: keyA2, remark: "owner-isolation",
  }));
  const draftA = prepA.json?.data?.draftId;
  note("owner_a_prepare", prepA.json?.code === 200 && !!draftA, {
    draftId: draftA,
    code: prepA.json?.code,
    msg: prepA.json?.data?.message || prepA.json?.message || prepA.raw || null,
  });

  {
    const r = await signedPost("/aierp/v1/wecom/draft/status", idBodyB({ draftId: draftA }));
    note(
      "owner_b_cannot_status_a",
      r.json?.code === 403 || r.json?.code === 404 || /无权|不属于|不可/.test(JSON.stringify(r.json)),
      { code: r.json?.code },
    );
  }
  {
    const r = await signedPost("/aierp/v1/wecom/draft/cancel", idBodyB({ draftId: draftA }));
    note(
      "owner_b_cannot_cancel_a",
      r.json?.code === 403 || r.json?.code === 404 || /无权|不属于|不可/.test(JSON.stringify(r.json)),
      { code: r.json?.code },
    );
  }

  // Rebind primary WeCom → new bound_at generation; old draft must be inaccessible.
  const unb = await signedPost("/aierp/v1/wecom/binding/unbind", idBody());
  note("unbind_before_rebind", unb.json?.code === 200 || !!unb.json?.data?.unbound, unb.json?.data);
  const issueA3 = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const claimedA3 = await claim(token, issueA3.json?.data?.bindCode);
  note("rebind_new_generation", claimedA3?.code === 200 || claimedA3?.data?.status === "ACTIVE", claimedA3?.data?.status);
  {
    const r = await signedPost("/aierp/v1/wecom/draft/status", idBody({ draftId: draftA }));
    note(
      "rebind_denies_old_draft",
      r.json?.code === 403 || /绑定已更新|不可再访问|不属于/.test(JSON.stringify(r.json)),
      { code: r.json?.code, msg: r.json?.data || r.json?.message },
    );
  }

  // Posted flag: mark a fresh draft CONFIRMED in DB, idempotent prepare replay must report posted=true.
  const keyPosted = `w:${WECOM.slice(-8)}:post:${Date.now().toString(36)}`;
  const prepPosted = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
    barCode: "RM-A001", qty: 2, unit: "L", depotName: "原料仓", organName: "华东化工",
    idempotencyKey: keyPosted, remark: "posted-flag-test",
  }));
  const draftPosted = prepPosted.json?.data?.draftId;
  note("posted_flag_seed_draft", prepPosted.json?.code === 200 && !!draftPosted, {
    draftId: draftPosted,
    code: prepPosted.json?.code,
    msg: prepPosted.json?.data?.message || null,
    keyLen: keyPosted.length,
  });
  if (draftPosted) {
    mysql(`UPDATE aierp_gateway_draft SET status='CONFIRMED', bill_number='TEST-POSTED-FLAG' WHERE id=${draftPosted}`);
    const replayPosted = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
      barCode: "RM-A001", qty: 2, unit: "L", depotName: "原料仓", organName: "华东化工",
      idempotencyKey: keyPosted, remark: "posted-flag-test",
    }));
    note(
      "idempotent_confirmed_posted_true",
      replayPosted.json?.code === 200 &&
        replayPosted.json.data?.draftId === draftPosted &&
        replayPosted.json.data?.replayed === true &&
        replayPosted.json.data?.posted === true &&
        replayPosted.json.data?.stockUnchanged === false,
      {
        posted: replayPosted.json?.data?.posted,
        stockUnchanged: replayPosted.json?.data?.stockUnchanged,
        status: replayPosted.json?.data?.status,
      },
    );
    const st = await signedPost("/aierp/v1/wecom/draft/status", idBody({ draftId: draftPosted }));
    note(
      "status_confirmed_posted_true",
      st.json?.code === 200 && st.json.data?.posted === true && st.json.data?.stockUnchanged === false,
      { posted: st.json?.data?.posted, status: st.json?.data?.status },
    );
  }

  const stockFinal = stockOf("RM-A001", 14);
  note("stock_still_unchanged_end", stockBefore === stockFinal, { stockBefore, stockFinal });

  await signedPost("/aierp/v1/wecom/binding/unbind", idBody());
  await signedPost("/aierp/v1/wecom/binding/unbind", idBodyB());

  const passed = results.filter((x) => x.ok).length;
  const out = {
    task: "AIERP-015A",
    at: new Date().toISOString(),
    base: BASE,
    passed,
    total: results.length,
    dualUserUat: "SIMULATED_TWO_WECOM_SAME_ERP",
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
