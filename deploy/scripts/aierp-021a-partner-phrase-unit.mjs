/**
 * Offline unit checks for AIERP-021A partner confirm phrase namespace.
 * No ERP / Docker required.
 */
import {
  isPartnerConfirmPhrase,
  parsePartnerConfirm,
  CONFIRM_PARTNER_CREATE,
  CONFIRM_PARTNER_UPDATE,
} from "../openclaw/sop/partner-upsert.mjs";

const cases = [
  ["确认伙伴建档12", true, "CREATE", 12],
  ["确认伙伴修改99", true, "UPDATE", 99],
  ["确认建档12", false, null, null],
  ["确认修改12", false, null, null],
  ["确认建档供应商12", false, null, null],
  ["确认建档客户12", false, null, null],
  ["确认建档物料12", false, null, null],
  ["确认采购12", false, null, null],
];

let failed = 0;
for (const [text, ok, op, id] of cases) {
  const matched = isPartnerConfirmPhrase(text);
  const parsed = parsePartnerConfirm(text);
  const pass =
    matched === ok &&
    (ok
      ? parsed && parsed.op === op && parsed.requestId === id && parsed.phrase === text.replace(/\s+/g, "")
      : parsed == null);
  // allow flexible whitespace normalization only for accepted phrases without spaces
  const pass2 = ok
    ? matched &&
      parsed &&
      parsed.op === op &&
      parsed.requestId === id &&
      (parsed.phrase === `确认伙伴建档${id}` || parsed.phrase === `确认伙伴修改${id}`)
    : !matched && parsed == null;
  console.log(`${pass2 ? "PASS" : "FAIL"} ${JSON.stringify(text)}`);
  if (!pass2) failed += 1;
}

if (!CONFIRM_PARTNER_CREATE.test("确认伙伴建档1") || !CONFIRM_PARTNER_UPDATE.test("确认伙伴修改2")) {
  console.log("FAIL regex constants");
  failed += 1;
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all phrase unit checks passed");
