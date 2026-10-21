# AIERP-015B · 可信确认 / 原生入库 / 回执证据

## 自动化（脚本 `deploy/scripts/aierp-015b-confirm-flow.mjs`）

| 项 | 结果 |
|---|---|
| 拒绝 LLM 自报来源 (`eventSource≠WECOM_BEFORE_DISPATCH`) | PASS → 403 |
| 拒绝群聊确认 | PASS → 403 |
| 拒绝未绑定 wecomUser | PASS → 401 |
| 专用测试草稿（未动 #106） | DRAFT `#110` |
| 可信确认过账 | **`GW-PURCHASE-110`** / depotHeadId `365` |
| 库存 | `RM-A001@原料仓` **159.7 → 160.7**（+1 L） |
| 幂等重放 | 同一 `billNumber`，`replayed=true` |
| 原生审核 | `jsh_depot_head.status=1`，`creator=63`（绑定用户 jsh） |
| 文本回执 | `RECEIPT_TEXT_READY` |
| PDF 生成 | **`PDF_GENERATED`**（样例见 `evidence/receipts/sample-GW-PURCHASE-110.pdf`） |
| PDF 企微私聊送达 | **`PDF_DELIVERY_NOT_VERIFIED`**（需真人客户端打开） |

详细 JSON：`docs/poc/evidence/aierp-015b-confirm-flow.json`。

## 原生 actor 审计结论

- `confirmAs` → `postNativeBillAs` → `DepotHeadService.addDepotHeadAndDetailAs` / `batchSetStatusAs`
- **未**伪造 Redis Session / 管理员 Token
- 显式 `User actor` 贯穿创建人、租户、`insertLogWithUserId`、仓库权限与物料扩展更新

## 绑定代际

- `aierp_wecom_binding.binding_version` 单调递增；草稿存 `binding_version`
- 同秒重绑后旧草稿不可确认（403）

## 真人企微 UAT（待用户）

请在企微对 bot 私聊新建采购草稿后回复「确认采购{新草稿号}」（**不要**确认历史 #106）。验证回执文本与 PDF 附件（若渠道 `MEDIA:` 可用）。
