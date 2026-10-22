import { readFileSync } from "node:fs";

const s = readFileSync(
  "jshERP-boot/src/main/java/com/jsh/erp/gateway/wecom/PartnerMasterDataService.java",
  "utf8",
);
console.log({
  class: (s.match(/public class \w+/) || [])[0],
  typed: s.includes("(供应商|客户)"),
  partnerPrefixed: s.includes("确认伙伴"),
  phrasePrefix: s.includes("phrasePrefixFor(String op, String partnerType)"),
  parseG2: s.includes("m1.group(2)"),
  assertOwned: s.includes("assertRequestOwnedByCurrentActor"),
  earlyBareReplay: /WHERE consume_message_id=\? LIMIT 1/.test(s),
  custDeny: s.includes("未分配客户权限"),
  nameLock: s.includes("GET_LOCK"),
});

const c = readFileSync(
  "jshERP-boot/src/main/java/com/jsh/erp/gateway/wecom/AierpWecomController.java",
  "utf8",
);
for (const l of c.split(/\n/)) {
  if (/MasterData|partnerMaster/.test(l)) console.log("CTRL", l.trim());
}

const sop = readFileSync("deploy/openclaw/sop/partner-upsert.mjs", "utf8");
console.log("SOP typed", sop.includes("(供应商|客户)"), "伙伴", sop.includes("确认伙伴"));

const t = readFileSync("deploy/scripts/aierp-021a-partner-master.mjs", "utf8");
console.log("TEST", {
  supplierPhrase: t.includes("确认建档供应商${requestId}"),
  cross: t.includes("cross_sender_same_msgid_no_partner_leak"),
  bare: t.includes("bare_confirm"),
  material: t.includes("material_confirm_phrase_not_partner"),
  leftoverPartner: t.includes("确认伙伴"),
});
