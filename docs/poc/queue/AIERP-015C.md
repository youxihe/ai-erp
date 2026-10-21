# AIERP-015C · 企微 PDF 回执送达与确认文案容错

- **状态**：PLANNED / NOT RELEASED，依赖 #27 AIERP-015B 最终 Review/Merge。
- **目标**：原生采购已审核后 ERP 服务端生成的 PDF 文件可以通过真实企业微信私聊发给确认人，并由其客户端收到/打开；用户可再次索要/下载同一回执；支持“确认采购：111”“确认采购 111”等合理标点/空格。
- **范围**：官方 Channel 的可信受控媒体 API、文件传输/失败重试/过期管理、回执实时权限和审计、中文打印；不改原生采购库存事务，不给 DeepSeek arbitrary FS/file-upload 权限。
- **验收**：PDF 客户端收到并打开才标 `PDF_SENT_VERIFIED`，否则标 `PDF_DELIVERY_NOT_VERIFIED`。同一 receiptId 幂等文件发送，发文件失败不重新过账；低权限用户不得查询/下载他人回执。
- **许可证**：检查已有 iText 5/PDF 依赖许可证与将来商业化兼容性，必要时安排替换组件，不从容器打包/分享第三方字体文件。
