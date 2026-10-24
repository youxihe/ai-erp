# ADR · AIERP-020C 通用表格 / 图表渲染库

## Status

CODE_READY（本分支）。未宣称 LOCAL_DEPLOYED；不直接改 F: OpenClaw 运行态 / `deploy/runtime/app.jar`。

## Decision

在 `deploy/openclaw/sop/render-lib/` 提供白名单渲染组件：

| renderId | 用途 |
|---|---|
| `table.basic` | 表头/单位/金额表格 PNG；>12 行附加 XLSX |
| `bar.compare` | 同量纲类别柱状对比 |
| `line.trend` | ≥3 时间点趋势折线 |
| `pie.share` | 2–6 非负同分母份额 |
| `delta.before_after` | 前后库存/数量差异 |
| `kpi.tiles` | KPI 磁贴 |

数据必须来自 `authorized` / `nature=REAL_ERP` / `sourceRefs` 的 dataset，或 `datasetRef`。AI 只许选 `renderId` + 数据集引用；拒绝自行拼数、HTML、SQL、本地路径。空数据 / 混单位 / 负饼图等降级为表格或说明图，**不画假图**。

PNG：受控 SVG → `@resvg/resvg-js`，字体仅用本机已安装中文字体（不提交字体二进制）。依赖装在 `.tools/aierp-020c-render/`（gitignored）。

企微：`channel/wecom-render-hook.mjs` 只预渲染并给出内部 `_media` 路径；caption 剥路径；真正 Bot WS 发图由后续适配器注入 `sendFn`。

## Smoke

```bash
npm install @resvg/resvg-js exceljs --prefix .tools/aierp-020c-render
node deploy/scripts/aierp-020c-render-smoke.mjs
```

证据：`docs/poc/evidence/aierp-020c-render-smoke.json` + `docs/poc/evidence/aierp-020c-artifacts/*.png`
