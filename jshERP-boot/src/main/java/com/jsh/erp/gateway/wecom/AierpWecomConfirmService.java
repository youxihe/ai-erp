package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Map;

/**
 * AIERP-015B: trusted WeCom confirm → native post → receipt text.
 * Confirm must come from before_dispatch (or ERP session UI), never LLM self-report.
 */
@Service
public class AierpWecomConfirmService {

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpGatewayService gatewayService;
    @Resource
    private AierpWecomReceiptService receiptService;
    @Resource
    private AierpWecomExcelService excelService;

    /**
     * Adapter entry: HMAC body carries trusted wecomUserId + raw inbound text + messageId.
     */
    public Map<String, Object> confirmFromTrustedInbound(JSONObject body) throws Exception {
        String source = trimToNull(body == null ? null : body.getString("eventSource"));
        if (!"WECOM_BEFORE_DISPATCH".equals(source)) {
            throw new BusinessRunTimeException(403, "确认事件来源必须是 WECOM_BEFORE_DISPATCH");
        }
        if (body != null && (Boolean.TRUE.equals(body.getBoolean("isGroup"))
                || Boolean.TRUE.equals(body.getBoolean("groupChat")))) {
            throw new BusinessRunTimeException(403, "禁止在群聊中确认业务单据");
        }
        String rawText = trimToNull(body == null ? null : body.getString("rawText"));
        if (rawText == null) {
            throw new BusinessRunTimeException(400, "缺少 rawText（须为企微原始私聊原文）");
        }
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        String messageMsgId = trimToNull(body.getString("messageMsgId"));
        long draftId;
        if (body.get("draftId") != null) {
            draftId = Long.parseLong(String.valueOf(body.get("draftId")).trim());
        } else {
            draftId = gatewayService.resolveConfirmDraftId(ctx.user, owner, rawText);
        }
        AierpGatewayService.ConfirmEventProof proof =
                new AierpGatewayService.ConfirmEventProof(rawText, messageMsgId, false, source);
        Map<String, Object> confirmed = gatewayService.confirmAs(ctx.user, owner, draftId, proof);
        try {
            String bizType = confirmed.get("bizType") == null ? null : String.valueOf(confirmed.get("bizType"));
            excelService.markWorkflowPosted(ctx, draftId, bizType);
        } catch (Exception ignore) {
            // workflow cleanup is best-effort; preserve PURCHASE PDF media + SERVICE text paths
        }
        return receiptService.enrichConfirmResult(ctx.user, owner, confirmed);
    }

    /**
     * ERP logged-in UI fallback: session user confirms own WeCom draft.
     * Re-checks live ACTIVE binding + binding_version (never trusts draft-row reconstruction alone).
     */
    public Map<String, Object> confirmUi(JSONObject body, User sessionUser) throws Exception {
        if (sessionUser == null || sessionUser.getId() == null) {
            throw new BusinessRunTimeException(403, "请先登录 ERP");
        }
        if (body == null || body.get("draftId") == null) {
            throw new BusinessRunTimeException(400, "缺少 draftId");
        }
        long draftId = Long.parseLong(String.valueOf(body.get("draftId")).trim());
        Map<String, Object> draftRow = gatewayService.loadOwnedDraftRow(sessionUser, draftId);
        AierpGatewayService.WecomDraftOwner liveOwner =
                bindingService.requireLiveOwnerMatchingDraft(sessionUser, draftRow);
        String bizType = String.valueOf(draftRow.get("biz_type"));
        String phrase = AierpGatewayService.confirmPhraseFor(bizType, draftId);
        AierpGatewayService.ConfirmEventProof proof =
                new AierpGatewayService.ConfirmEventProof(phrase, null, false, "ERP_SESSION_UI");
        Map<String, Object> confirmed = gatewayService.confirmAs(sessionUser, liveOwner, draftId, proof);
        return receiptService.enrichConfirmResult(sessionUser, liveOwner, confirmed);
    }

    private static AierpGatewayService.WecomDraftOwner toOwner(AierpWecomBindingService.BoundContext ctx) {
        long bindingId = ((Number) ctx.binding.get("id")).longValue();
        long bindingVersion = ctx.binding.get("binding_version") == null
                ? 1L : ((Number) ctx.binding.get("binding_version")).longValue();
        if (bindingVersion < 1L) {
            bindingVersion = 1L;
        }
        String boundAt = String.valueOf(ctx.binding.get("bound_at")).replace('T', ' ');
        if (boundAt.length() > 19) {
            boundAt = boundAt.substring(0, 19);
        }
        return new AierpGatewayService.WecomDraftOwner(
                "wecom", ctx.botId, ctx.wecomUserId, bindingId, bindingVersion, boundAt);
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
