# ADR · AIERP-014D 对话式业务草稿与显式确认协议

**状态**：Proposed / READY_FOR_REVIEW（docs-only）  
**日期**：2026-10-21  
**范围**：产品与架构闸门；**不实现** OpenClaw 写工具、不改 `draft.confirm` / 原生库存事务。  
**前置**：AIERP-012A 身份绑定；AIERP-013 只读查询（可并行 Review）。  
**后继**：ChatGPT Review 通过后 Release **AIERP-015**（采购写路径）。

## 1. 问题

用户希望在企微用自然语言完成采购/配制/服务耗料，但：

1. 模型可伪造「用户已确认」；
2. 现有 `AierpGatewayService.confirm` 依赖 **HTTP session 当前用户**，不能被 Agent 用管理员会话代审；
3. 企微模板卡片回调能力未在本机 Bot 上实证，不能假设一定可用。

## 2. 决策摘要

| 主题 | 决策 |
|---|---|
| 信任边界 | OpenClaw 只做意图/槽位/展示；**Java 适配器**裁定身份、草稿、挑战、过账 |
| 确认触发 | **禁止** `erp_draft_confirm({draftId})` 单独过账；必须消费**服务端发行的一次性确认挑战**，且挑战与**可验证的渠道事件**绑定 |
| 首选确认通道 | A) 企微私聊**带挑战码的原文消息事件**（渠道 `requesterSenderId` + 消息体匹配）→ B) 已登录 ERP 的本机 H5/PC 确认页 → C) 官方模板卡片回调（能力实测后升级，非阻塞） |
| 草稿 | 可调用现有 `purchase/draft|mix/draft|service/draft` 生成 `DRAFT`；**创建草稿 ≠ 过账** |
| 过账 | 服务端在验证挑战后，以**绑定 ERP 用户**委托执行既有 `draft.confirm` 逻辑（见 §6），单次成功 |
| 群聊 | 写路径一律拒绝 |

## 3. 数据流（采购）

```
用户私聊 → DeepSeek 槽位收集
    → erp_material_search / erp_partner_search / erp_stock_query（013）
    → erp_purchase_prepare（015）→ Java 校验 → 调用原生 purchase/draft → DRAFT
    → 服务端签发 ConfirmChallenge（5–10min，一次性）
    → 企微展示摘要 + 挑战提示（或 H5 链接）
    → 可信确认事件 → Java 验证挑战 + 重检绑定/权限/payload 哈希
    → 委托 confirmInTx → 原生单据号 + 库存变化
```

配制/服务耗料同协议，仅 `bizType` 与槽位不同（016）。

## 4. 服务端状态机

```
COLLECTING → VALIDATING → DRAFT_READY → AWAITING_CONFIRM
AWAITING_CONFIRM → COMMITTING → POSTED
AWAITING_CONFIRM → CANCELLED | EXPIRED | SUPERSEDED
COMMITTING → POSTED | FAILED_RETRYABLE（不重复插单）
POSTED →（终态；重放返回同一 billNumber）
```

对应 `aierp_gateway_draft.status` 扩展建议（015 实现时迁移，本设计不改表）：

| 状态 | 含义 |
|---|---|
| `DRAFT` | 已落库，未请求确认 |
| `AWAITING_CONFIRM` | 已发挑战，等待可信确认 |
| `COMMITTING` | 事务中（短） |
| `CONFIRMED` | 已过账（等同现网） |
| `CANCELLED` | 用户取消 |
| `EXPIRED` | 挑战超时 |
| `SUPERSEDED` | 被编辑后的新草稿版本替代 |

**规则**：

- 编辑草稿 → 递增 `draftVersion`，旧挑战作废，需重新确认。
- `CONFIRMED` 上任何确认重放 → 返回已有 `billNumber`，**不再次** `addDepotHeadAndDetail`。
- `CANCELLED`/`EXPIRED`/`SUPERSEDED` 不可再确认。

## 5. 确认挑战（ConfirmChallenge）

字段（持久化，多实例共享；进程内 map 不够）：

- `challengeId`（高熵）
- `botId`, `wecomUserId`, `tenantId`, `erpUserId`, `draftId`, `draftVersion`
- `businessHash` = SHA-256(canonical payload JSON)
- `expiresAt`（建议 7 分钟）
- `consumedAt`（空=未用）
- `channel`=`wecom`
- `expectedPhrase`（可选：用户须回复的短码，如 `确认-AB12`）

验证步骤（全部通过才过账）：

1. HMAC 适配器签名 + nonce（同 012A）；
2. `wecomUserId` 来自渠道可信身份，与挑战绑定一致；
3. 绑定仍 ACTIVE；用户/租户实时启停校验（同 012A）；
4. 角色仍具备对应 biz 的审核按钮（现网 `BTN_AUDIT`）；
5. 仓库/供应商/客户/物料仍属于租户且在授权范围（`reassertAccess`/`reassertParties`）；
6. 当前 draft payload 的 `businessHash` 与挑战一致；
7. 挑战未过期、未消费；消费用 `UPDATE ... WHERE consumed_at IS NULL` 单行；
8. 非群聊。

**明确拒绝**：模型自报「用户说确认了」而无挑战消费；群聊转发挑战码；另一企微用户；跨租户 draftId。

## 6. 绑定用户委托过账（相对现网 session）

现状：`confirm` → `userService.getCurrentUser()`（session）。

015 设计（不在本 PR 实现）：

1. 新增适配器路由 `POST /aierp/v1/wecom/draft/confirm-with-challenge`（HMAC）；
2. 解析绑定用户后，在**同一事务**内调用抽取的 `confirmAs(User user, …)`（从现 `confirmInTx` 抽出，禁止再读 session）；
3. 原生 `depotHeadService.addDepotHeadAndDetail` 若仍依赖 session，则在委托路径设置受控 `Request`/`User` 上下文（仅该绑定用户），**禁止**管理员 Token 冒充；
4. OpenClaw **不**持有 ERP 密码或长期用户 Token。

## 7. 备选方案对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 模型直接调 confirm Tool | 实现快 | 可伪造 | **否决** |
| 仅文本「确认」无挑战 | UX 简单 | 易误触/转发 | **否决**作唯一凭据 |
| 私聊挑战码短语 | 不依赖卡片 SDK；可验发送者 | 需用户打字 | **POC 默认** |
| 官方模板卡片回调 | UX 好 | 未实证；签名/环境差异 | **能力探针后可选升级** |
| 已登录 H5/PC | 强身份 | 手机外网未必可达 | **保底**（同机 POC） |

## 8. 幂等与并发

- 草稿创建：沿用 `idempotencyKey`（tenant+user 唯一）。
- 确认：`challengeId` 单次消费 + draft 行 `FOR UPDATE` + 已 `CONFIRMED` 短路返回。
- 企微重复投递 / 用户双击：第二次得同一 `billNumber`，`replay=true`。
- 库存死锁：保留现网最多 3 次重试；失败返回可重试错误，**不**谎称成功。

## 9. 安全与验收矩阵（摘要）

详见 `docs/poc/14d-api-contract.md` §验收。关键项：

| 场景 | 期望 |
|---|---|
| 绑定用户私聊回复正确挑战短语 | 过账成功，一单一号 |
| 群聊出现挑战码 | 拒绝 |
| 另一企微用户确认 | 拒绝 |
| 过期后确认 | 拒绝；可重新 prepare |
| 确认前撤销仓库权限 | 拒绝 |
| 确认前改草稿内容 | 哈希失败，须新挑战 |
| 已成功后再确认 | 返回原单号，库存不变 |
| 自动化 | 合成身份 + HMAC；无真人也可测挑战机 |
| 真人 UAT | 双账号仓库隔离；标 NOT_VERIFIED 直至完成 |

## 10. 后果

- 015 前禁止注册任何过账 Tool。
- 013 查询工具继续服务槽位消歧。
- 不假设企微卡片；不开放公网 H5，除非另立网络与鉴权任务。
