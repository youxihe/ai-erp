---
name: erp-inventory
description: 库存与物料只读 SOP——按授权仓库查实时库存、消歧物料编码；不写库存、不过账。
---

# 库存与物料（只读）

## 能力

- `erp_stock_query`（实时库存，按绑定 ERP 用户 + UserDepot）
- `erp_material_search`（主数据）
- 辅助：`erp_binding_status`（确认已绑定）

## 槽位

| 用户说法 | 映射参数 |
|---|---|
| 「原料仓里还有多少 X」 | `query=X`, `depotName=原料仓` |
| 「RM-A001 各仓多少」 | `barCode=RM-A001`（省略 depot 则多仓列表） |
| 「查一下表面活性剂」 | `query=表面活性剂` → 若多匹配再要编码 |

## 查询顺序

1. 绑定检查（失败则引导绑定）。
2. 有编码 → 直接 `erp_stock_query(barCode=…)`。
3. 仅中文名 → 先 `erp_material_search`；唯一则带 barCode 查库存；否则列候选。
4. 跨仓汇总：不传 `depotName`，读 `rows[]`。

## 歧义

- `ambiguous=true` 或库存返回多物料行：让用户确认编码后再答数量。
- 关键字未命中：提示换编码或更完整名称，**不**估库存。

## 副作用

- 全程 **READ**；禁止 prepare/confirm/cancel。
- 数字必须来自 `nature=REAL_ERP`；失败时说明原因，不填数。

## 与采购/分析衔接

- 采购前可用本 Skill 验证仓库与可用量（只读）。
- 分析报表见 `erp-analysis`；本 Skill 不做区间汇总。

## 权限拒绝

403「没有可查询的仓库」→ 说明账号未分配 UserDepot，不能查任意仓。
