# AIERP-017C1 · 多张采购批次一次可信确认、原生入库和批次回执

- **状态**：RELEASED / next_order #3（017B2 #41 已合并，可与 #44/#45、Demo UAT 并行开发；未经可信确认/权限/幂等闸门不得实际批量过账）。
- **分支**：`feat/aierp-017c1-purchase-batch-confirm` from latest master after 017B2 merge。
- **目标**：用户一份 XLSX 有 2–3 张合法采购单，系统显示每单数量/供应商/仓库/合计，用户本人在企微回复 `确认批次{batchId}`（或经验证的真实卡片）只确认**固定批次清单和版本**；ERP 每张真实授权原生过账，自动给出逐张审核单号/库存差异和 XLSX 批次结果回执，PDF 汇总可作为补充。
- **源事件**：延续 015B 的可信企微 raw inbound 消息挑战/幂等/绑定 actor，不是模型 Tool。挑战绑定 sender/bot/binding generation、batchId、revision、业务清单 hash、单据数/金额；显示后才允许本人确认；群聊/模型自报全部拒绝。
- **批次执行策略**：多张单如原生事务无法跨单原子提交，可逐张提交但明确 `PARTIAL_SUCCESS` 并持久化每张 POSTED/FAILED 状态；网络中断/再发相同确认只处理尚未审核子单，绝不重复库存变化。禁止将部分成功谎称全部成功。
- **严禁调用**原 `AierpExcelService.confirm` 作为批次模型操作（它内部直接逐单过账）；复用经过审查的 native `confirmAs` 及仓库/业务权限重验。
- **验收**：2 张采购单一次本人确认→2 张真实已审核原生单据、原料仓准确净增加、库存明细/合计正确；重放原文不重复过账；其中一张发生业务拒绝→PARTIAL_SUCCESS 并能安全补办失败单；批次结果 XLSX 真正从企微收到并可打开。

## 2026-10-23 并行验收快线
- 批次预览和真实未审核子单展示经 non-post regression 即可提前投本地 Demo，用户边测边反馈；不能因此放开正式批量审核。
- 业务批次 challenge 绑定 bot+sender+ERP actor/tenant+binding_id/version、不可变 manifestHash+revision/所有子单 ID、金额/仓库与过期时间。
- 只有可信本人原始消息`确认批次{batchId}`与当前已展示并未修订的清单一致才可逐张调用原生确认；遇 PARTIAL_SUCCESS 必须准确持久化每张状态和回执；重复原文不能多入库。
- 真正批次结果 XLSX 应借助已实际验证的企微 media adapter 发送，不能回退路径文本/采购模板。部署只由一个 Owner 控制，不能覆盖 F: 最新审查稳定版。
