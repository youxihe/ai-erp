/**
 * AIERP-020C: 真实 ERP 查询 → 服务端密封 datasetRef → 020C 渲染 PNG → 企业微信图片发送。
 *
 * 安全约束（与 020C 契约一致）：
 * - 数值只来自可信适配器对 ERP 的授权查询，模型/用户文本不得提供任何金额或数量
 * - authCtx 由服务端 binding/status 解析，禁止信任模型传入的 tenantId/actorUserId
 * - 媒体落在 identity-scoped 目录；用户可见文本一律 stripPaths，不出现 F:\... 或 MEDIA:
 * - 没有可比较分类时明确说明并降级为指标卡/表格，绝不编造柱状图数据
 * - 只读：不触碰采购/配制/耗料过账与 PDF 回执逻辑
 */
import { join } from "node:path";
import { sealAndRender, stripPaths } from "./render-lib/index.mjs";
import { sendWecomLocalFile, sendWecomTemplateCard, receiptMediaRoots } from "./wecom-outbound.mjs";

const CHANNEL_ID = "wecom";

export const RENDER_ZH = Object.freeze({
  "table.basic": "表格",
  "bar.compare": "柱状图",
  "line.trend": "折线图",
  "pie.share": "饼图",
  "delta.before_after": "变化图",
  "kpi.tiles": "指标卡",
});

// ---- 意图识别 ----------------------------------------------------------
const VISUAL =
  /(表格|柱状图|柱形图|柱图|柱状|饼图|饼状图|占比图|折线图|趋势图|指标卡|数据卡|图表|统计图|画成图|画个图|做个图|做成图)/;
const SUBJECT_STOCK = /(库存|原料仓|成品仓|半成品仓|仓库|存货|余料|物料|现存量|结存)/;
const SUBJECT_PURCHASE = /(采购|进货|入库单|供应商)/;
const ACTION =
  /(展示|显示|展现|发我|发给我|发一下|给我|画|生成|做成|来一张|看一下|看看|统计|汇总|列出|列个|整理成)/;
// 既有的成熟业务入口，图表 SOP 不得抢话
const EXCLUDE =
  /(模板|回执|PDF|pdf|确认\s*采购|确认\s*配制|确认\s*耗料|确认\s*服务|取消文件|取消|绑定|解绑|解\s*绑)/;

export function isChartRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (EXCLUDE.test(t)) return false;
  if (!VISUAL.test(t)) return false;
  if (!ACTION.test(t)) return false;
  return SUBJECT_STOCK.test(t) || SUBJECT_PURCHASE.test(t);
}

const RENDER_PATTERNS = [
  [/柱状图|柱形图|柱图|柱状/, "bar.compare"],
  [/饼图|饼状图|占比/, "pie.share"],
  [/折线图|趋势图|趋势/, "line.trend"],
  [/指标卡|数据卡|KPI|看板/i, "kpi.tiles"],
  [/变化图|前后对比|对比图/, "delta.before_after"],
  [/表格|表/, "table.basic"],
];

export function detectRenderId(text) {
  const t = String(text || "");
  for (const [re, id] of RENDER_PATTERNS) {
    if (re.test(t)) return id;
  }
  return null;
}

export function detectDepot(text) {
  const m = String(text || "").match(/[\u4e00-\u9fff]{1,8}仓/g);
  if (!m || !m.length) return undefined;
  const hit = m.find((s) => s.endsWith("仓"));
  if (!hit) return undefined;
  // 去掉前导动词/助词，避免「把原料仓」被整体当成仓库名
  const clean = hit.replace(/^[把用在的和我与有各从给看查请按以对将让再又还]+/, "");
  return clean.endsWith("仓") && clean.length > 1 ? clean : undefined;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return {
    fromDate: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01`,
    toDate: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
    label: `${first.getFullYear()}年${pad(first.getMonth() + 1)}月`,
  };
}

export function detectChartPlan(text, explicit = {}) {
  const t = String(text || "");
  const subject = SUBJECT_PURCHASE.test(t) ? "purchase" : SUBJECT_STOCK.test(t) ? "stock" : explicit.subject || "stock";
  const renderId =
    explicit.renderId ||
    detectRenderId(t) ||
    (subject === "stock" ? "table.basic" : "bar.compare");
  const depotName = explicit.depotName || detectDepot(t);
  const query = explicit.query;

  let range = null;
  if (explicit.fromDate && explicit.toDate) {
    range = { fromDate: explicit.fromDate, toDate: explicit.toDate, label: `${explicit.fromDate}~${explicit.toDate}` };
  } else if (explicit.days) {
    const d = Math.min(Math.max(Number(explicit.days) || 30, 1), 90);
    range = { days: d, label: `近${d}天` };
  } else if (/本月/.test(t)) {
    range = monthRange(0);
  } else if (/上\s*月/.test(t)) {
    range = monthRange(-1);
  } else {
    const dm = t.match(/近\s*(\d+)\s*天/);
    range = dm ? { days: Math.min(Number(dm[1]) || 30, 90), label: `近${dm[1]}天` } : monthRange(0);
  }
  return { subject, renderId, depotName, query, range };
}

// ---- 工具 --------------------------------------------------------------
function n0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function s0(v, max = 40) {
  return String(v ?? "").slice(0, max);
}

function stateDir() {
  return (
    process.env.OPENCLAW_STATE_DIR ||
    join(process.env.LOCALAPPDATA || "C:/Users/Public", "aierp-openclaw", "state")
  );
}

function rangeBody(range) {
  if (!range) return {};
  if (range.days) return { days: range.days };
  return { fromDate: range.fromDate, toDate: range.toDate };
}

// ---- 库存 --------------------------------------------------------------
function buildStockPlan(data, plan) {
  const raw = Array.isArray(data?.rows) ? data.rows : [];
  let rows = raw
    .map((r) => ({
      name: s0(r.materialName ?? r.name ?? r.mname ?? r.material, 60),
      barCode: s0(r.barCode ?? r.barcode ?? r.code, 40),
      depotName: s0(r.depotName ?? "", 40),
      currentStock: n0(r.currentStock ?? r.currentNumber ?? r.currentQuantity ?? r.qty),
      unit: s0(r.unit ?? r.materialUnit, 10),
    }))
    .filter((r) => r.name || r.barCode);

  // 后端 stockList 会返回该用户全部授权仓库；按用户指定的仓库收敛（仍在授权范围内）
  // 指定仓库但一条都不匹配时不回退到全部仓库，避免越权/误导展示
  if (plan.depotName) {
    const only = rows.filter((r) => r.depotName === plan.depotName);
    if (!only.length) return { empty: true };
    rows = only;
  }
  if (!rows.length) return { empty: true };

  const scope = plan.depotName || "当前权限范围";
  const asOf = s0(data?.asOf, 16);
  const table = () => ({
    renderId: "table.basic",
    dataset: {
      title: `${scope}库存`,
      timeRange: asOf,
      columns: [
        { key: "name", label: "物料名称" },
        { key: "barCode", label: "物料编码" },
        { key: "depotName", label: "仓库" },
        { key: "currentStock", label: "数量", type: "qty" },
        { key: "unit", label: "单位" },
      ],
      rows,
    },
    totalRows: rows.length,
  });

  const wanted = plan.renderId;
  if (wanted === "table.basic") return table();
  if (wanted === "kpi.tiles") {
    const total = rows.reduce((a, r) => a + r.currentStock, 0);
    return {
      renderId: "kpi.tiles",
      dataset: {
        title: `${scope}库存摘要`,
        timeRange: asOf,
        kpis: [
          { label: "物料品种数", value: rows.length, unit: "种" },
          { label: "库存合计", value: Number(total.toFixed(2)), unit: rows[0]?.unit || "" },
        ].filter((k) => Number.isFinite(k.value)),
      },
      totalRows: rows.length,
    };
  }

  // 图形：按物料对比（同一仓库内），要求单位统一且 ≥2 项
  const units = new Set(rows.map((r) => r.unit).filter(Boolean));
  const mixed = units.size > 1;
  const categories = rows
    .filter((r) => r.currentStock !== 0 || rows.length <= 12)
    .slice(0, 12)
    .map((r) => ({ label: r.name.slice(0, 12), value: r.currentStock, unit: r.unit }));

  if (mixed || categories.length < 2) {
    return {
      ...table(),
      degradeNote: mixed
        ? "库存物料单位不统一，无法可靠汇总成单一口径的图形，已改用表格展示真实明细。"
        : "可比较的数据点不足，已改用表格展示真实明细。",
    };
  }
  if (wanted === "pie.share") {
    if (categories.some((c) => c.value < 0)) {
      return { ...table(), degradeNote: "存在负数库存，饼图不适用，已改用表格展示真实明细。" };
    }
    if (categories.length > 6) {
      return { ...table(), degradeNote: `共 ${categories.length} 项超过饼图 6 个扇区上限，已改用表格展示。` };
    }
    return {
      renderId: "pie.share",
      dataset: { title: `${scope}库存占比`, unit: rows[0]?.unit || "", timeRange: asOf, categories },
      totalRows: categories.length,
    };
  }
  if (wanted === "line.trend" || wanted === "delta.before_after") {
    return {
      ...table(),
      degradeNote: "库存是时点快照，ERP 未提供时间序列/前后对比口径，已改用表格展示真实明细。",
    };
  }
  return {
    renderId: "bar.compare",
    dataset: { title: `${scope}库存对比`, unit: rows[0]?.unit || "", timeRange: asOf, categories },
    totalRows: categories.length,
  };
}

// ---- 采购入库汇总 ------------------------------------------------------
function buildPurchasePlan(rep, bills, plan) {
  const totals = rep?.totals || {};
  const label = plan.range?.label || "所选区间";
  const billRows = Array.isArray(bills?.rows) ? bills.rows : [];
  const totalAmount = n0(totals.totalAmount ?? totals.amount);
  const totalQty = n0(totals.totalQty ?? totals.qty);
  const billCount = n0(totals.billCount ?? totals.totalBillCount);

  const byPartner = new Map();
  const byDay = new Map();
  for (const r of billRows) {
    const amt = n0(r.totalAmount ?? r.amount ?? r.totalPrice);
    const p = s0(r.partnerName ?? r.supplierName ?? "(未填供应商)", 24);
    const d = String(r.operTime ?? r.oper_time ?? r.date ?? "").slice(0, 10);
    byPartner.set(p, (byPartner.get(p) || 0) + amt);
    if (d) byDay.set(d, (byDay.get(d) || 0) + amt);
  }
  const catsOf = (m) =>
    [...m.entries()]
      .map(([label2, value]) => ({ label: String(label2).slice(0, 24), value: Number(value.toFixed(2)), unit: "CNY" }))
      .sort((a, b) => b.value - a.value);

  const partnerCats = catsOf(byPartner);
  const dayCats = catsOf(byDay).sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const kpiPlan = (why) => ({
    renderId: "kpi.tiles",
    degradeNote: why,
    dataset: {
      title: `采购入库汇总（${label}，已审核）`,
      currency: "CNY",
      timeRange: label,
      kpis: [
        { label: "采购金额合计", value: totalAmount, unit: "CNY", money: true },
        { label: "入库单数", value: billCount, unit: "单" },
        { label: "数量合计", value: totalQty, unit: "" },
      ].filter((k) => Number.isFinite(k.value)),
    },
    totalRows: 0,
  });

  const billTable = () => ({
    renderId: "table.basic",
    dataset: {
      title: `采购入库明细（${label}，已审核）`,
      currency: "CNY",
      timeRange: label,
      columns: [
        { key: "billNumber", label: "单据编号" },
        { key: "partnerName", label: "供应商" },
        { key: "operTime", label: "日期" },
        { key: "totalAmount", label: "金额", type: "money" },
      ],
      rows: billRows.slice(0, 50).map((r) => ({
        billNumber: s0(r.billNumber ?? r.number, 40),
        partnerName: s0(r.partnerName ?? "(未填)", 24),
        operTime: String(r.operTime ?? "").slice(0, 10),
        totalAmount: n0(r.totalAmount ?? r.amount ?? r.totalPrice),
      })),
    },
    totalRows: billRows.length,
  });

  if (!billCount && !totalAmount && !billRows.length) return { empty: true };

  const truncated = billRows.length >= 50;
  const truncNote = truncated ? "（单据较多，仅统计最近 50 张）" : "";

  if (plan.renderId === "table.basic") return billTable();
  if (plan.renderId === "delta.before_after") {
    return {
      ...billTable(),
      degradeNote: "ERP 当前未提供采购的前后对比口径，已改用明细表格展示真实单据。",
    };
  }

  // 维度选择：优先供应商，其次日期；都不足 2 个分类则明确降级
  let dim = null;
  if (partnerCats.length >= 2) dim = { key: "partner", cats: partnerCats };
  else if (dayCats.length >= 2) dim = { key: "day", cats: dayCats };

  if (!dim) {
    const why =
      partnerCats.length === 1 && dayCats.length <= 1
        ? `ERP 在${label}只有 1 个供应商且集中在 1 天，没有可比较的多个分类`
        : `ERP 在${label}没有返回可比较的多个分类，只有总计口径`;
    return kpiPlan(`${why}，因此不做${RENDER_ZH[plan.renderId] || "图形"}，已降级为指标卡展示真实合计。`);
  }

  if (plan.renderId === "line.trend") {
    if (dayCats.length < 3) {
      return {
        ...billTable(),
        degradeNote: `折线图至少需要 3 个时间点，ERP 在${label}只有 ${dayCats.length} 天有数据，已改用明细表格。`,
      };
    }
    return {
      renderId: "line.trend",
      dataset: {
        title: `采购入库金额趋势（${label}，已审核）${truncNote}`,
        unit: "CNY",
        currency: "CNY",
        timeRange: label,
        series: [{ name: "采购金额", points: dayCats.map((c) => ({ x: c.label.slice(5), y: c.value })) }],
      },
      totalRows: dayCats.length,
      degradeNote:
        dim.key === "day" && partnerCats.length < 2
          ? `本月只有 ${partnerCats.length} 个供应商（${partnerCats[0]?.label || "-"}），无法按供应商比较，已按日期维度出图。`
          : undefined,
    };
  }

  let cats = dim.cats;
  if (plan.renderId === "pie.share" && cats.length > 6) cats = cats.slice(0, 6);
  if (plan.renderId === "pie.share" && cats.some((c) => c.value < 0)) {
    return { ...billTable(), degradeNote: "存在负数金额，饼图不适用，已改用明细表格展示真实单据。" };
  }

  return {
    renderId: plan.renderId === "pie.share" ? "pie.share" : "bar.compare",
    dataset: {
      title:
        dim.key === "partner"
          ? `供应商采购金额（${label}，已审核）${truncNote}`
          : `采购金额按日期（${label}，已审核）${truncNote}`,
      unit: "CNY",
      currency: "CNY",
      timeRange: label,
      categories: cats,
    },
    totalRows: cats.length,
    degradeNote:
      dim.key === "day" && partnerCats.length < 2
        ? `本月只有 ${partnerCats.length} 个供应商（${partnerCats[0]?.label || "-"}），无法按供应商比较，已按 ERP 真实可查的日期维度出图。`
        : undefined,
  };
}

// ---- 020B：图表摘要卡片（text_notice） ---------------------------------
function fmtMoney(v) {
  const n = Number(v);
  return `¥${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtQtyStr(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const s = Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(2).replace(/\.?0+$/, "");
  return s;
}

/**
 * 根据已渲染的图表 dataset 生成 text_notice 摘要卡片。
 * 只展示真实查询出的 KPI，不编造任何数值。
 *
 * 点击行为设计（无 ERP 网页版场景）：
 * - 整卡点击默认不配 card_action（企微文档：type=0/不填代表不是链接），避免乱开网页；
 *   若配置了 AIERP_ERP_WEB_URL 则启用整卡跳转
 * - 底部 jump_list 用 type=3 智能回复：点击后机器人自动代发查询指令并回真实数据
 */
export function buildSummaryCard(built, rendered, plan, scope) {
  const ds = built?.dataset || {};
  const subjectZh = plan.subject === "purchase" ? "采购入库" : "库存";
  const card = {
    card_type: "text_notice",
    source: { desc: "AI ERP 助手", desc_color: 0 },
    main_title: { title: `${scope}${subjectZh}摘要`, desc: plan.range?.label || ds.timeRange || "" },
    horizontal_content_list: [],
    jump_list: buildSmartReplies(plan),
  };
  const webUrl = process.env.AIERP_ERP_WEB_URL;
  if (webUrl) card.card_action = { type: 1, url: webUrl };

  const push = (keyname, value) => {
    if (card.horizontal_content_list.length < 6 && value != null && value !== "") {
      card.horizontal_content_list.push({ keyname: String(keyname).slice(0, 5), value: String(value).slice(0, 26) });
    }
  };

  if (plan.subject === "purchase") {
    const kpis = Array.isArray(ds.kpis) ? ds.kpis : [];
    if (kpis.length) {
      const amount = kpis.find((k) => k.money || /金额/.test(k.label || ""));
      card.emphasis_content = {
        title: amount ? fmtMoney(amount.value) : "-",
        desc: amount ? String(amount.label || "采购金额").slice(0, 15) : "采购金额",
      };
      for (const k of kpis) {
        if (k === amount) continue;
        const unit = k.unit && k.unit !== "CNY" ? ` ${k.unit}` : "";
        push(String(k.label || "").slice(0, 5), `${fmtQtyStr(k.value)}${unit}`);
      }
    } else if (Array.isArray(ds.rows)) {
      // 明细表格场景：从真实行数据汇总
      const sum = ds.rows.reduce((a, r) => a + Number(r.totalAmount || 0), 0);
      card.emphasis_content = { title: fmtMoney(sum), desc: "金额合计" };
      push("单据数", String(ds.rows.length));
      const partners = new Set(ds.rows.map((r) => r.partnerName).filter(Boolean));
      if (partners.size) push("供应商", `${partners.size} 家`);
    } else if (Array.isArray(ds.categories) && ds.categories.length) {
      // 柱状/饼图/趋势场景：从真实分类汇总（采购单位恒为 CNY）
      const cats = ds.categories;
      const sum = cats.reduce((a, c) => a + Number(c.value || 0), 0);
      card.emphasis_content = { title: fmtMoney(sum).slice(0, 10), desc: "金额合计" };
      const top = [...cats].sort((a, b) => b.value - a.value)[0];
      if (top && cats.length > 1) push("最高", `${top.label} ${fmtMoney(top.value)}`);
      push("分类数", String(cats.length));
    }
  } else if (rendered?.renderId === "kpi.tiles") {
    const kpis = Array.isArray(ds.kpis) ? ds.kpis : [];
    const total = kpis.find((k) => /合计|总量|库存/.test(k.label || "")) || kpis[kpis.length - 1];
    if (total) {
      card.emphasis_content = {
        title: `${fmtQtyStr(total.value)}${total.unit ? ` ${total.unit}` : ""}`.slice(0, 10),
        desc: String(total.label || "库存合计").slice(0, 15),
      };
    }
    for (const k of kpis) {
      if (k === total) continue;
      push(String(k.label || "").slice(0, 5), `${fmtQtyStr(k.value)}${k.unit ? ` ${k.unit}` : ""}`);
    }
  } else {
    // table / bar / pie / line：取合计或最大分类
    const cats = Array.isArray(ds.categories) ? ds.categories : [];
    if (cats.length) {
      const sum = cats.reduce((a, c) => a + Number(c.value || 0), 0);
      const unit = ds.unit === "CNY" ? "" : ds.unit ? ` ${ds.unit}` : "";
      card.emphasis_content = {
        title: `${ds.unit === "CNY" ? fmtMoney(sum) : fmtQtyStr(sum) + unit}`.slice(0, 10),
        desc: ds.unit === "CNY" ? "金额合计" : "合计",
      };
      const top = [...cats].sort((a, b) => b.value - a.value)[0];
      if (top && cats.length > 1) push("最高", `${top.label} ${ds.unit === "CNY" ? fmtMoney(top.value) : fmtQtyStr(top.value)}`);
      push("分类数", String(cats.length));
    } else if (Array.isArray(ds.rows)) {
      const totalQty = ds.rows.reduce((a, r) => a + Number(r.currentStock || 0), 0);
      card.emphasis_content = {
        title: `${fmtQtyStr(totalQty)}${ds.rows[0]?.unit ? ` ${ds.rows[0].unit}` : ""}`.slice(0, 10),
        desc: "库存合计",
      };
      push("物料品种", String(ds.rows.length));
    }
  }

  if (card.horizontal_content_list.length === 0) delete card.horizontal_content_list;
  card.sub_title_text = "数据来自 ERP 实时查询（非模型估算），明细见随发图表。";
  return card;
}

/** 智能回复指引：question 必须能命中 isChartRequest 的图表意图，形成闭环 */
export function buildSmartReplies(plan) {
  if (plan.subject === "purchase") {
    return [
      { type: 3, title: "查采购汇总", question: "把本月采购情况用指标卡展示给我" },
      { type: 3, title: "查采购明细", question: "把本月采购明细用表格展示给我" },
    ];
  }
  return [
    { type: 3, title: "查原料仓库存", question: "把原料仓的库存用表格展示给我" },
    { type: 3, title: "查成品仓库存", question: "把成品仓的库存用表格展示给我" },
  ];
}

/**
 * 卡片发送变体（按优先级依次尝试，第一个被企微接受的即送出）。
 *
 * 背景：errcode=42045 证明 text_notice 的 card_action 是服务端强校验项，
 * 不能省略；故 V0 尝试把整卡点击也做成智能回复（type=3），彻底避免跳浏览器。
 * V1 在配置了 ERP 网页地址时走正式跳转。全部失败则只保留图片，不影响主流程。
 *
 * @param {string} primaryQuestion 整卡点击触发的智能回复问题（必须命中图表意图）
 */
export function buildSummaryCardVariants(built, rendered, plan, scope, webUrl) {
  const base = buildSummaryCard(built, rendered, plan, scope);
  const primaryQuestion = buildSmartReplies(plan)[0]?.question;
  // 整卡智能回复（type=3）实测被 errcode=42045 拒绝；仅在无网页地址时才作为最后的尝试
  const smartVariant = primaryQuestion ? { ...base, card_action: { type: 3, question: primaryQuestion } } : null;
  const urlVariant = webUrl ? { ...base, card_action: { type: 1, url: webUrl } } : null;
  return [urlVariant, smartVariant].filter(Boolean);
}

// ---- 主流程 ------------------------------------------------------------
/**
 * @param {object} deps
 * @param {string} deps.wecomUserId  可信企微发送者（来自通道，非模型）
 * @param {string} deps.text         用户原始文本
 * @param {string} deps.botId
 * @param {(p:string,b:object)=>Promise<object>} deps.signedPost
 * @param {object} [deps.cfg]
 * @param {string[]} [deps.mediaLocalRoots]
 * @param {object} [deps.plan]       工具直调时的显式参数
 * @param {Function} [deps.sendFn]   测试替身；生产走 sendWecomLocalFile
 * @param {Function} [deps.sendCardFn] 测试替身；生产走 sendWecomTemplateCard
 */
export async function runChartRender(deps) {
  const {
    wecomUserId,
    text,
    botId,
    signedPost,
    cfg,
    mediaLocalRoots,
    plan: explicitPlan,
    sendFn = sendWecomLocalFile,
    sendCardFn = sendWecomTemplateCard,
  } = deps;
  const idBody = (extra = {}) => ({ wecomUserId, botId, channel: CHANNEL_ID, ...extra });

  let authCtx;
  try {
    const st = await signedPost("/aierp/v1/wecom/binding/status", idBody());
    if (!st?.bound) {
      return {
        handled: true,
        sent: false,
        text: "尚未绑定 ERP，无法查询真实数据。请先发送「绑定ERP」并完成绑定，再让我出图。",
      };
    }
    // actorUserId 用 ERP 登录名：稳定、按用户隔离，且不暴露自增 id
    authCtx = {
      tenantId: String(st.tenantId ?? ""),
      actorUserId: String(st.erpLoginName ?? st.tenantId ?? ""),
      wecomUserId,
      botId,
      bindingVersion: Number(st.bindingVersion ?? 1),
    };
  } catch (err) {
    return { handled: true, sent: false, text: `无法确认绑定身份：${String(err?.message || err).slice(0, 120)}` };
  }

  const plan = detectChartPlan(text, explicitPlan || {});
  const rb = rangeBody(plan.range);

  let built;
  let sourcePath;
  let depotScope;
  try {
    if (plan.subject === "purchase") {
      sourcePath = "/aierp/v1/wecom/report/query?purchase_in_summary";
      const rep = await signedPost(
        "/aierp/v1/wecom/report/query",
        idBody({ report: "purchase_in_summary", ...rb }),
      );
      let bills = { rows: [] };
      try {
        bills = await signedPost(
          "/aierp/v1/wecom/bill/search",
          idBody({ billType: "purchase", status: "1", limit: 50, ...rb }),
        );
      } catch {
        bills = { rows: [] }; // 无单据查询权限时仍可用总计口径
      }
      built = buildPurchasePlan(rep, bills, plan);
    } else {
      sourcePath = "/aierp/v1/wecom/stock/query";
      depotScope = plan.depotName ? [plan.depotName] : undefined;
      const data = await signedPost(
        "/aierp/v1/wecom/stock/query",
        idBody({ depotName: plan.depotName, query: plan.query }),
      );
      built = buildStockPlan(data, plan);
    }
  } catch (err) {
    return { handled: true, sent: false, text: `ERP 查询失败：${String(err?.message || err).slice(0, 160)}` };
  }

  if (built.empty) {
    const what = plan.subject === "purchase" ? "采购入库汇总" : "库存";
    const scope = plan.subject === "purchase" ? plan.range?.label || "所选区间" : plan.depotName || "当前权限范围";
    return {
      handled: true,
      sent: false,
      text: `ERP 在「${scope}」没有查到${what}数据，因此没有生成图表。可以换个仓库或时间区间再试。`,
    };
  }

  let rendered;
  try {
    rendered = await sealAndRender(
      authCtx,
      {
        renderId: built.renderId,
        sourceKind: "ERP_QUERY",
        sourcePath,
        depotScope,
        dataset: built.dataset,
      },
      { writeFiles: true, exportXlsx: built.renderId === "table.basic" },
    );
  } catch (err) {
    return { handled: true, sent: false, text: `图表渲染失败：${String(err?.message || err).slice(0, 200)}` };
  }

  const pngPath = rendered.files?.png;
  if (!pngPath) {
    return { handled: true, sent: false, text: "图表已生成但未能写入媒体文件，请稍后重试。" };
  }

  const roots = [
    ...receiptMediaRoots([
      ...(mediaLocalRoots || []),
      ...(cfg?.channels?.wecom?.mediaLocalRoots || []),
    ]),
    join(stateDir(), "media", "aierp-render"),
  ];

  const send = await sendFn({
    toUserId: wecomUserId,
    mediaPath: pngPath,
    mediaLocalRoots: roots,
    cfg,
  });

  if (!send.ok) {
    return {
      handled: true,
      sent: false,
      error: send.error,
      text: `图表已生成，但企业微信图片发送失败：${String(send.error || "").slice(0, 160)}。可稍后重说一次。`,
    };
  }

  // 长表被截断时补发 Excel 附件（真实数据，非模型估算）
  let xlsxSent = false;
  const truncated = rendered.totalRows > (rendered.previewRows || 0);
  if (truncated && rendered.files?.xlsx) {
    const sx = await sendFn({
      toUserId: wecomUserId,
      mediaPath: rendered.files.xlsx,
      mediaLocalRoots: roots,
      cfg,
    });
    xlsxSent = !!sx.ok;
  }

  const kindZh = RENDER_ZH[rendered.renderId] || "图表";
  const scope = plan.subject === "purchase" ? plan.range?.label || "所选区间" : plan.depotName || "当前权限范围";
  const subjectZh = plan.subject === "purchase" ? "采购入库" : "库存";

  // 020B：图片发完后补发一张企微原生摘要卡片（变体降级；失败不影响主流程、不追加报错文案）
  let cardSent = false;
  let cardError = null;
  const variants = buildSummaryCardVariants(
    built,
    rendered,
    plan,
    scope,
    process.env.AIERP_ERP_WEB_URL,
  );
  for (let i = 0; i < variants.length; i += 1) {
    try {
      const cardRes = await sendCardFn({ toUserId: wecomUserId, card: variants[i], cfg });
      if (cardRes?.ok) {
        cardSent = true;
        console.error(`[aierp-020b] summary card sent via variant ${i}`);
        break;
      }
      console.error(`[aierp-020b] card variant ${i} rejected: ${String(cardRes?.error || "no result").slice(0, 200)}`);
      cardError = String(cardRes?.error || "card send failed").slice(0, 120);
    } catch (err) {
      cardError = String(err?.message || err).slice(0, 120);
      console.error(`[aierp-020b] card variant ${i} threw: ${cardError}`);
    }
  }
  if (!cardSent) {
    console.error(`[aierp-020b] summary card send failed: ${cardError || "no variant accepted"}`);
  }

  const parts = [`${subjectZh}${kindZh}已发送（${scope}`];
  if (rendered.renderId === "table.basic" && rendered.totalRows) {
    parts.push(`，共 ${rendered.totalRows} 行`);
    if (truncated) {
      parts.push(
        xlsxSent
          ? `，图片展示前 ${rendered.previewRows} 行，完整数据见随后发送的 Excel`
          : `，图片展示前 ${rendered.previewRows} 行`,
      );
    }
  }
  parts.push("）。数据来自 ERP 实时查询，非模型估算。");
  const note = built.degradeNote || (rendered.degraded && rendered.degradeReason ? `图形口径不适用当前数据，已自动降级为${RENDER_ZH[rendered.renderId] || "表格"}。` : null);
  if (note) parts.push(`\n说明：${note}`);

  return {
    handled: true,
    sent: true,
    renderId: rendered.renderId,
    degraded: !!built.degradeNote || !!rendered.degraded,
    pngBytes: rendered.pngBytes,
    pngSha256: rendered.pngSha256,
    totalRows: rendered.totalRows || built.totalRows || 0,
    xlsxSent,
    cardSent,
    ...(cardError ? { cardError } : {}),
    messageId: send.messageId,
    text: stripPaths(parts.join("")),
  };
}

export { CHANNEL_ID };
