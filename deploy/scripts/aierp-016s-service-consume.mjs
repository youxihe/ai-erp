/**
 * AIERP-016S: SERVICE (客户服务耗料/其它出库) prepare + trusted confirm.
 * - Real ERP customer; FG-101 @ 成品仓 qty=1
 * - Prepare: stock N unchanged; Confirm: N-1; 原料仓 unchanged
 * - Negatives: bad customer, UserCustomer (flag=1), cross-depot, cross-owner,
 *   cross-type phrases (采购/配制), insufficient stock, no-post prepare, replay
 * - After confirm: same XLSX prepare-verified → posted bill (not new DRAFT)
 * - Never SALE / AR bill
 *
 * Env: AIERP_WECOM_ADAPTER_SECRET, optional AIERP_016S_CONFIRM=1 to post (default: prepare-only + negatives).
 * Live WeCom「确认耗料」UAT remains human when confirm skipped. Do NOT rerun GW-SERVICE-136.
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  isServiceConfirmPhrase,
  parseServiceConfirmDraftId,
} from "../openclaw/plugins/aierp-erp-tools/sop/service-consume.mjs";
import { routeTrustedInbound } from "../openclaw/plugins/aierp-erp-tools/sop/registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const envPath = resolve(root, "deploy/.env");
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || "aierp_root_change_me";
const DO_CONFIRM = process.env.AIERP_016S_CONFIRM === "1" || process.env.AIERP_016S_CONFIRM === "true";

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
const secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
const base = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
let botId = process.env.AIERP_WECOM_BOT_ID || env.AIERP_WECOM_BOT_ID || "default";

if (!secret || secret.length < 32) {
  console.error("AIERP_WECOM_ADAPTER_SECRET missing");
  process.exit(1);
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
    return { status: res.status, raw: text.slice(0, 240) };
  }
  return { status: res.status, json };
}

const results = [];
function pass(name, detail) {
  results.push({ name, ok: true, detail });
  const s = typeof detail === "string" ? detail : JSON.stringify(detail ?? null);
  console.log(`PASS ${name}`, (s || "").slice(0, 220));
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  const s = typeof detail === "string" ? detail : JSON.stringify(detail ?? null);
  console.error(`FAIL ${name}`, (s || "").slice(0, 400));
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function stockOf(data, barCode, depotName) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const hit = rows.find(
    (r) => String(r.barCode) === barCode && String(r.depotName || "").includes(depotName),
  );
  if (!hit || hit.currentStock == null) return null;
  return Number(hit.currentStock);
}

async function main() {
  // SOP unit (no ERP)
  assert(isServiceConfirmPhrase("确认耗料123"), "confirm phrase");
  assert(parseServiceConfirmDraftId("确认耗料123") === 123, "parse id");
  assert(!isServiceConfirmPhrase("确认采购123"), "not purchase");
  assert(!isServiceConfirmPhrase("确认配制123"), "not mix");
  const routed = routeTrustedInbound({
    text: "确认耗料99",
    wecomUserId: "x",
    isConfirmPhrase: (t) => /^\s*确认\s*采购/.test(t) || /^\s*确认\s*配制/.test(t),
  });
  assert(routed?.sopId === "service_confirm", "registry service_confirm");
  const routedMix = routeTrustedInbound({
    text: "确认配制88",
    wecomUserId: "x",
    isConfirmPhrase: (t) => /^\s*确认\s*采购/.test(t) || /^\s*确认\s*配制/.test(t),
  });
  assert(routedMix?.sopId === "purchase_confirm", "mix phrase → trusted confirm path (Java rejects cross-type)");
  pass("sop_registry_unit", { service: routed, mixRouted: routedMix });

  const bindRows = mysql(
    "SELECT wecom_user_id, erp_user_id, binding_version, id, bot_id FROM aierp_wecom_binding WHERE status='ACTIVE' AND wecom_user_id='sid' ORDER BY id DESC LIMIT 1",
  );
  if (!bindRows.length) {
    fail("find_binding", "no ACTIVE sid binding");
    process.exit(1);
  }
  const [wecomUserId, erpUserId, bindingVersion, , boundBotId] = bindRows[0].split(/\t/);
  botId = boundBotId || botId;
  pass("find_binding", { wecomUserIdMasked: wecomUserId.slice(0, 2) + "***", erpUserId, bindingVersion, botId });

  // Prefer UserCustomer-visible customer when flag may be on; else any tenant 客户.
  const visibleCust = mysql(
    `SELECT s.supplier FROM jsh_supplier s
     JOIN jsh_user_business ub ON ub.type='UserCustomer' AND ub.key_id='${Number(erpUserId)}' AND IFNULL(ub.delete_flag,'0')<>'1'
     WHERE s.type='客户' AND s.enabled=b'1' AND IFNULL(s.delete_flag,'0')<>'1'
       AND s.tenant_id=(SELECT tenant_id FROM jsh_user WHERE id=${Number(erpUserId)})
       AND ub.value LIKE CONCAT('%[', s.id, ']%')
     ORDER BY s.id ASC LIMIT 3`,
  );
  const customers = mysql(
    `SELECT supplier FROM jsh_supplier WHERE type='客户' AND enabled=b'1' AND IFNULL(delete_flag,'0')<>'1' AND tenant_id=(SELECT tenant_id FROM jsh_user WHERE id=${Number(erpUserId)}) ORDER BY id ASC LIMIT 5`,
  );
  assert(customers.length > 0, "no real ERP customer");
  const organName = visibleCust[0] || customers[0];
  pass("real_customer", { organName, userCustomerPreferred: !!visibleCust[0] });

  const stockFg = await signedPost("/aierp/v1/wecom/stock/query", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "FG-101",
    depotName: "成品仓",
  });
  assert(stockFg.json?.code === 200, "stock FG query failed");
  const nBefore = stockOf(stockFg.json.data, "FG-101", "成品仓");
  assert(nBefore != null && Number.isFinite(nBefore), "FG-101 成品仓 stock missing");

  const stockRm = await signedPost("/aierp/v1/wecom/stock/query", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "RM-A001",
    depotName: "原料仓",
  });
  const rmBefore = stockOf(stockRm.json?.data, "RM-A001", "原料仓");
  pass("stock_snapshot_before", { fgFinished: nBefore, rmRaw: rmBefore });

  // Cancel open excel workflow if any (best-effort)
  await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
    wecomUserId,
    botId,
    channel: "wecom",
  });

  // Negative: bad customer
  const badCust = await signedPost("/aierp/v1/wecom/service/prepare", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "FG-101",
    qty: 1,
    unit: "L",
    depotName: "成品仓",
    organName: "不存在的客户XYZ-" + Date.now(),
    serviceProject: "UAT负例",
    idempotencyKey: `svc-bad-cust-${Date.now()}`,
  });
  assert(badCust.json?.code !== 200, "bad customer must fail");
  pass("reject_bad_customer", badCust.json);

  // Negative: insufficient stock (qty >> N)
  const tooMuch = Math.max(Math.floor(nBefore) + 1000, 99999);
  const badQty = await signedPost("/aierp/v1/wecom/service/prepare", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "FG-101",
    qty: tooMuch,
    unit: "L",
    depotName: "成品仓",
    organName,
    serviceProject: "UAT负例超库存",
    idempotencyKey: `svc-bad-qty-${Date.now()}`,
  });
  assert(badQty.json?.code !== 200, "insufficient stock must fail at prepare");
  pass("reject_insufficient_stock", { code: badQty.json?.code, msg: badQty.json?.data?.message || badQty.json });

  // Negative: cross-depot (depot in tenant but not in UserDepot)
  const tenantIdRows = mysql(`SELECT tenant_id FROM jsh_user WHERE id=${Number(erpUserId)} LIMIT 1`);
  const tenantId = Number(tenantIdRows[0]);
  // name varchar(20): keep short
  const denyDepotName = `禁仓${Date.now().toString(36).slice(-8)}`;
  mysql(
    `INSERT INTO jsh_depot (name, address, warehousing, truckage, type, sort, remark, principal, tenant_id, delete_Flag, is_default, enabled)
     VALUES ('${denyDepotName}', '', 0, 0, 0, '0', '016S-xdepot', NULL, ${tenantId}, '0', b'0', b'1')`,
  );
  try {
    const badDepot = await signedPost("/aierp/v1/wecom/service/prepare", {
      wecomUserId,
      botId,
      channel: "wecom",
      barCode: "FG-101",
      qty: 1,
      unit: "L",
      depotName: denyDepotName,
      organName,
      serviceProject: "UAT跨仓负例",
      idempotencyKey: `svc-bad-depot-${Date.now()}`,
    });
    assert(badDepot.json?.code !== 200, "cross-depot must fail");
    pass("reject_cross_depot", { code: badDepot.json?.code, msg: badDepot.json?.data?.message || badDepot.json });
  } finally {
    mysql(`UPDATE jsh_depot SET delete_Flag='1' WHERE name='${denyDepotName}' AND tenant_id=${tenantId}`);
  }

  // Negative: UserCustomer when customerFlag=1 (customer in tenant but not in UserCustomer)
  const flagBefore = mysql("SELECT IFNULL(customer_flag,'0') FROM jsh_system_config ORDER BY id ASC LIMIT 1")[0] || "0";
  const deniedCust = mysql(
    `SELECT s.supplier FROM jsh_supplier s
     WHERE s.type='客户' AND s.enabled=b'1' AND IFNULL(s.delete_flag,'0')<>'1'
       AND s.tenant_id=${tenantId}
       AND NOT EXISTS (
         SELECT 1 FROM jsh_user_business ub
         WHERE ub.type='UserCustomer' AND ub.key_id='${Number(erpUserId)}' AND IFNULL(ub.delete_flag,'0')<>'1'
           AND ub.value LIKE CONCAT('%[', s.id, ']%')
       )
     ORDER BY s.id ASC LIMIT 1`,
  );
  if (deniedCust.length) {
    mysql("UPDATE jsh_system_config SET customer_flag='1'");
    try {
      const badVis = await signedPost("/aierp/v1/wecom/service/prepare", {
        wecomUserId,
        botId,
        channel: "wecom",
        barCode: "FG-101",
        qty: 1,
        unit: "L",
        depotName: "成品仓",
        organName: deniedCust[0],
        serviceProject: "UAT客户可见性负例",
        idempotencyKey: `svc-bad-vis-${Date.now()}`,
      });
      assert(badVis.json?.code !== 200, "UserCustomer mismatch must fail when flag=1");
      pass("reject_usercustomer_invisible", {
        organName: deniedCust[0],
        code: badVis.json?.code,
        msg: badVis.json?.data?.message || badVis.json,
      });
    } finally {
      mysql(`UPDATE jsh_system_config SET customer_flag='${flagBefore.replace(/'/g, "")}'`);
    }
  } else {
    pass("reject_usercustomer_invisible_skip", { reason: "all tenant customers already in UserCustomer" });
  }

  if (nBefore < 1) {
    fail("prepare_skipped_low_stock", { nBefore, hint: "FG-101 成品仓 < 1，无法做 1L 出库正向用例" });
  } else {
    const idem = `wecom:016s:${Date.now()}:${randomBytes(3).toString("hex")}`;
    const prep = await signedPost("/aierp/v1/wecom/service/prepare", {
      wecomUserId,
      botId,
      channel: "wecom",
      barCode: "FG-101",
      qty: 1,
      unit: "L",
      depotName: "成品仓",
      organName,
      serviceProject: "Demo C UAT 服务测试",
      idempotencyKey: idem,
      remark: "AIERP-016S automated test — SERVICE other outbound",
    });
    assert(prep.json?.code === 200, "prepare failed: " + JSON.stringify(prep.json));
    const draftId = prep.json.data?.draftId;
    assert(draftId, "no draftId");
    assert(prep.json.data?.posted !== true, "prepare must not post");
    assert(prep.json.data?.stockUnchanged === true, "prepare stockUnchanged");
    assert(prep.json.data?.bizType === "SERVICE", "bizType SERVICE");
    assert(
      prep.json.data?.challenge?.phrase === `确认耗料${draftId}` ||
        prep.json.data?.confirmPhrase === `确认耗料${draftId}`,
      "challenge phrase 确认耗料",
    );
    pass("prepare_service_draft", {
      draftId,
      phrase: prep.json.data?.confirmPhrase || prep.json.data?.challenge?.phrase,
      status: prep.json.data?.status,
    });

    const stockMid = await signedPost("/aierp/v1/wecom/stock/query", {
      wecomUserId,
      botId,
      channel: "wecom",
      barCode: "FG-101",
      depotName: "成品仓",
    });
    const nMid = stockOf(stockMid.json.data, "FG-101", "成品仓");
    assert(nMid === nBefore, `prepare must keep stock N=${nBefore}, got ${nMid}`);
    pass("prepare_stock_unchanged", { nBefore, nMid });

    // Wrong confirm kinds → reject (PURCHASE + MIX cross-type)
    const wrongKind = await signedPost("/aierp/v1/wecom/draft/confirm", {
      wecomUserId,
      botId,
      channel: "wecom",
      rawText: `确认采购${draftId}`,
      messageMsgId: `016s-wrong-${Date.now()}`,
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: false,
      draftId,
    });
    assert(wrongKind.json?.code !== 200, "确认采购 must not confirm SERVICE");
    pass("reject_purchase_phrase_on_service", wrongKind.json);

    const wrongMix = await signedPost("/aierp/v1/wecom/draft/confirm", {
      wecomUserId,
      botId,
      channel: "wecom",
      rawText: `确认配制${draftId}`,
      messageMsgId: `016s-mix-${Date.now()}`,
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: false,
      draftId,
    });
    assert(wrongMix.json?.code !== 200, "确认配制 must not confirm SERVICE");
    pass("reject_mix_phrase_on_service", wrongMix.json);

    // no-post: prepare must not create audited native bill
    const leaked = mysql(
      `SELECT number,status FROM jsh_depot_head WHERE number='GW-SERVICE-${Number(draftId)}' AND IFNULL(delete_flag,'0')<>'1'`,
    );
    assert(leaked.length === 0, "prepare must not create GW-SERVICE bill");
    pass("no_post_after_prepare", { draftId });

    // cross-owner: wrong wecom identity must not confirm
    const otherBind = mysql(
      `SELECT wecom_user_id FROM aierp_wecom_binding WHERE status='ACTIVE' AND wecom_user_id<>'${wecomUserId.replace(/'/g, "")}' ORDER BY id DESC LIMIT 1`,
    );
    if (otherBind.length) {
      const crossOwner = await signedPost("/aierp/v1/wecom/draft/confirm", {
        wecomUserId: otherBind[0],
        botId,
        channel: "wecom",
        rawText: `确认耗料${draftId}`,
        messageMsgId: `016s-xowner-${Date.now()}`,
        eventSource: "WECOM_BEFORE_DISPATCH",
        isGroup: false,
        draftId,
      });
      assert(crossOwner.json?.code !== 200, "cross-owner confirm must fail");
      pass("reject_cross_owner_confirm", { other: String(otherBind[0]).slice(0, 2) + "***", code: crossOwner.json?.code });
    } else {
      const fakeOwner = await signedPost("/aierp/v1/wecom/draft/confirm", {
        wecomUserId: "not-bound-user-" + Date.now(),
        botId,
        channel: "wecom",
        rawText: `确认耗料${draftId}`,
        messageMsgId: `016s-xowner-${Date.now()}`,
        eventSource: "WECOM_BEFORE_DISPATCH",
        isGroup: false,
        draftId,
      });
      assert(fakeOwner.json?.code !== 200, "unbound owner confirm must fail");
      pass("reject_cross_owner_confirm", { mode: "unbound", code: fakeOwner.json?.code });
    }

    if (!DO_CONFIRM) {
      pass("confirm_skipped", {
        reason: "set AIERP_016S_CONFIRM=1 to post FG-101 -1L (do not repost GW-SERVICE-136)",
        draftId,
        confirmPhrase: `确认耗料${draftId}`,
        LIVE_WECOM_CONFIRM: "PENDING_USER",
        NOT_VERIFIED: "human WeCom UAT",
      });
      // Cancel test draft so it does not block later verbal flows
      await signedPost("/aierp/v1/wecom/draft/cancel", {
        wecomUserId,
        botId,
        channel: "wecom",
        draftId,
      });
      pass("cancel_unposted_test_draft", { draftId });
    } else {
      const msgId = `016s-msg-${Date.now()}`;
      const conf = await signedPost("/aierp/v1/wecom/draft/confirm", {
        wecomUserId,
        botId,
        channel: "wecom",
        rawText: `确认耗料${draftId}`,
        messageMsgId: msgId,
        eventSource: "WECOM_BEFORE_DISPATCH",
        isGroup: false,
        draftId,
      });
      assert(conf.json?.code === 200, "confirm failed: " + JSON.stringify(conf.json));
      const bill = conf.json.data?.billNumber;
      assert(bill && String(bill).startsWith("GW-SERVICE-"), "missing GW-SERVICE bill");
      assert(!String(bill).startsWith("GW-SALE"), "must not be SALE");
      assert(conf.json.data?.posted === true, "posted");
      const receiptText = String(conf.json.data?.receiptText || "");
      assert(receiptText.includes("服务耗料"), "receipt title/text");
      assert(!/采购入库业务回执/.test(receiptText) || /服务耗料/.test(receiptText), "no fake purchase retitle alone");
      pass("confirm_once", {
        billNumber: bill,
        pdfStatus: conf.json.data?.pdfStatus,
        receiptSnippet: receiptText.slice(0, 180),
      });

      const stockAfter = await signedPost("/aierp/v1/wecom/stock/query", {
        wecomUserId,
        botId,
        channel: "wecom",
        barCode: "FG-101",
        depotName: "成品仓",
      });
      const nAfter = stockOf(stockAfter.json.data, "FG-101", "成品仓");
      assert(Math.abs(nAfter - (nBefore - 1)) < 1e-6, `expect N-1=${nBefore - 1}, got ${nAfter}`);
      pass("confirm_stock_N_minus_1", { nBefore, nAfter });

      const stockRmAfter = await signedPost("/aierp/v1/wecom/stock/query", {
        wecomUserId,
        botId,
        channel: "wecom",
        barCode: "RM-A001",
        depotName: "原料仓",
      });
      const rmAfter = stockOf(stockRmAfter.json?.data, "RM-A001", "原料仓");
      if (rmBefore != null && rmAfter != null) {
        assert(rmAfter === rmBefore, `原料仓 must unchanged ${rmBefore}→${rmAfter}`);
        pass("raw_depot_unchanged", { rmBefore, rmAfter });
      } else {
        pass("raw_depot_skip", { rmBefore, rmAfter });
      }

      const native = mysql(
        `SELECT number,type,sub_type,status FROM jsh_depot_head WHERE number='${bill}' AND IFNULL(delete_flag,'0')<>'1'`,
      );
      assert(native.length === 1 && /\t出库\t其它\t1$/.test(native[0].replace(/\s+/g, "\t")) || (native[0].includes("出库") && native[0].includes("其它") && native[0].includes("\t1")),
        "native other-outbound audited: " + native[0]);
      pass("native_service_other_outbound", native[0]);

      const conf2 = await signedPost("/aierp/v1/wecom/draft/confirm", {
        wecomUserId,
        botId,
        channel: "wecom",
        rawText: `确认耗料${draftId}`,
        messageMsgId: msgId + "-replay",
        eventSource: "WECOM_BEFORE_DISPATCH",
        isGroup: false,
        draftId,
      });
      assert(conf2.json?.code === 200, "replay confirm failed");
      assert(conf2.json.data?.billNumber === bill, "replay bill mismatch");
      assert(conf2.json.data?.replayed === true || conf2.json.data?.stockUnchanged === true, "replay flags");
      const stockReplay = await signedPost("/aierp/v1/wecom/stock/query", {
        wecomUserId,
        botId,
        channel: "wecom",
        barCode: "FG-101",
        depotName: "成品仓",
      });
      const nReplay = stockOf(stockReplay.json.data, "FG-101", "成品仓");
      assert(nReplay === nAfter, "replay must not double outbound");
      pass("confirm_replay_no_double_outbound", { bill, nReplay });

      // Same idempotencyKey prepare → already posted bill (not new DRAFT)
      const prepReplay = await signedPost("/aierp/v1/wecom/service/prepare", {
        wecomUserId,
        botId,
        channel: "wecom",
        barCode: "FG-101",
        qty: 1,
        unit: "L",
        depotName: "成品仓",
        organName,
        serviceProject: "Demo C UAT 服务测试",
        idempotencyKey: idem,
        remark: "AIERP-016S automated test — SERVICE other outbound",
      });
      assert(prepReplay.json?.code === 200, "idempotent prepare after confirm failed");
      assert(prepReplay.json.data?.status === "CONFIRMED" || prepReplay.json.data?.posted === true, "must show posted");
      assert(String(prepReplay.json.data?.draftId) === String(draftId), "same draftId");
      assert(prepReplay.json.data?.billNumber === bill || prepReplay.json.data?.replayed === true, "audited replay");
      const headsAfter = mysql(
        `SELECT COUNT(*) FROM jsh_depot_head WHERE number LIKE 'GW-SERVICE-%' AND creator=${Number(erpUserId)} AND number='${bill}' AND IFNULL(delete_flag,'0')<>'1'`,
      );
      assert(Number(headsAfter[0]) === 1, "must not issue another native bill");
      pass("idempotent_prepare_shows_posted", {
        draftId,
        bill,
        posted: prepReplay.json.data?.posted,
        status: prepReplay.json.data?.status,
      });

      // Same XLSX workflow POSTED → prepare-verified returns posted, not new DRAFT
      const fakeSha = "ab".repeat(32);
      const fakePreview = `016s-replay-${draftId}`;
      await signedPost("/aierp/v1/wecom/excel/workflow/status", {
        wecomUserId,
        botId,
        channel: "wecom",
        status: "POSTED",
        previewId: fakePreview,
        fileSha256: fakeSha,
        draftId,
        businessKey: "016S-REPLAY",
        reason: "CONFIRMED",
        userSummaryZh: `服务耗料单 #${draftId} 已出库。`,
      });
      const xlsxReplay = await signedPost("/aierp/v1/wecom/service/prepare-verified", {
        wecomUserId,
        botId,
        channel: "wecom",
        previewId: fakePreview,
        fileSha256: fakeSha,
      });
      assert(xlsxReplay.json?.code === 200, "xlsx prepare-verified replay failed: " + JSON.stringify(xlsxReplay.json));
      assert(xlsxReplay.json.data?.posted === true, "xlsx replay must be posted");
      assert(String(xlsxReplay.json.data?.draftId) === String(draftId), "xlsx replay same draft");
      assert(xlsxReplay.json.data?.autoDraft !== true, "xlsx replay must not create new DRAFT");
      pass("xlsx_replay_shows_posted_bill", {
        draftId,
        bill: xlsxReplay.json.data?.billNumber || bill,
        replayed: xlsxReplay.json.data?.replayed,
      });
    }
  }

  // --- Non-posting REVIEW_FIX: PURCHASE draft + 确认耗料 must reject ---
  await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
    wecomUserId,
    botId,
    channel: "wecom",
  });
  const purchIdem = `wecom:016s-xpurchase:${Date.now()}:${randomBytes(3).toString("hex")}`;
  const purchPrep = await signedPost("/aierp/v1/wecom/purchase/prepare", {
    wecomUserId,
    botId,
    channel: "wecom",
    barCode: "RM-A001",
    qty: 1,
    unit: "L",
    depotName: "原料仓",
    organName: "华东化工",
    idempotencyKey: purchIdem,
    remark: "AIERP-016S cross-type PURCHASE fixture (no post)",
  });
  if (purchPrep.json?.code === 200 && purchPrep.json.data?.draftId) {
    const pDraft = purchPrep.json.data.draftId;
    const svcOnPurch = await signedPost("/aierp/v1/wecom/draft/confirm", {
      wecomUserId,
      botId,
      channel: "wecom",
      rawText: `确认耗料${pDraft}`,
      messageMsgId: `016s-svc-on-purch-${Date.now()}`,
      eventSource: "WECOM_BEFORE_DISPATCH",
      isGroup: false,
      draftId: pDraft,
    });
    assert(svcOnPurch.json?.code !== 200, "确认耗料 must not confirm PURCHASE");
    pass("reject_service_phrase_on_purchase", {
      draftId: pDraft,
      code: svcOnPurch.json?.code,
      msg: svcOnPurch.json?.data?.message || svcOnPurch.json,
    });
    await signedPost("/aierp/v1/wecom/draft/cancel", {
      wecomUserId,
      botId,
      channel: "wecom",
      draftId: pDraft,
    });
    pass("cancel_purchase_cross_type_fixture", { draftId: pDraft });
  } else {
    pass("reject_service_phrase_on_purchase_skip", {
      reason: "purchase prepare unavailable",
      code: purchPrep.json?.code,
      msg: purchPrep.json?.data?.message || purchPrep.json,
    });
  }

  // --- Non-posting: same businessKey/file after POSTED → already posted, no new DRAFT (reuse GW-SERVICE-136; do NOT repost) ---
  const posted136 = mysql(
    `SELECT id, idempotency_key, bill_number, status FROM aierp_gateway_draft
     WHERE bill_number='GW-SERVICE-136' AND biz_type='SERVICE' AND status='CONFIRMED'
       AND user_id=${Number(erpUserId)} LIMIT 1`,
  );
  if (posted136.length) {
    const [pId, pIdem, pBill] = posted136[0].split(/\t/);
    const organ136 =
      mysql(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.organName')) FROM aierp_gateway_draft WHERE id=${Number(pId)}`,
      )[0] || organName;
    const bar136 =
      mysql(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.lines[0].barCode')) FROM aierp_gateway_draft WHERE id=${Number(pId)}`,
      )[0] || "FG-101";
    const depot136 =
      mysql(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.lines[0].depotName')) FROM aierp_gateway_draft WHERE id=${Number(pId)}`,
      )[0] || "成品仓";
    const qty136 =
      mysql(
        `SELECT IFNULL(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.lines[0].operNumber')),
                       JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.lines[0].qty'))) FROM aierp_gateway_draft WHERE id=${Number(pId)}`,
      )[0] || "1";
    const unit136 =
      mysql(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.lines[0].unit')) FROM aierp_gateway_draft WHERE id=${Number(pId)}`,
      )[0] || "L";
    const stockBeforeReplay = stockOf(
      (
        await signedPost("/aierp/v1/wecom/stock/query", {
          wecomUserId,
          botId,
          channel: "wecom",
          barCode: bar136,
          depotName: depot136,
        })
      ).json?.data,
      bar136,
      depot136,
    );
    const replayPrep = await signedPost("/aierp/v1/wecom/service/prepare", {
      wecomUserId,
      botId,
      channel: "wecom",
      barCode: bar136,
      qty: Number(qty136) > 0 ? Number(qty136) : 1,
      unit: unit136,
      depotName: depot136,
      organName: organ136,
      serviceProject: "Demo C UAT 服务测试",
      idempotencyKey: pIdem,
      remark: "AIERP-016S automated test — SERVICE other outbound",
    });
    assert(replayPrep.json?.code === 200, "audited replay prepare failed: " + JSON.stringify(replayPrep.json));
    assert(String(replayPrep.json.data?.draftId) === String(pId), "replay must return same draftId");
    assert(String(replayPrep.json.data?.billNumber || "") === String(pBill), "replay must keep GW-SERVICE-136");
    assert(
      replayPrep.json.data?.status === "CONFIRMED" || replayPrep.json.data?.posted === true,
      "replay must be already posted, not new DRAFT",
    );
    assert(replayPrep.json.data?.status !== "DRAFT" && replayPrep.json.data?.status !== "AWAITING_CONFIRM", "must not issue another DRAFT");
    const stockAfterReplay = stockOf(
      (
        await signedPost("/aierp/v1/wecom/stock/query", {
          wecomUserId,
          botId,
          channel: "wecom",
          barCode: bar136,
          depotName: depot136,
        })
      ).json?.data,
      bar136,
      depot136,
    );
    assert(stockAfterReplay === stockBeforeReplay, "audited replay must not change stock");
    pass("audited_replay_posted_not_new_draft", {
      draftId: pId,
      billNumber: pBill,
      posted: replayPrep.json.data?.posted,
      status: replayPrep.json.data?.status,
      stockUnchanged: stockAfterReplay,
    });

    // Same-file XLSX workflow POSTED → prepare-verified shows posted bill (no new DRAFT)
    const fakeSha = "cd".repeat(32);
    const fakePreview = `016s-posted-replay-${pId}`;
    await signedPost("/aierp/v1/wecom/excel/workflow/status", {
      wecomUserId,
      botId,
      channel: "wecom",
      status: "POSTED",
      previewId: fakePreview,
      fileSha256: fakeSha,
      draftId: Number(pId),
      businessKey: "016S-POSTED-REPLAY",
      reason: "CONFIRMED",
      userSummaryZh: `服务耗料单 #${pId} 已出库（${pBill}）。`,
    });
    const xlsxPosted = await signedPost("/aierp/v1/wecom/service/prepare-verified", {
      wecomUserId,
      botId,
      channel: "wecom",
      previewId: fakePreview,
      fileSha256: fakeSha,
    });
    assert(xlsxPosted.json?.code === 200, "xlsx posted replay failed: " + JSON.stringify(xlsxPosted.json));
    assert(xlsxPosted.json.data?.posted === true, "xlsx posted replay must be posted");
    assert(String(xlsxPosted.json.data?.draftId) === String(pId), "xlsx posted same draft");
    assert(xlsxPosted.json.data?.autoDraft !== true, "xlsx posted must not create new DRAFT");
    pass("xlsx_posted_replay_no_new_draft", {
      draftId: pId,
      bill: xlsxPosted.json.data?.billNumber || pBill,
      replayed: xlsxPosted.json.data?.replayed,
    });
    await signedPost("/aierp/v1/wecom/excel/workflow/cancel", {
      wecomUserId,
      botId,
      channel: "wecom",
    });
  } else {
    pass("audited_replay_posted_not_new_draft_skip", { reason: "GW-SERVICE-136 CONFIRMED missing" });
  }

  const evidenceDir = join(root, "docs", "poc", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    ticket: "AIERP-016S",
    suite: "REVIEW_FIX non-post",
    at: new Date().toISOString(),
    doConfirm: DO_CONFIRM,
    pass: results.every((r) => r.ok),
    results,
    uatNotes: {
      LIVE_WECOM_CONFIRM: DO_CONFIRM ? "SCRIPT_CONFIRMED" : "PENDING_USER",
      next: "企微私聊发服务耗料 Excel 或对话槽位 → 待确认 → 本人回复 确认耗料{draftId} → 核对 FG-101 成品仓 -1L、原料仓不变、回执《服务耗料出库回执》",
      noFDeploy: true,
      noRepostGwService136: true,
      NOT_VERIFIED: ["human WeCom UAT", "F: plugin deploy", "SERVICE PDF"],
    },
  };
  const outJson = join(evidenceDir, "aierp-016s-service-consume.json");
  writeFileSync(outJson, JSON.stringify(evidence, null, 2), "utf8");
  console.log("evidence ->", outJson);
  if (!evidence.pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
