/**
 * AIERP-020B unit: multi-line purchase WeCom renderer + capability matrix + no-post buttons.
 * No live send / no stock mutation.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderPurchaseConfirmed,
  factsFromConfirm,
  extractPurchaseLines,
  sumLineAmounts,
  sanitizeForChannel,
  renderPurchaseBatchDraftReady,
  factsFromPurchaseBatch,
  fmtMoney,
} from "../openclaw/plugins/aierp-erp-tools/sop/renderers/wecom-business.mjs";
import {
  renderBusinessResult,
  buildPurchaseTextNoticeCard,
  buildPurchasePhraseHintCard,
  toBusinessResult,
} from "../openclaw/plugins/aierp-erp-tools/sop/renderers/wecom-adapter.mjs";
import {
  capabilityMatrixSummary,
  assertNoPostingButtonKeys,
  SAFE_CARD_BUTTON_KEYS,
  FORBIDDEN_POST_BUTTON_KEYS,
} from "../openclaw/plugins/aierp-erp-tools/sop/renderers/wecom-capability.mjs";
import { formatPurchaseBatchReply } from "../openclaw/plugins/aierp-erp-tools/sop/purchase-batch-prepare.mjs";
import { findWecomPluginRoot } from "../openclaw/plugins/aierp-erp-tools/sop/wecom-outbound.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const results = [];
function note(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail != null ? ` ${JSON.stringify(detail).slice(0, 160)}` : ""}`);
}

// --- Fixture: 2 bills / 3 lines (017B2 style) ---
const billALines = [
  { materialName: "表面活性剂", barCode: "RM-A001", qty: 10, unit: "L", unitPrice: 20, allPrice: 200, depotName: "原料仓" },
  { materialName: "表面活性剂", barCode: "RM-A001", qty: 5, unit: "L", unitPrice: 20, allPrice: 100, depotName: "原料仓" },
];
const billBLines = [
  { materialName: "表面活性剂", barCode: "RM-A001", qty: 3, unit: "L", unitPrice: 20, allPrice: 60, depotName: "原料仓" },
];

note("sum_bill_a_not_first_line", sumLineAmounts(billALines) === 300, sumLineAmounts(billALines));
note("sum_bill_b", sumLineAmounts(billBLines) === 60, sumLineAmounts(billBLines));
note("sum_all_three", sumLineAmounts([...billALines, ...billBLines]) === 360, sumLineAmounts([...billALines, ...billBLines]));

const confirmPayload = {
  billNumber: "GW-PURCHASE-501",
  partnerName: "华东化工",
  lines: billALines,
  stockBefore: { "RM-A001@原料仓": 100 },
  stockAfter: { "RM-A001@原料仓": 115 },
  totalAmount: 300,
};
const facts = factsFromConfirm(confirmPayload);
note("facts_all_lines", facts.lines?.length === 2, facts.lines?.length);
note("facts_total_300_not_200", facts.totalAmount === 300, facts.totalAmount);
note(
  "confirmed_shows_both_lines",
  (() => {
    const t = renderPurchaseConfirmed(facts, "plain");
    return (
      t.includes("10 L") &&
      t.includes("5 L") &&
      t.includes("行金额") &&
      t.includes("¥300") &&
      !t.includes("<font") &&
      !/MEDIA:/i.test(t) &&
      !/[A-Z]:\\/.test(t)
    );
  })(),
);

const batchData = {
  awaitingDrafts: 2,
  totalBills: 2,
  drafts: [
    {
      draftId: 201,
      businessKey: "CG-A",
      confirmPhrase: "确认采购201",
      partnerName: "华东化工",
      lines: billALines,
      totalAmount: 300,
    },
    {
      draftId: 202,
      businessKey: "CG-B",
      confirmPhrase: "确认采购202",
      partnerName: "华东化工",
      lines: billBLines,
      totalAmount: 60,
    },
  ],
};
const batchFacts = factsFromPurchaseBatch(batchData);
note("batch_2_bills_3_lines", batchFacts.billCount === 2 && batchFacts.lineCount === 3, {
  bills: batchFacts.billCount,
  lines: batchFacts.lineCount,
});
const batchText = formatPurchaseBatchReply(batchData);
note(
  "batch_reply_multi_line",
  batchText.includes("确认采购201") &&
    batchText.includes("确认采购202") &&
    batchText.includes("¥300") &&
    batchText.includes("¥60") &&
    batchText.includes("10 L") &&
    batchText.includes("5 L") &&
    batchText.includes("3 L") &&
    !batchText.includes("<font") &&
    !/MEDIA:/i.test(batchText),
  batchText.slice(0, 280),
);
// Regression: first-line-only would show ¥200 as "total" and omit 5 L / bill B
note(
  "not_first_line_only_total",
  !/^[\s\S]*采购合计：¥200\s*$/m.test(batchText) &&
    batchText.includes("本单合计：¥300") &&
    batchText.includes("本单合计：¥60"),
);

const card = buildPurchaseTextNoticeCard(
  toBusinessResult({
    status: "AWAITING_CONFIRM",
    draftId: 201,
    confirmPhrase: "确认采购201",
    lines: billALines,
    totalAmount: 300,
    partnerName: "华东化工",
    depotName: "原料仓",
    bizType: "PURCHASE",
  }),
);
note("card_text_notice", card.card_type === "text_notice" && card.emphasis_content?.title === "¥300", card.emphasis_content);
note("card_has_quote_phrase", card.quote_area?.quote_text === "确认采购201");
note("card_action_no_link", card.card_action?.type === 0);

const phraseCard = buildPurchasePhraseHintCard({
  confirmPhrase: "确认采购201",
  draftId: 201,
  status: "AWAITING_CONFIRM",
});
note("phrase_card_buttons_safe", (() => {
  try {
    assertNoPostingButtonKeys(phraseCard.button_list);
    return (
      phraseCard.card_type === "button_interaction" &&
      phraseCard.button_list.every((b) => SAFE_CARD_BUTTON_KEYS.includes(b.key))
    );
  } catch {
    return false;
  }
})());
note(
  "forbidden_post_keys_rejected",
  (() => {
    try {
      assertNoPostingButtonKeys([{ key: "confirm_purchase", text: "入库" }]);
      return false;
    } catch {
      return true;
    }
  })(),
);

const native = renderBusinessResult(
  toBusinessResult({
    billNumber: "GW-PURCHASE-501",
    status: "CONFIRMED",
    lines: billALines,
    totalAmount: 300,
    bizType: "PURCHASE",
  }),
  { markdown: true, templateCard: true, prefer: "templateCard" },
);
note("native_payloads", !!native.markdown?.msgtype && !!native.templateCard?.msgtype, {
  md: native.markdown?.msgtype,
  card: native.templateCard?.msgtype,
});
note(
  "plain_no_html_media",
  !/<font|MEDIA:|[A-Z]:\\/.test(native.text),
);

// Preserve MIX/SERVICE routing surface — purchase renderer must not eat them
note("mix_not_in_purchase_facts", factsFromConfirm({ bizType: "MIX", billNumber: "GW-MIX-1", lines: [] }).bizType === "MIX");

const matrix = capabilityMatrixSummary();
note("capability_matrix", matrix.matrix?.length >= 8 && matrix.installed?.version === "2026.7.2", {
  n: matrix.matrix?.length,
  ver: matrix.installed?.version,
});
const root = findWecomPluginRoot();
note("wecom_plugin_discovered", !!root && root.includes("wecom-openclaw-plugin"), root);

const money = fmtMoney(1600);
note("fmt_money", money === "¥1,600");

const receiptFallback = extractPurchaseLines({
  receiptText:
    "- 表面活性剂（RM-A001） 10 L → 原料仓 金额 200\n- 表面活性剂（RM-A001） 5 L → 原料仓 金额 100",
});
note("parse_all_receipt_lines", receiptFallback.length === 2 && sumLineAmounts(receiptFallback) === 300, receiptFallback.length);

const evidenceDir = join(__dirname, "..", "..", "docs", "poc", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const out = {
  ticket: "AIERP-020B",
  kind: "wecom-card-unit",
  pass: results.every((r) => r.ok),
  wecomPluginRoot: root,
  capability: matrix,
  sampleBatchText: batchText,
  sampleConfirmed: renderPurchaseConfirmed(facts, "plain"),
  safeButtonKeys: SAFE_CARD_BUTTON_KEYS,
  forbiddenPostButtonKeys: FORBIDDEN_POST_BUTTON_KEYS,
  results,
};
writeFileSync(join(evidenceDir, "aierp-020b-wecom-card-unit.json"), JSON.stringify(out, null, 2), "utf8");
writeFileSync(
  join(evidenceDir, "aierp-020b-wecom-capability-matrix.md"),
  [
    "# AIERP-020B · WeCom Bot WS capability matrix",
    "",
    `Probed installed \`${matrix.installed.package}@${matrix.installed.version}\` + \`${matrix.installed.aibotSdk.package}@${matrix.installed.aibotSdk.version}\`.`,
    `Live PC/mobile delivery: **not verified in this unit** (SDK source probe only).`,
    "",
    "| Capability | msgtype | SDK | Installed plugin | before_dispatch | Notes |",
    "|---|---|---|---|---|---|",
    ...matrix.matrix.map(
      (r) =>
        `| ${r.capability} | ${r.msgtype}${r.card_type ? `/${r.card_type}` : ""} | ${r.sdkSupport} | ${r.installedPluginSupport} | ${r.beforeDispatchText} | ${r.notes} |`,
    ),
    "",
    "## Button policy",
    "",
    `- Safe keys: ${SAFE_CARD_BUTTON_KEYS.join(", ")}`,
    `- Forbidden posting keys (never emit): ${FORBIDDEN_POST_BUTTON_KEYS.join(", ")}`,
    `- jump_list type=3 with confirm phrase is **banned** (would auto-send confirm text).`,
    "",
    "## Multi-line purchase",
    "",
    "- `factsFromConfirm` / `extractPurchaseLines` keep **all** lines.",
    "- Totals = sum(line.allPrice); never first-line-only.",
    "- PURCHASE / MIX / SERVICE confirm routes unchanged (trusted phrase → before_dispatch).",
    "",
  ].join("\n"),
  "utf8",
);

console.log(out.pass ? "ALL_PASS" : "HAS_FAIL");
process.exit(out.pass ? 0 : 1);
