# AIERP-017A Review Fix · unified plugin + prefill（2026-10-21）

## Status: `REVIEW_FIX_PUSHED`

## P0 回归（非过账）

| Check | Result |
|---|---|
| F: 插件备份 | `aierp-erp-tools.bak-unified-015b-017a-*` |
| 模型工具 13 个（含 `erp_excel_template`） | PASS · `aierp-017a-unified-plugin-smoke.json` |
| `before_dispatch` 采购确认钩子 | PASS（源码注册；**未**重跑历史草稿确认） |
| Excel 入站预览钩子 | PASS |
| 无 `erp_draft_confirm` / `excel.confirm` 模型工具 | PASS |
| AGENTS：单张原文确认可入库；Excel 仅预览、无批量过账 | PASS |
| Excel template/preview 14/14 | PASS · `aierp-017a-excel-preview-flow.json` |
| 预填 RM-A001 / 华东化工 / 原料仓 / 10 L | PASS · `aierp-017a-prefill-evidence.json` + `.xlsx` |
| 库存 RM-A001@原料仓 | **170.7 不变** |
| Gateway 已加载 `aierp-erp-tools` | PASS（日志 `16 plugins: aierp-erp-tools, …`） |

## Prefill

- Java `templateAs` + WeCom adapter 接受 `rows`/`fill`；插件 `erp_excel_template` 转发 `rows`。
- 预填校验：物料/单位/供应商存在性 + UserDepot；幽灵仓 → 403。
- 落盘证据：`docs/poc/evidence/aierp-017a-prefill-RM-A001.xlsx`；`MEDIA:` 路径已写入 OpenClaw `state/media/aierp-excel/`。

## 真人企微文件收发

- 运行态已恢复确认钩子 + Excel 工具；预填 XLSX 与 MEDIA 路径就绪。
- **`FILE_OUTBOUND_WECOM` / 回传预览**：需用户在企微私聊再说一次「填上去给我模板…」完成端到端 UAT（本脚本不伪造渠道送达）。标记 `LIVE_WECOM_FILE_UAT=PENDING_USER`。

## 不做

- 不自行 Merge；不重装 OpenClaw；不开发 017B/017C；不确认 #106/#111。
