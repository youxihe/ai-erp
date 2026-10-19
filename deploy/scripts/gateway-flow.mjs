#!/usr/bin/env node
/**
 * AIERP-003 real gateway checks against the running jshERP.
 * Drafts must not change stock. Confirm posts native bills. Failures exit non-zero.
 */
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BASE = process.env.AIERP_BOOT_URL || 'http://127.0.0.1:9999/jshERP-boot'
const MYSQL_ROOT_PASSWORD = process.env.AIERP_MYSQL_ROOT_PASSWORD || 'aierp_root_change_me'
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const reportPath = path.join(ROOT, 'docs', 'poc', 'evidence', `gateway-${stamp}.json`)
const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], ok: false }
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

function assert(name, cond, detail) {
  report.checks.push({ name, pass: !!cond, detail })
  if (!cond) throw new Error(`${name}: ${JSON.stringify(detail)}`)
}

function near(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001
}

function mysql(sql) {
  const r = spawnSync('docker', ['exec', 'aierp-mysql', 'mysql', '-uroot', `-p${MYSQL_ROOT_PASSWORD}`, '-N', '--default-character-set=utf8mb4', 'jsh_erp', '-e', sql], { encoding: 'utf8' })
  const text = `${r.stdout || ''}\n${r.stderr || ''}`
  if (r.status !== 0) throw new Error(text)
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.includes('Using a password'))
}

async function api(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json;charset=UTF-8' }
  if (token) headers['X-Access-Token'] = token
  const res = await fetch(BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json, text }
}

async function login(name, password) {
  const res = await api('POST', '/user/login', { body: { loginName: name, password: md5(password) } })
  if (!res.json?.data?.token) throw new Error(`login ${name} failed ${res.text.slice(0, 300)}`)
  return res.json.data.token
}

async function stock(token, barCode, depotName) {
  const res = await api('POST', '/aierp/v1/stock/query', { token, body: { barCode, depotName } })
  if (res.json.code !== 200) throw new Error(`stock query ${barCode} ${res.text.slice(0, 300)}`)
  return Number(res.json.data.currentStock)
}

function captchaBypassAllowed() {
  if (process.env.AIERP_CAPTCHA_TEST_BYPASS === '0') return false
  try {
    const host = new URL(BASE).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

async function main() {
  const sql = fs.readFileSync(path.join(ROOT, 'deploy', 'sql', '03-aierp-gateway-draft.sql'))
  const applied = spawnSync('docker', ['exec', '-i', 'aierp-mysql', 'mysql', '-uroot', `-p${MYSQL_ROOT_PASSWORD}`, '--default-character-set=utf8mb4', 'jsh_erp'], { input: sql, encoding: 'utf8' })
  if (applied.status !== 0) throw new Error(`gateway schema failed: ${applied.stderr || applied.stdout}`)
  const bypass = captchaBypassAllowed()
  const captchaBefore = bypass
    ? mysql("SELECT platform_value FROM jsh_platform_config WHERE platform_key='checkcode_flag'")[0]
    : null
  if (bypass) {
    mysql("UPDATE jsh_platform_config SET platform_value='0' WHERE platform_key='checkcode_flag'")
  }
  try {
    await runChecks()
    if (bypass) {
      const safe = captchaBefore === '1' ? '1' : '0'
      mysql(`UPDATE jsh_platform_config SET platform_value='${safe}' WHERE platform_key='checkcode_flag'`)
      const after = mysql("SELECT platform_value FROM jsh_platform_config WHERE platform_key='checkcode_flag'")[0]
      if (after !== captchaBefore) throw new Error(`captcha flag not restored: before=${captchaBefore} after=${after}`)
    }
  } catch (err) {
    if (bypass) {
      const safe = captchaBefore === '1' ? '1' : '0'
      try { mysql(`UPDATE jsh_platform_config SET platform_value='${safe}' WHERE platform_key='checkcode_flag'`) } catch {}
    }
    throw err
  }
}

async function runChecks() {
  const token = await login('jsh', '123456')
  const bStock = await stock(token, 'RM-B002', '原料仓')
  if (bStock < 1) {
    const buy = Math.ceil(1 - bStock) + 30
    const key = `b-replenish-${stamp}`
    const draft = await api('POST', '/aierp/v1/purchase/draft', {
      token,
      body: { idempotencyKey: key, organName: '华东化工', remark: 'AIERP-003 replenish RM-B002', lines: [{ barCode: 'RM-B002', depotName: '原料仓', qty: String(buy), unit: 'L' }] },
    })
    assert('replenish-b-draft', draft.json.code === 200, draft.json)
    const confirmed = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: key } })
    assert('replenish-b-posted', confirmed.json.code === 200 && (await stock(token, 'RM-B002', '原料仓')) > 1, confirmed.json)
  }
  const anon = await api('POST', '/aierp/v1/stock/query', { body: { barCode: 'RM-A001', depotName: '原料仓' } })
  assert('no-token-rejected', anon.status === 500 && anon.text.includes('loginOut'), { status: anon.status, text: anon.text.slice(0, 80) })

  const beforeA = await stock(token, 'RM-A001', '原料仓')
  const draftKey = `gw-pi-${stamp}`
  const draft = await api('POST', '/aierp/v1/purchase/draft', {
    token,
    body: {
      idempotencyKey: draftKey,
      organName: '华东化工',
      remark: 'AIERP-003 purchase draft',
      lines: [{ barCode: 'RM-A001', depotName: '原料仓', qty: '2', unit: 'L', unitPrice: '20' }],
    },
  })
  assert('draft-created', draft.json.code === 200 && draft.json.data.status === 'DRAFT' && draft.json.data.posted === false, draft.json)
  const afterDraft = await stock(token, 'RM-A001', '原料仓')
  assert('draft-stock-unchanged', afterDraft === beforeA, { beforeA, afterDraft })
  const billsAfterDraft = mysql(`SELECT COUNT(*) FROM jsh_depot_head WHERE number='GW-PURCHASE-${draft.json.data.draftId}' AND IFNULL(delete_flag,'0')<>'1';`)
  assert('draft-no-native-bill', billsAfterDraft[0] === '0', billsAfterDraft)

  const replay = await api('POST', '/aierp/v1/purchase/draft', {
    token,
    body: {
      idempotencyKey: draftKey,
      organName: '华东化工',
      remark: 'AIERP-003 purchase draft',
      lines: [{ barCode: 'RM-A001', depotName: '原料仓', qty: '2', unit: 'L', unitPrice: '20' }],
    },
  })
  assert('draft-idempotent', replay.json.code === 200 && replay.json.data.replayed === true && replay.json.data.draftId === draft.json.data.draftId, replay.json)

  const confirmed = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: draftKey } })
  assert('confirm-posted', confirmed.json.code === 200 && confirmed.json.data.replayed === false && String(confirmed.json.data.nativeBill?.status) === '1', confirmed.json)
  const pay = mysql(`SELECT CONCAT(change_amount,'|',debt) FROM jsh_depot_head WHERE number='${confirmed.json.data.billNumber}' AND tenant_id=63;`)[0].split('|')
  assert('purchase-unpaid', Number(pay[0]) === 0 && Number(pay[1]) > 0, { changeAmount: pay[0], debt: pay[1] })
  const afterConfirm = await stock(token, 'RM-A001', '原料仓')
  assert('confirm-stock-plus-2', afterConfirm === beforeA + 2, { beforeA, afterConfirm, stockBefore: confirmed.json.data.stockBefore, stockAfter: confirmed.json.data.stockAfter })

  const confirmedAgain = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: draftKey } })
  const afterReplay = await stock(token, 'RM-A001', '原料仓')
  assert('confirm-idempotent', confirmedAgain.json.code === 200 && confirmedAgain.json.data.replayed === true && confirmedAgain.json.data.billNumber === confirmed.json.data.billNumber && afterReplay === afterConfirm, confirmedAgain.json)

  const badUnit = await api('POST', '/aierp/v1/purchase/draft', {
    token,
    body: { idempotencyKey: `bad-unit-${stamp}`, organName: '华东化工', lines: [{ barCode: 'RM-A001', depotName: '原料仓', qty: '1', unit: '桶' }] },
  })
  assert('illegal-unit-rejected', badUnit.json.code === 400, badUnit.json)

  const noDepot = await api('POST', '/aierp/v1/purchase/draft', {
    token,
    body: { idempotencyKey: `no-depot-${stamp}`, organName: '华东化工', lines: [{ barCode: 'RM-A001', depotName: '仓库3', qty: '1', unit: 'L' }] },
  })
  assert('depot-permission-rejected', noDepot.json.code === 403, noDepot.json)

  mysql("INSERT INTO jsh_material (id, category_id, name, model, unit, enabled, tenant_id, delete_flag) SELECT 99001, 901, '跨租户探针', 'XT-99001', 'L', b'1', 999, '0' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM jsh_material WHERE id=99001);")
  mysql("INSERT INTO jsh_material_extend (id, material_id, bar_code, commodity_unit, purchase_decimal, default_flag, tenant_id, delete_flag) SELECT 99001, 99001, 'XT-99001', 'L', 1, '1', 999, '0' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM jsh_material_extend WHERE id=99001);")
  try {
    const cross = await api('POST', '/aierp/v1/purchase/draft', {
      token,
      body: { idempotencyKey: `cross-${stamp}`, organName: '华东化工', lines: [{ barCode: 'XT-99001', depotName: '原料仓', qty: '1', unit: 'L' }] },
    })
    assert('cross-tenant-rejected', cross.json.code === 400, cross.json)
  } finally {
    mysql("DELETE FROM jsh_material_extend WHERE id=99001; DELETE FROM jsh_material WHERE id=99001;")
  }

  const shortKey = `short-${stamp}`
  const shortDraft = await api('POST', '/aierp/v1/service/draft', {
    token,
    body: {
      idempotencyKey: shortKey,
      organName: '苏州精密电子',
      remark: 'AIERP-003 insufficient stock',
      lines: [{ barCode: 'FG-101', depotName: '成品仓', qty: '999999', unit: 'L' }],
    },
  })
  assert('short-draft-saved', shortDraft.json.code === 200 && shortDraft.json.data.status === 'DRAFT', shortDraft.json)
  const fgBefore = await stock(token, 'FG-101', '成品仓')
  const shortConfirm = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: shortKey } })
  const fgAfter = await stock(token, 'FG-101', '成品仓')
  const shortBills = mysql(`SELECT COUNT(*) FROM jsh_depot_head WHERE remark='AIERP-003 insufficient stock' AND IFNULL(delete_flag,'0')<>'1';`)
  assert('short-confirm-rejected', shortConfirm.json.code === 400 && fgAfter === fgBefore && shortBills[0] === '0', { shortConfirm: shortConfirm.json, fgBefore, fgAfter, shortBills })

  const mixKey = `mix-${stamp}`
  const mixDraft = await api('POST', '/aierp/v1/mix/draft', {
    token,
    body: {
      idempotencyKey: mixKey,
      remark: 'AIERP-003 mix fictitious',
      finished: { barCode: 'FG-101', depotName: '成品仓', qty: '1', unit: 'L' },
      lines: [
        { barCode: 'RM-A001', depotName: '原料仓', qty: '0.6', unit: 'L' },
        { barCode: 'RM-B002', depotName: '原料仓', qty: '0.1', unit: 'L' },
        { barCode: 'RM-C003', depotName: '原料仓', qty: '0.3', unit: 'L' },
      ],
    },
  })
  assert('mix-draft', mixDraft.json.code === 200, mixDraft.json)
  const aBeforeMix = await stock(token, 'RM-A001', '原料仓')
  const fgBeforeMix = await stock(token, 'FG-101', '成品仓')
  const mixConfirm = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: mixKey } })
  const aAfterMix = await stock(token, 'RM-A001', '原料仓')
  const fgAfterMix = await stock(token, 'FG-101', '成品仓')
  assert('mix-posted', mixConfirm.json.code === 200 && mixConfirm.json.data.nativeBill?.sub_type === '组装单' && near(aAfterMix, aBeforeMix - 0.6) && near(fgAfterMix, fgBeforeMix + 1), { mixConfirm: mixConfirm.json, aBeforeMix, aAfterMix, fgBeforeMix, fgAfterMix })

  const partialKey = `partial-${stamp}`
  const partial = await api('POST', '/aierp/v1/mix/draft', {
    token,
    body: {
      idempotencyKey: partialKey,
      remark: 'AIERP-003 partial mix must fail wholly',
      finished: { barCode: 'FG-101', depotName: '成品仓', qty: '1', unit: 'L' },
      lines: [
        { barCode: 'RM-A001', depotName: '原料仓', qty: '0.1', unit: 'L' },
        { barCode: 'RM-B002', depotName: '原料仓', qty: '999999', unit: 'L' },
      ],
    },
  })
  assert('partial-draft', partial.json.code === 200, partial.json)
  const fgBeforePartial = await stock(token, 'FG-101', '成品仓')
  const partialConfirm = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: partialKey } })
  const fgAfterPartial = await stock(token, 'FG-101', '成品仓')
  const partialBills = mysql("SELECT COUNT(*) FROM jsh_depot_head WHERE remark='AIERP-003 partial mix must fail wholly';")
  assert('partial-mix-rejected', partialConfirm.json.code === 400 && fgAfterPartial === fgBeforePartial && partialBills[0] === '0', { partialConfirm: partialConfirm.json, fgBeforePartial, fgAfterPartial, partialBills })

  const svcKey = `svc-${stamp}`
  const svc = await api('POST', '/aierp/v1/service/draft', {
    token,
    body: {
      idempotencyKey: svcKey,
      organName: '苏州精密电子',
      remark: 'AIERP-003 service consume',
      lines: [{ barCode: 'FG-101', depotName: '成品仓', qty: '1', unit: 'L' }],
    },
  })
  assert('service-draft', svc.json.code === 200, svc.json)
  const fgBeforeSvc = await stock(token, 'FG-101', '成品仓')
  const svcConfirm = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: svcKey } })
  const fgAfterSvc = await stock(token, 'FG-101', '成品仓')
  assert('service-is-other-out', svcConfirm.json.code === 200 && svcConfirm.json.data.nativeBill?.type === '出库' && svcConfirm.json.data.nativeBill?.sub_type === '其它' && Number(svcConfirm.json.data.nativeBill?.organ_id) === 911 && fgAfterSvc === fgBeforeSvc - 1, svcConfirm.json)

  await lowPrivilegeChecks(stamp)
  await crossTenantBillCheck(token, stamp)
  await concurrentOutboundCheck(token, stamp)
  await lockProbeCheck(token, stamp)

  const summary = await api('POST', '/aierp/v1/report/summary', { token, body: {} })
  assert('summary-real', summary.json.code === 200 && summary.json.data.nature === 'REAL_ERP' && summary.json.data.loginName === 'jsh' && summary.json.data.confirmedCount >= 3, summary.json.data)

  report.ok = report.checks.every((c) => c.pass)
  report.finishedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log(`\nWrote ${reportPath}`)
  if (!report.ok) process.exit(1)
}

function cleanupProbeUsers() {
  mysql("DELETE FROM jsh_user_business WHERE key_id IN ('99021','99022'); DELETE FROM aierp_gateway_draft WHERE user_id IN (99021,99022); DELETE FROM jsh_user WHERE id IN (99021,99022); DELETE FROM jsh_role WHERE id IN (99021,99022);")
}

async function lowPrivilegeChecks(stamp) {
  cleanupProbeUsers()
  mysql("INSERT INTO jsh_role (id, name, type, enabled, tenant_id, delete_flag) VALUES (99021, 'AIERP_STOCK_ONLY', '个人数据', b'1', 63, '0'), (99022, 'AIERP_PURCHASE_NO_AUDIT', '个人数据', b'1', 63, '0');")
  mysql("INSERT INTO jsh_user (id, username, login_name, password, leader_flag, ismanager, isystem, status, tenant_id, delete_flag) VALUES (99021, 'AIERP_STOCK_ONLY', 'aierp_stock', 'e10adc3949ba59abbe56e057f20f883e', '0', 1, 0, 0, 63, '0'), (99022, 'AIERP_PURCHASE_NO_AUDIT', 'aierp_buyer', 'e10adc3949ba59abbe56e057f20f883e', '0', 1, 0, 0, 63, '0');")
  mysql("INSERT INTO jsh_user_business (type, key_id, `value`, btn_str, tenant_id, delete_flag) VALUES ('RoleFunctions','99021','[246]', NULL, 63, '0'), ('UserRole','99021','[99021]', NULL, 63, '0'), ('UserDepot','99021','[14][15]', NULL, 63, '0'), ('RoleFunctions','99022','[33][246]','[{\\\"funId\\\":33,\\\"btnStr\\\":\\\"1\\\"}]', 63, '0'), ('UserRole','99022','[99022]', NULL, 63, '0'), ('UserDepot','99022','[14]', NULL, 63, '0');")
  try {
    const reader = await login('aierp_stock', '123456')
    const readable = await api('POST', '/aierp/v1/stock/query', { token: reader, body: { barCode: 'RM-A001', depotName: '原料仓' } })
    const deniedWrite = await api('POST', '/aierp/v1/purchase/draft', {
      token: reader,
      body: { idempotencyKey: `ro-${stamp}`, organName: '华东化工', lines: [{ barCode: 'RM-A001', depotName: '原料仓', qty: '1', unit: 'L' }] },
    })
    assert('reader-can-query', readable.json.code === 200 && readable.json.data.loginName === 'aierp_stock', readable.json)
    assert('reader-cannot-purchase', deniedWrite.json.code === 403, deniedWrite.json)

    const buyer = await login('aierp_buyer', '123456')
    const buyerStock = await api('POST', '/aierp/v1/stock/query', { token: buyer, body: { barCode: 'RM-A001', depotName: '原料仓' } })
    const buyerDraft = await api('POST', '/aierp/v1/purchase/draft', {
      token: buyer,
      body: { idempotencyKey: `buyer-${stamp}`, organName: '华东化工', remark: 'AIERP-003 buyer no audit', lines: [{ barCode: 'RM-A001', depotName: '原料仓', qty: '1', unit: 'L' }] },
    })
    const buyerOtherDepot = await api('POST', '/aierp/v1/purchase/draft', {
      token: buyer,
      body: { idempotencyKey: `buyer-depot-${stamp}`, organName: '华东化工', lines: [{ barCode: 'FG-101', depotName: '成品仓', qty: '1', unit: 'L' }] },
    })
    const buyerConfirm = await api('POST', '/aierp/v1/draft/confirm', { token: buyer, body: { idempotencyKey: `buyer-${stamp}` } })
    const buyerBills = mysql("SELECT COUNT(*) FROM jsh_depot_head WHERE remark='AIERP-003 buyer no audit' AND IFNULL(delete_flag,'0')<>'1';")
    assert('buyer-can-query-and-draft', buyerStock.json.code === 200 && buyerDraft.json.code === 200 && buyerDraft.json.data.status === 'DRAFT', { buyerStock: buyerStock.json, buyerDraft: buyerDraft.json })
    assert('buyer-cannot-other-depot', buyerOtherDepot.json.code === 403, buyerOtherDepot.json)
    assert('buyer-cannot-audit', buyerConfirm.json.code === 403 && buyerBills[0] === '0', { buyerConfirm: buyerConfirm.json, buyerBills })
  } finally {
    cleanupProbeUsers()
  }
}

async function crossTenantBillCheck(token, stamp) {
  const key = `own-${stamp}`
  const draft = await api('POST', '/aierp/v1/service/draft', {
    token,
    body: {
      idempotencyKey: key,
      organName: '苏州精密电子',
      remark: 'AIERP-003 own tenant bill',
      lines: [{ barCode: 'FG-101', depotName: '成品仓', qty: '1', unit: 'L' }],
    },
  })
  assert('own-draft', draft.json.code === 200, draft.json)
  const number = `GW-SERVICE-${draft.json.data.draftId}`
  mysql(`INSERT INTO jsh_depot_head (type, sub_type, number, status, tenant_id, delete_flag, remark) VALUES ('出库','其它','${number}','0',999,'0','AIERP-003 cross tenant decoy');`)
  try {
    const before = await stock(token, 'FG-101', '成品仓')
    const confirmed = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: key } })
    const after = await stock(token, 'FG-101', '成品仓')
    const decoy = mysql(`SELECT CONCAT(status,'|',tenant_id) FROM jsh_depot_head WHERE number='${number}' AND tenant_id=999 AND remark='AIERP-003 cross tenant decoy';`)
    const own = mysql(`SELECT CONCAT(status,'|',tenant_id) FROM jsh_depot_head WHERE number='${number}' AND tenant_id=63 AND IFNULL(delete_flag,'0')<>'1';`)
    assert('cross-tenant-bill-not-audited', confirmed.json.code === 200 && confirmed.json.data.billNumber === number && decoy[0] === '0|999' && own[0] === '1|63' && after === before - 1, { confirmed: confirmed.json, decoy, own, before, after })
  } finally {
    mysql(`DELETE FROM jsh_depot_head WHERE number='${number}' AND tenant_id=999 AND remark='AIERP-003 cross tenant decoy';`)
  }
}

async function concurrentOutboundCheck(token, stamp) {
  let before = await stock(token, 'RM-B002', '原料仓')
  if (before < 3) {
    const buy = Math.ceil(3 - before) + 20
    const key = `race-buy-${stamp}`
    const draft = await api('POST', '/aierp/v1/purchase/draft', {
      token,
      body: {
        idempotencyKey: key,
        organName: '华东化工',
        remark: 'AIERP-003 race replenish',
        lines: [{ barCode: 'RM-B002', depotName: '原料仓', qty: String(buy), unit: 'L' }],
      },
    })
    assert('concurrent-replenish-draft', draft.json.code === 200, draft.json)
    const confirmed = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: key } })
    assert('concurrent-replenish-posted', confirmed.json.code === 200, confirmed.json)
    before = await stock(token, 'RM-B002', '原料仓')
  }
  const each = Math.floor(Number(before) / 2) + 1
  assert('concurrent-qty-fits-one', each > 0 && each < Number(before) && each * 2 > Number(before), { before, each })
  const keys = [`race-a-${stamp}`, `race-b-${stamp}`]
  for (const key of keys) {
    const draft = await api('POST', '/aierp/v1/service/draft', {
      token,
      body: {
        idempotencyKey: key,
        organName: '苏州精密电子',
        remark: `AIERP-003 race ${key}`,
        lines: [{ barCode: 'RM-B002', depotName: '原料仓', qty: String(each), unit: 'L' }],
      },
    })
    assert(`concurrent-draft-${key}`, draft.json.code === 200, draft.json)
  }
  const [left, right] = await Promise.all(keys.map((key) => api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: key } })))
  const codes = [left.json.code, right.json.code].sort((a, b) => a - b)
  const after = await stock(token, 'RM-B002', '原料仓')
  const posted = mysql(`SELECT COUNT(*) FROM jsh_depot_head WHERE remark LIKE 'AIERP-003 race race-%${stamp}' AND status='1' AND tenant_id=63 AND IFNULL(delete_flag,'0')<>'1';`)
  const numbers = [left.json.data?.billNumber, right.json.data?.billNumber].filter(Boolean)
  assert('concurrent-one-wins', codes[0] === 200 && codes[1] === 400 && near(after, before - each) && posted[0] === '1' && new Set(numbers).size === numbers.length, { codes, before, after, each, posted, left: left.json, right: right.json })
}

async function lockProbeCheck(token, stamp) {
  const key = `lock-probe-${stamp}`
  const draft = await api('POST', '/aierp/v1/mix/draft', {
    token,
    body: {
      idempotencyKey: key,
      remark: 'AIERP-003 lock-probe',
      finished: { barCode: 'FG-101', depotName: '成品仓', qty: '1', unit: 'L' },
      lines: [
        { barCode: 'RM-A001', depotName: '原料仓', qty: '0.1', unit: 'L' },
        { barCode: 'RM-C003', depotName: '原料仓', qty: '0.1', unit: 'L' },
      ],
    },
  })
  assert('lock-probe-draft', draft.json.code === 200, draft.json)
  const started = Date.now()
  const probed = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: key } })
  const followKey = `lock-follow-${stamp}`
  const followDraft = await api('POST', '/aierp/v1/service/draft', {
    token,
    body: {
      idempotencyKey: followKey,
      organName: '苏州精密电子',
      remark: 'AIERP-003 lock follow',
      lines: [{ barCode: 'RM-A001', depotName: '原料仓', qty: '0.1', unit: 'L' }],
    },
  })
  const before = await stock(token, 'RM-A001', '原料仓')
  const followed = await api('POST', '/aierp/v1/draft/confirm', { token, body: { idempotencyKey: followKey } })
  const after = await stock(token, 'RM-A001', '原料仓')
  const elapsed = Date.now() - started
  const probeBills = mysql("SELECT COUNT(*) FROM jsh_depot_head WHERE remark='AIERP-003 lock-probe' AND IFNULL(delete_flag,'0')<>'1';")
  assert('lock-probe-rolls-back', probed.json.code === 409 && String(probed.json.data?.message || '').includes('第一把行锁') && probeBills[0] === '0' && followDraft.json.code === 200 && followed.json.code === 200 && near(after, before - 0.1) && elapsed < 15000, { probed: probed.json, followed: followed.json, before, after, elapsed, probeBills })
}

main().catch((err) => {
  report.ok = false
  report.error = String(err.stack || err)
  report.finishedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.error(err)
  console.error(`Wrote failure evidence: ${reportPath}`)
  process.exit(1)
})
