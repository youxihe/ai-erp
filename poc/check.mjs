/**
 * 零第三方依赖 POC 验证：执行 node poc/check.mjs
 * 只检查静态脚本语法、服务可访问、无密钥时不伪装真实 AI。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = await fs.readFile(path.join(here, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(script, 'POC 页面缺少脚本');
new vm.Script(script[1], { filename: 'index.html inline script' });
assert.match(html, /data-draft-action="confirm"/);
assert.match(html, /演示数据/);
assert.match(html, /清洗服务耗料/);

const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));

const env = { ...process.env, PORT: String(port) };
delete env.AI_API_KEY;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: here, env, stdio: 'ignore'
});
let exited = false;
child.on('exit', () => { exited = true; });
const origin = 'http://127.0.0.1:' + port;
async function getReady() {
  for (let i = 0; i < 35; i++) {
    if (exited) throw new Error('server.mjs 过早退出');
    try {
      const res = await fetch(origin + '/api/status');
      if (res.ok) return await res.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('HTTP 服务未在预期时间内启动');
}
try {
  const status = await getReady();
  assert.equal(status.llmConfigured, false);
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AI 清洗经营助手|AI 清洗/);
  const noKey = await fetch(origin + '/api/intent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '查看库存' })
  });
  assert.equal(noKey.status, 503);
  const error = await noKey.json();
  assert.match(error.error, /AI_API_KEY/);
  const badBody = await fetch(origin + '/api/intent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' })
  });
  assert.equal(badBody.status, 400);
  const notFound = await fetch(origin + '/non-existent');
  assert.equal(notFound.status, 404);
  console.log('PASS: inline JS syntax, local HTTP server, default offline demo, safe AI fallback');
} finally {
  child.kill('SIGTERM');
}
