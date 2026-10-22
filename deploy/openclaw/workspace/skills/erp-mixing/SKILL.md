---
name: erp-mixing
description: 组装配制（药水配制）SOP：Excel/槽位 → 配方哈希原文确认 → 未审核草稿 → 原文确认配制 → 原生库存与文字回执。
---

# 组装配制 / 药水配制（AIERP-016M）

## 触发（仅技能摘要）

| 用户说法 | 处理 |
|---|---|
| 「配制模板 / 药水配制模板」 | `erp_excel_template(scene=MIX)` |
| 回传配制 Excel（同配制单号多行原料） | 预览 → 未审核 MIX 草稿；库存不变 |
| 对话槽位配方 | `/mix/recipe-preview` 展示完整成品+原料草案 + `recipeHash` |
| 「确认配方{哈希}」 | **可信原文** before_dispatch；标记 USER_ACKED（不是模型 Tool） |
| 携带已确认 `recipeHash` 准备草稿 | `/mix/prepare` → 未审核 DRAFT |
| 「确认配制{数字草稿号}」 | **可信原文** before_dispatch 过账 |
| 查最近配制 / `GW-MIX-*` | `erp_bill_search(mix)` / `erp_bill_detail` |

## 硬规则

- 配方必须是**用户确认的测试值**；禁止 AI 擅自推导化学比例。
- **模型布尔 `recipeUserConfirmed` 永不等于批准**；须服务端 `recipeHash` + 用户原文「确认配方{hash}」。
- 准备草稿**不改库存**；仅 `确认配制{draftId}` 过账。
- MIX ≠ 完整 MES/工单/BOM；原料仓→成品仓为当前默认语义。
- 回执列成品 FG + 各原料扣减；**不许用采购 PDF 冒充配制回执**（MIX 仅文字回执，无专用 PDF）。
- Excel `MIX_HEADERS` 有两个「单位」列，成品/原料单位按列位读取，不可串列。

## 槽位（对话制备）

1. 成品：`finished.barCode`, `qty`, `unit`, `depotName`（默认成品仓）
2. 原料：`lines[].barCode`, `qty`, `unit`, `depotName`（默认原料仓）
3. `recipe-preview` → 展示全文 → 用户「确认配方{shortHash}」→ `prepare(recipeHash, idempotencyKey)`

## 负例

原料不足 / 无权仓库 / 单位错误 / 用「确认采购」确认配制草稿 / 仅模型布尔或未 ack 的哈希 → 拒绝；重复确认幂等、库存只变一次。
