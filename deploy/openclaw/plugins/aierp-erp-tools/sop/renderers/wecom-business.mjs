/**
 * AIERP-020A / 015C: WeCom business reply renderer.
 * before_dispatch text path does NOT reliably render <font> / markdown colors —
 * use plain Chinese hierarchy. Never emit MEDIA paths, JSON dumps, or 6-decimal noise.
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

/**
 * @param {"markdown"|"plain"} mode  — channel before_dispatch: always prefer plain
 */
export function renderPurchaseConfirmed(facts, mode = "plain") {
  const bill = facts.billNumber || facts.realBillNumber || "-";
  const material = facts.materialName || facts.material || "物料";
  const bar = facts.barCode ? `（${facts.barCode}）` : "";
  const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
  const depot = facts.depotName || "仓库";
  const partner = facts.partnerName || facts.organName || "供应商";
  const amount = fmtMoney(facts.amount ?? facts.allPrice ?? facts.totalAmount);
  const before = facts.stockBefore != null ? fmtQty(facts.stockBefore, facts.unit || "L") : null;
  const after = facts.stockAfter != null ? fmtQty(facts.stockAfter, facts.unit || "L") : null;

  // Never emit <font> — WeCom before_dispatch text shows tags literally.
  const lines = [
    `✅ 采购入库完成`,
    `${bill} · 已审核`,
    "",
    `${material}${bar}  ${qty}`,
    `${depot} · ${partner}`,
    `采购金额：${amount}`,
  ];
  if (before && after) lines.push(`入库前 ${before} → 当前 ${after}`);
  lines.push(`回执 PDF 已随消息发送（非发票）`);
  void mode;
  return lines.join("\n");
}

export function renderReceiptReady(facts, mode = "plain") {
  const bill = facts.billNumber || "-";
  const material = facts.materialName || "采购物料";
  const qty = fmtQty(facts.qty ?? facts.operNumber, facts.unit || "L");
  const amount = fmtMoney(facts.amount ?? facts.allPrice);
  void mode;
  return [
    `📄 采购入库业务回执`,
    `${bill} · 已审核`,
    `${material} · ${qty}`,
    `采购金额 ${amount}`,
    `回执 PDF 见上方文件消息（非发票）。`,
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
 */
export function factsFromReceiptApi(data) {
  const bill = data?.billNumber || data?.realBillNumber;
  let materialName;
  let barCode;
  let qty;
  let unit;
  let amount;
  let depotName;
  let partnerName = data?.partnerName || data?.organName;

  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const first = lines[0] || {};
  materialName = first.materialName || first.material_name;
  barCode = first.barCode || first.bar_code;
  qty = first.qty || first.oper_number || first.operNumber;
  unit = first.unit || first.material_unit || "L";
  amount = first.allPrice || first.all_price || data?.totalAmount;
  depotName = first.depotName || first.depot_name;

  try {
    const summary = String(data?.userSummaryZh || "");
    const m = summary.match(/，([^，]+?)(\d+(?:\.\d+)?)\s*([A-Za-z\u4e00-\u9fff]+)?\s*¥?(\d+(?:\.\d+)?)/);
    if (m) {
      materialName = materialName || m[1].trim();
      qty = qty || m[2];
      unit = unit || m[3] || "L";
      amount = amount || m[4];
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

  const keyParts = firstStockKeyParts(data?.stockAfter || data?.stockBefore);
  return {
    billNumber: bill,
    materialName: materialName || "采购物料",
    barCode: barCode || keyParts.barCode,
    qty,
    unit: unit || "L",
    amount,
    depotName: depotName || keyParts.depotName,
    partnerName,
  };
}

export function factsFromConfirm(data) {
  const bill = data?.billNumber;
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const first = lines[0] || {};
  let stockBefore = firstStockValue(data?.stockBefore);
  let stockAfter = firstStockValue(data?.stockAfter);
  const keyParts = firstStockKeyParts(data?.stockAfter || data?.stockBefore);

  // Parse receiptText fallback: "- 表面活性剂（RM-A001） 80 L → 原料仓 金额 1600"
  let materialName = first.materialName || first.material_name;
  let barCode = first.barCode || first.bar_code || keyParts.barCode;
  let qty = first.qty || first.oper_number || first.operNumber;
  let unit = first.unit || first.material_unit || "L";
  let amount = first.allPrice || first.all_price || data?.totalAmount;
  let depotName = first.depotName || first.depot_name || keyParts.depotName;
  let partnerName = data?.partnerName || data?.organName;

  const hint = String(data?.receiptText || data?.hint || "");
  if (hint) {
    const partnerM = hint.match(/供应商：([^\n]+)/);
    if (!partnerName && partnerM) partnerName = partnerM[1].trim();
    const lineM = hint.match(/-\s*([^\n（(]+)[（(]([^）)]+)[）)]\s+(\d+(?:\.\d+)?)\s*(\S+)\s*→\s*(\S+)(?:\s+金额\s+(\d+(?:\.\d+)?))?/);
    if (lineM) {
      materialName = materialName || lineM[1].trim();
      barCode = barCode || lineM[2].trim();
      qty = qty || lineM[3];
      unit = unit || lineM[4];
      depotName = depotName || lineM[5];
      amount = amount || lineM[6];
    }
    const stockM = hint.match(/库存变化[：:][^\n]*?(\d+(?:\.\d+)?)\s*→\s*(\d+(?:\.\d+)?)/);
    if (stockM) {
      stockBefore = stockBefore ?? stockM[1];
      stockAfter = stockAfter ?? stockM[2];
    }
  }

  return {
    billNumber: bill,
    materialName: materialName || "物料",
    barCode,
    qty,
    unit: unit || "L",
    amount,
    depotName: depotName || "仓库",
    partnerName: partnerName || "供应商",
    stockBefore,
    stockAfter,
  };
}
