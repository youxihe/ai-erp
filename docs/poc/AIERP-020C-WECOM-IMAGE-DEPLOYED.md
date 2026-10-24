# AIERP-020C · 企微图片链路 LOCAL_DEPLOYED（2026-10-24）

- 基线：master `93ed2636`（本提交在其上追加）
- 状态：**LOCAL_DEPLOYED**；图片通道 **LIVE_UAT 待真人确认**（Bot WS 已连接、发送 API 就绪，等待真人在企微客户端点击验收）

## 本轮改动

| 文件 | 说明 |
| --- | --- |
| `deploy/openclaw/plugins/aierp-erp-tools/sop/chart-render.mjs` | 新增：真实 ERP 查询 → `sealAndRender` 服务端密封 → PNG → 企微图片（复用 `sendWecomLocalFile`） |
| `deploy/openclaw/plugins/aierp-erp-tools/index.js` | 接线：`erp_chart_render` 工具 + `before_dispatch` 图表意图兜底；不触碰采购/配制/耗料确认与 PDF 逻辑 |
| `deploy/openclaw/plugins/aierp-erp-tools/openclaw.plugin.json` | `contracts.tools` 声明 `erp_chart_render` |
| `deploy/openclaw/sop/render-lib/renderers/table-basic.mjs` | 修复：单元格按列宽截断（省略号），长物料名不再压列 |
| `deploy/openclaw/sop/render-lib/renderers/bar-compare.mjs` | 修复：柱图标签按柱宽自适应，`2026-10-20` 不再被截成 `2026-10-` |
| `deploy/openclaw/scripts/common.ps1` + `start-gateway-native.ps1` | 修复：宿主 shell 传入大小写重复代理变量（HTTP_PROXY/http_proxy）导致 `Start-Process` 抛「字典关键字」异常 |
| `deploy/scripts/aierp-020c-wecom-chart-flow.mjs` | 新增：真实 ERP → 密封 → PNG → 发送替身的 8 项链路自测（非过账） |

## 运行态（2026-10-24 实测）

- Boot JAR：host/container SHA `5995bcb5…` 一致（本轮无 Java 改动，未重编）
- Gateway：`http://127.0.0.1:18789/health` 200 live；16 插件含 `aierp-erp-tools`、`wecom-openclaw-plugin`
- 企微 Bot WS：`wss://openws.work.weixin.qq.com` 已连接并认证（心跳 30s）
- F: 插件 `index.js` SHA == master 检出；`F:\aierp-openclaw\state\sop\render-lib` 已同步（shim 跨目录解析路径）
- 渲染依赖：`F:\.tools\aierp-020c-render`（@resvg/resvg-js 2.6.2 + exceljs 4.4.0，win32-x64）
- 中文字体：msyh / NotoSansSC / simhei 等系统字体可用

## 安全与降级语义

- 数值只来自可信适配器授权查询；模型/用户文本只能选 `renderId` 与查询范围
- `authCtx` 由服务端 `binding/status` 解析（tenantId + erpLoginName + bindingVersion），拒绝伪造
- 用户可见文本经 `stripPaths`，不出现 `MEDIA:` / `F:\...`
- 采购汇总接口只有总计口径：供应商 ≥2 才按供应商出图，否则按 ERP 可查的日期维度出图；连日期维度都不足时降级为 `kpi.tiles` 并在文案中说明，绝不编造分类
- 长表（>12 行）PNG 预览 + 自动补发真实数据 XLSX

## 验收记录

| 检查 | 结果 |
| --- | --- |
| `aierp-020c-render-smoke.mjs` | 28/28 PASS（含真实 ERP 库存表 + 采购汇总密封渲染） |
| `aierp-020c-wecom-chart-flow.mjs` | 8/8 PASS（场景 A 表格、场景 B 柱图、折线、空区间/未知仓库负例、媒体身份隔离） |
| `aierp-013-query-flow.mjs`（只读回归） | 23/23 PASS（含跨仓权限 403 负例） |
| 真人企微打开图片 | **待确认**（LIVE_UAT_PENDING） |

## 热修 1：企微实发报「缺少 @resvg/resvg-js」

**现象**：企微里发「把原料仓的库存用表格展示给我」，1 秒内返回
`图表渲染失败：缺少 @resvg/resvg-js`。

**根因**：OpenClaw 启动时把插件整体复制到临时目录后再加载：

```
state/tmp/plugin-captures/<uuid>/captures/openclaw-plugin-build-XXX/
  package-1/node_modules/aierp-openclaw/state/sop/render-lib
```

`svg-to-png.mjs` / `xlsx-export.mjs` 原来用 `join(__dirname, "../../../..")` 推算仓库根，
在副本里指向的是副本内部，因此永远找不到 `F:\.tools\aierp-020c-render`。
脚本自测（直接 import 仓库路径）能过，实发必失败 —— 属于解析路径假设错误，不是依赖没装。

**修复**：

- 新增 `render-lib/deps.mjs`：按「环境变量 → OPENCLAW_HOME/STATE_DIR → 模块自身逐级上溯 → 进程 cwd 逐级上溯 → 同级 node_modules」解析，不再依赖目录层级
- `svg-to-png.mjs` / `xlsx-export.mjs` 改用统一解析；失败文案带上实际尝试过的路径
- `F:\aierp-openclaw\state\.env` 增加 `AIERP_020C_RENDER_HOME=F:\.tools\aierp-020c-render`
- 依赖同时落到 `F:\.tools\aierp-020c-render` 与 `F:\aierp-openclaw\.tools\aierp-020c-render`（cwd 兜底）

**验证**：用网关实际加载的副本路径（`plugin-captures/.../package-1/...`）导入并渲染，
`resvgAvailable=true`、`pngBytes=17928`；去掉环境变量仅靠 cwd 兜底同样可用；smoke 仍 28/28。

## 待办

- 真人企微客户端点击打开库存表格 PNG / 采购柱图，金额与 ERP 对账
- 多租户/多绑定用户隔离的真人复核（当前 demo 单租户 `63`，代码层已有 datasetRef 跨身份拒绝覆盖）
