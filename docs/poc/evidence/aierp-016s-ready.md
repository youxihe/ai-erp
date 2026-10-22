# AIERP-016S READY_FOR_REVIEW

**HEAD:** `70f94fe08b1fd7ef1b73e1d77b57d65420c7cc92`  
**Branch:** `feat/aierp-016s-service-outbound-sop` (from `origin/master` `74b32fe8`)  
**Compare / open PR:** https://github.com/youxihe/ai-erp/compare/master...feat/aierp-016s-service-outbound-sop?expand=1  
**Status:** READY_FOR_REVIEW — no Merge; no F: plugin overwrite.

## Scope
客户服务耗料出库（SERVICE = 原生其它出库，≠ 销售出库/开票/应收）。

## Delivered
- Java `AierpWecomServiceConsumeService`：`servicePrepare` + `prepareVerifiedService`
- API：`/aierp/v1/wecom/service/prepare` (+ prepare-verified)；HMAC allowlist
- Confirm：可信私聊 `确认耗料{draftId}` only；`确认采购` 跨类型拒绝；无 LLM confirm tool
- SOP：`sop/service-consume.mjs` + registry `service_confirm`
- Plugin minimal：`erp_service_prepare` + phrase match（未整体重写 index.js）
- Receipt：文字《服务耗料出库回执》；`pdfStatus=NONE`（专用 PDF 未交付，诚实）

## Evidence
- `docs/poc/evidence/aierp-016s-service-consume.json` — ALL PASS（含受控 1 L confirm + replay）
- `docs/poc/evidence/aierp-016s-service-consume.md`

Controlled confirm sample：`GW-SERVICE-136`，苏州精密电子，FG-101 成品仓 150→149，原料仓不变。

## UAT (human WeCom)
- [ ] 新草稿后本人发 `确认耗料{n}`
- [ ] 勿确认 #119 等采购单

## Gaps
1. SERVICE 专用 PDF 模板未实现（仅文字回执）
2. 勿单独覆盖 F: 运行插件；集成 PR 后再部署
3. 真人企微 UAT 待用户
