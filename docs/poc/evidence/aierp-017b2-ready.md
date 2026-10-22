# AIERP-017B2 READY_FOR_REVIEW (post REVIEW_FIX)

## HEAD

`5bc40da0d3d28188f75e4eb2e249d766da5ca45f` · branch `feat/aierp-017b2-multi-purchase-draft` · 详见 `aierp-017b2-REVIEW_FIX_PUSHED.md`

## 行为

1. 多张采购 Excel（2 businessKey / 3 行）→ 恰好 2 个未审核 DRAFT，库存不变；同文件重传幂等且 **revision 不变**。
2. 已审核单重传（#119 类）→ 仅当原生 `jsh_depot_head.status=1` 核验通过才报「已审核」+ PDF；禁止「未入库」「待确认」；不新建草稿。
3. CONFIRMED 但缺 bill / 缺原生头 / 未审核头 → **RECONCILIATION_REQUIRED**，不新建草稿、不诱导再确认。
4. 同 businessKey 单据字段冲突 → 校验阻断；错误不可静默，须显式 selectedBusinessKeys。
5. API：`/excel/prepare-verified-batch`、`/excel/purchase-batch-prepare`；SOP：`sop/purchase-batch-prepare.mjs`；**无**模型 `excel.confirm`。

## 本地无过账

- `aierp-017b2-multi-purchase`：**18/18 PASS**（fail=0） · at `2026-10-22T16:28:50.688Z`

## 真人企微

请用**新**多单采购 Excel 验证预览摘要；已审核旧文件重传应直接给回执指引。勿对测试草稿做真实确认除非专用新单。
