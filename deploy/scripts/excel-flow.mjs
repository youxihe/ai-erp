#!/usr/bin/env node
/**
 * AIERP-002 real XLSX round trip against the running jshERP gateway.
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
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || 'aierp_root_change_me'
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const reportPath = path.join(ROOT, 'docs', 'poc', 'evidence', `excel-${stamp}.json`)
const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], ok: false }
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

function assert(name, cond, detail) {
  report.checks.push({ name, pass: !!cond, detail })
  if (!cond) throw new Error(`${name}: ${JSON.stringify(detail)}`)
}
function near(a, b) { return Math.abs(Number(a) - Number(b)) < 0.0001 }
function mysql(sql) {
  const r = spawnSync('docker', ['exec', 'aierp-mysql', 'mysql', '-uroot', `-p${MYSQL_ROOT_PASSWORD}`, '-N', '--default-character-set=utf8mb4', 'jsh_erp', '-e', sql], { encoding: 'utf8' })
  const text = `${r.stdout || ''}\n${r.stderr || ''}`
  if (r.status !== 0) throw new Error(text)
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.includes('Using a password'))
}
async function api(method, urlPath, { token, body, raw } = {}) {
  const headers = {}
  if (token) headers['X-Access-Token'] = token
  let payload
  if (raw) {
    payload = raw
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json;charset=UTF-8'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: payload })
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  let json = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, json, text, buf }
}
async function login() {
  const res = await api('POST', '/user/login', { body: { loginName: 'jsh', password: md5('123456') } })
  if (!res.json?.data?.token) throw new Error(res.text.slice(0, 300))
  return res.json.data.token
}
async function stock(token, barCode, depotName) {
  const res = await api('POST', '/aierp/v1/stock/query', { token, body: { barCode, depotName } })
  if (res.json.code !== 200) throw new Error(res.text.slice(0, 300))
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

async function run() {
  const token = await login()
  const template = await api('GET', '/aierp/v1/excel/template?scene=PURCHASE', { token })
  assert('template-xlsx', template.status === 200 && template.buf.slice(0, 2).toString() === 'PK', { status: template.status, head: template.buf.slice(0, 2).toString() })

  const beforeA = await stock(token, 'RM-A001', '原料仓')
  const purchaseKey = `POC-PI-${stamp}`
  const badKey = `POC-PI-BAD-${stamp}`
  const file = await workbook([{
    name: '02采购入库',
    headers: ['业务单号', '业务日期', '供应商名称', '物料编码', '物料名称', '入库仓库', '入库数量', '单位', '单价(元)', '业务备注'],
    rows: [
      [purchaseKey, '2026-10-20', '华东化工', 'RM-A001', '表面活性剂', '原料仓', 2, 'L', 20, 'AIERP-002 purchase'],
      [badKey, '2026-10-20', '华东化工', 'RM-A001', '表面活性剂', '原料仓', 1, '桶', 20, 'bad unit'],
      [`POC-PI-UNK-${stamp}`, '2026-10-20', '华东化工', 'NO-SUCH', '不存在', '原料仓', 1, 'L', 1, 'unknown'],
    ],
  }])
  const packed = form(file, 'purchase.xlsx')
  const preview = await fetch(BASE + '/aierp/v1/excel/preview', { method: 'POST', headers: { 'X-Access-Token': token, 'Content-Type': packed.contentType }, body: packed.body })
  const previewJson = await preview.json()
  const ready = previewJson.data.records.filter((r) => r.canConfirm)
  const blocked = previewJson.data.records.filter((r) => !r.canConfirm)
  assert('preview-no-post', previewJson.code === 200 && previewJson.data.status === 'PREVIEWED' && previewJson.data.posted === false && ready.length === 1 && blocked.length === 2, previewJson)
  const afterPreview = await stock(token, 'RM-A001', '原料仓')
  assert('preview-stock-unchanged', afterPreview === beforeA, { beforeA, afterPreview })

  const batch = `batch-${stamp}`
  const confirmed = await api('POST', '/aierp/v1/excel/confirm', { token, body: { previewId: previewJson.data.previewId, idempotencyBatchKey: batch } })
  const posted = confirmed.json.data.results.find((r) => r.businessKey === purchaseKey)
  const rejected = confirmed.json.data.results.filter((r) => r.status !== 'POSTED')
  const after = await stock(token, 'RM-A001', '原料仓')
  assert('purchase-posted', confirmed.json.code === 200 && posted?.status === 'POSTED' && posted.billNumber && rejected.length === 2 && near(after, beforeA + 2), { confirmed: confirmed.json, beforeA, after })
  const again = await api('POST', '/aierp/v1/excel/confirm', { token, body: { previewId: previewJson.data.previewId, idempotencyBatchKey: batch } })
  const afterAgain = await stock(token, 'RM-A001', '原料仓')
  assert('batch-idempotent', again.json.data.replayed === true && afterAgain === after, again.json)
  const receipt = await api('GET', `/aierp/v1/excel/receipt?batchId=${batch}`, { token })
  assert('receipt-xlsx', receipt.status === 200 && receipt.buf.slice(0, 2).toString() === 'PK', { status: receipt.status })

  const beforeB = await stock(token, 'RM-B002', '原料仓')
  const beforeFg = await stock(token, 'FG-101', '成品仓')
  const mixFile = await workbook([{
    name: '03药水配制',
    headers: ['配制单号', '日期', '成品编码', '成品名称', '产出数量', '单位', '原料编码', '原料名称', '领用数量', '单位', '备注'],
    rows: [
      [`POC-MIX-${stamp}`, '2026-10-20', 'FG-101', 'PCB清洗液', 1, 'L', 'RM-A001', '表面活性剂', 0.6, 'L', '虚构配比'],
      [`POC-MIX-${stamp}`, '2026-10-20', 'FG-101', 'PCB清洗液', 1, 'L', 'RM-B002', '络合剂', 0.1, 'L', '虚构配比'],
      [`POC-MIX-${stamp}`, '2026-10-20', 'FG-101', 'PCB清洗液', 1, 'L', 'RM-C003', '纯水', 0.3, 'L', '虚构配比'],
    ],
  }])
  const mixPacked = form(mixFile, 'mix.xlsx')
  const mixPreview = await (await fetch(BASE + '/aierp/v1/excel/preview', { method: 'POST', headers: { 'X-Access-Token': token, 'Content-Type': mixPacked.contentType }, body: mixPacked.body })).json()
  assert('mix-grouped', mixPreview.code === 200 && mixPreview.data.records.length === 1 && mixPreview.data.records[0].normalized.lines.length === 3, mixPreview)
  const mixBatch = `mix-${stamp}`
  const mixConfirm = await api('POST', '/aierp/v1/excel/confirm', { token, body: { previewId: mixPreview.data.previewId, idempotencyBatchKey: mixBatch } })
  const fgAfterMix = await stock(token, 'FG-101', '成品仓')
  const bAfterMix = await stock(token, 'RM-B002', '原料仓')
  assert('mix-posted', mixConfirm.json.data.results[0].status === 'POSTED' && near(fgAfterMix, beforeFg + 1) && near(bAfterMix, beforeB - 0.1), { mixConfirm: mixConfirm.json, beforeFg, fgAfterMix, beforeB, bAfterMix })

  const svcFile = await workbook([{
    name: '04服务耗料',
    headers: ['服务单号', '服务日期', '客户名称', '服务项目', '药水编码', '药水名称', '耗用数量', '单位', '出库仓库', '备注'],
    rows: [[`POC-SV-${stamp}`, '2026-10-20', '苏州精密电子', 'PCB清洗', 'FG-101', 'PCB清洗液', 1, 'L', '成品仓', 'AIERP-002 service']],
  }])
  const svcPacked = form(svcFile, 'service.xlsx')
  const svcPreview = await (await fetch(BASE + '/aierp/v1/excel/preview', { method: 'POST', headers: { 'X-Access-Token': token, 'Content-Type': svcPacked.contentType }, body: svcPacked.body })).json()
  const beforeSvc = await stock(token, 'FG-101', '成品仓')
  const svcConfirm = await api('POST', '/aierp/v1/excel/confirm', { token, body: { previewId: svcPreview.data.previewId, idempotencyBatchKey: `svc-${stamp}` } })
  const afterSvc = await stock(token, 'FG-101', '成品仓')
  assert('service-posted', svcConfirm.json.data.results[0].status === 'POSTED' && near(afterSvc, beforeSvc - 1), { svcConfirm: svcConfirm.json, beforeSvc, afterSvc })

  const formulaFile = await workbook([{
    name: '02采购入库',
    headers: ['业务单号', '业务日期', '供应商名称', '物料编码', '物料名称', '入库仓库', '入库数量', '单位', '单价(元)', '业务备注'],
    rows: [[`POC-PI-F-${stamp}`, '2026-10-20', '华东化工', 'RM-A001', '表面活性剂', '原料仓', { formula: '1+1' }, 'L', 20, 'formula']],
  }])
  const formulaPacked = form(formulaFile, 'formula.xlsx')
  const formulaPreview = await (await fetch(BASE + '/aierp/v1/excel/preview', { method: 'POST', headers: { 'X-Access-Token': token, 'Content-Type': formulaPacked.contentType }, body: formulaPacked.body })).json()
  assert('formula-rejected', formulaPreview.code === 200 && formulaPreview.data.records[0].canConfirm === false, formulaPreview)

  report.ok = report.checks.every((c) => c.pass)
}

async function main() {
  const sql = fs.readFileSync(path.join(ROOT, 'deploy', 'sql', '04-aierp-excel.sql'))
  const applied = spawnSync('docker', ['exec', '-i', 'aierp-mysql', 'mysql', '-uroot', `-p${MYSQL_ROOT_PASSWORD}`, '--default-character-set=utf8mb4', 'jsh_erp'], { input: sql })
  if (applied.status !== 0) throw new Error(applied.stderr?.toString() || 'schema')
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
