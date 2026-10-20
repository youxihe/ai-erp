# AIERP-005 · 演示工作台

登录 jshERP 后打开 `/dashboard/aierp`。开发服务配置端口是 3000；若 3000 已被占用，Vue 会改用下一个端口。本次本机验证在 `http://localhost:3001/dashboard/aierp`：库存卡片显示原料仓 RM-A001 为 135.9，最近单据包含 `GW-PURCHASE-88`、`GW-MIX-89`、`GW-SERVICE-90`，助手接口未合并时标明待接入并用页面上的真实库存回答。

页面调用已登录会话：

- `POST /aierp/v1/report/summary` 显示真实库存和最近网关单据
- `GET /aierp/v1/excel/template`、`POST /excel/preview`、`POST /excel/confirm`、`GET /excel/receipt`
- `POST /aierp/v1/assistant/turn`

接口返回 404 时页面显示“待接入”，不会把本地引导写成已过账。确认按钮只在解析出预览编号后出现。
