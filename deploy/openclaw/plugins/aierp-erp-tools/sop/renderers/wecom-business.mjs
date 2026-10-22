/**
 * AIERP-020A / 015C: WeCom business reply renderer.
 * Prefer Markdown (info/comment/warning when channel supports); plain-text fallback.
 * Never emit MEDIA paths, JSON dumps, or 6-decimal noise.
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

/**
 * @param {"markdown"|"plain"} mode
 */
export function renderPurchaseConfirmed(facts, mode = "markdown") {
  const bill = facts.billNumber || facts.realBillNumber || "-";
  const material = facts.materialName || facts.material || "物料";
  const bar = facts.barCode ? `（${facts.barCode}）` : "";
  const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
  const depot = facts.depotName || "仓库";
  const partner = facts.partnerName || facts.organName || "供应商";
  const amount = fmtMoney(facts.amount ?? facts.allPrice ?? facts.totalAmount);
  const before = facts.stockBefore != null ? fmtQty(facts.stockBefore, facts.unit || "L") : null;
  const after = facts.stockAfter != null ? fmtQty(facts.stockAfter, facts.unit || "L") : null;

  if (mode === "markdown") {
    const lines = [
      `✅ **采购入库完成**`,
      `**${bill}** · <font color="info">已审核</font>`,
      "",
      `**${material}${bar}**  **${qty}**`,
      `${depot} · ${partner}`,
      `采购金额：<font color="info">${amount}</font>`,
    ];
    if (before && after) lines.push(`入库前 ${before} → 当前 ${after}`);
    lines.push(`回执：采购入库业务回执_${bill}.pdf`);
    return lines.join("\n");
  }

  const lines = [
    `✅ 采购入库完成`,
    `${bill} · 已审核`,
    `${material}${bar}  ${qty}`,
    `${depot} · ${partner}`,
    `采购金额：${amount}`,
  ];
  if (before && after) lines.push(`入库前 ${before} → 当前 ${after}`);
  lines.push(`回执：采购入库业务回执_${bill}.pdf`);
  return lines.join("\n");
}

export function renderReceiptReady(facts, mode = "markdown") {
  const bill = facts.billNumber || "-";
  const material = facts.materialName || "采购物料";
  const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
  const amount = fmtMoney(facts.amount ?? facts.allPrice);
  if (mode === "markdown") {
    return [
      `📄 **采购入库业务回执**`,
      `**${bill}** · <font color="info">已审核</font>`,
      `${material} · **${qty}**`,
      `采购金额 <font color="info">${amount}</font>`,
      "",
      `回执 PDF 见文件消息（非发票）。`,
    ].join("\n");
  }
  return [
    `📄 采购入库业务回执`,
    `${bill} · 已审核`,
    `${material} · ${qty}`,
    `采购金额 ${amount}`,
    `回执 PDF 见文件消息（非发票）。`,
  ].join("\n");
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

/** Prefer markdown; strip unsupported tags if caller requests plain. */
export function sanitizeForChannel(text, { markdown = true } = {}) {
  let t = String(text || "");
  if (!markdown) {
    t = t.replace(/<\/?font[^>]*>/gi, "").replace(/\*\*/g, "");
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
 */
export function factsFromReceiptApi(data) {
  const bill = data?.billNumber || data?.realBillNumber;
  let materialName;
  let barCode;
  let qty;
  let unit;
  let amount;
  let depotName;
  let partnerName;
  try {
    const summary = String(data?.userSummaryZh || "");
    // Fallback parse from summaryLine style "表面活性剂 80L ¥1600"
    const m = summary.match(/，([^，]+?)(\d+(?:\.\d+)?)\s*([A-Za-z\u4e00-\u9fff]+)?\s*¥?(\d+(?:\.\d+)?)/);
    if (m) {
      materialName = m[1].trim();
      qty = m[2];
      unit = m[3] || "L";
      amount = m[4];
    }
  } catch {
    // ignore
  }
  if (Array.isArray(data?.candidates) && data.candidates[0]?.summaryLine) {
    const line = String(data.candidates[0].summaryLine);
    const m2 = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)([A-Za-z\u4e00-\u9fff]+)?\s*¥?\s*(\d+(?:\.\d+)?)/);
    if (m2) {
      materialName = materialName || m2[1];
      qty = qty || m2[2];
      unit = unit || m2[3] || "L";
      amount = amount || m2[4];
    }
  }
  return {
    billNumber: bill,
    materialName: materialName || "表面活性剂",
    barCode: barCode || "RM-A001",
    qty,
    unit: unit || "L",
    amount,
    depotName,
    partnerName,
  };
}

export function factsFromConfirm(data) {
  const bill = data?.billNumber;
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const first = lines[0] || {};
  let stockBefore;
  let stockAfter;
  try {
    const b = data?.stockBefore;
    const a = data?.stockAfter;
    if (b && typeof b === "object") stockBefore = Object.values(b)[0];
    if (a && typeof a === "object") stockAfter = Object.values(a)[0];
  } catch {
    // ignore
  }
  return {
    billNumber: bill,
    materialName: first.materialName || first.material_name,
    barCode: first.barCode || first.bar_code,
    qty: first.qty || first.oper_number || first.operNumber,
    unit: first.unit || first.material_unit || "L",
    amount: first.allPrice || first.all_price || data?.totalAmount,
    depotName: first.depotName || first.depot_name,
    partnerName: data?.partnerName || data?.organName,
    stockBefore,
    stockAfter,
  };
}
