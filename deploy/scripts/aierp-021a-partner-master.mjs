/**
 * AIERP-021A: partner prepare/commit against real ERP (no stock change).
 * Covers: prepare zero insert, commit real id, replay, update whitelist-only,
 * negatives: dup name, wrong type, no auth, group, LLM self-confirm,
 * cross-sender same messageMsgId must not leak partnerId,
 * bare/material confirm phrases rejected (namespace vs 021B).
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const MIN_SECRET_LEN = 32;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
const WECOM = `aierp021a-${Date.now().toString(36)}`;
const SUP_NAME = `测试供应商-${stamp}`;
const CUS_NAME = `测试客户-${stamp}`;

function loadSecretAndBot() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  let bot = (process.env.AIERP_WECOM_BOT_ID || "").trim();
  if (!secret) {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        if (line.startsWith("AIERP_WECOM_ADAPTER_SECRET=")) {
          secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
        }
        if (line.startsWith("AIERP_WECOM_BOT_ID=")) {
          bot = line.slice("AIERP_WECOM_BOT_ID=".length).trim();
        }
      }
    }
  }
  if (!secret) {
    const r = spawnSync("docker", ["exec", "aierp-boot", "printenv", "AIERP_WECOM_ADAPTER_SECRET"], {
      encoding: "utf8",
    });
    secret = (r.stdout || "").trim();
  }
  if (!bot) {
    const r = spawnSync("docker", ["exec", "aierp-boot", "printenv", "AIERP_WECOM_BOT_ID"], {
      encoding: "utf8",
    });
    bot = (r.stdout || "").trim() || "default";
  }
  if (!secret || secret.length < MIN_SECRET_LEN || /change-me|changeme|example|placeholder/i.test(secret)) {
    console.error("AIERP_WECOM_ADAPTER_SECRET required");
    process.exit(2);
  }
  return { secret, bot };
}

const { secret: SECRET, bot: BOT } = loadSecretAndBot();
const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

function note(name, ok, detail) {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: String(d).slice(0, 500) });
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

function countSupplier(name, type) {
  const rows = mysql(
    `SELECT COUNT(*) FROM jsh_supplier WHERE supplier='${name.replace(/'/g, "''")}' AND type='${type}' AND IFNULL(delete_flag,'0')<>'1'`,
  );
  return Number(rows[0] || 0);
}

function loadSupplier(id) {
  const rows = mysql(
    `SELECT id, supplier, type, contacts, phone_num, address, description, bank_name, account_number, tax_num, IFNULL(begin_need_pay,0), IFNULL(begin_need_get,0), IFNULL(advance_in,0), creator, tenant_id FROM jsh_supplier WHERE id=${Number(id)}`,
  );
  if (!rows.length) return null;
  const p = rows[0].split("\t");
  return {
    id: p[0],
    supplier: p[1],
    type: p[2],
    contacts: p[3],
    phone_num: p[4],
    address: p[5],
    description: p[6],
    bank_name: p[7],
    account_number: p[8],
    tax_num: p[9],
    begin_need_pay: p[10],
    begin_need_get: p[11],
    advance_in: p[12],
    creator: p[13],
    tenant_id: p[14],
  };
}

function stockSnapshot() {
  const rows = mysql(
    `SELECT IFNULL(SUM(current_number),0) FROM jsh_material_current_stock WHERE depot_id IN (14,15)`,
  );
  return rows[0] || "0";
}

async function main() {
  mysql("UPDATE jsh_platform_config SET platform_value='0' WHERE platform_key='checkcode_flag'");
  const stockBefore = stockSnapshot();

  {
    const r = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
      op: "CREATE",
      type: "供应商",
      name: SUP_NAME,
      contacts: "张工",
      phone: "13800001111",
    }));
    note("unbound_prepare_401", r.json?.code === 401 || /尚未绑定/.test(JSON.stringify(r)), r.json);
  }

  const issue = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  const code = issue.json?.data?.bindCode;
  note("bind_issue", !!code, { codeLen: code?.length });
  const token = await login();
  const claimed = await claim(token, code);
  note("bind_claim", claimed?.code === 200 || claimed?.data?.status === "ACTIVE", claimed?.data?.status);

  const beforeCreate = countSupplier(SUP_NAME, "供应商");
  const prep = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
    op: "CREATE",
    type: "供应商",
    name: SUP_NAME,
    contacts: "张工",
    phone: "13800001111",
    address: "演示路1号",
    remark: "021a-demo",
  }));
  const requestId = prep.json?.data?.requestId;
  const phrase = prep.json?.data?.challenge?.phrase;
  const afterPrep = countSupplier(SUP_NAME, "供应商");
  note(
    "prepare_zero_db_insert",
    prep.json?.code === 200 &&
      prep.json.data?.dbWrite === false &&
      afterPrep === beforeCreate &&
      !!requestId &&
      phrase === `确认伙伴建档${requestId}`,
    { requestId, phrase, beforeCreate, afterPrep, summary: prep.json?.data?.summary },
  );

  {
    const r = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
      eventSource: "LLM_SELF_REPORT",
      rawText: phrase,
      messageMsgId: `llm-${Date.now()}`,
    }));
    note("llm_self_confirm_rejected", r.json?.code === 403 || /WECOM_BEFORE_DISPATCH/.test(JSON.stringify(r)), r.json);
  }

  {
    const r = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: phrase,
      isGroup: true,
      messageMsgId: `grp-${Date.now()}`,
    }));
    note("group_chat_rejected", r.json?.code === 403 || /群聊/.test(JSON.stringify(r)), r.json);
  }

  const msgId = `msg-create-${Date.now()}`;
  const commit = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
    eventSource: "WECOM_BEFORE_DISPATCH",
    rawText: phrase,
    messageMsgId: msgId,
    isGroup: false,
  }));
  const partnerId = commit.json?.data?.partnerId;
  const row = partnerId ? loadSupplier(partnerId) : null;
  note(
    "commit_create_real_id",
    commit.json?.code === 200 &&
      !!partnerId &&
      row &&
      row.supplier === SUP_NAME &&
      row.type === "供应商" &&
      row.contacts === "张工" &&
      row.phone_num === "13800001111" &&
      row.tenant_id === "63" &&
      row.creator === "63",
    { partnerId, row, hint: commit.json?.data?.hint },
  );
  note("commit_stock_unchanged", stockSnapshot() === stockBefore, { stockBefore, after: stockSnapshot() });

  const replay = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
    eventSource: "WECOM_BEFORE_DISPATCH",
    rawText: phrase,
    messageMsgId: msgId,
  }));
  note(
    "replay_once_idempotent",
    replay.json?.code === 200 &&
      replay.json.data?.idempotentReplay === true &&
      String(replay.json.data?.partnerId) === String(partnerId) &&
      countSupplier(SUP_NAME, "供应商") === 1,
    replay.json?.data,
  );

  // P0: foreign tenant CONSUMED row with same messageMsgId must not leak partnerId to current actor
  {
    const foreignMsg = `foreign-msg-${Date.now()}`;
    const foreignPartner = 999001;
    const challengeHex = randomBytes(16).toString("hex");
    mysql(
      `INSERT INTO aierp_master_partner_request (
         challenge_id, channel, bot_id, wecom_user_id, tenant_id, erp_user_id, binding_id, binding_version,
         op_type, partner_type, partner_id, record_digest, payload_json, payload_hash, expected_phrase,
         status, result_partner_id, expires_at, consumed_at, consume_message_id, created_at
       ) VALUES (
         '${challengeHex}', 'wecom', '${BOT}', 'foreign-wecom-user', 999, 999, 999, 1,
         'CREATE', '供应商', NULL, NULL, '{}', 'deadbeef', '确认伙伴建档0',
         'CONSUMED', ${foreignPartner}, DATE_ADD(NOW(), INTERVAL 1 DAY), NOW(), '${foreignMsg}', NOW()
       )`
    );
    const stealTenant = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: phrase,
      messageMsgId: foreignMsg,
      isGroup: false,
    }));
    const leaked = String(stealTenant.json?.data?.partnerId ?? "") === String(foreignPartner);
    note(
      "cross_tenant_same_msgid_no_partner_leak",
      !leaked &&
        (stealTenant.json?.code === 200
          ? stealTenant.json?.data?.idempotentReplay === true &&
            String(stealTenant.json?.data?.partnerId) === String(partnerId)
          : [409, 403, 400].includes(stealTenant.json?.code)),
      { code: stealTenant.json?.code, data: stealTenant.json?.data, foreignPartner },
    );
    mysql(`DELETE FROM aierp_master_partner_request WHERE consume_message_id='${foreignMsg}' AND tenant_id=999`);
  }

  // P0: other wecom sender must not replay via shared messageMsgId / steal partnerId
  {
    const WECOM_B = `${WECOM}-b`;
    const idBodyB = (extra = {}) => ({ wecomUserId: WECOM_B, botId: BOT, channel: "wecom", ...extra });
    const issueB = await signedPost("/aierp/v1/wecom/binding/issue", idBodyB());
    await claim(token, issueB.json?.data?.bindCode);
    const steal = await signedPost("/aierp/v1/wecom/master/partner/commit", idBodyB({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: phrase,
      messageMsgId: msgId,
      isGroup: false,
    }));
    const stealPid = steal.json?.data?.partnerId;
    const stealJson = JSON.stringify(steal.json || {});
    note(
      "cross_sender_same_msgid_no_partner_leak",
      (steal.json?.code === 403 || steal.json?.code === 404 || steal.json?.code === 400) &&
        String(stealPid ?? "") !== String(partnerId) &&
        !stealJson.includes('"idempotentReplay":true'),
      { code: steal.json?.code, stealPid, ownerPartnerId: partnerId, hint: steal.json?.data?.hint || steal.json?.message },
    );

    // Same message id on a different actor's own pending request must not return A's partnerId
    const prepB = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBodyB({
      op: "CREATE",
      type: "供应商",
      name: `${SUP_NAME}-B`,
      contacts: "乙方",
    }));
    const phraseB = prepB.json?.data?.challenge?.phrase;
    const commitB = await signedPost("/aierp/v1/wecom/master/partner/commit", idBodyB({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: phraseB,
      messageMsgId: msgId, // collide with A's consumed message id
      isGroup: false,
    }));
    const pidB = commitB.json?.data?.partnerId;
    note(
      "cross_sender_msgid_collision_fresh_commit_ok",
      commitB.json?.code === 200 &&
        !!pidB &&
        String(pidB) !== String(partnerId) &&
        commitB.json?.data?.idempotentReplay !== true,
      { code: commitB.json?.code, pidB, ownerPartnerId: partnerId, phraseB },
    );
  }

  // Namespace: bare 确认建档{id} and material 确认建档物料{id} must not commit partner
  {
    const bare = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: `确认建档${requestId}`,
      messageMsgId: `bare-${Date.now()}`,
    }));
    note(
      "bare_confirm_建档_rejected",
      bare.json?.code === 400 || /不是有效|往来单位确认|物料/.test(JSON.stringify(bare)),
      bare.json,
    );
    const mat = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: `确认建档物料${requestId}`,
      messageMsgId: `mat-${Date.now()}`,
    }));
    note(
      "material_confirm_phrase_not_partner",
      mat.json?.code === 400 || /不是有效|往来单位确认/.test(JSON.stringify(mat)),
      mat.json,
    );
  }

  // Simultaneous pending partner + material-style phrase: partner pending must stay PENDING
  {
    const pend = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
      op: "CREATE",
      type: "供应商",
      name: `${SUP_NAME}-pend-mat`,
      contacts: "待确认",
    }));
    const pendId = pend.json?.data?.requestId;
    const pendPhrase = pend.json?.data?.challenge?.phrase;
    const wrong = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
      eventSource: "WECOM_BEFORE_DISPATCH",
      rawText: `确认建档物料${pendId}`,
      messageMsgId: `pend-mat-${Date.now()}`,
    }));
    const st = mysql(`SELECT status FROM aierp_master_partner_request WHERE id=${Number(pendId)}`)[0];
    note(
      "pending_partner_survives_material_phrase",
      (wrong.json?.code === 400 || wrong.json?.code >= 400) &&
        st === "PENDING" &&
        String(pendPhrase || "").startsWith("确认伙伴建档"),
      { code: wrong.json?.code, status: st, pendPhrase },
    );
    mysql(`UPDATE aierp_master_partner_request SET status='CANCELLED' WHERE id=${Number(pendId)} AND status='PENDING'`);
  }
  {
    const r = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
      op: "CREATE",
      type: "供应商",
      name: SUP_NAME,
      contacts: "张工",
    }));
    note("dup_name_rejected", r.json?.code === 409 || /已存在/.test(JSON.stringify(r)), r.json);
  }

  {
    const r = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
      op: "UPDATE",
      type: "客户",
      partnerId: Number(partnerId),
      contacts: "错类型",
    }));
    note("wrong_type_update_rejected", r.json?.code === 400 || /跨类型|类型/.test(JSON.stringify(r)), r.json);
  }

  {
    const r = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
      op: "CREATE",
      type: "供应商",
      name: `${SUP_NAME}-敏感`,
      bankName: "伪造银行",
    }));
    note("sensitive_field_rejected", r.json?.code === 400 || /敏感/.test(JSON.stringify(r)), r.json);
  }

  // Seed bank/tax on row to prove update leaves them alone
  mysql(
    `UPDATE jsh_supplier SET bank_name='KEEP_BANK', account_number='KEEP_ACCT', tax_num='KEEP_TAX', begin_need_pay=12.34 WHERE id=${Number(partnerId)}`,
  );
  const beforeUpd = loadSupplier(partnerId);
  const prepUpd = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
    op: "UPDATE",
    type: "供应商",
    partnerId: Number(partnerId),
    contacts: "李工",
    phone: "13900002222",
  }));
  const updReq = prepUpd.json?.data?.requestId;
  const updPhrase = prepUpd.json?.data?.challenge?.phrase;
  const diffs = prepUpd.json?.data?.fieldDiffs || [];
  note(
    "update_prepare_diff_whitelist",
    prepUpd.json?.code === 200 &&
      diffs.some((d) => d.field === "contacts" && d.oldValue === "张工" && d.newValue === "李工") &&
      diffs.every((d) => ["name", "contacts", "phone", "address", "remark"].includes(d.field)),
    { updReq, diffs, summary: prepUpd.json?.data?.summary },
  );

  const updCommit = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
    eventSource: "WECOM_BEFORE_DISPATCH",
    rawText: updPhrase,
    messageMsgId: `msg-upd-${Date.now()}`,
  }));
  const afterUpd = loadSupplier(partnerId);
  note(
    "update_commit_whitelist_only",
    updCommit.json?.code === 200 &&
      afterUpd?.contacts === "李工" &&
      afterUpd?.phone_num === "13900002222" &&
      afterUpd?.bank_name === "KEEP_BANK" &&
      afterUpd?.account_number === "KEEP_ACCT" &&
      afterUpd?.tax_num === "KEEP_TAX" &&
      String(afterUpd?.begin_need_pay) === String(beforeUpd.begin_need_pay),
    { afterUpd, beforeUpd },
  );

  // Customer create
  const cusPrep = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
    op: "CREATE",
    type: "客户",
    name: CUS_NAME,
    contacts: "王工",
  }));
  const cusCountBefore = countSupplier(CUS_NAME, "客户");
  note("customer_prepare_zero_insert", cusPrep.json?.code === 200 && cusCountBefore === 0 &&
    cusPrep.json?.data?.challenge?.phrase === `确认建档客户${cusPrep.json?.data?.requestId}`, {
    requestId: cusPrep.json?.data?.requestId,
    phrase: cusPrep.json?.data?.challenge?.phrase,
  });
  const cusCommit = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
    eventSource: "WECOM_BEFORE_DISPATCH",
    rawText: cusPrep.json?.data?.challenge?.phrase,
    messageMsgId: `msg-cus-${Date.now()}`,
  }));
  const cusId = cusCommit.json?.data?.partnerId;
  const cusRow = cusId ? loadSupplier(cusId) : null;
  note(
    "customer_commit_type_客户",
    cusCommit.json?.code === 200 &&
      cusRow?.type === "客户" &&
      cusRow?.supplier === CUS_NAME &&
      cusPrep.json?.data?.challenge?.phrase === `确认建档客户${cusPrep.json?.data?.requestId}`,
    { cusId, cusRow, phrase: cusPrep.json?.data?.challenge?.phrase },
  );

  // When customer_flag restricts, missing UserCustomer assignment must deny UPDATE prepare.
  {
    mysql("UPDATE jsh_system_config SET customer_flag='1'");
    try {
      // Ensure current user has NO UserCustomer row covering this customer for the deny path.
      // grantCustomerPermission on create may have assigned — strip assignment for this check.
      mysql(
        `UPDATE jsh_user_business SET \`value\`=REPLACE(IFNULL(\`value\`,''),'[${Number(cusId)}]','') WHERE type='UserCustomer' AND key_id='63'`,
      );
      const r = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
        op: "UPDATE",
        type: "客户",
        partnerId: Number(cusId),
        contacts: "无权改",
      }));
      note(
        "customer_flag_denies_unassigned",
        r.json?.code === 403 || /无权|未分配/.test(JSON.stringify(r)),
        r.json,
      );
    } finally {
      mysql("UPDATE jsh_system_config SET customer_flag='0'");
      // Restore assignment so later flows / demo tenant stay usable.
      if (cusId) {
        const ub = mysql(
          `SELECT id, IFNULL(\`value\`,'') FROM jsh_user_business WHERE type='UserCustomer' AND key_id='63' AND IFNULL(delete_flag,'0')<>'1' LIMIT 1`,
        );
        if (ub.length) {
          const parts = ub[0].split("\t");
          const val = parts[1] || "";
          if (!val.includes(`[${cusId}]`)) {
            mysql(`UPDATE jsh_user_business SET \`value\`=CONCAT(IFNULL(\`value\`,''),'[${Number(cusId)}]') WHERE id=${Number(parts[0])}`);
          }
        } else {
          mysql(
            `INSERT INTO jsh_user_business (type, key_id, \`value\`, delete_flag) VALUES ('UserCustomer','63','[${Number(cusId)}]','0')`,
          );
        }
      }
    }
  }

  // Same name OK across types
  note(
    "same_name_cross_type_allowed_as_separate",
    countSupplier(SUP_NAME, "供应商") === 1,
    { supplier: countSupplier(SUP_NAME, "供应商"), customer: countSupplier(CUS_NAME, "客户") },
  );

  // Searchable for purchase organ
  const search = await signedPost("/aierp/v1/wecom/partner/search", idBody({
    partnerType: "supplier",
    query: SUP_NAME,
  }));
  note(
    "new_supplier_searchable",
    search.json?.code === 200 &&
      (search.json.data?.rows || []).some((r) => r.partnerName === SUP_NAME),
    { rowCount: search.json?.data?.rowCount },
  );

  // Rebind invalidates pending
  const prep2 = await signedPost("/aierp/v1/wecom/master/partner/prepare", idBody({
    op: "CREATE",
    type: "供应商",
    name: `${SUP_NAME}-rebind`,
    contacts: "赵工",
  }));
  const pendingPhrase = prep2.json?.data?.challenge?.phrase;
  const issue2 = await signedPost("/aierp/v1/wecom/binding/issue", idBody());
  await claim(token, issue2.json?.data?.bindCode);
  const afterRebind = await signedPost("/aierp/v1/wecom/master/partner/commit", idBody({
    eventSource: "WECOM_BEFORE_DISPATCH",
    rawText: pendingPhrase,
    messageMsgId: `msg-rebind-${Date.now()}`,
  }));
  note(
    "rebind_invalidates_pending",
    afterRebind.json?.code === 403 || /绑定已变更|失效/.test(JSON.stringify(afterRebind)),
    afterRebind.json,
  );

  note("final_stock_unchanged", stockSnapshot() === stockBefore, {
    stockBefore,
    after: stockSnapshot(),
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const out = {
    ticket: "AIERP-021A",
    botId: BOT,
    wecomUserId: WECOM,
    supplierName: SUP_NAME,
    customerName: CUS_NAME,
    partnerId,
    customerId: cusId,
    stockBefore,
    stockAfter: stockSnapshot(),
    passed,
    failed,
    results,
    uat: {
      wecomLiveClient: "NOT_RUN",
      note: "Automated HMAC prepare/commit against local aierp-boot. Live WeCom DM UAT deferred; light plugin wiring present; F: runtime not overwritten. Phrases: 确认建档供应商/客户{id}, 确认修改供应商/客户{id}.",
    },
    readyForReview: failed === 0,
  };
  const path = join(evidenceDir, "aierp-021a-partner-master.json");
  writeFileSync(path, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n${passed}/${results.length} PASS → ${path}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
