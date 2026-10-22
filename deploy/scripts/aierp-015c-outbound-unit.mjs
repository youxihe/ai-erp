/**
 * AIERP-015C review-fix unit: intent + followup + wecom plugin discovery (no live send).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isReceiptRequest,
  isReceiptFollowup,
  canHandleReceipt,
  extractBillNumber,
} from "../openclaw/plugins/aierp-erp-tools/sop/receipt-send.mjs";
import { findWecomPluginRoot } from "../openclaw/plugins/aierp-erp-tools/sop/wecom-outbound.mjs";
import {
  renderPurchaseConfirmed,
  renderReceiptReady,
  fmtQty,
  fmtMoney,
} from "../openclaw/plugins/aierp-erp-tools/sop/renderers/wecom-business.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const results = [];
function note(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

note("intent_receipt_bill", isReceiptRequest("发 GW-PURCHASE-119 回执") && extractBillNumber("发 GW-PURCHASE-119 回执") === "GW-PURCHASE-119");
note("intent_receipt_cn", isReceiptRequest("《采购入库业务回执》发我"));
note("followup_file", isReceiptFollowup("文件直接发我"));
note("followup_resend", isReceiptRequest("重发回执") || isReceiptFollowup("再发一次"));
note("not_template", !isReceiptRequest("给我批量进货模板"));
note("canHandle_followup_without_pending", canHandleReceipt("文件直接发我", "sid")?.sopId === "receipt-send");

const md = renderPurchaseConfirmed({
  billNumber: "GW-PURCHASE-119",
  materialName: "表面活性剂",
  barCode: "RM-A001",
  qty: 80,
  unit: "L",
  amount: 1600,
  depotName: "原料仓",
  partnerName: "华东化工",
  stockBefore: 170.7,
  stockAfter: 250.7,
});
note("render_no_six_decimals", !md.includes("80.000000") && md.includes("80 L") && md.includes("¥1,600"));
note("render_no_media_path", !/MEDIA:/i.test(md) && !/[A-Z]:\\/.test(md));
note("render_no_font_tags", !/<font/i.test(md));
note("fmt", fmtQty(80.0, "L") === "80 L" && fmtMoney(1600) === "¥1,600");

const root = findWecomPluginRoot();
note("wecom_plugin_discovered", !!root && root.includes("wecom-openclaw-plugin"), root);

const receiptMd = renderReceiptReady({
  billNumber: "GW-PURCHASE-119",
  materialName: "表面活性剂",
  qty: 80,
  unit: "L",
  amount: 1600,
});
note("receipt_render", receiptMd.includes("GW-PURCHASE-119") && !receiptMd.includes("MEDIA:"));

const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const out = {
  ticket: "AIERP-015C",
  kind: "outbound-unit",
  pass: results.every((r) => r.ok),
  wecomPluginRoot: root,
  results,
};
writeFileSync(join(evidenceDir, "aierp-015c-outbound-unit.json"), JSON.stringify(out, null, 2), "utf8");
console.log(out.pass ? "ALL_PASS" : "HAS_FAIL");
process.exit(out.pass ? 0 : 1);
