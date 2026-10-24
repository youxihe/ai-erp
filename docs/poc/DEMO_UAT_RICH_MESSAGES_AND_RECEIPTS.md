# AI ERP · 企业微信富消息、表格图表、所有真实写操作 PDF 回执验收卡

> 在当前 Windows F: Demo 操作，不自动创建/确认真实业务。任何真实库存/主数据写入必须由本人在企微明确发送受信短语；历史 GW-PURCHASE-119 / GW-SERVICE-136 只能查/重发，不能重复过账。

## A. 部署验真（Cursor Deploy Owner 先执行）
Windows PowerShell：powershell -File deploy/scripts/verify-demo-release.ps1
- 结果需要展示本机 git HEAD vs origin/master；宿主 JAR 与容器 /app/app.jar 两个 SHA256 一致；F: 插件 index.js 与关键 SOP 文件 hash 与发布源码相同；ERP doc.html 200 和 Gateway /health 200。未通过即不能写“最新已发布”。源码头与 JAR sha 相同不能推出 JAR 是从这份源码编译的，必须结合 hot-reload 的 clean Maven 构建日志、发布记录和单一 Deploy Owner。
- 人工查询 F: OpenClaw 最新 channel logs，确认实际加载 aierp-erp-tools + 当前 13+ 官方运行工具，非只看 Gateway 健康。通过企微“查一下 RM-A001 目前在原料仓的库存”验证真实 ERP 读能力。

## B. 富消息展示（正式逻辑无需过账即可验证）
1. 企业微信发“查一下原料仓里几个原料的库存，用表格给我”：应调用已有 ERP 授权查询，显示中文列头（物料/编码/仓库/数量/单位），行 >3 用清晰图片表格并允许 XLSX 导出；不能发送 raw Markdown 表格源码或 SQL/JSON。
2. 发“将各仓同一种物料的库存做柱状图”：需要至少两个授权仓数据，图中单位与数值清楚、未授权仓不可入图。
3. 发“近 7 天已审核采购金额变化，画折线图”：只有真实带日期的授权聚合记录时出图；缺数据应说清并退回表格，不能自行编每天金额。
4. 发“供应商采购金额占比”：2–6 类同币种同范围可画饼图，负数/混币种/没有来源拒绝画饼图；可改柱状/表格。
5. 发“刚才那张采购库存前后变化”：显示 before、delta、after 的变化图或表格，不能用历史固定库存冒充当前值。
6. Excel 两张单/三行，预览必须看到每行名称、数量、单价、金额，以及分单合计和全批金额；不得只显示第一件商品。
7. 同一查询结果在 PC/移动端对比：原生卡片优先，Markdown 次之，复杂表格/图表 PNG，技术不支持时 plain 降级；不出现 literal HTML、MEDIA F: 路径、英文内部变量、过长技术文案。若按钮存在，仅查看/下载/复制，不能用未经本人原文确认的按钮直接入库。

## C. PDF 操作回执（真实业务请用户单独授权）

| 业务 | 预期 PDF 内容 | 后台核验 |
|---|---|---|
| 采购入库 PURCHASE | 原生采购单、供应商、全部行货品数量单价金额、仓库 before/after、操作时间 | 已审核原生单号一致，且历史 PDF SHA 不被静默覆写 |
| 配制 MIX | 真实配制单、产成品数量，全部原料领用与产出各仓变化表 | 成品加、原料减，名称非采购入库回执 |
| 服务耗料 SERVICE | 客户、服务项目、物料、数量、成品仓库存减少 | 真正其它出库，不伪装 SALES 或生成应收 |
| 客户/供应商 CREATE/UPDATE | 主数据真实 ID/名称、发生修改的字段旧→新、操作者、时间 | 关联原生 Supplier，不含敏感账户信息 |
| 物料 CREATE/UPDATE | Material/MaterialExtend 真实 ID/编码/单位及字段差异 | 新建本身所有仓库库存仍为零 |
| 批次采购 | 每张真实已审核采购回执 + 准确成功/失败汇总 | 部分成功按原生单逐张记录，重试不重复变库存 |

- 操作未正式成功前不出现“已审核 PDF”；客户端真正收到并打开 file 才标送达验收。
- 索要“重发上一笔回执”只发送已经审核的同一条授权 PDF，不重新过账；用户换绑/低权限/另一租户不应收到。
- PDF 版式升级应创建第二版本，原 SHA/审计号与原文件保留；断网/文件不存在只能重试生成/发送，不重新执行 ERP 原生事务。

## D. 应记录的证据
部署 git HEAD / Jar SHA / F plugin hash / Gateway 进程与 channel loaded；截图包括 1 张原生卡片、1 张多行表格、柱/折/饼各 1 张（真实数据有意义才展示），采购/MIX/SERVICE 各一份真实业务 PDF，审计流水号/文件 sha 与 ERP 前后库存快照；分别标记 CODE_READY / LOCAL_DEPLOYED / WE_COM_RECEIVED / USER_OPENED / REVIEW_MERGED，不能混淆。
