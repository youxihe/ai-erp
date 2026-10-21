# AI-ERP Agent · 017A Round3 文件字节预览收口

**Repo** `youxihe/ai-erp`。master 已含 015B（#27）与 019A（#31）及控制面 #32。

## PR #30 AIERP-017A · REVIEW_FIX_PUSHED（本分支）

P0 已修：用户回传 XLSX 时不再依赖 OBSERVE 改写 `event.content`；改为：

1. `message_received` 暂存并 **await** 真实文件字节 → ERP `previewAs`
2. `before_dispatch` **claim** 返回 PREVIEWED（previewId + 单元格行）或 FILE_PARSE_FAILED
3. 服务端 Redis 文件工作流门禁：打开时拒绝 `erp_purchase_prepare` 凭文件名建草稿
4. 「取消文件」关闭工作流后可口头采购

**禁止**确认/修改草稿 #113；库存与已审核单据在预览路径上不变。保留 13 模型工具 + 015B 确认钩子；不暴露 excel.confirm。

不自行 Merge；017B/C 未释放。
