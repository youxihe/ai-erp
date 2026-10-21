package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AIERP-015A: WeCom delegated purchase DRAFT create/status/cancel.
 * Ownership = trusted wecomUserId + botId + binding id + bound_at generation.
 * No confirm / posting.
 */
@Service
public class AierpWecomDraftService {

    private static final String CHANNEL = "wecom";

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpGatewayService gatewayService;

    public Map<String, Object> purchasePrepare(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        JSONObject draftBody = buildPurchaseBody(body);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, "PURCHASE", draftBody, owner);
        return enrichPurchaseView(ctx.user, created);
    }

    public Map<String, Object> draftStatus(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        long draftId = requireDraftId(body);
        Map<String, Object> status = gatewayService.draftStatusAs(ctx.user, draftId, toOwner(ctx));
        if ("PURCHASE".equals(String.valueOf(status.get("bizType")))) {
            return enrichPurchaseView(ctx.user, status);
        }
        status.put("boundErpLoginName", ctx.user.getLoginName());
        status.put("statusLabel", statusLabel(String.valueOf(status.get("status"))));
        return status;
    }

    public Map<String, Object> draftCancel(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        long draftId = requireDraftId(body);
        Map<String, Object> cancelled = gatewayService.cancelDraftAs(ctx.user, draftId, toOwner(ctx));
        cancelled.put("boundErpLoginName", ctx.user.getLoginName());
        cancelled.put("statusLabel", "已取消");
        cancelled.put("hint", "草稿已取消，未入库、库存未变化。");
        return cancelled;
    }

    private static AierpGatewayService.WecomDraftOwner toOwner(AierpWecomBindingService.BoundContext ctx) {
        long bindingId = ((Number) ctx.binding.get("id")).longValue();
        String boundAt = String.valueOf(ctx.binding.get("bound_at")).replace('T', ' ');
        if (boundAt.length() > 19) {
            boundAt = boundAt.substring(0, 19);
        }
        return new AierpGatewayService.WecomDraftOwner(CHANNEL, ctx.botId, ctx.wecomUserId, bindingId, boundAt);
    }

    private JSONObject buildPurchaseBody(JSONObject body) {
        String idem = trimToNull(body.getString("idempotencyKey"));
        if (idem == null) {
            throw new BusinessRunTimeException(400, "缺少 idempotencyKey");
        }
        if (idem.length() > 80) {
            throw new BusinessRunTimeException(400, "idempotencyKey 过长");
        }
        String barCode = trimToNull(body.getString("barCode"));
        String depotName = trimToNull(body.getString("depotName"));
        String unit = trimToNull(body.getString("unit"));
        String organName = trimToNull(body.getString("organName"));
        if (barCode == null || depotName == null || unit == null || organName == null) {
            throw new BusinessRunTimeException(400, "采购草稿需要 barCode、depotName、unit、organName");
        }
        BigDecimal qty;
        try {
            qty = new BigDecimal(String.valueOf(body.get("qty")));
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "qty 必须是数字");
        }
        if (qty.compareTo(BigDecimal.ZERO) <= 0) {
            throw new BusinessRunTimeException(400, "qty 必须大于 0");
        }
        JSONObject line = new JSONObject(true);
        line.put("barCode", barCode);
        line.put("depotName", depotName);
        line.put("qty", qty);
        line.put("unit", unit);
        if (body.get("unitPrice") != null) {
            line.put("unitPrice", body.get("unitPrice"));
        }
        JSONArray lines = new JSONArray();
        lines.add(line);
        JSONObject draftBody = new JSONObject(true);
        draftBody.put("idempotencyKey", idem);
        draftBody.put("organName", organName);
        draftBody.put("lines", lines);
        String remark = trimToNull(body.getString("remark"));
        draftBody.put("remark", remark == null ? "企微对话采购草稿" : remark);
        return draftBody;
    }

    private Map<String, Object> enrichPurchaseView(User user, Map<String, Object> created) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.putAll(created);
        data.put("boundErpLoginName", user.getLoginName());
        data.put("tenantId", user.getTenantId());
        data.put("nature", "REAL_ERP");
        String status = String.valueOf(created.get("status"));
        boolean confirmed = "CONFIRMED".equals(status);
        // Do not override accurate posted/stockUnchanged from gateway for CONFIRMED replays.
        if (created.get("posted") == null) {
            data.put("posted", confirmed);
        }
        if (created.get("stockUnchanged") == null) {
            data.put("stockUnchanged", !confirmed);
        }
        data.put("statusLabel", statusLabel(status));
        Object payloadObj = created.get("payload");
        JSONObject payload = payloadObj instanceof JSONObject
                ? (JSONObject) payloadObj
                : JSONObject.parseObject(String.valueOf(payloadObj));
        Map<String, Object> summary = new LinkedHashMap<String, Object>();
        if (payload != null) {
            summary.put("partnerName", payload.getString("organName"));
            JSONArray lines = payload.getJSONArray("lines");
            if (lines != null && !lines.isEmpty()) {
                JSONObject line = lines.getJSONObject(0);
                summary.put("materialName", line.getString("name"));
                summary.put("barCode", line.getString("barCode"));
                summary.put("qty", line.get("operNumber"));
                summary.put("unit", line.getString("unit"));
                summary.put("depotName", line.getString("depotName"));
                BigDecimal unitPrice = line.getBigDecimal("unitPrice");
                BigDecimal amount = line.getBigDecimal("allPrice");
                if (amount == null && unitPrice != null && line.getBigDecimal("operNumber") != null) {
                    amount = unitPrice.multiply(line.getBigDecimal("operNumber")).setScale(2, RoundingMode.HALF_UP);
                }
                summary.put("unitPrice", unitPrice);
                summary.put("amount", amount);
                summary.put("stockDeltaHint", confirmed
                        ? "已过账"
                        : ("+" + line.get("operNumber") + " @ " + line.getString("depotName") + "（仅确认后生效）"));
            }
        }
        data.put("summary", summary);
        if (!confirmed) {
            data.put("hint", "待确认、未入库。库存尚未变化。正式过账属后续可信确认阶段，当前无法通过对话直接审核。");
        }
        return data;
    }

    private static long requireDraftId(JSONObject body) {
        if (body == null || body.get("draftId") == null) {
            throw new BusinessRunTimeException(400, "缺少 draftId");
        }
        try {
            return Long.parseLong(String.valueOf(body.get("draftId")).trim());
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "draftId 无效");
        }
    }

    private static String statusLabel(String status) {
        if ("DRAFT".equals(status)) {
            return "待确认、未入库";
        }
        if ("CANCELLED".equals(status)) {
            return "已取消";
        }
        if ("CONFIRMED".equals(status)) {
            return "已过账";
        }
        return status == null ? "?" : status;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
