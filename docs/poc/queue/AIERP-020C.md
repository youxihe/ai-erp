# AIERP-020C · 通用表格 / 图表渲染脚本库

状态：RELEASED / visual #2。分支：feat/aierp-020c-render-table-chart-library，从 master，可与 020B 并行编码，F: 由单一部署人合入。
不编写几十个业务专用统计脚本，而是将**已有 ERP 实际授权查询/聚合数据**输入白名单的通用展示组件：table.basic/table.grouped、bar.compare、bar.stacked、line.trend、pie.share、delta.before_after、kpi.tiles。

统一 BusinessResult/datasetRef；模板 Schema、列/度量白名单、类型/单位/日期/币种验证；AI 只允许选择 renderId+数据集引用，禁止自行拼数/传 HTML/SQL/文件路径。金额/库存数据必须来自 ERP，维度有来源、时间范围；空数据/不同单位/负数饼图不能画假图，自动降级表格。
采用受控安全 SVG 绘图 + 本机已安装可验证的 SVG→PNG 实现或成熟图表包，输出中文字体清晰的高 DPI PNG，再经当前可信 WeCom 图片通道发送。复杂表格 PNG 首屏最多 8–12 行，加 XLSX 完整导出；图表均有标题、单位、图例、值标签、数据来源、生成时间与文字 alt 摘要。原始数据按 ERP 绑定和权限隔离、限定图片尺寸/文件大小/缓存 TTL。

案例：采购入库明细表；库存各仓柱状；近 7 日采购金额折线；供应商金额占比饼图（同一金额分母）；MIX 三原料与成品的前后库存差异图。验证 PC/移动企微图片能打开、汇总与原生 ERP 对得上，禁止把未审核草稿算入已审核经营报表。建立独立 Node 自动化和截图证据。
