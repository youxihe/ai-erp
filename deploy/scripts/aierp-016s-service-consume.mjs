/**
 * AIERP-016S: SERVICE (客户服务耗料/其它出库) prepare + trusted confirm.
 * - Real ERP customer; FG-101 @ 成品仓 qty=1
 * - Prepare: stock N unchanged; Confirm: N-1; 原料仓 unchanged
 * - Negatives: bad customer, insufficient stock, replay no double outbound
 * - Never SALE bill
 *
 * Env: AIERP_WECOM_ADAPTER_SECRET, optional AIERP_016S_CONFIRM=1 to post (default: prepare-only + negatives).
 * Live WeCom「确认耗料」UAT remains human when confirm skipped.
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
  const routed = routeTrustedInbound({
    text: "确认耗料99",
    wecomUserId: "x",
    isConfirmPhrase: (t) => /^\s*确认\s*采购/.test(t),
  });
  assert(routed?.sopId === "service_confirm", "registry service_confirm");
  pass("sop_registry_unit", routed);

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

  // Real customer (type=客户)
  const customers = mysql(
    `SELECT supplier FROM jsh_supplier WHERE type='客户' AND enabled=b'1' AND IFNULL(delete_flag,'0')<>'1' AND tenant_id=(SELECT tenant_id FROM jsh_user WHERE id=${Number(erpUserId)}) ORDER BY id ASC LIMIT 5`,
  );
  assert(customers.length > 0, "no real ERP customer");
  const organName = customers[0];
  pass("real_customer", { organName });

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

    // Wrong confirm kind → reject
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

    if (!DO_CONFIRM) {
      pass("confirm_skipped", {
        reason: "set AIERP_016S_CONFIRM=1 to post FG-101 -1L",
        draftId,
        confirmPhrase: `确认耗料${draftId}`,
        LIVE_WECOM_CONFIRM: "PENDING_USER",
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
    }
  }

  const evidenceDir = join(root, "docs", "poc", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    ticket: "AIERP-016S",
    at: new Date().toISOString(),
    doConfirm: DO_CONFIRM,
    pass: results.every((r) => r.ok),
    results,
    uatNotes: {
      LIVE_WECOM_CONFIRM: DO_CONFIRM ? "SCRIPT_CONFIRMED" : "PENDING_USER",
      next: "企微私聊发服务耗料 Excel 或对话槽位 → 待确认 → 本人回复 确认耗料{draftId} → 核对 FG-101 成品仓 -1L、原料仓不变、回执《服务耗料出库回执》",
      noFDeploy: true,
      noPluginIndexEdit: true,
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
