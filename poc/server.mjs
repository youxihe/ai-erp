/**
 * PCB 清洗进销存 POC：可选的真实 LLM 意图解析代理。
 * 无第三方依赖；仅绑定本地 127.0.0.1；业务变更由前端显式确认。
 * 注意：POC 的业务数据保存在浏览器 localStorage，尚未接入 jshERP。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const key = process.env.AI_API_KEY || '';
const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const model = process.env.AI_MODEL || 'gpt-4o-mini';

const systemPrompt = [
  '你是PCB清洗企业进销存POC的意图识别器。仅输出JSON对象，不要Markdown。',
  'action只能是 stock、purchase、mix、service、report、unknown。',
  'schema: {"action":"stock","sku":"RM-A001","quantity":null,"customer":"","supplier":"","reason":""}',
  '库存/预警/还有多少=>stock；采购/进货/入库=>purchase；配制/调配/组装=>mix；清洗服务耗料/领用=>service；统计/经营分析=>report。',
  '演示物料：RM-A001=表面活性剂,RM-B002=络合剂,RM-C003=纯水,FG-101=PCB清洗液,FG-102=除胶清洗液。',
  '只有FG-101有演示配方。配制默认FG-101；服务耗料没有指定成品时返回unknown。',
  '数量统一按升(L)，输入为桶或公斤时不允许臆测换算，返回unknown并在reason说明。',
  '不得捏造价格、单位换算、客户、供应商；缺少采购原料或数量等必要信息返回unknown。',
  'sku必须来自上述物料编号或为空。quantity是正数或null，用户文本中的数字才可填写。',
  '不执行任何库存变更，不做权限判断，只负责抽取用户意图。'
].join('\n');

function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:"
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function normalize(value) {
  const allowed = new Set(['stock', 'purchase', 'mix', 'service', 'report', 'unknown']);
  const skus = new Set(['RM-A001', 'RM-B002', 'RM-C003', 'FG-101', 'FG-102']);
  const action = allowed.has(value?.action) ? value.action : 'unknown';
  const sku = skus.has(value?.sku) ? value.sku : '';
  const quantity = Number(value?.quantity);
  return {
    action,
    sku,
    quantity: Number.isFinite(quantity) && quantity > 0 && quantity <= 100000 ? quantity : null,
    customer: typeof value?.customer === 'string' ? value.customer.slice(0, 80) : '',
    supplier: typeof value?.supplier === 'string' ? value.supplier.slice(0, 80) : '',
    reason: typeof value?.reason === 'string' ? value.reason.slice(0, 160) : ''
  };
}

async function parseWithLLM(text) {
  if (!key) throw Object.assign(new Error('未配置 AI_API_KEY'), { status: 503 });
  const url = new URL(baseUrl + '/chat/completions');
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw Object.assign(new Error('AI_BASE_URL 必须为 HTTPS 或本地地址'), { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model, temperature: 0,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }]
      })
    });
    if (!response.ok) throw new Error('模型请求失败：HTTP ' + response.status);
    const data = await response.json();
    const raw = String(data?.choices?.[0]?.message?.content || '');
    const cleaned = raw.replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '').trim();
    const result = JSON.parse(cleaned);
    return normalize(result);
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return respond(res, 200, { llmConfigured: Boolean(key), model: key ? model : null });
  }
  if (req.method === 'POST' && url.pathname === '/api/intent') {
    const size = Number(req.headers['content-length'] || 0);
    if (size > 4096) return respond(res, 413, { error: '输入过长' });
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return respond(res, 413, { error: '输入过长' });
      }
      const text = JSON.parse(body).text;
      if (typeof text !== 'string' || !text.trim() || text.length > 500) {
        return respond(res, 400, { error: '请输入不超过500字的文本' });
      }
      const intent = await parseWithLLM(text);
      return respond(res, 200, { ...intent, source: 'llm' });
    } catch (error) {
      return respond(res, error.status || 502, { error: error.message || '模型解析失败' });
    }
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try {
      const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
      return respond(res, 200, html, 'text/html; charset=utf-8');
    } catch {
      return respond(res, 500, { error: 'Demo 文件不存在' });
    }
  }
  return respond(res, 404, { error: 'Not Found' });
});
server.listen(port, '127.0.0.1', () => {
  console.log('PCB AI ERP POC: http://127.0.0.1:' + port);
  console.log(key ? '真实模型意图解析已启用' : '未设置 AI_API_KEY：页面使用本地规则模拟');
});
