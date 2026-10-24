/**
 * AIERP-020A / 015C / 020B: WeCom business reply renderer.
 * before_dispatch text path does NOT reliably render <font> / markdown colors —
 * use plain Chinese hierarchy. Never emit MEDIA paths, JSON dumps, or 6-decimal noise.
 *
 * AIERP-020B: purchase facts use ALL lines (name/qty/unitPrice/lineAmount) + bill totals.
 * Never first-line-only; never treat first line amount as whole-bill total.
 */

export function fmtQty(v, unit = "") {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  const s = Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(2).replace(/\.?0+$/, "");
  return unit ? `${s} ${unit}` : s;
}

export function fmtMoney(v) {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function stripJsonish(s) {
  return String(s || "")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstStockValue(obj) {
  if (obj == null) return null;
  if (typeof obj !== "object") return obj;
  const vals = Object.values(obj);
  return vals.length ? vals[0] : null;
}

function firstStockKeyParts(obj) {
  if (!obj || typeof obj !== "object") return {};
  const key = Object.keys(obj)[0];
  if (!key) return {};
  const at = String(key).indexOf("@");
  if (at > 0) {
    return { barCode: key.slice(0, at), depotName: key.slice(at + 1) };
  }
  return { barCode: key };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize one ERP line into display fields.
 * Line amount prefers allPrice; else unitPrice * qty (2dp).
 */
export function normalizePurchaseLine(raw = {}) {
  const materialName = raw.materialName || raw.material_name || raw.name || raw.material || null;
  const barCode = raw.barCode || raw.bar_code || raw.barcode || null;
  const qty = numOrNull(raw.qty ?? raw.oper_number ?? raw.operNumber);
  const unit = raw.unit || raw.material_unit || raw.materialUnit || "L";
  const unitPrice = numOrNull(raw.unitPrice ?? raw.unit_price ?? raw.price);
  let allPrice = numOrNull(raw.allPrice ?? raw.all_price ?? raw.lineAmount ?? raw.amount);
  if (allPrice == null && unitPrice != null && qty != null) {
    allPrice = Math.round(unitPrice * qty * 100) / 100;
  }
  const depotName = raw.depotName || raw.depot_name || null;
  return {
    materialName: materialName || "物料",
    barCode,
    qty,
    unit,
    unitPrice,
    allPrice,
    depotName,
  };
}

/** Sum line amounts; never invent from first line alone. */
export function sumLineAmounts(lines = []) {
  let total = 0;
  let any = false;
  for (const ln of lines) {
    const n = numOrNull(ln?.allPrice);
    if (n != null) {
      total += n;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

/**
 * Parse all "- 物料（编码） qty unit → 仓 金额 n" rows from receiptText/hint.
 */
export function parseReceiptTextLines(hint) {
  const text = String(hint || "");
  const out = [];
  const re =
    /-\s*([^\n（(]+)[（(]([^）)]+)[）)]\s+(\d+(?:\.\d+)?)\s*(\S+)\s*→\s*(\S+)(?:\s+金额\s+(\d+(?:\.\d+)?))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const qty = numOrNull(m[3]);
    const allPrice = numOrNull(m[6]);
    out.push({
      materialName: m[1].trim(),
      barCode: m[2].trim(),
      qty,
      unit: m[4],
      unitPrice: qty && allPrice != null ? Math.round((allPrice / qty) * 100) / 100 : null,
      allPrice,
      depotName: m[5],
    });
  }
  return out;
}

/**
 * Extract full purchase line list from confirm / draft / receipt payloads.
 * Prefers structured `lines`; falls back to parsing ALL receiptText rows.
 */
export function extractPurchaseLines(data = {}) {
  const structured = Array.isArray(data.lines) ? data.lines.map(normalizePurchaseLine) : [];
  if (structured.length) return structured;

  const fromSummary = Array.isArray(data.summary?.lines)
    ? data.summary.lines.map(normalizePurchaseLine)
    : [];
  if (fromSummary.length) return fromSummary;

  const parsed = parseReceiptTextLines(data.receiptText || data.hint || data.userSummaryZh);
  if (parsed.length) return parsed.map(normalizePurchaseLine);

  // Legacy single-summary shape (one logical line)
  const s = data.summary || {};
  if (s.materialName || s.barCode || s.qty != null) {
    return [normalizePurchaseLine(s)];
  }
  return [];
}

function formatLinePlain(ln) {
  const bar = ln.barCode ? `（${ln.barCode}）` : "";
  const qty = fmtQty(ln.qty, ln.unit || "L");
  const price =
    ln.unitPrice != null ? `  单价 ${fmtMoney(ln.unitPrice)}` : "";
  const amt = ln.allPrice != null ? `  行金额 ${fmtMoney(ln.allPrice)}` : "";
  return `${ln.materialName}${bar}  ${qty}${price}${amt}`;
}

/**
 * @param {"markdown"|"plain"} mode  — channel before_dispatch: always prefer plain
 */
/** AIERP-016S: awaiting SERVICE draft (stock unchanged). */
export function renderServiceDraftReady(facts, mode = "plain") {
  const material = facts.materialName || facts.material || "物料";
  const bar = facts.barCode ? `（${facts.barCode}）` : "";
  const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
  const depot = facts.depotName || "成品仓";
  const partner = facts.partnerName || facts.organName || "客户";
  const project = facts.serviceProject ? `服务项目：${facts.serviceProject}` : null;
  const phrase = facts.confirmPhrase || (facts.draftId ? `确认耗料${facts.draftId}` : "确认耗料{草稿号}");
  const stock =
    facts.currentStock != null
      ? `当前库存 ${fmtQty(facts.currentStock, facts.unit || "L")}（确认前不变）`
      : "确认前库存不变";
  void mode;
  return [
    `📝 服务耗料单待确认`,
    facts.draftId != null ? `#${facts.draftId} · 其它出库（非销售）` : `其它出库（非销售）`,
    "",
    `${material}${bar}  ${qty}`,
    `${depot} · ${partner}`,
    project,
    stock,
    `回复「${phrase}」完成出库`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** AIERP-016S: SERVICE confirmed — text receipt titled 服务耗料出库回执. */
export function renderServiceConfirmed(facts, mode = "plain") {
  const bill = facts.billNumber || facts.realBillNumber || "-";
  const material = facts.materialName || facts.material || "物料";
  const bar = facts.barCode ? `（${facts.barCode}）` : "";
  const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
  const depot = facts.depotName || "成品仓";
  const partner = facts.partnerName || facts.organName || "客户";
  const project = facts.serviceProject ? `服务项目：${facts.serviceProject}` : null;
  const before = facts.stockBefore != null ? fmtQty(facts.stockBefore, facts.unit || "L") : null;
  const after = facts.stockAfter != null ? fmtQty(facts.stockAfter, facts.unit || "L") : null;
  void mode;
  const lines = [
    `✅ 服务耗料出库完成`,
    `${bill} · 已审核 · 其它出库（非销售）`,
    "",
    `${material}${bar}  ${qty}`,
    `${depot} · ${partner}`,
  ];
  if (project) lines.push(project);
  if (before && after) lines.push(`出库前 ${before} → 当前 ${after}`);
  if (facts.pdfStatus === "PDF_GENERATED") {
    lines.push(`回执 PDF 已随消息发送（非发票）`);
  } else {
    lines.push(`《服务耗料出库回执》见文字（专用 PDF 模板尚未独立交付）`);
  }
  return lines.join("\n");
}

/** Multi-line purchase confirmed (all lines + accurate bill total). */
export function renderPurchaseConfirmed(facts, mode = "plain") {
  const bill = facts.billNumber || facts.realBillNumber || "-";
  const lines = Array.isArray(facts.lines) && facts.lines.length
    ? facts.lines.map(normalizePurchaseLine)
    : [];
  const depot =
    facts.depotName ||
    lines.find((l) => l.depotName)?.depotName ||
    "仓库";
  const partner = facts.partnerName || facts.organName || "供应商";
  const total =
    numOrNull(facts.totalAmount ?? facts.amount ?? facts.allPrice) ??
    sumLineAmounts(lines);
  const before = facts.stockBefore != null ? fmtQty(facts.stockBefore, facts.unit || "L") : null;
  const after = facts.stockAfter != null ? fmtQty(facts.stockAfter, facts.unit || "L") : null;

  const out = [`✅ 采购入库完成`, `${bill} · 已审核`, ""];
  if (lines.length) {
    for (const ln of lines) out.push(formatLinePlain(ln));
  } else {
    const material = facts.materialName || facts.material || "物料";
    const bar = facts.barCode ? `（${facts.barCode}）` : "";
    const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
    out.push(`${material}${bar}  ${qty}`);
  }
  out.push(`${depot} · ${partner}`);
  if (total != null) out.push(`采购合计：${fmtMoney(total)}`);
  if (before && after) out.push(`入库前 ${before} → 当前 ${after}`);
  out.push(`回执 PDF 已随消息发送（非发票）`);
  void mode;
  return out.join("\n");
}

/** Awaiting confirm — multi-line draft preview; phrase for copy only. */
export function renderPurchaseDraftReady(facts, mode = "plain") {
  const draftId = facts.draftId;
  const phrase =
    facts.confirmPhrase || (draftId != null ? `确认采购${draftId}` : "确认采购{草稿号}");
  const lines = Array.isArray(facts.lines) && facts.lines.length
    ? facts.lines.map(normalizePurchaseLine)
    : [];
  const depot =
    facts.depotName || lines.find((l) => l.depotName)?.depotName || "仓库";
  const partner = facts.partnerName || facts.organName || "供应商";
  const total =
    numOrNull(facts.totalAmount ?? facts.amount ?? facts.allPrice) ??
    sumLineAmounts(lines);
  const biz = facts.businessKey ? ` · ${facts.businessKey}` : "";

  const out = [
    `📝 采购单待确认`,
    draftId != null ? `#${draftId}${biz}` : biz ? biz.slice(3) : "待确认",
    "",
  ];
  if (lines.length) {
    for (const ln of lines) out.push(formatLinePlain(ln));
  } else {
    const material = facts.materialName || "物料";
    const bar = facts.barCode ? `（${facts.barCode}）` : "";
    out.push(`${material}${bar}  ${fmtQty(facts.qty, facts.unit || "L")}`);
  }
  out.push(`${partner} · ${depot}`);
  if (total != null) out.push(`采购合计：${fmtMoney(total)}`);
  out.push(`回复「${phrase}」完成入库`);
  void mode;
  return out.join("\n");
}

/**
 * Batch: 2+ bills / N lines — each bill with its lines and own total.
 * Never sum different bills into one fake first-line total.
 */
export function renderPurchaseBatchDraftReady(facts, mode = "plain") {
  const bills = Array.isArray(facts.bills) ? facts.bills : [];
  if (!bills.length) {
    return renderPurchaseDraftReady(facts, mode);
  }
  const header = [
    `📝 采购单待确认（${bills.length} 张）`,
    facts.hintLine || "库存未变化。请逐张回复确认指令。",
    "",
  ];
  const blocks = [];
  for (const b of bills) {
    const lines = Array.isArray(b.lines) ? b.lines.map(normalizePurchaseLine) : [];
    const total =
      numOrNull(b.totalAmount ?? b.amount) ?? sumLineAmounts(lines);
    const phrase =
      b.confirmPhrase || (b.draftId != null ? `确认采购${b.draftId}` : null);
    const part = [
      b.draftId != null
        ? `#${b.draftId}${b.businessKey ? ` · ${b.businessKey}` : ""}`
        : b.businessKey || "采购单",
    ];
    for (const ln of lines) part.push(formatLinePlain(ln));
    if (total != null) part.push(`本单合计：${fmtMoney(total)}`);
    if (phrase) part.push(`回复「${phrase}」完成入库`);
    blocks.push(part.join("\n"));
  }
  void mode;
  return sanitizeForChannel([...header, blocks.join("\n\n")].join("\n"), { markdown: false });
}

export function renderReceiptReady(facts, mode = "plain") {
  const bill = facts.billNumber || "-";
  const lines = Array.isArray(facts.lines) && facts.lines.length
    ? facts.lines.map(normalizePurchaseLine)
    : [];
  const total =
    numOrNull(facts.totalAmount ?? facts.amount ?? facts.allPrice) ??
    sumLineAmounts(lines);
  void mode;
  const body = [
    `📄 采购入库业务回执`,
    `${bill} · 已审核`,
  ];
  if (lines.length) {
    for (const ln of lines.slice(0, 3)) {
      body.push(`${ln.materialName} · ${fmtQty(ln.qty, ln.unit || "L")}`);
    }
    if (lines.length > 3) body.push(`…共 ${lines.length} 行`);
  } else {
    body.push(`${facts.materialName || "采购物料"} · ${fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L")}`);
  }
  if (total != null) body.push(`采购合计 ${fmtMoney(total)}`);
  body.push(`回执 PDF 见上方文件消息（非发票）。`);
  return body.join("\n");
}

export function renderReceiptSendFailed(facts) {
  const bill = facts.billNumber || "该采购单";
  return [
    `采购单 ${bill} 已审核，入库不受影响。`,
    `PDF 暂未发送成功，请回复「重发回执」，或登录 ERP 下载。`,
  ].join("\n");
}

export function renderReceiptAmbiguous(candidates) {
  const lines = ["找到多张可访问的已审核回执，请回复其中一张单号："];
  for (const c of candidates || []) {
    lines.push(`- ${c.billNumber}${c.summaryLine ? ` · ${c.summaryLine}` : ""}`);
  }
  return lines.join("\n");
}

export function renderReceiptMissing() {
  return "暂未找到可访问的已审核采购入库回执。";
}

/** Always strip font tags / MEDIA paths for WeCom text replies. */
export function sanitizeForChannel(text, { markdown = false } = {}) {
  let t = String(text || "");
  t = t.replace(/<\/?font[^>]*>/gi, "");
  if (!markdown) {
    t = t.replace(/\*\*/g, "");
  }
  t = t
    .split(/\r?\n/)
    .filter((line) => !/^\s*MEDIA:\s*/i.test(line))
    .filter((line) => !/^[A-Z]:\\/i.test(line.trim()))
    .join("\n");
  return stripJsonish(t) ? t : t;
}

/**
 * Pull display fields from receipt/file API payload or confirm result.
 * AIERP-020B: keeps full `lines` + accurate `totalAmount`.
 */
export function factsFromReceiptApi(data) {
  const bill = data?.billNumber || data?.realBillNumber;
  const lines = extractPurchaseLines(data || {});
  const partnerName = data?.partnerName || data?.organName;
  const total =
    numOrNull(data?.totalAmount) ??
    sumLineAmounts(lines);
  const first = lines[0] || {};
  const keyParts = firstStockKeyParts(data?.stockAfter || data?.stockBefore);

  return {
    billNumber: bill,
    materialName: first.materialName || "采购物料",
    barCode: first.barCode || keyParts.barCode,
    qty: first.qty,
    unit: first.unit || "L",
    unitPrice: first.unitPrice,
    amount: total,
    totalAmount: total,
    allPrice: total,
    depotName: first.depotName || keyParts.depotName,
    partnerName,
    lines,
  };
}

export function factsFromConfirm(data) {
  const bill = data?.billNumber;
  const lines = extractPurchaseLines(data || {});
  let stockBefore = firstStockValue(data?.stockBefore);
  let stockAfter = firstStockValue(data?.stockAfter);
  const keyParts = firstStockKeyParts(data?.stockAfter || data?.stockBefore);
  const first = lines[0] || {};

  let partnerName = data?.partnerName || data?.organName;
  const hint = String(data?.receiptText || data?.hint || "");
  if (hint) {
    const partnerM = hint.match(/供应商：([^\n]+)/);
    if (!partnerName && partnerM) partnerName = partnerM[1].trim();
    const stockM = hint.match(/库存变化[：:][^\n]*?(\d+(?:\.\d+)?)\s*→\s*(\d+(?:\.\d+)?)/);
    if (stockM) {
      stockBefore = stockBefore ?? stockM[1];
      stockAfter = stockAfter ?? stockM[2];
    }
  }

  const total =
    numOrNull(data?.totalAmount ?? data?.amount) ??
    sumLineAmounts(lines) ??
    numOrNull(first.allPrice);

  return {
    billNumber: bill,
    materialName: first.materialName || "物料",
    barCode: first.barCode || keyParts.barCode,
    qty: first.qty,
    unit: first.unit || "L",
    unitPrice: first.unitPrice,
    amount: total,
    totalAmount: total,
    allPrice: total,
    depotName: first.depotName || keyParts.depotName || "仓库",
    partnerName: partnerName || "供应商",
    stockBefore,
    stockAfter,
    lines,
    bizType: data?.bizType,
    draftId: data?.draftId,
    confirmPhrase: data?.confirmPhrase,
    businessKey: data?.businessKey,
  };
}

/**
 * Build batch facts from Java purchase-batch-prepare / preview drafts.
 * Expects drafts[].lines or normalized lines; computes per-bill totals.
 */
export function factsFromPurchaseBatch(data = {}) {
  const drafts = Array.isArray(data.drafts) ? data.drafts : [];
  const bills = drafts.map((d) => {
    const lines = extractPurchaseLines(d);
    const total =
      numOrNull(d.totalAmount ?? d.amount) ?? sumLineAmounts(lines);
    return {
      draftId: d.draftId ?? d.id,
      businessKey: d.businessKey,
      confirmPhrase: d.confirmPhrase || (d.draftId != null ? `确认采购${d.draftId}` : null),
      partnerName: d.partnerName || d.organName || data.partnerName,
      depotName: d.depotName || lines[0]?.depotName,
      lines,
      totalAmount: total,
      amount: total,
    };
  });
  const lineCount = bills.reduce((n, b) => n + (b.lines?.length || 0), 0);
  return {
    bills,
    billCount: bills.length,
    lineCount,
    awaitingDrafts: data.awaitingDrafts ?? bills.length,
    totalBills: data.totalBills ?? bills.length,
    hintLine:
      data.userSummaryZh && !String(data.userSummaryZh).includes("{")
        ? null
        : `共 ${bills.length} 张 / ${lineCount} 行；库存未变化。`,
    userSummaryZh: data.userSummaryZh,
  };
}

export default {
  fmtQty,
  fmtMoney,
  normalizePurchaseLine,
  sumLineAmounts,
  parseReceiptTextLines,
  extractPurchaseLines,
  renderServiceDraftReady,
  renderServiceConfirmed,
  renderPurchaseConfirmed,
  renderPurchaseDraftReady,
  renderPurchaseBatchDraftReady,
  renderReceiptReady,
  renderReceiptSendFailed,
  renderReceiptAmbiguous,
  renderReceiptMissing,
  sanitizeForChannel,
  factsFromReceiptApi,
  factsFromConfirm,
  factsFromPurchaseBatch,
};
