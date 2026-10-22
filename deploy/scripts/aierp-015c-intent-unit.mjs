/**
 * AIERP-015C: receipt intent + followup unit (imports SOP, no ERP).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isReceiptRequest,
  isReceiptFollowup,
  extractBillNumber,
} from "../openclaw/plugins/aierp-erp-tools/sop/receipt-send.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cases = [
  ["《采购入库业务回执》发我", true, false, undefined],
  ["把刚才的回执 PDF 发我", true, false, undefined],
  ["发 GW-PURCHASE-119 回执", true, false, "GW-PURCHASE-119"],
  ["发我 GW-PURCHASE-119 的采购入库业务回执 PDF", true, false, "GW-PURCHASE-119"],
  ["文件直接发我", false, true, undefined],
  ["再发一次", false, true, undefined],
  ["给我批量进货模板", false, false, undefined],
  ["采购入库模板", false, false, undefined],
  ["确认采购119", false, false, undefined],
  ["入库吧", false, false, undefined],
];

const results = [];
for (const [text, expectReq, expectFu, bill] of cases) {
  const got = isReceiptRequest(text);
  const fu = isReceiptFollowup(text);
  const gotBill = extractBillNumber(text);
  const billOk = bill ? gotBill === bill : true;
  const pass = got === expectReq && fu === expectFu && billOk;
  results.push({ text, expectReq, got, expectFu, fu, bill, gotBill, ok: pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${JSON.stringify(text)} req=${got} fu=${fu} bill=${gotBill}`);
}

const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const out = { ticket: "AIERP-015C", kind: "intent-unit", pass: results.every((r) => r.ok), results };
writeFileSync(join(evidenceDir, "aierp-015c-intent-unit.json"), JSON.stringify(out, null, 2), "utf8");
process.exit(out.pass ? 0 : 1);
