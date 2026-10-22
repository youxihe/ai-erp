# AIERP-021A · 企微对话创建/修改供应商与客户（ERP 原生主数据）

- **状态**：READY_FOR_REVIEW（实现完成，待 ChatGPT Review；勿 Merge；F: 插件未接线）
- **分支**：`feat/aierp-021a-partner-masterdata-sop`，基于最新 origin/master。
- **HEAD**：见 push 后最新 commit（证据 `docs/poc/evidence/aierp-021a-ready.md`）。
- **交付目标**：对话“新增供应商”“修改客户联系人/电话/地址”“查供应商资料”→ 真实 ERP 往来单位档案持久化，可立即被采购/服务耗料按名称检索。**创建/修改前显示摘要或字段差异，用户本人明确确认**，而不是模型认为“已提交”就生效。

## 已核对的现有代码（必须复用数据语义而不是直接复用假 Session）

- `SupplierController` 有 `POST /supplier/add`、`PUT /supplier/update`、`checkIsNameAndTypeExist`；Supplier 实体 `type=供应商|客户`、`supplier` 名称、`contacts,phoneNum,email,address,telephone,description,enabled,tenantId` 等。
- 原生 `SupplierService.insertSupplier/updateSupplier` 依赖 `userService.getCurrentUser()`、`HttpServletRequest` 与 `setUserCustomerPermission`，直接模拟伪登录会话是**错误路径**；新增狭窄 `PartnerMasterDataService.createPartnerAs(User actor,...)` / `updatePartnerAs`（Partner-only；勿与 021B Material 共用 service），显式身份 + 事务 + 审计 + 与原生字段约束兼容，严禁利用共享 admin token。
- 当前 SupplierService 原生逻辑部分异常吞掉后返回 0；必须对返回值和最终 DB 记录做事实校验、错误时不宣称成功。用户权限（往来单位/客户分配）需与原生相容；不能因“新增客户”给所有用户全局权限。

## 最小字段
- **供应商**：供应商名称（必填，租户内同类型去重）、联系人、联系电话、地址、备注（选填）；实体类型固定 **供应商**。
- **客户**：客户名称（必填，租户内同类型去重）、联系人、联系电话、地址、备注（选填）；实体类型固定 **客户**。
- 允许一个名称在客户和供应商两个类型分别存在，但选择/使用时必须显式类型匹配；禁止自动将客户改成供应商或反过来。
- 本棒仅开放上述普通资料字段。**不允许**经聊天直接写银行账号、税号、初期应收/应付、预收款、税率、对账余额、启用/停用、删除、数据权限配置等敏感/财务字段；待独立正式业务评审。手机号/邮箱格式检查，备注长度限制；返回信息按渠道只展示业务必要字段。

## SOP
- `sop/partner-upsert.mjs`：意图识别 + 受控字段收集 + 本人审批提示；后端 `POST /aierp/v1/wecom/master/partner/prepare` 返回单次 challenge / normalized payload / record digest，**只创建业务操作申请，不立即建档**。
- 本人原始企微 DM 明确回复 `确认建档供应商{申请号}` / `确认修改供应商{申请号}` 或 `确认建档客户{申请号}` / `确认修改客户{申请号}`（**禁止**裸 `确认建档{申请号}`，避免与 021B 物料冲突），Channel trusted handler→签名 `/master/partner/commit`，服务端在执行前重验当前绑定 actor/tenant/角色权限、版本/申请数据 digest、同类型名称冲突和幂等。LLM **没有 master-data commit Tool**；群聊及由模型自报确认均拒绝。
- 更新必须先按 ERP 主键定位准确现有记录，展示字段级 `旧值→新值`，只允许白名单字段部分更新；无 ID/同名多候选时先让用户选择，不允许模糊更新。并发更新冲突（record version/modifiedAt 或已读取快照 hash）明确拒绝覆盖。
- 申请存放 ERP Redis/DB，以可信 wecom sender + bot + binding ID/version + ERP actor/tenant + request ID、请求 digest/TTL 关联；用户 /new 后还可查询，换绑立即失效，防重复提交、多设备重试。
- 成功返回真实 `supplier.id`、类型、名称及变更摘要；失败说明重名/无权限/格式等业务原因，不输出堆栈或内部账号。
- 新建成功后，由 021C 续接当前挂起的采购/服务业务（在该集成任务实现前可明确给出“继续刚才采购”并从服务端已有业务上下文恢复）。

## 本地非破坏测试 + 真人 UAT
1. 在 ERP 测试租户用唯一名称（例如带当天时分的测试供应商、测试客户）分别新增一条；**prepare 时 DB 零新增**、确认后查询真实 id/type/tenant/creator。重复同一申请只有一条。
2. 更改测试供应商的联系人电话，展示差异→可信本人确认→ERP 真值更新；其它字段如银行账号、余额完全不变；无版本冲突覆盖。
3. 名称重复/跨类型/同类型更新、权限不足/停用、换绑、跨租户/企微另一个 sender、群聊原文、LLM 自称确认、并发重试均负例通过。
4. 新供应商立即可用于 PURCHASE 单据的真实下拉查询；新客户立即可用于 SERVICE 选择。**不进行真实采购/耗料过账**，除非用户单独明确确认。
5. 明确使用真正的企业微信私聊测试真实添加/修改；运行 F: 备份与统一集成，不能直接覆盖正在工作的插件；提交 READY_FOR_REVIEW 和本地+客户端证据，不自行 Merge。
