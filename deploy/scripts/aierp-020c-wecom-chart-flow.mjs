#!/usr/bin/env node
/**
 * AIERP-020C 企微图片链路自测（非过账）：
 * - 真实 ERP 授权查询 → 服务端密封 → 020C PNG → 发送替身（不打扰真人）
 * - 场景 A：原料仓库存表格；场景 B：本月采购柱状图
 * - 负例：无数据时不生成图表；用户可见文本不含本地路径
 * - 不触碰 F: OpenClaw 运行时，不写 deploy/runtime/app.jar
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const stateRoot = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-wecom-state");
process.env.OPENCLAW_STATE_DIR = stateRoot;

const outDir = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-wecom-artifacts");
const reportPath = path.join(ROOT, "docs", "poc", "evidence", "aierp-020c-wecom-chart.json");

const chartUrl = pathToFileURL(
  path.join(ROOT, "deploy", "openclaw", "plugins", "aierp-erp-tools", "sop", "chart-render.mjs"),
).href;
const { isChartRequest, runChartRender, detectChartPlan } = await import(chartUrl);

const BASE = (process.env.AIERP_ERP_BASE_URL || "http://127.0.0.1:9999/jshERP-boot").replace(/\/$/, "");
const BOT = process.env.AIERP_WECOM_BOT_ID || "default";
const LOGIN = process.env.AIERP_LOGIN_NAME || "jsh";
const PASS = process.env.AIERP_LOGIN_PASSWORD || "123456";
const WECOM = `aierp020cwc-${Date.now().toString(36)}`;

const report = {
  ticket: "AIERP-020C-WECOM-IMAGE",
  startedAt: new Date().toISOString(),
  checks: [],
  scenarios: {},
  ok: false,
};

function pass(name, detail) {
  report.checks.push({ name, pass: true, detail });
}
function softFail(name, detail) {
  report.checks.push({ name, pass: false, detail });
}
const md5 = (s) => createHash("md5").update(String(s), "utf8").digest("hex");

function loadSecret() {
  let secret = (process.env.AIERP_WECOM_ADAPTER_SECRET || "").trim();
  if (!secret) {
    const envPath = path.join(ROOT, "deploy", ".env");
    if (existsSync(envPath)) {
      const line = fs
        .readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("AIERP_WECOM_ADAPTER_SECRET="));
      if (line) secret = line.slice("AIERP_WECOM_ADAPTER_SECRET=".length).trim();
    }
  }
  return secret && secret.length >= 32 ? secret : null;
}

async function signedPost(secret, pathName, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const payload = `POST\n/jshERP-boot${pathName}\n${ts}\n${nonce}\n${body}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const res = await fetch(`${BASE}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Aierp-Adapter-Timestamp": ts,
      "X-Aierp-Adapter-Nonce": nonce,
      "X-Aierp-Adapter-Signature": sig,
    },
    body,
  });
  const json = await res.json();
  if (json?.code !== 200) {
    throw new Error(String(json?.data?.message || json?.message || json?.code));
  }
  return json.data;
}

async function bind() {
  const issue = await signedPost(secret, "/aierp/v1/wecom/binding/issue", {
    wecomUserId: WECOM,
    botId: BOT,
    channel: "wecom",
  });
  const login = await (
    await fetch(`${BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ loginName: LOGIN, password: md5(PASS) }),
    })
  ).json();
  const token = login?.data?.token || login?.token;
  const claim = await (
    await fetch(`${BASE}/aierp/v1/wecom/binding/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "X-Access-Token": token },
      body: JSON.stringify({ bindCode: issue.bindCode }),
    })
  ).json();
  if (claim?.data?.status !== "ACTIVE") throw new Error(`bind claim failed: ${JSON.stringify(claim).slice(0, 200)}`);
  return claim.data;
}

const secret = loadSecret();
if (!secret) {
  softFail("adapter_secret", "AIERP_WECOM_ADAPTER_SECRET missing");
  finish(false);
} else {
  await main();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });

  // 发送替身：记录调用并留存产物，不打扰真人
  const sent = [];
  const sendFn = async ({ mediaPath }) => {
    sent.push(mediaPath);
    if (existsSync(mediaPath)) {
      const dest = path.join(outDir, path.basename(mediaPath));
      copyFileSync(mediaPath, dest);
      return { ok: true, messageId: `stub-${sent.length}` };
    }
    return { ok: false, error: "media file missing" };
  };

  // 020B 卡片发送替身：校验 card_type 合法性并记录卡片内容
  const cards = [];
  const sendCardFn = async ({ card }) => {
    if (!card || typeof card !== "object") return { ok: false, error: "card required" };
    const okType = ["text_notice", "news_notice", "button_interaction", "vote_interaction", "multiple_interaction"]
      .includes(card.card_type);
    const noPath = !/[A-Za-z]:\\/.test(JSON.stringify(card));
    cards.push(card);
    return okType && noPath ? { ok: true, messageId: `card-${cards.length}` } : { ok: false, error: "invalid card" };
  };

  // 智能回复 question 必须能命中图表意图（闭环校验）
  const smartReplyQuestions = [];

  let bound;
  try {
    bound = await bind();
    pass("real_erp_bind", { erpLoginName: bound.erpLoginName, tenantId: bound.tenantId });
  } catch (err) {
    softFail("real_erp_bind", String(err?.message || err).slice(0, 200));
    return finish(false);
  }

  const run = (text, plan) =>
    runChartRender({
      wecomUserId: WECOM,
      text,
      botId: BOT,
      signedPost: (p, b) => signedPost(secret, p, b),
      cfg: {},
      mediaLocalRoots: [],
      sendFn,
      sendCardFn,
      plan,
    });

  const hasPath = (t) => /[A-Za-z]:\\[^\n]+/.test(String(t || "")) || /MEDIA:/i.test(String(t || ""));

  // ---- 意图识别 ----
  {
    const a = isChartRequest("把原料仓的库存用表格展示给我");
    const b = isChartRequest("把本月采购情况画成柱状图发我");
    const negs = ["确认采购123", "给我采购模板", "发 GW-PURCHASE-119 回执", "绑定ERP"];
    const negOk = negs.every((t) => !isChartRequest(t));
    if (!a || !b || !negOk) {
      softFail("intent_detect", { a, b, negs: negs.map((t) => [t, isChartRequest(t)]) });
    } else {
      pass("intent_detect", { scenarioA: a, scenarioB: b, negativesClear: true });
    }
  }

  // ---- 场景 A：原料仓库存表格 ----
  {
    const before = sent.length;
    const beforeCards = cards.length;
    const r = await run("把原料仓的库存用表格展示给我");
    const png = sent[before];
    const okPng = png && existsSync(png) && fs.readFileSync(png)[0] === 0x89;
    const card = cards[beforeCards];
    const cardOk = !!r.sent && r.cardSent === true && card?.card_type === "text_notice" && !!card?.emphasis_content;
    report.scenarios.stockTable = {
      renderId: r.renderId,
      sent: !!r.sent,
      totalRows: r.totalRows,
      pngBytes: r.pngBytes,
      pngSha256: (r.pngSha256 || "").slice(0, 12),
      cardSent: r.cardSent,
      card: card || null,
      text: r.text,
    };
    if (r.renderId !== "table.basic" || !r.sent || !okPng || hasPath(r.text) || !cardOk) {
      softFail("scenario_a_stock_table", report.scenarios.stockTable);
    } else {
      pass("scenario_a_stock_table", report.scenarios.stockTable);
    }
  }

  // ---- 场景 B：本月采购柱状图 ----
  {
    const before = sent.length;
    const beforeCards = cards.length;
    const r = await run("把本月采购情况画成柱状图发我");
    const png = sent[before];
    const okPng = png && existsSync(png) && fs.readFileSync(png)[0] === 0x89;
    const card = cards[beforeCards];
    const cardOk = !!r.sent && r.cardSent === true && card?.card_type === "text_notice" && !!card?.emphasis_content;
    report.scenarios.purchaseChart = {
      renderId: r.renderId,
      sent: !!r.sent,
      degraded: !!r.degraded,
      degradeNote: (r.text || "").split("\n").find((l) => l.startsWith("说明：")) || null,
      pngBytes: r.pngBytes,
      cardSent: r.cardSent,
      card: card || null,
      text: r.text,
    };
    if (!r.sent || !okPng || hasPath(r.text) || !cardOk) {
      softFail("scenario_b_purchase_chart", report.scenarios.purchaseChart);
    } else {
      pass("scenario_b_purchase_chart", report.scenarios.purchaseChart);
    }
  }

  // ---- 020B 卡片语义：无整卡乱跳、智能回复 question 可闭环、无路径泄漏 ----
  {
    const okCards = cards.length > 0 && cards.every((c) => {
      const blob = JSON.stringify(c);
      const noPath = !/[A-Za-z]:\\/.test(blob) && !/MEDIA:/i.test(blob);
      // 未配置 AIERP_ERP_WEB_URL 时不应有整卡跳转
      const noCardAction = !process.env.AIERP_ERP_WEB_URL ? !c.card_action : true;
      const jumps = Array.isArray(c.jump_list) ? c.jump_list : [];
      for (const j of jumps) {
        if (j.type === 3 && j.question) smartReplyQuestions.push(j.question);
      }
      return c.card_type === "text_notice" && noPath && noCardAction && jumps.length > 0;
    });
    if (!okCards) softFail("card_semantics", { count: cards.length });
    else pass("card_semantics", { count: cards.length, types: cards.map((c) => c.card_type) });
    // 智能回复闭环：每个 question 都应命中图表意图
    const loopOk = smartReplyQuestions.length > 0 && smartReplyQuestions.every((q) => isChartRequest(q));
    if (!loopOk) softFail("card_smart_reply_loop", { questions: smartReplyQuestions, hits: smartReplyQuestions.map((q) => isChartRequest(q)) });
    else pass("card_smart_reply_loop", { questions: smartReplyQuestions });
  }

  // ---- 采购表格 + 折线趋势（同一真实数据，不同 renderId）----
  {
    const before = sent.length;
    const r = await run("", { renderId: "line.trend", subject: "purchase", fromDate: "2026-10-01", toDate: "2026-10-24" });
    report.scenarios.purchaseTrend = { renderId: r.renderId, sent: !!r.sent, text: r.text };
    if (!r.sent && r.renderId !== "table.basic") {
      softFail("scenario_purchase_trend", report.scenarios.purchaseTrend);
    } else {
      pass("scenario_purchase_trend", report.scenarios.purchaseTrend);
    }
    if (sent.length <= before) softFail("scenario_purchase_trend_media", "no png produced");
  }

  // ---- 负例：无数据区间不生成图表 ----
  {
    const before = sent.length;
    const r = await run("", { renderId: "bar.compare", subject: "purchase", fromDate: "2001-01-01", toDate: "2001-01-02" });
    report.scenarios.emptyRange = { sent: !!r.sent, text: r.text };
    if (r.sent || sent.length !== before) {
      softFail("negative_empty_range", report.scenarios.emptyRange);
    } else {
      pass("negative_empty_range", report.scenarios.emptyRange);
    }
  }

  // ---- 负例：未知仓库不生成图表 ----
  {
    const before = sent.length;
    const r = await run("把不存在的仓库的库存用表格展示给我");
    report.scenarios.unknownDepot = { sent: !!r.sent, text: r.text };
    if (r.sent || sent.length !== before) {
      softFail("negative_unknown_depot", report.scenarios.unknownDepot);
    } else {
      pass("negative_unknown_depot", report.scenarios.unknownDepot);
    }
  }

  // ---- 媒体隔离：产物必须在 identity-scoped 目录下 ----
  {
    const renderRoot = path.join(stateRoot, "media", "aierp-render");
    const inside = sent.every((p) => p && path.resolve(p).startsWith(path.resolve(renderRoot)));
    if (!inside) softFail("media_identity_scope", { sent: sent.map((p) => path.basename(p || "")) });
    else pass("media_identity_scope", { count: sent.length, files: sent.map((p) => path.basename(p)) });
  }

  return finish(true);
}

function finish(ran) {
  report.finishedAt = new Date().toISOString();
  report.ok =
    !!ran &&
    report.checks.length > 0 &&
    report.checks.every((c) => c.pass) &&
    report.checks.some((c) => c.name === "scenario_a_stock_table") &&
    report.checks.some((c) => c.name === "scenario_b_purchase_chart");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        reportPath,
        checks: report.checks.length,
        passed: report.checks.filter((c) => c.pass).length,
        failed: report.checks.filter((c) => !c.pass).map((c) => c.name),
        scenarios: {
          stockTable: report.scenarios.stockTable?.renderId,
          purchaseChart: report.scenarios.purchaseChart?.renderId,
          purchaseChartDegraded: report.scenarios.purchaseChart?.degraded,
        },
        outDir,
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exit(1);
}
