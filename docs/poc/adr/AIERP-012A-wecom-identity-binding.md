# ADR · AIERP-012A 企微可信身份 → ERP 绑定 → 只读库存

**状态**：Accepted（本机已装 OpenClaw 2026.10.5 + `@wecom/wecom-openclaw-plugin@2026.7.2` 核验）  
**日期**：2026-10-20

## 背景

AIERP-011 已打通企微 Bot WebSocket + DeepSeek。012A 要求按**真实企微发送者**绑定 ERP 登录用户，并按该用户仓库权限只读查库存。禁止共享管理员 Token，禁止信任模型自填的 userId。

## 决策：可信身份来源

官方 WeCom Channel 入站（Bot WS）在 `monitor.js` 将 `body.from.userid` 写入消息 `SenderId`。  
OpenClaw Plugin Tool 工厂回调提供：

- `ctx.messageChannel`（企微会话为 `wecom`）
- `ctx.requesterSenderId`（渠道写入的发送者）
- `ctx.agentAccountId` / `ctx.sessionKey`

官方插件自身对 MCP 工具采用同一模式（仅当 `messageChannel === "wecom"` 时取 `requesterSenderId`）：

```js
const trustedRequesterUserId =
  ctx.messageChannel === CHANNEL_ID
    ? ctx.requesterSenderId?.trim() ?? undefined
    : undefined;
```

**结论：非 `BLOCKED_IDENTITY_CONTEXT`。** 专用 ERP 工具必须复制该判定；忽略工具参数里的 `wecomUserId` / `tenantId` / `erpUserId` / `token`。

## 决策：绑定与委托

1. OpenClaw 工具 `erp_bind_start` 用可信 `wecomUserId` 调用 ERP **适配器接口**（HMAC，非用户 Token）签发一次性绑定码（5 分钟，存哈希）。
2. 用户在已登录的 ERP PC（`/dashboard/aierp`）输入绑定码；`claim` 使用当前 `X-Access-Token` 会话用户完成绑定。
3. `erp_stock_query` / `erp_binding_status` / `erp_unbind` 同样只带适配器签名 + 可信 wecomUserId；ERP 按绑定解析 `tenantId+erpUserId`，内部以该用户执行既有 `stockQuery` 权限/仓库检查。
4. 适配器密钥 `AIERP_WECOM_ADAPTER_SECRET` 仅存本机 `.env` / ERP 环境，不进 Git，不交给模型。
5. **Fail-closed 密钥**：Boot `@PostConstruct` 与每次请求均拒绝缺失 / 过短 / `change-me` 等占位密钥；YAML / compose **无可用默认值**。OpenClaw 与 ERP 共用同一本机高熵密钥。
6. HMAC 载荷含 `timestamp + nonce + body`；服务端短期 nonce 去重防重放（进程内 map；集群级持久化列为技术债）。
7. **实时授权**：`stockQueryDelegated` 每次加载 ERP 用户并校验 `status==0`、租户 `enabled`、未过期；禁用后拒绝，恢复后按**当前**用户权限查询（不缓存旧授权）。

## 后果

- 写单据工具本阶段不注册；网关写接口对适配器路径不可达。
- 群聊：工具层尽量私聊限定——检测 `chatType` / `sessionKey` / `nativeChannelId` 中的 group|channel 则拒绝；官方 WeCom SDK 有 chatType，OpenClaw ToolContext 基类未必透传，故以启发式 + 渠道侧 groupPolicy 双保险。
- F:`\aierp-openclaw` 不重装；插件以本地目录安装并备份配置。
- 自动化隔离测试（单合成企微用户）≠ 双真实 ERP 用户企微权限 UAT（后者单独标 NOT_VERIFIED）。
