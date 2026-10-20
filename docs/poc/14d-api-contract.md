# AIERP-014D · API / Tool 合同与验收矩阵

**性质**：设计合同（015 实现时遵守）；本分支不改 Java/OpenClaw 代码。

## 1. Agent Tool（015 才注册；014D 仅命名）

| Tool | 级别 | 作用 | 禁止 |
|---|---|---|---|
| `erp_purchase_prepare` | 草稿 | 槽位齐全后创建/更新采购 DRAFT + 签发挑战 | 不审核 |
| `erp_mix_prepare` | 草稿 | 配制草稿 + 挑战（016） | 不审核 |
| `erp_service_prepare` | 草稿 | 服务耗料草稿 + 挑战（016） | 不审核 |
| `erp_draft_status` | 只读 | 查草稿状态/摘要 | — |
| `erp_draft_cancel` | 草稿 | 取消未过账单 | 不能取消已 CONFIRMED |
| ~~`erp_draft_confirm`~~ | — | **不注册**为可单独过账的模型工具 | — |

确认入口**不是**模型 Tool，而是：

1. OpenClaw 渠道钩子：检测到私聊消息匹配 `确认-XXXX` → 调用适配器 `confirm-with-challenge`；或  
2. 已登录 H5/PC：`POST /aierp/v1/wecom/draft/confirm-ui`（session 用户必须等于绑定 erpUser）。

## 2. Prepare 请求 DTO（适配器 HMAC）

```json
{
  "wecomUserId": "<from trusted ctx only>",
  "botId": "default",
  "channel": "wecom",
  "bizType": "PURCHASE",
  "idempotencyKey": "wecom:{bot}:{wecomUser}:{conversation}:{clientKey}",
  "lines": [
    { "barCode": "RM-A001", "depotName": "原料仓", "qty": 10, "unit": "L" }
  ],
  "organName": "华东化工",
  "remark": "企微对话草稿"
}
```

**忽略**模型传入的 `erpUserId` / `tenantId` / `token`。

### Prepare 响应

```json
{
  "nature": "REAL_ERP",
  "draftId": 1024,
  "draftVersion": 1,
  "status": "AWAITING_CONFIRM",
  "posted": false,
  "stockUnchanged": true,
  "summary": { "materialName": "表面活性剂", "barCode": "RM-A001", "qty": 10, "unit": "L", "depotName": "原料仓", "partnerName": "华东化工", "amount": 200.00, "stockDeltaHint": "+10 @原料仓" },
  "challenge": {
    "expiresInSec": 420,
    "phrase": "确认-K7P2",
    "h5Path": "/dashboard/aierp?confirmDraft=1024"
  }
}
```

`phrase` / 挑战密钥**可**下发到企微（用户需要看到）；**不可**写入 Git 证据原文时可脱敏。

## 3. Confirm-with-challenge 请求

```json
{
  "wecomUserId": "<trusted>",
  "botId": "default",
  "channel": "wecom",
  "draftId": 1024,
  "draftVersion": 1,
  "phrase": "确认-K7P2",
  "messageMsgId": "<optional wecom msg id for audit>"
}
```

### 成功响应

```json
{
  "nature": "REAL_ERP",
  "status": "CONFIRMED",
  "replay": false,
  "billNumber": "GW-PURCHASE-1024",
  "depotHeadId": 12345,
  "stockBefore": { "RM-A001@原料仓": 32 },
  "stockAfter": { "RM-A001@原料仓": 42 }
}
```

### 幂等重放

`replay: true`，字段与首次成功一致；库存不二次变化。

## 4. 映射到现网网关

| 对话步骤 | 原生服务 |
|---|---|
| prepare | `AierpGatewayService.createDraft("PURCHASE"\|"MIX"\|"SERVICE", …)` |
| confirm | 抽取 `confirmAs(boundUser, …)` ← 现 `confirmInTx` |
| 单据号 | 现规则 `GW-{bizType}-{draftId}` |
| 库存 | 现 `addDepotHeadAndDetail` + `batchSetStatus("1")` |

**不重写**原生库存事务；Excel `confirm` 保持独立，不接入对话挑战。

## 5. H5 / PC 保底

- 路径：现有 `/dashboard/aierp` 增加「待确认草稿」列表（015）。
- 身份：ERP 登录 session；必须 `session.userId == binding.erp_user_id`。
- 网络：POC 默认本机/内网；**不**在 014D/015 擅自做公网穿透。
- 企微模板卡片：另立探针任务；未通过前不阻塞挑战短语方案。

## 6. 槽位规范（采购）

| 槽位 | 必填 | 来源 |
|---|---|---|
| barCode / material | 是 | `erp_material_search` |
| qty + unit | 是 | 用户；单位与物料主数据一致 |
| depotName | 是 | 用户；`UserDepot` |
| organName（供应商） | 是 | `erp_partner_search` supplier |
| account | 否 | 默认租户账户（现网 `defaultAccount`） |

配制另需成品行 + 子件行；服务耗料需客户。

## 7. 安全与验收矩阵

| # | 场景 | 自动化 | 真人企微 | 期望 |
|---|---|---|---|---|
| 1 | 绑定用户私聊正确短语 | Y | Y | POSTED，一单一号 |
| 2 | 仅模型调用「假 confirm Tool」 | Y | — | 无此 Tool / 404 |
| 3 | 群聊发送确认码 | Y | Y | 403 |
| 4 | 另一 wecomUser 确认 | Y | Y | 403 |
| 5 | 跨租户 draftId | Y | — | 404/403 |
| 6 | 挑战重放（已消费） | Y | Y | 若已 POSTED → replay 原单；否则 409 |
| 7 | 双击并发两请求 | Y | Y | 仅一单；另一 replay |
| 8 | 断线重连后再确认 | — | Y | 同 1 或 replay |
| 9 | 确认前禁用用户 | Y | — | 403 |
| 10 | 确认前去掉仓库权限 | Y | — | 403 |
| 11 | 确认前改 payload | Y | — | 哈希失败，须新挑战 |
| 12 | 过期挑战 | Y | Y | 410；可 re-prepare |
| 13 | 取消后确认 | Y | Y | 409 |
| 14 | 库存不足（耗料/配制） | Y | — | 整单失败，无单据 |
| 15 | 双账号不同仓库隔离 | — | **UAT** | NOT_VERIFIED 直至完成 |

证据要求：脱敏 JSON；不上传 Secret、确认码原文、真实聊天全量。

## 8. 发布闸门

- 本设计 PR：**READY_FOR_REVIEW** → ChatGPT Review。
- Review 通过后控制面 **Release AIERP-015**。
- 015 未 Release 前，Cursor **不得**实现过账 Tool 或自行 Merge 写路径。
