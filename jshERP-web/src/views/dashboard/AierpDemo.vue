<template>
  <div class="desk">
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
      <article v-for="row in stocks" :key="row.barCode + row.depotName" class="card">
        <span>{{ row.depotName }}</span>
        <strong>{{ row.currentStock }}</strong>
        <em>{{ row.barCode }}</em>
      </article>
      <article v-if="!stocks.length" class="card muted">库存接口未返回数据</article>
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
            <input type="file" accept=".xlsx" @change="onFile" />
          </label>
        </div>
        <p class="state">当前状态：{{ stageLabel }}</p>
        <table v-if="records.length">
          <thead>
            <tr><th>业务单</th><th>数量</th><th>能否确认</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in records" :key="row.businessKey">
              <td>{{ row.businessKey }}</td>
              <td>{{ qtyText(row) }}</td>
              <td>{{ row.canConfirm ? '待确认' : '有错误' }}</td>
              <td>{{ messageOf(row) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="actions" v-if="previewId">
          <button class="solid" :disabled="busy || !canPost" @click="confirmPreview">确认并审核选中可过账单据</button>
          <button v-if="batchId" class="ghost" @click="downloadReceipt">下载回执</button>
        </div>
        <ul v-if="results.length" class="results">
          <li v-for="item in results" :key="item.businessKey">
            {{ item.businessKey }} · {{ item.status }} · {{ item.billNumber || item.error || '无单据' }}
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>最近单据</h2>
        <ul class="bills">
          <li v-for="bill in bills" :key="bill.bill_number">
            <b>{{ bill.bill_number }}</b>
            <span>{{ bill.biz_type }} · {{ bill.confirm_time }}</span>
          </li>
          <li v-if="!bills.length">还没有经网关确认的单据</li>
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
      busy: false,
      chat: [{ role: 'bot', text: '我可以查询真实库存，或带你下载 Excel。确认过账只能由你点击按钮完成。' }],
      draft: '',
      assistantMode: '助手接口：待接入。下面的回复只做页面引导，不会伪造过账。'
    }
  },
  computed: {
    current () {
      return this.scenes.find(item => item.id === this.active)
    },
    canPost () {
      return this.records.some(row => row.canConfirm)
    },
    stageLabel () {
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
  methods: {
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
        this.banner = { kind: 'wait', text: this.missing(error) ? '库存与单据接口待接入' : '库存查询失败：' + this.reason(error) }
      }
    },
    async downloadTemplate () {
      try {
        const blob = await axios({ url: '/aierp/v1/excel/template', method: 'get', params: { scene: this.active }, responseType: 'blob' })
        if (this.looksJson(blob)) {
          this.banner = { kind: 'wait', text: 'Excel 模板接口待接入' }
          return
        }
        this.saveBlob(blob, this.current.title + '.xlsx')
        this.banner = { kind: 'ok', text: '已下载真实 xlsx 模板' }
      } catch (error) {
        this.banner = { kind: this.missing(error) ? 'wait' : 'bad', text: this.missing(error) ? 'Excel 模板接口待接入' : this.reason(error) }
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
        this.stage = 'previewed'
        this.banner = { kind: 'ok', text: '已解析，库存尚未变化。请核对明细后再确认。' }
      } catch (error) {
        this.stage = 'failed'
        this.banner = { kind: this.missing(error) ? 'wait' : 'bad', text: this.missing(error) ? 'Excel 解析接口待接入' : this.reason(error) }
      } finally {
        this.busy = false
      }
    },
    async confirmPreview () {
      this.busy = true
      try {
        const key = 'ui-' + Date.now()
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
        this.stage = posted ? 'posted' : 'failed'
        this.banner = { kind: posted ? 'ok' : 'bad', text: posted ? '已审核原生单据。正在刷新真实库存。' : '没有单据入账，请看失败原因。' }
        await this.loadSummary()
      } catch (error) {
        this.stage = 'failed'
        this.banner = { kind: this.missing(error) ? 'wait' : 'bad', text: this.missing(error) ? '确认接口待接入' : this.reason(error) }
      } finally {
        this.busy = false
      }
    },
    async downloadReceipt () {
      const blob = await axios({ url: '/aierp/v1/excel/receipt', method: 'get', params: { batchId: this.batchId }, responseType: 'blob' })
      this.saveBlob(blob, '回执.xlsx')
    },
    async ask () {
      const message = this.draft.trim()
      if (!message) return
      this.chat.push({ role: 'me', text: message })
      this.draft = ''
      try {
        const stored = JSON.parse(localStorage.getItem('pro__Access-Token') || '{}')
        const res = await fetch('/jshERP-boot/aierp/v1/assistant/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Access-Token': stored.value || '' },
          body: JSON.stringify({ message, context: { previewId: this.previewId || undefined } })
        })
        if (res.status === 404) {
          this.assistantMode = '助手接口：待接入。当前只根据页面上的真实库存做引导。'
          this.replyLocal(message)
          return
        }
        const body = await res.json()
        if (body && body.code === 200 && body.data) {
          this.assistantMode = '助手模式：' + (body.data.mode || '未知')
          this.chat.push({ role: 'bot', text: body.data.reply || '助手没有返回文字' })
          return
        }
        this.replyLocal(message)
      } catch (error) {
        this.chat.push({ role: 'bot', text: '助手请求失败：' + this.reason(error) })
      }
    },
    replyLocal (message) {
      if (message.indexOf('库存') >= 0 || message.indexOf('表面活性剂') >= 0) {
        const hit = this.stocks.find(row => row.barCode === 'RM-A001' && row.depotName === '原料仓')
        this.chat.push({ role: 'bot', text: hit ? '原料仓表面活性剂 RM-A001 当前库存 ' + hit.currentStock + '。这是实时查询，不是模型生成的数字。' : '页面上还没有 RM-A001 的库存。' })
        return
      }
      if (message.indexOf('采购') >= 0) {
        this.active = 'PURCHASE'
        this.chat.push({ role: 'bot', text: '已切到采购入库。请先下载 Excel，填写后上传。我不会代替你确认入库。' })
        return
      }
      this.chat.push({ role: 'bot', text: '可以问库存，或切换采购、配制、服务。过账必须点击“确认并审核”。' })
    },
    qtyText (row) {
      const lines = row.normalized && row.normalized.lines ? row.normalized.lines : []
      return lines.map(line => line.barCode + ' ' + line.qty + line.unit).join('；')
    },
    messageOf (row) {
      const errors = row.errors || []
      return errors.length ? errors.join('；') : ((row.warnings || []).join('；') || '可确认')
    },
    missing (error) {
      return error && error.response && (error.response.status === 404 || error.response.status === 0)
    },
    reason (error) {
      if (error && error.code === 'ECONNABORTED') return '请求超时'
      const data = error && error.response && error.response.data
      if (data && data.data && data.data.message) return data.data.message
      if (typeof data === 'string') return data
      return '请求失败'
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
.desk { padding: 20px; color: #1c1917; background: #f6f3ee; min-height: 100%; }
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
.panel { flex: 1; }
.scenes { flex-wrap: wrap; }
.scenes button, .actions button, .composer button, .file { border: 1px solid #d6d3d1; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.scenes button { text-align: left; }
.scenes button.on, .solid { background: #1c1917; color: #fff; }
.file input { display: block; margin-top: 6px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
td, th { border-bottom: 1px solid #e7e5e4; text-align: left; padding: 8px 4px; font-size: 13px; }
.banner { padding: 10px 12px; border-radius: 10px; }
.banner.ok { background: #ecfdf3; }
.banner.bad { background: #fff1f2; }
.banner.wait { background: #fff7ed; }
.chat { min-height: 160px; max-height: 280px; overflow: auto; }
.me { text-align: right; }
.bills, .results { padding-left: 18px; }
@media (max-width: 800px) {
  .split, .top { flex-direction: column; }
  h1 { font-size: 26px; }
}
</style>
