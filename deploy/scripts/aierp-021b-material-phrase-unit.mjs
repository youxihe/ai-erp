/**
 * Offline unit checks for AIERP-021B material confirm phrase namespace.
 * No ERP / Docker required. Must not collide with partner #44 phrases.
 */
import {
  isMaterialConfirmPhrase,
  parseMaterialConfirm,
  MATERIAL_CONFIRM,
} from "../openclaw/sop/material-upsert.mjs";

const cases = [
  ["确认建档物料12", true, "CREATE", 12],
  ["确认修改物料99", true, "UPDATE", 99],
  [" 确认建档物料7 ", true, "CREATE", 7],
  ["确认建档12", false, null, null],
  ["确认修改12", false, null, null],
  ["确认建档供应商12", false, null, null],
  ["确认建档客户12", false, null, null],
  ["确认物料建档12", false, null, null],
  ["确认物料修改12", false, null, null],
  ["确认伙伴建档12", false, null, null],
  ["确认采购12", false, null, null],
];

let failed = 0;
for (const [text, ok, op, id] of cases) {
  const matched = isMaterialConfirmPhrase(text);
  const parsed = parseMaterialConfirm(text);
  const pass = ok
    ? matched &&
      parsed &&
      parsed.op === op &&
      parsed.requestId === id &&
      parsed.phrase === `确认${op === "CREATE" ? "建档" : "修改"}物料${id}`
    : !matched && parsed == null;
  console.log(`${pass ? "PASS" : "FAIL"} ${JSON.stringify(text)}`);
  if (!pass) failed += 1;
}

if (
  !MATERIAL_CONFIRM.test("确认建档物料1") ||
  !MATERIAL_CONFIRM.test("确认修改物料2") ||
  MATERIAL_CONFIRM.test("确认建档1") ||
  MATERIAL_CONFIRM.test("确认建档供应商1") ||
  MATERIAL_CONFIRM.test("确认物料建档1")
) {
  console.log("FAIL regex constants");
  failed += 1;
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all material phrase unit checks passed");
