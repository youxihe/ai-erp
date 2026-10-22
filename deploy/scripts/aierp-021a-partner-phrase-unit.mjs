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
  ["确认建档供应商12", true, "CREATE", "供应商", 12],
  ["确认修改供应商99", true, "UPDATE", "供应商", 99],
  ["确认建档客户7", true, "CREATE", "客户", 7],
  ["确认修改客户8", true, "UPDATE", "客户", 8],
  ["确认建档12", false, null, null, null],
  ["确认修改12", false, null, null, null],
  ["确认伙伴建档12", false, null, null, null],
  ["确认建档物料12", false, null, null, null],
  ["确认采购12", false, null, null, null],
];

let failed = 0;
for (const [text, ok, op, partnerType, id] of cases) {
  const matched = isPartnerConfirmPhrase(text);
  const parsed = parsePartnerConfirm(text);
  const pass2 = ok
    ? matched &&
      parsed &&
      parsed.op === op &&
      parsed.partnerType === partnerType &&
      parsed.requestId === id &&
      parsed.phrase === `确认${op === "CREATE" ? "建档" : "修改"}${partnerType}${id}`
    : !matched && parsed == null;
  console.log(`${pass2 ? "PASS" : "FAIL"} ${JSON.stringify(text)}`);
  if (!pass2) failed += 1;
}

if (
  !CONFIRM_PARTNER_CREATE.test("确认建档供应商1") ||
  !CONFIRM_PARTNER_UPDATE.test("确认修改客户2") ||
  CONFIRM_PARTNER_CREATE.test("确认建档1") ||
  CONFIRM_PARTNER_CREATE.test("确认建档物料1")
) {
  console.log("FAIL regex constants");
  failed += 1;
}

// Simultaneous pending partner + material phrases must not share a regex namespace.
{
  const partnerPending = "确认建档供应商88";
  const materialPending = "确认建档物料88";
  const partnerOk = isPartnerConfirmPhrase(partnerPending);
  const materialAsPartner = isPartnerConfirmPhrase(materialPending);
  const pass =
    partnerOk &&
    !materialAsPartner &&
    parsePartnerConfirm(partnerPending)?.requestId === 88 &&
    parsePartnerConfirm(materialPending) == null;
  console.log(`${pass ? "PASS" : "FAIL"} simultaneous_partner_material_phrase_namespace`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all phrase unit checks passed");
