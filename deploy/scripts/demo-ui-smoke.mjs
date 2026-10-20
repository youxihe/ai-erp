#!/usr/bin/env node
/**
 * Light UI contract checks for AIERP-009. Does not post new ERP bills.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const vuePath = path.join(ROOT, 'jshERP-web', 'src', 'views', 'dashboard', 'AierpDemo.vue')
const e2ePath = path.join(ROOT, 'deploy', 'scripts', 'demo-e2e.mjs')
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const reportPath = path.join(ROOT, 'docs', 'poc', 'evidence', `demo-ui-${stamp}.json`)
const report = { startedAt: new Date().toISOString(), checks: [], ok: false }

function assert(name, cond, detail) {
  report.checks.push({ name, pass: !!cond, detail })
  if (!cond) throw new Error(`${name}: ${JSON.stringify(detail)}`)
}

const vue = fs.readFileSync(vuePath, 'utf8')
const e2e = fs.readFileSync(e2ePath, 'utf8')

assert('row-status-uses-results', vue.includes('resultOf(row.businessKey)') && vue.includes('已审核'), 'missing result binding')
assert('confirm-hidden-when-done', vue.includes('hasPendingConfirm') && vue.includes('确认并审核待确认单据'), 'confirm gate missing')
assert('stock-filter', vue.includes('RAW_CODES') && vue.includes('FG_CODES') && vue.includes('displayStocks'), 'stock filter missing')
assert('bill-chinese-type', vue.includes('采购入库') && vue.includes('药水配制') && vue.includes('服务耗料') && vue.includes('displayBills'), 'bill labels missing')
assert('h5-mask-guard', vue.includes('aierp-demo-active') && vue.includes('closeMobileChrome'), 'h5 guard missing')
assert('e2e-relative-exceljs', e2e.includes(".tools', 'excel-node'") && !e2e.includes('D:/ERP/ai-erp/.tools'), e2e.match(/D:\\\\ERP|D:\/ERP/)?.[0] || 'ok')
assert('e2e-install-hint', e2e.includes('npm install exceljs --prefix .tools/excel-node'), 'install hint missing')

report.ok = report.checks.every((c) => c.pass)
report.finishedAt = new Date().toISOString()
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`Wrote ${reportPath} ok=${report.ok}`)
if (!report.ok) process.exit(1)
