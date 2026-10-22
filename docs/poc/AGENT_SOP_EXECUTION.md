# AI ERP · OpenClaw 标准流程脚本化约定（Agent 2.1）

**产品原则：意图由 Agent 理解，标准业务由可审计 SOP 执行，ERP 是状态与权限权威源，Channel 负责附件投递。** 这并不是把整个 jshERP Swagger API 暴露给模型。

## 代码与文档位置

```text
deploy/openclaw/
  plugins/aierp-erp-tools/index.js       # 唯一可信接入 / route dispatch
  sop/
    registry.mjs                         # 业务意图及必要参数路由/明确优先级
    receipt-send.mjs                     # 认证回执查找、PDF bytes、真实渠道发送
    purchase-excel.mjs                   # 已实现模板→真实文件→预览→未审核草稿
    purchase-confirm.mjs                 # 仅原始可信私聊触发，真实审批后业务回执
    stock-query.mjs                      # 已授权只读库存及回包 DTO
    renderers/wecom-business.mjs         # Markdown/Card/Text 根据运行态支持渲染
  workspace/
    AGENTS.md                            # 只保留触发/能力/硬边界，不写详尽流程
    skills/erp-receipt/SKILL.md          # AI 自然语言意图和恢复方式
    skills/erp-batch-excel/SKILL.md      # 已存在，整理去冗余
```

以上是**实施目标结构**，不代表源码现在已有 `sop/` 文件。015C 第一棒只要求 receipt-send 与 renderer；其他脚本按后续小 PR 迁移，防止再出现一轮巨型重构。

## Trigger 决策样例

| 用户文本（私聊） | 走 SOP | 是否走模型自由工具推理 |
|---|---|---|
| 发 GW-PURCHASE-119 的回执 PDF | receipt-send | 否，身份和单号明确 |
| 把刚才的回执文件直接发我 | receipt-send pendingAction | 否，需此前有可信待发 PDF |
| 没收到，再发一次 | receipt-send pendingAction | 否 |
| 给我采购 Excel 模板 | purchase-excel | 否 / 用户槽位不完整才追问 |
| 填好采购 XLSX 发过来 | purchase-excel parse→prepare | 否，依赖真实文件字节 |
| 确认采购119 | purchase-confirm | **绝不走 LLM 工具** |
| 查询 RM-A001 原料仓还有多少 | stock-query | 已知准确槽位时脚本直达，只读 |
| 我要配制清洗液、原料不够怎么办 | LLM/业务 SKILL 组合库存分析 | 可调用只读能力；不能擅自过账 |

## 业务动作 SOP 合同

- `route(trustedInboundEvent, pendingAction) -> {sopId, args, needsUserInput}`。
- `execute(sopId, BoundContext, ValidatedArgs) -> {businessFacts, mutationState, media[]}`。所有有状态操作由 Java ERP 复核角色、租户、当前仓库、绑定代际、幂等；JS SOP 不是安全边界的替代品。
- `render(channel, businessFacts) -> {text, structuredMedia?, card?}`。文件单独结构化传输，不在用户可见文字里插入本机路径。
- `updatePendingAction`：非聊天历史，服务端保存 `PENDING_FILE_SEND/FILE_HANDOFF/SENT/FAILED`，与 bot + sender + ERP actor + binding ID/version + receiptId + TTL 绑定，刷新会话仍能根据真实状态继续操作。
- 可解析但含糊的事务必须展示真实金额/仓库和数字草稿 ID 再获得可信本人确认；receipt-send 是已审核回执的**只读文件转发**，绝不触发新的购买动作。

## 明确不做

- 不给 LLM OS 脚本执行权限，不使用动态 eval 或 arbitrary URL。
- 不把 `tools.alsoAllow` 设置为全部企微业务工具；仅按最小需要连接特定 channel media sender。
- 不将密钥、企微 sender 原文、报表敏感信息、PDF 存储路径放进 Git 日志或对话。
- 不承诺“生成了 PDF”即“用户已收到”，必须通道结果+客户端验收。

## 主数据 SOP（021A/021B）及业务续办（021C）

- 新增 `partner-upsert.mjs` 与 `material-upsert.mjs` 独立可导入模块，`AGENTS.md` 仅写“新建/修改供应商、客户、原料→这些 SOP”，不把原生 MaterialController/SupplierController 直接交给 LLM Tool。
- LLM 只收集安全白名单字段；Java ERP 依据绑定当前 actor / tenant / 当前功能权限查重、正则/枚举、幂等及修改前版本。由可信企微**原始本人单独确认**提交，模型无 master commit Tool。
- `确认伙伴建档{requestId}` / `确认伙伴修改{requestId}`（物料侧另用独立 namespaced 确认）与 `确认采购/确认配制/确认耗料{draftId}` 是**不同授权**；前者不会调整库存/金额，后者是业务真实过账。客户和供应商名称相同也需要类型明确，物料编码 `MaterialExtend.bar_code` 不可与别的 SKU 冲突。禁止裸 `确认建档{id}`。
- 原生 jshERP MaterialService 传 `stock` 能写或重置期初库存/当前库存，SupplierService 的隐式 getCurrentUser/Request 日志不能直接从没有 Session 的企微套用。需明确身份安全 facade 和原生实体一致性。
- 021C 实施业务缺档挂起/恢复，读取此前 server-authoritative 文件/槽位，完成建档后重新校验并**只继续创建未审核草稿**，绝不能自动确认入库/配制/耗料。测试清单 `docs/poc/DEMO_UAT_MASTERDATA_CHAT.md`。
