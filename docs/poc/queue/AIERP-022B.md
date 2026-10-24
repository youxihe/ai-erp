# AIERP-022B · 写操作完成后自动 PDF 发送与真实送达回执

状态：RELEASED / audit delivery #2，按 022A 统一凭证 DTO 接入，可并行实现安全媒体适配。
目标：企业微信本人提交成功的采购/MIX/SERVICE/主数据新增与更新/批次入库后，自动发送精简业务摘要 + **真正的操作回执 PDF 文件**，无需用户再要求“发我回执”。失败只重传回执，绝不重复提交业务。

沿用 Bot WS uploadAndSendMedia 的已验证真实文件能力；当前 wecom-outbound.mjs 动态把 dirname(abs) 添入 mediaLocalRoots 存在任意路径放宽风险，必须改为部署时固定配置的安全媒体目录 + realpath 验证，限制符号链接逃逸与容量。上传成功不等于用户已打开，状态 PDF_READY/CHANNEL_ACCEPTED/CLIENT_OPEN_VERIFIED 必须区分。

每种 receiptKind 匹配各自文件和业务摘要，不能用采购 PDF 代替 MIX 或 SERVICE，不能把 PDF 发送失败说成入库失败。只读请求“刚才的回执再发一遍”要查询同 bot/sender/tenant/actor/binding generation 当前允许的凭证及版本；权限失效拒绝。

对旧 #119/#136 只能只读补发/验证，不得再次过账。验收新测试操作仅在本人真实确认之后生成凭证及主动 PDF，PC/手机真实可打开；客户端未验证只能记 CHANNEL_ACCEPTED。无全路径/JSON/假成功消息，支持同一操作重试投递与限流。
