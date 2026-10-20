<template>
  <div class="desk" :class="{ mobile: isNarrow }">
    <header class="top">
      <div>
        <p class="eyebrow">PCB 清洗 · 真实 ERP</p>
        <h1>AI 进销存演示</h1>
        <p class="lead">库存和单据来自当前登录租户。上传只产生预览，确认后才审核原生单据。</p>
      </div>
      <button class="ghost" @click="loadSummary">刷新库存</button>
    </header>

    <p v-if="banner" class="banner" :class="banner.kind">{{ banner.text }}</p>

    <section class="grid">
      <article v-for="row in displayStocks" :key="row.barCode + row.depotName" class="card">
        <span>{{ row.depotName }}</span>
        <strong>{{ formatQty(row.currentStock) }}</strong>
        <em>{{ row.barCode }}</em>
      </article>
      <article v-if="!displayStocks.length" class="card muted">库存接口未返回可用卡片</article>
    </section>

    <section class="split">
      <div class="panel">
        <h2>业务入口</h2>
        <div class="scenes">
          <button v-for="scene in scenes" :key="scene.id" :class="{ on: active === scene.id }" @click="active = scene.id">
            <b>{{ scene.title }}</b>
            <span>{{ scene.hint }}</span>
          </button>
        </div>
        <div class="actions">
          <button @click="downloadTemplate">下载 {{ current.title }} Excel</button>
          <label class="file">
            上传填写后的 xlsx
            <input id="aierp-file" ref="fileInput" type="file" accept=".xlsx" @change="onFile" />
          </label>
        </div>
        <p class="state">当前状态：{{ stageLabel }}</p>
        <table v-if="records.length">
          <thead>
            <tr><th>业务单</th><th>数量</th><th>状态</th><th>说明 / 单据</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in records" :key="row.businessKey">
              <td>{{ row.businessKey }}</td>
              <td>{{ qtyText(row) }}</td>
              <td>
                <span class="tag" :class="rowStatusClass(row)">{{ rowStatus(row) }}</span>
              </td>
              <td>
                <template v-if="resultOf(row.businessKey) && resultOf(row.businessKey).billNumber">
                  <code class="bill">{{ resultOf(row.businessKey).billNumber }}</code>
                  <button class="linkish" type="button" @click="copyText(resultOf(row.businessKey).billNumber)">复制单号</button>
                </template>
                <template v-else>{{ messageOf(row) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="actions" v-if="previewId">
          <button
            v-if="hasPendingConfirm"
            class="solid"
            :disabled="busy || !hasPendingConfirm"
            @click="confirmPreview"
          >确认并审核待确认单据</button>
          <button v-if="batchId" class="ghost" @click="downloadReceipt">下载回执</button>
        </div>
        <ul v-if="results.length" class="results">
          <li v-for="item in results" :key="item.businessKey + item.status">
            {{ item.businessKey }} · {{ statusLabel(item.status) }}
            <template v-if="item.billNumber"> · <code>{{ item.billNumber }}</code></template>
            <template v-else-if="item.error"> · {{ item.error }}</template>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>最近单据</h2>
        <ul class="bills">
          <li v-for="bill in displayBills" :key="bill.number">
            <div class="bill-row">
              <code class="bill">{{ bill.number }}</code>
              <button class="linkish" type="button" @click="copyText(bill.number)">复制</button>
            </div>
            <span>{{ bill.typeLabel }} · {{ bill.timeLabel }}</span>
          </li>
          <li v-if="!displayBills.length">还没有经网关确认的单据</li>
        </ul>
        <h2>助手</h2>
        <p class="mode">{{ assistantMode }}</p>
        <div class="chat">
          <p v-for="(line, index) in chat" :key="index" :class="line.role">{{ line.text }}</p>
        </div>
        <div class="composer">
          <input v-model="draft" placeholder="例如：查表面活性剂库存" @keyup.enter="ask" />
          <button @click="ask">发送</button>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { axios } from '@/utils/request'

const SCENES = [
  { id: 'PURCHASE', title: '采购入库', hint: '原料增加' },
  { id: 'MIX', title: '药水配制', hint: '原料减少，成品增加' },
  { id: 'SERVICE', title: '服务耗料', hint: '成品减少，不是销售' }
]
const RAW_CODES = ['RM-A001', 'RM-B002', 'RM-C003']
const FG_CODES = ['FG-101', 'FG-102']
const TYPE_LABEL = {
  PURCHASE: '采购入库',
  MIX: '药水配制',
  SERVICE: '服务耗料'
}

export default {
  name: 'AierpDemo',
  data () {
    return {
      scenes: SCENES,
      active: 'PURCHASE',
      stocks: [],
      bills: [],
      banner: null,
      stage: 'idle',
      previewId: '',
      records: [],
      results: [],
      batchId: '',
      lastConfirmKey: '',
      busy: false,
      conversationId: '',
      chat: [{ role: 'bot', text: '本地规则演示。我可以查询真实库存、引导下载 Excel。确认过账只能由你点击按钮完成。' }],
      draft: '',
      assistantMode: '本地规则演示（RULE_DEMO）· 使用当前登录 ERP 会话',
      isNarrow: false,
      mediaQuery: null
    }
  },
  computed: {
    current () {
      return this.scenes.find(item => item.id === this.active)
    },
    displayStocks () {
      return (this.stocks || []).filter(row => {
        const qty = Number(row.currentStock)
        if (row.depotName === '原料仓' && RAW_CODES.indexOf(row.barCode) >= 0) {
          return true
        }
        if (row.depotName === '成品仓' && FG_CODES.indexOf(row.barCode) >= 0) {
          // keep FG-101 even at 0 for demo continuity; drop other empty finished SKUs
          return qty > 0 || row.barCode === 'FG-101'
        }
        return false
      })
    },
    displayBills () {
      return (this.bills || []).map(bill => {
        const number = bill.bill_number || bill.billNumber || ''
        const type = bill.biz_type || bill.bizType || ''
        const time = bill.confirm_time || bill.confirmTime || ''
        return {
          number,
          typeLabel: TYPE_LABEL[type] || type || '业务单据',
          timeLabel: this.formatTime(time)
        }
      })
    },
    hasPendingConfirm () {
      return this.records.some(row => row.canConfirm && !this.resultOf(row.businessKey))
    },
    stageLabel () {
      if (this.stage === 'posted') return '已入账'
      if (this.stage === 'previewed' && this.hasPendingConfirm) return '已解析，待确认'
      if (this.stage === 'previewed' && this.results.length) return '已处理完毕'
      return {
        idle: '待上传',
        previewed: '已解析，待确认',
        posted: '已入账',
        failed: '失败'
      }[this.stage] || this.stage
    }
  },
  created () {
    this.loadSummary()
  },
  mounted () {
    this.closeMobileChrome()
    this.mediaQuery = window.matchMedia('(max-width: 800px)')
    this.isNarrow = this.mediaQuery.matches
    this.onNarrow = (event) => {
      this.isNarrow = event.matches
      if (event.matches) this.closeMobileChrome()
    }
    if (this.mediaQuery.addEventListener) {
      this.mediaQuery.addEventListener('change', this.onNarrow)
    } else if (this.mediaQuery.addListener) {
      this.mediaQuery.addListener(this.onNarrow)
    }
    document.body.classList.add('aierp-demo-active')
  },
  beforeDestroy () {
    document.body.classList.remove('aierp-demo-active')
    if (!this.mediaQuery) return
    if (this.mediaQuery.removeEventListener) {
      this.mediaQuery.removeEventListener('change', this.onNarrow)
    } else if (this.mediaQuery.removeListener) {
      this.mediaQuery.removeListener(this.onNarrow)
    }
  },
  methods: {
    closeMobileChrome () {
      try {
        if (this.$store && this.$store.dispatch) {
          this.$store.dispatch('setSidebar', true)
        }
      } catch (e) { /* ignore */ }
      this.$nextTick(() => {
        document.querySelectorAll('.ant-drawer-open .ant-drawer-mask, .drawer-sider .ant-drawer-mask').forEach(el => {
          el.click()
        })
        document.querySelectorAll('.ant-drawer-open').forEach(el => {
          el.classList.remove('ant-drawer-open')
        })
        document.querySelectorAll('.ant-drawer-mask, .setting-drawer, .setting-drawer-index-handle').forEach(el => {
          el.setAttribute('hidden', 'true')
          el.setAttribute('aria-hidden', 'true')
          if (el.style) {
            el.style.setProperty('display', 'none', 'important')
            el.style.setProperty('visibility', 'hidden', 'important')
            el.style.setProperty('pointer-events', 'none', 'important')
          }
        })
      })
    },
    async loadSummary () {
      try {
        const res = await axios({ url: '/aierp/v1/report/summary', method: 'post', data: {} })
        if (!res || res.code !== 200) {
          this.banner = { kind: 'bad', text: '库存接口已响应，但没有返回成功数据。' }
          this.stocks = []
          return
        }
        this.stocks = (res.data && res.data.stocks) || []
        this.bills = (res.data && res.data.recentBills) || []
        this.banner = null
      } catch (error) {
        this.stocks = []
        this.bills = []
        this.banner = { kind: 'bad', text: '库存查询失败：' + this.reason(error) }
      }
    },
    async downloadTemplate (sceneId) {
      const scene = sceneId || this.active
      if (typeof scene === 'string') {
        this.active = scene
      }
      try {
        const blob = await axios({
          url: '/aierp/v1/excel/template',
          method: 'get',
          params: { scene: this.active },
          responseType: 'blob'
        })
        if (this.looksJson(blob)) {
          const text = await blob.text()
          this.banner = { kind: 'bad', text: '模板下载失败：' + text.slice(0, 120) }
          return
        }
        this.saveBlob(blob, this.current.title + '.xlsx')
        this.banner = { kind: 'ok', text: '已下载真实 xlsx 模板' }
      } catch (error) {
        this.banner = { kind: 'bad', text: this.reason(error) }
      }
    },
    async onFile (event) {
      const file = event.target.files[0]
      event.target.value = ''
      if (!file) return
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        this.stage = 'failed'
        this.banner = { kind: 'bad', text: '格式错误：只接受 .xlsx' }
        return
      }
      const body = new FormData()
      body.append('file', file)
      this.busy = true
      try {
        const res = await axios({ url: '/aierp/v1/excel/preview', method: 'post', data: body })
        if (!res || res.code !== 200 || !res.data || !res.data.previewId) {
          this.stage = 'failed'
          this.banner = { kind: 'bad', text: '解析失败：' + ((res && res.data && res.data.message) || '没有预览编号') }
          return
        }
        this.previewId = res.data.previewId
        this.records = res.data.records || []
        this.results = []
        this.batchId = ''
        this.lastConfirmKey = ''
        this.stage = 'previewed'
        this.banner = { kind: 'ok', text: '已解析，库存尚未变化。请核对明细后再确认。' }
      } catch (error) {
        this.stage = 'failed'
        this.banner = { kind: 'bad', text: this.reason(error) }
      } finally {
        this.busy = false
      }
    },
    async confirmPreview () {
      if (this.busy || !this.hasPendingConfirm) return
      this.busy = true
      try {
        const key = this.lastConfirmKey || ('ui-' + Date.now())
        this.lastConfirmKey = key
        const res = await axios({
          url: '/aierp/v1/excel/confirm',
          method: 'post',
          data: { previewId: this.previewId, idempotencyBatchKey: key }
        })
        if (!res || res.code !== 200) {
          this.stage = 'failed'
          this.banner = { kind: 'bad', text: '确认失败' }
          return
        }
        this.results = (res.data && res.data.results) || []
        this.batchId = key
        const posted = this.results.some(item => item.status === 'POSTED')
        const replayed = !!(res.data && res.data.replayed)
        this.stage = posted ? 'posted' : 'failed'
        this.banner = {
          kind: posted ? 'ok' : 'bad',
          text: replayed
            ? '重复确认已拦截：返回原批次结果，库存不会再次变化。'
            : (posted ? '已审核原生单据。正在刷新真实库存。' : '没有单据入账，请看失败原因。')
        }
        await this.loadSummary()
      } catch (error) {
        this.stage = 'failed'
        this.banner = { kind: 'bad', text: this.reason(error) }
      } finally {
        this.busy = false
      }
    },
    async downloadReceipt () {
      try {
        const blob = await axios({
          url: '/aierp/v1/excel/receipt',
          method: 'get',
          params: { batchId: this.batchId },
          responseType: 'blob'
        })
        this.saveBlob(blob, '回执.xlsx')
        this.banner = { kind: 'ok', text: '已下载处理回执' }
      } catch (error) {
        this.banner = { kind: 'bad', text: this.reason(error) }
      }
    },
    async ask () {
      const message = this.draft.trim()
      if (!message) return
      this.chat.push({ role: 'me', text: message })
      this.draft = ''
      try {
        const res = await axios({
          url: '/aierp/v1/assistant/turn',
          method: 'post',
          data: {
            conversationId: this.conversationId || undefined,
            message,
            context: { previewId: this.previewId || undefined }
          }
        })
        if (res && res.code === 200 && res.data) {
          this.conversationId = res.data.conversationId || this.conversationId
          this.assistantMode = '本地规则演示（' + (res.data.mode || 'RULE_DEMO') + '）· 使用当前登录 ERP 会话'
          this.chat.push({ role: 'bot', text: res.data.reply || '助手没有返回文字' })
          await this.applyActions(res.data.suggestedActions || [])
          return
        }
        this.chat.push({ role: 'bot', text: '助手没有返回成功结果' })
      } catch (error) {
        this.chat.push({ role: 'bot', text: '助手请求失败：' + this.reason(error) })
      }
    },
    async applyActions (actions) {
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        if (action && action.type === 'excel.template') {
          const scene = action.payload && action.payload.scene ? action.payload.scene : 'PURCHASE'
          this.active = scene
          await this.downloadTemplate(scene)
        }
      }
    },
    resultOf (businessKey) {
      return this.results.find(item => item.businessKey === businessKey)
    },
    rowStatus (row) {
      const result = this.resultOf(row.businessKey)
      if (result) return this.statusLabel(result.status)
      if (!row.canConfirm) return '有错误'
      return '待确认'
    },
    rowStatusClass (row) {
      const label = this.rowStatus(row)
      if (label === '已审核') return 'ok'
      if (label === '待确认') return 'wait'
      if (label === '有错误' || label === '已拒绝' || label === '失败') return 'bad'
      return ''
    },
    statusLabel (status) {
      if (status === 'POSTED') return '已审核'
      if (status === 'REJECTED') return '已拒绝'
      if (status === 'ERP_FAILED') return '失败'
      return status || '未知'
    },
    qtyText (row) {
      if (row.scene === 'MIX' && row.normalized && row.normalized.finished) {
        const finished = row.normalized.finished
        const lines = row.normalized.lines || []
        return finished.barCode + ' ' + finished.qty + finished.unit + ' ← ' + lines.map(line => line.barCode + ' ' + line.qty + line.unit).join(' + ')
      }
      const lines = row.normalized && row.normalized.lines ? row.normalized.lines : []
      return lines.map(line => line.barCode + ' ' + line.qty + line.unit).join('；')
    },
    messageOf (row) {
      const result = this.resultOf(row.businessKey)
      if (result && result.error) return result.error
      const errors = row.errors || []
      if (errors.length) {
        return Array.isArray(errors) ? errors.join('；') : String(errors)
      }
      return ((row.warnings || []).join('；') || '可确认')
    },
    formatQty (value) {
      const number = Number(value)
      if (Number.isNaN(number)) return value
      return String(Number(number.toFixed(4)))
    },
    formatTime (value) {
      if (!value) return ''
      const text = String(value).replace('T', ' ')
      return text.length > 19 ? text.slice(0, 19) : text
    },
    async copyText (text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const input = document.createElement('textarea')
          input.value = text
          document.body.appendChild(input)
          input.select()
          document.execCommand('copy')
          document.body.removeChild(input)
        }
        this.banner = { kind: 'ok', text: '已复制单据号 ' + text }
      } catch (error) {
        this.banner = { kind: 'bad', text: '复制失败' }
      }
    },
    reason (error) {
      if (error && error.code === 'ECONNABORTED') return '请求超时'
      const data = error && error.response && error.response.data
      if (data && data.data && data.data.message) return data.data.message
      if (typeof data === 'string') return data
      if (data && data.message) return data.message
      return (error && error.message) || '请求失败'
    },
    looksJson (blob) {
      return blob && blob.type && blob.type.indexOf('json') >= 0
    },
    saveBlob (blob, name) {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    }
  }
}
</script>

<style scoped>
.desk { padding: 20px; color: #1c1917; background: #f6f3ee; min-height: 100%; overflow-x: hidden; }
.top, .split, .actions, .composer, .scenes { display: flex; gap: 12px; }
.top { justify-content: space-between; align-items: flex-end; }
.eyebrow { letter-spacing: .12em; color: #9a3412; margin: 0; }
h1 { margin: 4px 0; font-size: 32px; }
.lead, .mode { color: #57534e; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 16px 0; }
.card, .panel { background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 14px; }
.card strong { display: block; font-size: 28px; }
.card em { color: #78716c; font-style: normal; }
.split { align-items: flex-start; }
.panel { flex: 1; min-width: 0; }
.scenes { flex-wrap: wrap; }
.scenes button, .actions button, .composer button, .file { border: 1px solid #d6d3d1; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.scenes button { text-align: left; }
.scenes button.on, .solid { background: #1c1917; color: #fff; }
.solid:disabled { opacity: .45; cursor: not-allowed; }
.file input { display: block; margin-top: 6px; max-width: 100%; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
td, th { border-bottom: 1px solid #e7e5e4; text-align: left; padding: 8px 4px; font-size: 13px; word-break: break-word; }
.banner { padding: 10px 12px; border-radius: 10px; }
.banner.ok { background: #ecfdf3; }
.banner.bad { background: #fff1f2; }
.banner.wait { background: #fff7ed; }
.chat { min-height: 160px; max-height: 280px; overflow: auto; }
.me { text-align: right; }
.bills, .results { padding-left: 0; list-style: none; }
.bills li, .results li { margin-bottom: 10px; }
.bill-row { display: flex; gap: 8px; align-items: center; }
.bill { font-family: ui-monospace, Consolas, monospace; }
.linkish { border: none; background: transparent; color: #9a3412; padding: 0; cursor: pointer; text-decoration: underline; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #f5f5f4; }
.tag.ok { background: #dcfce7; color: #166534; }
.tag.wait { background: #ffedd5; color: #9a3412; }
.tag.bad { background: #fee2e2; color: #991b1b; }
@media (max-width: 800px) {
  .split, .top { flex-direction: column; align-items: stretch; }
  h1 { font-size: 24px; }
  .desk { padding: 12px; }
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .actions, .composer { flex-wrap: wrap; }
}
</style>

<style>
body.aierp-demo-active .ant-drawer-mask {
  display: none !important;
  pointer-events: none !important;
}
body.aierp-demo-active .setting-drawer,
body.aierp-demo-active .setting-drawer-index-handle {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
@media (max-width: 800px) {
  body.aierp-demo-active .ant-drawer.ant-drawer-open {
    transform: translateX(-100%) !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  body.aierp-demo-active .ant-layout {
    margin-left: 0 !important;
  }
  body.aierp-demo-active .ant-layout-content,
  body.aierp-demo-active .page-header-index-wide {
    padding-left: 0 !important;
    margin-left: 0 !important;
  }
}
</style>
