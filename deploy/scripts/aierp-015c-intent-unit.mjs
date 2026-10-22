/**
 * AIERP-015C: unit-check receipt intent routing (no ERP calls).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginPath = join(__dirname, "..", "openclaw", "plugins", "aierp-erp-tools", "index.js");
const src = readFileSync(pluginPath, "utf8");

const start = src.indexOf("function isReceiptRequest");
const end = src.indexOf("function formatStock", start);
if (start < 0 || end < 0) {
  console.error("helpers not found", { start, end });
  process.exit(1);
}
const helpers = src.slice(start, end);
const ctx = createContext({});
runInContext(`${helpers}\nthis.isReceiptRequest=isReceiptRequest; this.extractReceiptBillNumber=extractReceiptBillNumber;`, ctx);
const { isReceiptRequest, extractReceiptBillNumber } = ctx;

const cases = [
  ["《采购入库业务回执》发我", true, undefined],
  ["把刚才的回执 PDF 发我", true, undefined],
  ["发 GW-PURCHASE-119 回执", true, "GW-PURCHASE-119"],
  ["发我 GW-PURCHASE-119 的采购入库业务回执 PDF", true, "GW-PURCHASE-119"],
  ["给我批量进货模板", false, undefined],
  ["采购入库模板", false, undefined],
  ["确认采购119", false, undefined],
  ["入库吧", false, undefined],
];

const results = [];
for (const [text, expect, bill] of cases) {
  const got = isReceiptRequest(text);
  const gotBill = extractReceiptBillNumber(text);
  const ok = got === expect && (bill ? gotBill === bill : gotBill === undefined || !bill);
  const billOk = bill ? gotBill === bill : true;
  const pass = got === expect && billOk;
  results.push({ text, expect, got, bill, gotBill, ok: pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${JSON.stringify(text)} -> ${got} bill=${gotBill}`);
}

const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const out = { ticket: "AIERP-015C", kind: "intent-unit", pass: results.every((r) => r.ok), results };
writeFileSync(join(evidenceDir, "aierp-015c-intent-unit.json"), JSON.stringify(out, null, 2), "utf8");
process.exit(out.pass ? 0 : 1);
