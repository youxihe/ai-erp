#!/usr/bin/env node
/**
 * AIERP-001 baseline: native jshERP bills + stock before/after audit.
 * Uses HTTP APIs only — never updates jsh_material_current_stock directly.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BASE = process.env.AIERP_BOOT_URL || 'http://127.0.0.1:9999/jshERP-boot'
const LOGIN_NAME = process.env.AIERP_LOGIN_NAME || 'jsh'
const LOGIN_PASSWORD = process.env.AIERP_LOGIN_PASSWORD || '123456'
const DEPOT_RAW = Number(process.env.AIERP_DEPOT_RAW || 14)
const DEPOT_FG = Number(process.env.AIERP_DEPOT_FG || 15)
const SUPPLIER_ID = Number(process.env.AIERP_SUPPLIER_ID || 901)
const CUSTOMER_ID = Number(process.env.AIERP_CUSTOMER_ID || 911)
const ACCOUNT_ID = Number(process.env.AIERP_ACCOUNT_ID || 17)

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const outDir = path.join(ROOT, 'docs', 'poc', 'evidence')
fs.mkdirSync(outDir, { recursive: true })
const reportPath = path.join(outDir, `baseline-${stamp}.json`)

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

async function api(method, urlPath, { token, body, query } = {}) {
  const u = new URL(BASE + urlPath)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
    }
  }
  const headers = { 'Content-Type': 'application/json;charset=UTF-8' }
  if (token) headers['X-Access-Token'] = token
  const res = await fetch(u, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${urlPath} non-JSON (${res.status}): ${text.slice(0, 300)}`)
  }
  return { status: res.status, json }
}

async function login() {
  const { json } = await api('POST', '/user/login', {
    body: { loginName: LOGIN_NAME, password: md5(LOGIN_PASSWORD) },
  })
  if (json.code !== 200 || !json.data?.token) {
    throw new Error(`login failed: ${JSON.stringify(json)}`)
  }
  return json.data.token
}

async function stockOf(token, barCode, depotId) {
  const { json } = await api('GET', '/material/getListWithStock', {
    token,
    query: {
      currentPage: 1,
      pageSize: 50,
      depotIds: depotId,
      materialParam: barCode,
      zeroStock: 1,
      column: 'createTime',
      order: 'desc',
    },
  })
  if (json.code !== 200) {
    throw new Error(`stock query failed: ${JSON.stringify(json)}`)
  }
  const rows = json?.data?.rows || []
  const hit = rows.find((r) => r.mBarCode === barCode || r.model === barCode)
  if (!hit) return { found: false, currentStock: 0, raw: null }
  const currentStock = Number(hit.currentStock ?? 0)
  return { found: true, currentStock, raw: { id: hit.id, mBarCode: hit.mBarCode, currentStock } }
}

async function addBill(token, info, rows) {
  const { json } = await api('POST', '/depotHead/addDepotHeadAndDetail', {
    token,
    body: { info: JSON.stringify(info), rows: JSON.stringify(rows) },
  })
  if (json.code !== 200) {
    throw new Error(`add bill failed: ${JSON.stringify(json)}`)
  }
  return json
}

async function findBillId(token, number) {
  const { json } = await api('GET', '/depotHead/getDetailByNumber', {
    token,
    query: { number },
  })
  if (json.code !== 200 || !json.data?.id) {
    throw new Error(`bill not found: ${number} resp=${JSON.stringify(json).slice(0, 400)}`)
  }
  return json.data.id
}

async function audit(token, id) {
  const { json } = await api('POST', '/depotHead/batchSetStatus', {
    token,
    body: { status: '1', ids: String(id) },
  })
  if (json.code !== 200) {
    throw new Error(`audit failed id=${id}: ${JSON.stringify(json)}`)
  }
  return json
}

function nowStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function main() {
  const report = { startedAt: new Date().toISOString(), base: BASE, steps: [] }
  const token = await login()
  report.steps.push({ step: 'login', ok: true, user: LOGIN_NAME })

  const materials = ['RM-A001', 'RM-B002', 'RM-C003', 'FG-101']
  const before = {}
  for (const code of materials) {
    const depotId = code.startsWith('FG') ? DEPOT_FG : DEPOT_RAW
    before[code] = await stockOf(token, code, depotId)
  }
  report.steps.push({ step: 'stock_before', before })

  // 1) Purchase in — unapproved first
  const piNo = `POC-PI-${stamp}`
  const piQty = 80
  const piPrice = 20
  const piInfo = {
    type: '入库',
    subType: '采购',
    organId: SUPPLIER_ID,
    operTime: nowStr(),
    number: piNo,
    accountId: ACCOUNT_ID,
    // Match native UI: positive line amounts, then negate header totals for 采购入库
    changeAmount: -(piQty * piPrice),
    totalPrice: -(piQty * piPrice),
    discount: 0,
    discountMoney: 0,
    discountLastMoney: piQty * piPrice,
    otherMoney: 0,
    deposit: 0,
    status: '0',
    remark: 'AIERP-001 baseline purchase',
  }
  const piRows = [
    {
      depotId: String(DEPOT_RAW),
      barCode: 'RM-A001',
      name: '表面活性剂',
      unit: 'L',
      operNumber: piQty,
      unitPrice: piPrice,
      allPrice: piQty * piPrice,
      taxRate: 0,
      taxMoney: 0,
      taxLastMoney: piQty * piPrice,
    },
  ]
  await addBill(token, piInfo, piRows)
  const afterCreatePi = await stockOf(token, 'RM-A001', DEPOT_RAW)
  const piId = await findBillId(token, piNo)
  await audit(token, piId)
  const afterAuditPi = await stockOf(token, 'RM-A001', DEPOT_RAW)
  report.steps.push({
    step: 'purchase_in',
    number: piNo,
    id: piId,
    qty: piQty,
    stockAfterCreateUnapproved: afterCreatePi.currentStock,
    stockAfterAudit: afterAuditPi.currentStock,
    deltaOnAudit: afterAuditPi.currentStock - afterCreatePi.currentStock,
  })

  // Also buy B/C for assemble recipe
  for (const [code, qty, price] of [
    ['RM-B002', 20, 35],
    ['RM-C003', 50, 1],
  ]) {
    const no = `POC-PI-${code}-${stamp}`
    const info = {
      type: '入库',
      subType: '采购',
      organId: SUPPLIER_ID,
      operTime: nowStr(),
      number: no,
      accountId: ACCOUNT_ID,
      changeAmount: -(qty * price),
      totalPrice: -(qty * price),
      discount: 0,
      discountMoney: 0,
      discountLastMoney: qty * price,
      otherMoney: 0,
      deposit: 0,
      status: '0',
      remark: 'AIERP-001 baseline feed stock',
    }
    const rows = [
      {
        depotId: String(DEPOT_RAW),
        barCode: code,
        unit: 'L',
        operNumber: qty,
        unitPrice: price,
        allPrice: qty * price,
        taxRate: 0,
        taxMoney: 0,
        taxLastMoney: qty * price,
      },
    ]
    await addBill(token, info, rows)
    await audit(token, await findBillId(token, no))
  }

  // 2) Assemble mix: FG-101 100L from A60/B10/C30 — fictitious ratio
  const mixNo = `POC-MIX-${stamp}`
  const mixInfo = {
    type: '其它',
    subType: '组装单',
    operTime: nowStr(),
    number: mixNo,
    totalPrice: 0,
    status: '0',
    remark: 'AIERP-001 baseline assemble (fictitious ratio)',
  }
  const mixRows = [
    {
      depotId: String(DEPOT_FG),
      barCode: 'FG-101',
      unit: 'L',
      operNumber: 100,
      unitPrice: 28,
      allPrice: 2800,
      mType: '组合件',
    },
    {
      depotId: String(DEPOT_RAW),
      barCode: 'RM-A001',
      unit: 'L',
      operNumber: 60,
      unitPrice: 20,
      allPrice: 1200,
      mType: '普通子件',
    },
    {
      depotId: String(DEPOT_RAW),
      barCode: 'RM-B002',
      unit: 'L',
      operNumber: 10,
      unitPrice: 35,
      allPrice: 350,
      mType: '普通子件',
    },
    {
      depotId: String(DEPOT_RAW),
      barCode: 'RM-C003',
      unit: 'L',
      operNumber: 30,
      unitPrice: 1,
      allPrice: 30,
      mType: '普通子件',
    },
  ]
  const stockBeforeMix = {
    'RM-A001': (await stockOf(token, 'RM-A001', DEPOT_RAW)).currentStock,
    'FG-101': (await stockOf(token, 'FG-101', DEPOT_FG)).currentStock,
  }
  await addBill(token, mixInfo, mixRows)
  const mixId = await findBillId(token, mixNo)
  const stockCreateMix = {
    'RM-A001': (await stockOf(token, 'RM-A001', DEPOT_RAW)).currentStock,
    'FG-101': (await stockOf(token, 'FG-101', DEPOT_FG)).currentStock,
  }
  await audit(token, mixId)
  const stockAuditMix = {
    'RM-A001': (await stockOf(token, 'RM-A001', DEPOT_RAW)).currentStock,
    'FG-101': (await stockOf(token, 'FG-101', DEPOT_FG)).currentStock,
  }
  report.steps.push({
    step: 'assemble',
    number: mixNo,
    id: mixId,
    stockBefore: stockBeforeMix,
    stockAfterCreateUnapproved: stockCreateMix,
    stockAfterAudit: stockAuditMix,
  })

  // 3) Other out — service consume FG-101 20L
  const svNo = `POC-SV-${stamp}`
  const svQty = 20
  const stockBeforeSv = (await stockOf(token, 'FG-101', DEPOT_FG)).currentStock
  const svInfo = {
    type: '出库',
    subType: '其它',
    organId: CUSTOMER_ID,
    operTime: nowStr(),
    number: svNo,
    totalPrice: svQty * 45,
    status: '0',
    remark: 'AIERP-001 baseline service consume',
  }
  const svRows = [
    {
      depotId: String(DEPOT_FG),
      barCode: 'FG-101',
      unit: 'L',
      operNumber: svQty,
      unitPrice: 45,
      allPrice: svQty * 45,
    },
  ]
  await addBill(token, svInfo, svRows)
  const stockCreateSv = (await stockOf(token, 'FG-101', DEPOT_FG)).currentStock
  const svId = await findBillId(token, svNo)
  await audit(token, svId)
  const stockAuditSv = (await stockOf(token, 'FG-101', DEPOT_FG)).currentStock
  report.steps.push({
    step: 'other_out',
    number: svNo,
    id: svId,
    qty: svQty,
    stockBefore: stockBeforeSv,
    stockAfterCreateUnapproved: stockCreateSv,
    stockAfterAudit: stockAuditSv,
    deltaOnAudit: stockAuditSv - stockCreateSv,
  })

  const after = {}
  for (const code of materials) {
    const depotId = code.startsWith('FG') ? DEPOT_FG : DEPOT_RAW
    after[code] = await stockOf(token, code, depotId)
  }
  report.steps.push({ step: 'stock_after', after })
  report.finishedAt = new Date().toISOString()
  report.ok = true

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
  console.log(`\nWrote evidence: ${reportPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
