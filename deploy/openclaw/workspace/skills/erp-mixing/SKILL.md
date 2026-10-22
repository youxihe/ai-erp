---
name: erp-mixing
description: 组装配制（药水配制）SOP：Excel/槽位 → 未审核草稿 → 原文确认配制 → 原生库存与文字回执。
---

# 组装配制 / 药水配制（AIERP-016M）

## 触发（仅技能摘要）

| 用户说法 | 处理 |
|---|---|
| 「配制模板 / 药水配制模板」 | `erp_excel_template(scene=MIX)` |
| 回传配制 Excel（同配制单号多行原料） | 预览 → 未审核 MIX 草稿；库存不变 |
| 「确认配制{数字草稿号}」 | **可信原文** before_dispatch 过账（唯一库存变更授权） |
| 查最近配制 / `GW-MIX-*` | `erp_bill_search(mix)` / `erp_bill_detail` |

## 硬规则

- 配方必须是**用户核对过的测试值**；禁止 AI 擅自推导化学比例。
- **模型布尔** `recipeUserConfirmed` / `userConfirmedRecipe` **不能**证明用户已核对。
- 槽位路径：`/mix/recipe-preview`（展示完整成品/原料 + 服务端 `recipeHash`）→ `/mix/prepare(recipeHash)` → 原文「确认配制{id}」。
- 准备草稿**不改库存**；仅 `确认配制{draftId}` 过账（唯一确认/过账路径）。
- MIX ≠ 完整 MES/工单/BOM；原料仓→成品仓为当前默认语义。
- 回执列成品 FG + 各原料扣减；**不许用采购 PDF 冒充配制回执**（MIX 无专用 PDF，文字回执）。
- Excel `MIX_HEADERS` 有两个「单位」列，成品/原料单位按列位读取，不可串列。

## 槽位（对话制备）

- 成品：`finished.barCode`, `qty`, `unit`, `depotName`（默认成品仓）
- 原料：`lines[].barCode`, `qty`, `unit`, `depotName`（默认原料仓）
- **先** `/mix/recipe-preview` 展示完整成品/原料配比并取得 `recipeHash`（草案 PROPOSED）
- **再** `/mix/prepare` 携带该 `recipeHash` + `idempotencyKey` 生成未审核草稿
- 过账仅原文 `确认配制{draftId}`

## 负例

原料不足 / 无权仓库 / 单位错误 / 用「确认采购」或「确认耗料」确认配制草稿 / 仅靠模型布尔跳过配方展示 → 拒绝；重复确认幂等、库存只变一次。
