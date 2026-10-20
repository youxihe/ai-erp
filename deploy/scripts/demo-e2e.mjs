#!/usr/bin/env node
/**
 * AIERP-008 integrated demo evidence against the merged master stack.
 * Browser screenshots are separate; this script records real bill and stock deltas.
 */
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
function loadExcelJS () {
  const candidates = [
    path.join(ROOT, '.tools', 'excel-node', 'package.json'),
    path.join(ROOT, 'node_modules', 'exceljs', 'package.json')
  ]
  for (const pkg of candidates) {
    if (fs.existsSync(pkg)) {
      return createRequire(pkg)('exceljs')
    }
  }
  throw new Error('exceljs not found. Run: npm install exceljs --prefix .tools/excel-node')
}
const ExcelJS = loadExcelJS()
const BASE = process.env.AIERP_BOOT_URL || 'http://127.0.0.1:9999/jshERP-boot'
const PASS = process.env.AIERP_MYSQL_ROOT_PASSWORD || 'aierp_root_change_me'
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const reportPath = path.join(ROOT, 'docs', 'poc', 'evidence', `demo-e2e-${stamp}.json`)
const report = { startedAt: new Date().toISOString(), base: BASE, chains: {}, checks: [], ok: false }
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

function assert(name, cond, detail) {
  report.checks.push({ name, pass: !!cond, detail })
  if (!cond) throw new Error(`${name}: ${JSON.stringify(detail)}`)
}
function near(a, b) { return Math.abs(Number(a) - Number(b)) < 0.0001 }
function mysql(sql) {
  const r = spawnSync('docker', ['exec', 'aierp-mysql', 'mysql', '-uroot', `-p${PASS}`, '-N', '--default-character-set=utf8mb4', 'jsh_erp', '-e', sql], { encoding: 'utf8' })
  const text = `${r.stdout || ''}\n${r.stderr || ''}`
  if (r.status !== 0) throw new Error(text)
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.includes('Using a password'))
}
async function api(method, urlPath, { token, body, raw, contentType } = {}) {
  const headers = {}
  if (token) headers['X-Access-Token'] = token
  let payload
  if (raw) {
    payload = raw
    if (contentType) headers['Content-Type'] = contentType
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json;charset=UTF-8'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: payload })
  const buf = Buffer.from(await res.arrayBuffer())
  let json = null
  try { json = JSON.parse(buf.toString('utf8')) } catch { json = null }
  return { status: res.status, json, buf }
}
async function login() {
  const res = await api('POST', '/user/login', { body: { loginName: 'jsh', password: md5('123456') } })
  if (!res.json?.data?.token) throw new Error('login failed')
  return res.json.data.token
}
async function stock(token, barCode, depotName) {
  const res = await api('POST', '/aierp/v1/stock/query', { token, body: { barCode, depotName } })
  if (res.json.code !== 200) throw new Error(JSON.stringify(res.json))
  return Number(res.json.data.currentStock)
}
async function workbook(sheets) {
  const book = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    const ws = book.addWorksheet(sheet.name)
    ws.getRow(1).getCell(1).value = sheet.name
    ws.getRow(2).getCell(1).value = '第3行表头，第4行数据'
    sheet.headers.forEach((h, i) => { ws.getRow(3).getCell(i + 1).value = h })
    sheet.rows.forEach((row, r) => row.forEach((v, c) => { ws.getRow(4 + r).getCell(c + 1).value = v }))
  }
  return Buffer.from(await book.xlsx.writeBuffer())
}
function form(file, filename) {
  const boundary = '----aierp' + stamp
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { body: Buffer.concat([head, file, tail]), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function previewConfirm(token, file, filename, batch, note) {
  const packed = form(file, filename)
  const preview = await api('POST', '/aierp/v1/excel/preview', { token, raw: packed.body, contentType: packed.contentType })
  assert(note + '-preview', preview.json?.code === 200 && preview.json.data.posted === false, preview.json)
  const confirmed = await api('POST', '/aierp/v1/excel/confirm', { token, body: { previewId: preview.json.data.previewId, idempotencyBatchKey: batch } })
  assert(note + '-confirm', confirmed.json?.code === 200, confirmed.json)
  const again = await api('POST', '/aierp/v1/excel/confirm', { token, body: { previewId: preview.json.data.previewId, idempotencyBatchKey: batch } })
  assert(note + '-idempotent', again.json?.data?.replayed === true, again.json)
  const receipt = await api('GET', `/aierp/v1/excel/receipt?batchId=${batch}`, { token })
  assert(note + '-receipt', receipt.status === 200 && receipt.buf.slice(0, 2).toString() === 'PK', { status: receipt.status })
  return { preview: preview.json.data, confirmed: confirmed.json.data }
}

async function run() {
  const token = await login()
  const assistant = await api('POST', '/aierp/v1/assistant/turn', { token, body: { message: '查表面活性剂库存' } })
  assert('assistant-rule-demo', assistant.json?.data?.mode === 'RULE_DEMO' && assistant.json.data.facts?.currentStock != null, assistant.json)
  const templateAsk = await api('POST', '/aierp/v1/assistant/turn', { token, body: { message: '给我采购表' } })
  assert('assistant-template-action', templateAsk.json?.data?.mode === 'RULE_DEMO' && !String(JSON.stringify(templateAsk.json.data)).includes('待接入') && templateAsk.json.data.suggestedActions?.[0]?.type === 'excel.template', templateAsk.json)

  const beforeA = await stock(token, 'RM-A001', '原料仓')
  const purchaseKey = `POC-PI-008-${stamp}`
  const badKey = `POC-PI-BAD-008-${stamp}`
  const purchaseFile = await workbook([{
    name: '02采购入库',
    headers: ['业务单号', '业务日期', '供应商名称', '物料编码', '物料名称', '入库仓库', '入库数量', '单位', '单价(元)', '业务备注'],
    rows: [
      [purchaseKey, '2026-10-20', '华东化工', 'RM-A001', '表面活性剂', '原料仓', 2, 'L', 20, 'AIERP-008'],
      [badKey, '2026-10-20', '华东化工', 'RM-A001', '表面活性剂', '原料仓', 1, '桶', 20, 'bad unit'],
    ],
  }])
  const purchase = await previewConfirm(token, purchaseFile, 'purchase.xlsx', `batch-pi-${stamp}`, 'purchase')
  const afterA = await stock(token, 'RM-A001', '原料仓')
  const posted = purchase.confirmed.results.find((r) => r.businessKey === purchaseKey)
  const rejected = purchase.confirmed.results.find((r) => r.businessKey === badKey)
  assert('purchase-stock', near(afterA, beforeA + 2) && posted?.status === 'POSTED' && rejected?.status !== 'POSTED', { beforeA, afterA, posted, rejected })
  report.chains.purchase = { businessKey: purchaseKey, billNumber: posted.billNumber, before: beforeA, after: afterA, rejected: rejected?.status }

  const beforeB = await stock(token, 'RM-B002', '原料仓')
  const beforeFg = await stock(token, 'FG-101', '成品仓')
  const mixKey = `POC-MIX-008-${stamp}`
  const mixFile = await workbook([{
    name: '03药水配制',
    headers: ['配制单号', '日期', '成品编码', '成品名称', '产出数量', '单位', '原料编码', '原料名称', '领用数量', '单位', '备注'],
    rows: [
      [mixKey, '2026-10-20', 'FG-101', 'PCB清洗液', 1, 'L', 'RM-A001', '表面活性剂', 0.6, 'L', '虚构配比'],
      [mixKey, '2026-10-20', 'FG-101', 'PCB清洗液', 1, 'L', 'RM-B002', '络合剂', 0.1, 'L', '虚构配比'],
      [mixKey, '2026-10-20', 'FG-101', 'PCB清洗液', 1, 'L', 'RM-C003', '纯水', 0.3, 'L', '虚构配比'],
    ],
  }])
  const mix = await previewConfirm(token, mixFile, 'mix.xlsx', `batch-mix-${stamp}`, 'mix')
  const afterFgMix = await stock(token, 'FG-101', '成品仓')
  const afterB = await stock(token, 'RM-B002', '原料仓')
  assert('mix-stock', mix.confirmed.results[0].status === 'POSTED' && near(afterFgMix, beforeFg + 1) && near(afterB, beforeB - 0.1), { mix: mix.confirmed, beforeFg, afterFgMix, beforeB, afterB })
  report.chains.mix = { businessKey: mixKey, billNumber: mix.confirmed.results[0].billNumber, fgBefore: beforeFg, fgAfter: afterFgMix, bBefore: beforeB, bAfter: afterB }

  const beforeSvc = await stock(token, 'FG-101', '成品仓')
  const svcKey = `POC-SV-008-${stamp}`
  const svcFile = await workbook([{
    name: '04服务耗料',
    headers: ['服务单号', '服务日期', '客户名称', '服务项目', '药水编码', '药水名称', '耗用数量', '单位', '出库仓库', '备注'],
    rows: [[svcKey, '2026-10-20', '苏州精密电子', 'PCB清洗', 'FG-101', 'PCB清洗液', 1, 'L', '成品仓', 'AIERP-008']],
  }])
  const svc = await previewConfirm(token, svcFile, 'service.xlsx', `batch-svc-${stamp}`, 'service')
  const afterSvc = await stock(token, 'FG-101', '成品仓')
  assert('service-stock', svc.confirmed.results[0].status === 'POSTED' && near(afterSvc, beforeSvc - 1), { svc: svc.confirmed, beforeSvc, afterSvc })
  report.chains.service = { businessKey: svcKey, billNumber: svc.confirmed.results[0].billNumber, before: beforeSvc, after: afterSvc, subType: '其它', note: '不是销售' }

  const samplesDir = path.join(ROOT, 'docs', 'poc', 'samples')
  fs.mkdirSync(samplesDir, { recursive: true })
  fs.writeFileSync(path.join(samplesDir, 'purchase-demo.xlsx'), purchaseFile)
  fs.writeFileSync(path.join(samplesDir, 'mix-demo.xlsx'), mixFile)
  fs.writeFileSync(path.join(samplesDir, 'service-demo.xlsx'), svcFile)
  report.samples = ['docs/poc/samples/purchase-demo.xlsx', 'docs/poc/samples/mix-demo.xlsx', 'docs/poc/samples/service-demo.xlsx']
  report.ok = report.checks.every((c) => c.pass)
}

async function main() {
  const before = mysql("SELECT platform_value FROM jsh_platform_config WHERE platform_key='checkcode_flag'")[0]
  mysql("UPDATE jsh_platform_config SET platform_value='0' WHERE platform_key='checkcode_flag'")
  try {
    await run()
  } finally {
    mysql(`UPDATE jsh_platform_config SET platform_value='${before === '1' ? '1' : '0'}' WHERE platform_key='checkcode_flag'`)
  }
  report.finishedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`Wrote ${reportPath} ok=${report.ok}`)
  if (!report.ok) process.exit(1)
}
main().catch((err) => {
  report.ok = false
  report.error = String(err.stack || err)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.error(err)
  process.exit(1)
})
