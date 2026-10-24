/**
 * AIERP-022B intent / outbound unit (no ERP, no live WeCom send).
 * Covers: extractBillNumber MIX/SERVICE, NEED_CHOICE bare pick,
 * delivery status constants, media root hardening, auto-delivery hooks.
 */
import { writeFileSync, mkdirSync, mkdtempSync, writeFileSync as writeF, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  isReceiptRequest,
  isReceiptFollowup,
  extractBillNumber,
  isBareBillPick,
  canHandleReceipt,
  savePending,
  getPending,
  DELIVERY_STATUS as RS_DELIVERY,
} from "../openclaw/plugins/aierp-erp-tools/sop/receipt-send.mjs";
import {
  assertMediaUnderRoots,
  receiptMediaRoots,
  DELIVERY_STATUS,
} from "../openclaw/plugins/aierp-erp-tools/sop/wecom-outbound.mjs";
import {
  resolveReceiptKind,
  receiptFileTitle,
  AUTO_DELIVER_KINDS,
  FUTURE_HOOK_KINDS,
  RECEIPT_KIND,
  isPostSuccess,
  appendDeliveryHint,
} from "../openclaw/plugins/aierp-erp-tools/sop/receipt-auto-delivery.mjs";
import { routeTrustedInbound } from "../openclaw/plugins/aierp-erp-tools/sop/registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const results = [];
function note(name, ok, detail) {
  results.push({
    name,
    ok: !!ok,
    detail: detail == null ? undefined : typeof detail === "string" ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400),
  });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail != null ? ` · ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

// --- Bill number extraction (UAT bug: MIX was ignored) ---
note(
  "extract_purchase",
  extractBillNumber("发 GW-PURCHASE-119 回执") === "GW-PURCHASE-119",
);
note(
  "extract_mix",
  extractBillNumber("发 GW-MIX-12 回执") === "GW-MIX-12",
);
note(
  "extract_service",
  extractBillNumber("发我 GW-SERVICE-136 的回执 PDF") === "GW-SERVICE-136",
);
note("extract_bare_mix", extractBillNumber("GW-MIX-12") === "GW-MIX-12");
note("bare_pick_mix", isBareBillPick("GW-MIX-12") && isBareBillPick("  gw-service-136  "));
note("bare_pick_reject_phrase", !isBareBillPick("发 GW-MIX-12 回执") && !isBareBillPick("确认配制12"));

// --- Intent ---
note("intent_mix_receipt", isReceiptRequest("发 GW-MIX-12 回执"));
note("intent_service_receipt", isReceiptRequest("发 GW-SERVICE-136 回执"));
note("intent_purchase_still", isReceiptRequest("发 GW-PURCHASE-119 回执"));
note("not_template", !isReceiptRequest("给我批量进货模板"));
note("followup", isReceiptFollowup("文件直接发我"));

// --- NEED_CHOICE bare GW-* = receipt pick, not re-confirm ---
const fakeUser = `022b-unit-${Date.now()}`;
savePending(fakeUser, {
  status: "NEED_CHOICE",
  candidates: ["GW-MIX-12", "GW-PURCHASE-119"],
});
const pending = getPending(fakeUser);
note("pending_need_choice", pending?.status === "NEED_CHOICE");
const claim = canHandleReceipt("GW-MIX-12", fakeUser);
note(
  "canHandle_bare_after_need_choice",
  claim?.sopId === "receipt-send" && claim?.billPick === true,
  claim,
);
const routed = routeTrustedInbound({
  text: "GW-MIX-12",
  wecomUserId: fakeUser,
  isConfirmPhrase: (t) => /^\s*确认\s*采购/.test(t),
});
note(
  "registry_bill_pick",
  routed?.sopId === "receipt_bill_pick" && routed?.billPick === true,
  routed,
);
// Without NEED_CHOICE, bare bill must NOT claim receipt (avoid stealing confirm flows)
savePending(fakeUser, null);
note(
  "bare_without_pending_no_claim",
  canHandleReceipt("GW-MIX-12", fakeUser) == null,
);

// --- Delivery status ladder ---
note(
  "delivery_constants",
  DELIVERY_STATUS.PDF_READY === "PDF_READY" &&
    DELIVERY_STATUS.CHANNEL_ACCEPTED === "CHANNEL_ACCEPTED" &&
    DELIVERY_STATUS.CLIENT_OPEN_VERIFIED === "CLIENT_OPEN_VERIFIED" &&
    RS_DELIVERY.CHANNEL_ACCEPTED === "CHANNEL_ACCEPTED",
);
note(
  "never_auto_client_open",
  DELIVERY_STATUS.CLIENT_OPEN_VERIFIED !== DELIVERY_STATUS.CHANNEL_ACCEPTED,
);

// --- Kind resolution + titles (no purchase retitle) ---
note("kind_mix_bill", resolveReceiptKind({ billNumber: "GW-MIX-12" }) === "MIX");
note("kind_service_dto", resolveReceiptKind({ bizType: "SERVICE", billNumber: "GW-SERVICE-1" }) === "SERVICE");
note("kind_purchase", resolveReceiptKind({ billNumber: "GW-PURCHASE-119" }) === "PURCHASE");
note("kind_022a_partner_hook", resolveReceiptKind({ receiptKind: "PARTNER_CREATE" }) === "PARTNER_CREATE");
note(
  "title_mix_not_purchase",
  receiptFileTitle("MIX", "GW-MIX-12").includes("配制") &&
    !receiptFileTitle("MIX", "GW-MIX-12").includes("采购入库"),
);
note(
  "title_service_not_purchase",
  receiptFileTitle("SERVICE", "GW-SERVICE-136").includes("服务耗料") &&
    !receiptFileTitle("SERVICE", "GW-SERVICE-136").includes("采购入库"),
);
note("auto_kinds", AUTO_DELIVER_KINDS.has("PURCHASE") && AUTO_DELIVER_KINDS.has("MIX") && AUTO_DELIVER_KINDS.has("SERVICE"));
note("future_hooks", FUTURE_HOOK_KINDS.has(RECEIPT_KIND.PARTNER_CREATE) && FUTURE_HOOK_KINDS.has(RECEIPT_KIND.BATCH));
note("post_success", isPostSuccess({ status: "CONFIRMED" }) && !isPostSuccess({ status: "DRAFT" }));

const hint = appendDeliveryHint("业务完成", {
  skipped: true,
  reason: "PDF_NOT_READY",
  receiptKind: "MIX",
});
note("hint_pdf_not_ready_no_repost", /发回执/.test(hint) && !/再次入库|重新审核/.test(hint));

// --- Media root hardening: no dirname(abs) escape ---
const tmp = mkdtempSync(join(tmpdir(), "aierp-022b-"));
const allowedDir = join(tmp, "aierp-receipt");
mkdirSync(allowedDir, { recursive: true });
const inside = join(allowedDir, "ok.pdf");
writeF(inside, "%PDF-1.4 unit");
const outside = join(tmp, "escape.pdf");
writeF(outside, "%PDF-1.4 bad");

const gateOk = assertMediaUnderRoots(inside, [allowedDir]);
note("realpath_inside_ok", gateOk.ok === true, gateOk);

const gateBad = assertMediaUnderRoots(outside, [allowedDir]);
note(
  "realpath_outside_denied",
  gateBad.ok === false && /outside configured/i.test(String(gateBad.error || "")),
  gateBad,
);

const roots = receiptMediaRoots([allowedDir]);
note(
  "roots_fixed_no_parent_injection",
  roots.some((r) => resolve(r) === resolve(allowedDir)) &&
    !roots.includes(resolve(dirname(outside))),
);

// Cleanup pending + temp
savePending(fakeUser, null);
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  // ignore
}

const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const out = {
  ticket: "AIERP-022B",
  kind: "intent-unit",
  pass: results.every((r) => r.ok),
  passCount: results.filter((r) => r.ok).length,
  total: results.length,
  results,
};
writeFileSync(join(evidenceDir, "aierp-022b-intent-unit.json"), JSON.stringify(out, null, 2), "utf8");
console.log(out.pass ? `ALL_PASS ${out.passCount}/${out.total}` : `HAS_FAIL ${out.passCount}/${out.total}`);
process.exit(out.pass ? 0 : 1);
