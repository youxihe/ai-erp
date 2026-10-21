/**
 * AIERP-015B safety + confirm flow (no auto-post of existing user drafts like #106).
 * Creates a dedicated test draft, exercises challenge confirm via HMAC adapter,
 * verifies idempotency / cross-user rejection, then leaves WeCom UAT to human.
 */
import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const envPath = resolve(root, "deploy/.env");

function loadEnv() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();
const secret = env.AIERP_WECOM_ADAPTER_SECRET;
const base = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
let botId = env.AIERP_WECOM_BOT_ID || "default";

if (!secret || secret.length < 32) {
  console.error("AIERP_WECOM_ADAPTER_SECRET missing");
  process.exit(1);
}

async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const urlPath = path.startsWith("/jshERP-boot") ? path : `/jshERP-boot${path}`;
  const payload = `POST\n${urlPath}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const res = await fetch(`${base}${path}`, {
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
    throw new Error(`non-JSON ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];
function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}`, detail || "");
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name}`, detail || "");
}

async function main() {
  // Discover an active binding for tests (do not invent wecom ids).
  // Prefer real WeCom bot binding (sid), not debug/default test rows.
  const mysqlCmd = `docker exec aierp-mysql mysql -N -uroot -paierp_root_change_me jsh_erp -e "SELECT wecom_user_id, erp_user_id, binding_version, id, bot_id FROM aierp_wecom_binding WHERE status='ACTIVE' AND wecom_user_id='sid' ORDER BY id DESC LIMIT 1"`;
  const { execSync } = await import("node:child_process");
  let row;
  try {
    row = execSync(mysqlCmd, { encoding: "utf8" }).trim().split(/\t/);
  } catch (e) {
    fail("find_binding", String(e));
    process.exit(1);
  }
  if (row.length < 5 || !row[0]) {
    fail("find_binding", "no ACTIVE sid binding");
    process.exit(1);
  }
  const wecomUserId = row[0];
  const erpUserId = row[1];
  const bindingVersion = row[2];
  const boundBotId = row[4];
  botId = boundBotId;
  pass("find_binding", { wecomUserIdMasked: wecomUserId.slice(0, 2) + "***", erpUserId, bindingVersion, botId });

  // 1) Fake confirm without WECOM_BEFORE_DISPATCH → reject
  {
    const r = await signedPost("/aierp/v1/wecom/draft/confirm", {
      wecomUserId,
      botId,
      channel: "wecom",
      rawText: "确认采购999999",
      eventSource: "LLM_SELF_REPORT",
      isGroup: false,
    });
    assert(r.json.code !== 200, "LLM self-report must fail");
    pass("reject_llm_self_report", r.json);
  }

  // 2) Group chat confirm → reject
  {
    const r = await signedPost("/aierp/v1/wecom/draft/confirm", {
      wecomUserId,
      botId,
      channel: "wecom",
      rawText: "确认",
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: true,
    });
    assert(r.json.code !== 200, "group confirm must fail");
    pass("reject_group_confirm", r.json);
  }

  // 3) Other wecom user → reject
  {
    const r = await signedPost("/aierp/v1/wecom/draft/confirm", {
      wecomUserId: "not-a-real-wecom-user-xyz",
      botId,
      channel: "wecom",
      rawText: "确认采购1",
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: false,
    });
    assert(r.json.code !== 200, "unknown wecom must fail");
    pass("reject_unknown_wecom", r.json);
  }

  // 4) Create dedicated test draft (does not touch #106)
  const idem = `wecom:015b-test:${Date.now()}:${randomBytes(4).toString("hex")}`;
  const prep = await signedPost("/aierp/v1/wecom/purchase/prepare", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "RM-A001",
    qty: 1,
    unit: "L",
    depotName: "原料仓",
    organName: "华东化工",
    idempotencyKey: idem,
    remark: "AIERP-015B automated test draft — do not confuse with user drafts",
  });
  assert(prep.json.code === 200, "prepare failed: " + JSON.stringify(prep.json));
  const draftId = prep.json.data?.draftId;
  assert(draftId, "no draftId");
  assert(prep.json.data?.posted !== true, "prepare must not post");
  assert(prep.json.data?.challenge?.phrase === `确认采购${draftId}`, "challenge phrase");
  pass("prepare_test_draft", { draftId, status: prep.json.data?.status, phrase: prep.json.data?.challenge?.phrase });

  // Snapshot stock before (via delegated query)
  const stockBefore = await signedPost("/aierp/v1/wecom/stock/query", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "RM-A001",
    depotName: "原料仓",
  });
  pass("stock_before", stockBefore.json.data);

  // 5) Confirm with trusted event
  const msgId = `test-msg-${Date.now()}`;
  const conf = await signedPost("/aierp/v1/wecom/draft/confirm", {
    wecomUserId,
    botId,
    channel: "wecom",
    rawText: `确认采购${draftId}`,
    messageMsgId: msgId,
    eventSource: "WECOM_BEFORE_DISPATCH",
    isGroup: false,
    draftId,
  });
  assert(conf.json.code === 200, "confirm failed: " + JSON.stringify(conf.json));
  const bill = conf.json.data?.billNumber;
  assert(bill && String(bill).startsWith("GW-PURCHASE-"), "missing bill");
  assert(conf.json.data?.posted === true, "posted");
  assert(conf.json.data?.receiptText, "receipt text");
  pass("confirm_once", {
    billNumber: bill,
    depotHeadId: conf.json.data?.depotHeadId,
    stockBefore: conf.json.data?.stockBefore,
    stockAfter: conf.json.data?.stockAfter,
    receiptId: conf.json.data?.receiptId,
    pdfStatus: conf.json.data?.pdfStatus,
  });

  // 6) Replay same message id / confirm again → same bill, no second post
  const conf2 = await signedPost("/aierp/v1/wecom/draft/confirm", {
    wecomUserId,
    botId,
    channel: "wecom",
    rawText: `确认采购${draftId}`,
    messageMsgId: msgId + "-replay",
    eventSource: "WECOM_BEFORE_DISPATCH",
    isGroup: false,
    draftId,
  });
  assert(conf2.json.code === 200, "replay confirm failed");
  assert(conf2.json.data?.billNumber === bill, "replay bill mismatch");
  assert(conf2.json.data?.replayed === true || conf2.json.data?.stockUnchanged === true, "replay flags");
  pass("confirm_replay_idempotent", { billNumber: conf2.json.data?.billNumber, replayed: conf2.json.data?.replayed });

  // Native head check
  const native = execSync(
    `docker exec aierp-mysql mysql -N -uroot -paierp_root_change_me jsh_erp -e "SELECT number,status,creator,tenant_id FROM jsh_depot_head WHERE number='${bill}' AND IFNULL(delete_flag,'0')<>'1'"`,
    { encoding: "utf8" },
  ).trim();
  assert(native.includes("\t1\t"), "native status not audited: " + native);
  pass("native_audited_bill", native);

  const evidence = {
    at: new Date().toISOString(),
    results,
    testDraftId: draftId,
    billNumber: bill,
    note: "Did not confirm pre-existing user drafts (#106 etc). WeCom PDF client open still needs human UAT.",
  };
  const outJson = resolve(root, "docs/poc/evidence/aierp-015b-confirm-flow.json");
  writeFileSync(outJson, JSON.stringify(evidence, null, 2), "utf8");
  console.log("evidence ->", outJson);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
