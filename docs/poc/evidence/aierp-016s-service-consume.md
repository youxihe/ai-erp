# AIERP-016S · 客户服务耗料出库证据

## 范围

- 分支：`feat/aierp-016s-service-outbound-sop`
- 业务：`SERVICE` = 原生 `出库/其它`，**≠ 销售出库 / 开票 / 应收**
- 确认原文：`确认耗料{数字draftId}`（before_dispatch）；模型无 confirm 工具
- **未**覆盖共享 `F:\aierp-openclaw` 插件；Cursor 不自 Merge

## 自动化（`deploy/scripts/aierp-016s-service-consume.mjs`）

受控脚本确认（`AIERP_016S_CONFIRM=1`）一轮 PASS，JSON：`aierp-016s-service-consume.json`。

| 检查 | 结果 |
|---|---|
| SOP 注册 `service_confirm` / `确认耗料` 解析 | PASS |
| 真实客户（`苏州精密电子`） | PASS |
| 错误客户 / 超库存拒绝 | PASS → 400 |
| prepare → DRAFT `#136`，短语 `确认耗料136`，库存不变 | PASS（N=150） |
| `确认采购136` 确认 SERVICE | PASS 拒绝 |
| `确认耗料136` → `GW-SERVICE-136` | PASS |
| 成品仓 FG-101 | **150 → 149**（−1 L） |
| 原料仓 RM-A001 | **250.7 不变** |
| 原生头 | `出库` / `其它` / `status=1` |
| 回执文字《服务耗料出库回执》 | PASS；`pdfStatus=NONE`（无专用 SERVICE PDF） |
| 同消息重放 | 同单号，库存不二次扣减 |

## 实现要点

- Java：`AierpWecomServiceConsumeService` + `/wecom/service/prepare` / `prepare-verified`
- 网关：`confirmPhraseFor(SERVICE)=确认耗料{id}`；指令与 PURCHASE/MIX 互斥
- Excel：单张合法 SERVICE 预览可自动 DRAFT
- OpenClaw 源码：`sop/service-consume.mjs`、registry、`erp_service_prepare`；统一 F: 部署另排

## 真人企微 UAT（待用户）

私聊再走一轮新草稿（勿确认历史 #136）：模板/槽位 → `确认耗料{新号}` → 客户端可见文字回执。
