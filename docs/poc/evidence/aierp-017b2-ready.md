# AIERP-017B2 READY_FOR_REVIEW

## HEAD

`60067efb50085c2fd533b50f4a488f985c9c0460` · branch `feat/aierp-017b2-multi-purchase-draft` · **READY_FOR_REVIEW**（勿 merge）

## 行为

1. 多张采购 Excel（2 businessKey / 3 行）→ 恰好 2 个未审核 DRAFT，库存不变；同文件重传幂等。
2. 已审核单重传（#119 类）→ 回复「已审核」+ 原生单号 / 可领 PDF；禁止「未入库」「待确认」；不新建草稿。
3. 同 businessKey 供应商冲突 → 校验阻断，不建草稿。
4. API：`/excel/prepare-verified-batch`、`/excel/purchase-batch-prepare`；SOP：`sop/purchase-batch-prepare.mjs`（未扩 plugin/index.js）。
5. 批次确认留 017C1；仍可用逐张「确认采购{draftId}」。

## 本地无过账

- `aierp-017b2-multi-purchase`：**13/13 PASS**（fail=0）

## 真人企微

请用**新**多单采购 Excel 验证预览摘要；已审核旧文件重传应直接给回执指引。勿对测试草稿做真实确认除非专用新单。
