/**
 * AIERP-015B Review Fix: confirm-ui binding_version re-check + receipt PDF authz.
 * Non-destructive: creates isolated DRAFT only (never posts); uses existing receipt if present.
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
const WECOM = `aierp015b-fix-${Date.now().toString(36)}`;

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
  results.push({ name, ok, detail: String(d).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${String(d).slice(0, 220)}`);
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
    headers: { "Content-Type": "application/json;charset=UTF-8", "X-Access-Token": token },
    body: JSON.stringify({ bindCode: code }),
  });
  return res.json();
}

async function sessionPost(token, path, bodyObj) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Access-Token": token,
    },
    body: JSON.stringify(bodyObj ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, raw: text.slice(0, 240), bytes: text.length };
  }
  return { status: res.status, json, bytes: text.length };
}

async function sessionPdf(token, receiptId) {
  const res = await fetch(`${BASE}/aierp/v1/wecom/receipt/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Access-Token": token,
    },
    body: JSON.stringify({ receiptId }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/pdf") || buf.slice(0, 4).toString() === "%PDF") {
    return { status: res.status, pdf: true, bytes: buf.length };
  }
  let json;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    return { status: res.status, pdf: false, raw: buf.toString("utf8").slice(0, 240) };
  }
  return { status: res.status, pdf: false, json };
}

function idBody(extra = {}) {
  return { wecomUserId: WECOM, botId: BOT, channel: "wecom", ...extra };
}

function denied(r) {
  const blob = JSON.stringify(r.json || r.raw || "");
  return (
    r.status === 403 ||
    r.status === 404 ||
    r.json?.code === 403 ||
    r.json?.code === 404 ||
    /绑定已更新|已解除|无权|禁用|停用|仓库权限|403|404/.test(blob)
  );
}

async function main() {
  const token = await login();
  note("erp_login", true, { login: LOGIN });

  // --- P0-1: confirm-ui rejects after unbind/rebind (draft never posted) ---
  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const code = issue.json?.data?.bindCode;
  const claimed = await claim(token, code);
  note("fixture_bind", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed?.data?.status);

  const prep = await signedPost("/aierp/v1/wecom/purchase/prepare", idBody({
    barCode: "RM-A001",
    qty: 1,
    unit: "L",
    depotName: "原料仓",
    organName: "华东化工",
    idempotencyKey: `authz-fix:${WECOM}:prep`,
    remark: "015b-authz-fix-no-post",
  }));
  const draftId = prep.json?.data?.draftId;
  note("fixture_prepare_draft", prep.json?.code === 200 && !!draftId, { draftId, code: prep.json?.code });

  if (!draftId) {
    writeEvidence();
    process.exit(1);
  }

  // Positive smoke: while ACTIVE same generation, confirm-ui is allowed to reach challenge/confirm path.
  // We do NOT complete posting: cancel after authz negatives instead.
  // First prove confirm-ui would be reachable with matching binding by checking status only,
  // then bump generation and assert confirm-ui rejects.

  const verBefore = mysql(
    `SELECT binding_version, id FROM aierp_wecom_binding WHERE wecom_user_id='${WECOM}' AND status='ACTIVE' LIMIT 1`,
  )[0];
  note("binding_version_before", !!verBefore, verBefore);

  const unb = await signedPost("/aierp/v1/wecom/binding/unbind", idBody());
  note("unbind", unb.json?.code === 200 || !!unb.json?.data?.unbound, unb.json?.data);

  {
    const r = await sessionPost(token, "/aierp/v1/wecom/draft/confirm-ui", { draftId });
    note("confirm_ui_rejects_unbound", denied(r), { code: r.json?.code, msg: r.json?.data || r.json?.message });
  }

  const issue2 = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const claimed2 = await claim(token, issue2.json?.data?.bindCode);
  note("rebind_new_generation", claimed2?.code === 200 || claimed2?.data?.status === "ACTIVE", claimed2?.data?.status);

  const verAfter = mysql(
    `SELECT binding_version, id FROM aierp_wecom_binding WHERE wecom_user_id='${WECOM}' AND status='ACTIVE' LIMIT 1`,
  )[0];
  note("binding_version_bumped", verBefore && verAfter && verBefore !== verAfter, { verBefore, verAfter });

  {
    const r = await sessionPost(token, "/aierp/v1/wecom/draft/confirm-ui", { draftId });
    note(
      "confirm_ui_rejects_stale_binding_version",
      denied(r) && /绑定已更新|已解除|不可再确认|无权/.test(JSON.stringify(r.json || {})),
      { code: r.json?.code, msg: r.json?.data || r.json?.message },
    );
  }

  // Leave draft unposted: cancel via HMAC after rebinding so WeCom path uses new generation —
  // old draft cancel should also fail; mark CANCELLED in DB for cleanup only.
  mysql(`UPDATE aierp_gateway_draft SET status='CANCELLED' WHERE id=${Number(draftId)} AND status IN ('DRAFT','AWAITING_CONFIRM')`);
  note("fixture_draft_cancelled_db", true, { draftId });

  // --- P0-2: PDF download re-checks user + depot ---
  const receiptRow = mysql(
    `SELECT receipt_id, actor_user_id, tenant_id, depot_head_id, bill_number, pdf_status
     FROM aierp_gateway_receipt
     WHERE pdf_status='PDF_GENERATED' AND pdf_storage_ref IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
  )[0];
  if (!receiptRow) {
    note("pdf_fixture_available", false, "no PDF_GENERATED receipt — skip PDF authz (prior 015B evidence expected)");
  } else {
    const [receiptId, actorUserId, tenantId, depotHeadId, billNumber, pdfStatus] = receiptRow.split(/\t/);
    note("pdf_fixture_available", true, { receiptId: receiptId?.slice(0, 8) + "…", billNumber, pdfStatus });

    // Actor must be jsh for session token tests
    const actorLogin = mysql(`SELECT login_name FROM jsh_user WHERE id=${Number(actorUserId)}`)[0];
    if (actorLogin !== LOGIN) {
      note("pdf_actor_is_test_login", false, { actorLogin, expected: LOGIN });
    } else {
      note("pdf_actor_is_test_login", true, { actorLogin });

      {
        const r = await sessionPdf(token, receiptId);
        note("pdf_active_actor_ok", r.pdf === true && r.status === 200 && r.bytes > 100, {
          status: r.status,
          bytes: r.bytes,
          pdf: r.pdf,
        });
      }

      // Cross-tenant / other actor: random receipt id
      {
        const r = await sessionPdf(token, "ffffffffffffffffffffffffffffffff");
        note("pdf_unknown_receipt_denied", !r.pdf && (r.status === 404 || r.json?.code === 404 || denied(r)), {
          status: r.status,
          code: r.json?.code,
        });
      }

      const userStatusBefore = mysql(`SELECT status FROM jsh_user WHERE id=${Number(actorUserId)}`)[0];
      mysql(`UPDATE jsh_user SET status=1 WHERE id=${Number(actorUserId)}`);
      try {
        const r = await sessionPdf(token, receiptId);
        note(
          "pdf_disabled_user_denied",
          !r.pdf && denied(r),
          { status: r.status, code: r.json?.code, msg: r.json?.data || r.json?.message },
        );
      } finally {
        mysql(`UPDATE jsh_user SET status=${userStatusBefore == null ? 0 : userStatusBefore} WHERE id=${Number(actorUserId)}`);
      }

      // Revoke all UserDepot for actor, then restore
      const depotBefore = mysql(
        `SELECT id, IFNULL(value,''), IFNULL(delete_flag,'0') FROM jsh_user_business WHERE type='UserDepot' AND key_id='${actorUserId}' LIMIT 1`,
      )[0];
      let depotUbId = null;
      let depotValue = "";
      let depotDelete = "0";
      if (depotBefore) {
        const parts = depotBefore.split(/\t/);
        depotUbId = parts[0];
        depotValue = parts[1] || "";
        depotDelete = parts[2] || "0";
        mysql(`UPDATE jsh_user_business SET value='[]' WHERE id=${Number(depotUbId)}`);
      } else {
        mysql(
          `INSERT INTO jsh_user_business (type, key_id, value, delete_flag) VALUES ('UserDepot','${actorUserId}','[]','0')`,
        );
        depotUbId = mysql(
          `SELECT id FROM jsh_user_business WHERE type='UserDepot' AND key_id='${actorUserId}' ORDER BY id DESC LIMIT 1`,
        )[0];
      }
      try {
        const r = await sessionPdf(token, receiptId);
        note(
          "pdf_depot_revoked_denied",
          !r.pdf && denied(r),
          { status: r.status, code: r.json?.code, msg: r.json?.data || r.json?.message, billNumber, depotHeadId },
        );
      } finally {
        if (depotBefore) {
          mysql(
            `UPDATE jsh_user_business SET value='${depotValue.replace(/'/g, "''")}', delete_flag='${depotDelete}' WHERE id=${Number(depotUbId)}`,
          );
        } else if (depotUbId) {
          mysql(`DELETE FROM jsh_user_business WHERE id=${Number(depotUbId)}`);
        }
      }

      {
        const r = await sessionPdf(token, receiptId);
        note("pdf_restored_ok", r.pdf === true && r.status === 200 && r.bytes > 100, {
          status: r.status,
          bytes: r.bytes,
        });
      }
    }
  }

  // cleanup fixture binding
  await signedPost("/aierp/v1/wecom/binding/unbind", idBody());
  note("fixture_unbind_cleanup", true, { wecom: WECOM.slice(0, 12) + "…" });

  writeEvidence();
  const failed = results.filter((x) => !x.ok);
  if (failed.length) {
    console.error(`FAILED ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`ALL_PASS ${results.length}`);
}

function writeEvidence() {
  const out = {
    suite: "aierp-015b-authz-fix",
    at: new Date().toISOString(),
    wecomFixture: WECOM.slice(0, 8) + "***",
    results,
    pass: results.filter((x) => x.ok).length,
    fail: results.filter((x) => !x.ok).length,
  };
  writeFileSync(join(evidenceDir, "aierp-015b-authz-fix.json"), JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  writeEvidence();
  process.exit(1);
});
