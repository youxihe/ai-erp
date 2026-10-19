# AIERP-002 · Excel 双向工作流

真实接口都在 `/jshERP-boot/aierp/v1/excel`，需要当前登录用户的 `X-Access-Token`。

| 动作 | 方法 | 说明 |
|---|---|---|
| 下载模板 | `GET /excel/template?scene=PURCHASE\|MIX\|SERVICE\|INITIAL\|SALE\|PACK` | 返回 xlsx。期初和销售表写明不能确认过账 |
| 预填模板 | `POST /excel/template` | JSON `{scene, rows}` |
| 解析预览 | `POST /excel/preview` | `multipart` 字段 `file`。不创建单据、不改库存 |
| 确认过账 | `POST /excel/confirm` | `{previewId, idempotencyBatchKey, selectedBusinessKeys?}`。按业务单调用已合并网关 |
| 下载回执 | `GET /excel/receipt?batchId=` | xlsx |

采购、配制、服务的表头在第 3 行，数据从第 4 行开始。配制按配制单号合成一张组装单，成品默认成品仓，原料默认原料仓。同一 `idempotencyBatchKey` 再次确认返回原结果。

```powershell
node deploy/scripts/excel-flow.mjs
```
