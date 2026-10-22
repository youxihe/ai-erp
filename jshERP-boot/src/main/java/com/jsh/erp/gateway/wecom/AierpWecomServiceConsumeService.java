package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AIERP-016S: WeCom delegated SERVICE (客户服务耗料 / 其它出库) DRAFT prepare.
 * From Excel preview or explicit slots. Confirm is trusted WeCom DM「确认耗料{draftId}」only —
 * never an LLM tool. Does not create SALE / 应收 / finance docs.
 */
@Service
public class AierpWecomServiceConsumeService {

    private static final String CHANNEL = "wecom";
    private static final String BIZ = "SERVICE";

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpGatewayService gatewayService;
    @Resource
    private AierpWecomExcelService excelService;

    /** Explicit slots → unposted SERVICE draft (stock unchanged until 确认耗料). */
    public Map<String, Object> servicePrepare(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        excelService.assertNoOpenFileWorkflow(ctx);
        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        JSONObject draftBody = buildServiceBody(body);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, BIZ, draftBody, owner);
        return enrichServiceView(ctx.user, created);
    }

    /**
     * From persisted Excel preview: exactly one canConfirm SERVICE bill → unposted DRAFT.
     * Stock unchanged; confirm remains trusted「确认耗料{draftId}」.
     */
    public Map<String, Object> prepareVerifiedService(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        Map<String, Object> wf = excelService.peekWorkflow(ctx);
        String previewId = body == null ? null : trimToNull(body.getString("previewId"));
        String fileSha256 = body == null ? null : trimToNull(body.getString("fileSha256"));
        if (previewId == null && wf != null) {
            previewId = trimToNull(String.valueOf(wf.get("previewId")));
        }
        if (fileSha256 == null && wf != null && wf.get("fileSha256") != null) {
            fileSha256 = trimToNull(String.valueOf(wf.get("fileSha256")));
        }
        if (previewId == null) {
            throw new BusinessRunTimeException(404, "没有可生成服务耗料单的 Excel 核对结果，请先发送填写好的服务耗料文件。");
        }
        Map<String, Object> drafted = tryPrepareVerifiedService(ctx, previewId, fileSha256, true);
        if (drafted == null) {
            throw new BusinessRunTimeException(409, "当前 Excel 不能自动生成服务耗料单（需恰好 1 张无错误的服务耗料单）。");
        }
        return drafted;
    }

    /** Soft try used by Excel preview auto-draft (throwOnIneligible=false). */
    public Map<String, Object> tryPrepareVerifiedServiceFromPreview(AierpWecomBindingService.BoundContext ctx,
                                                                    String previewId, String fileSha256,
                                                                    boolean throwOnIneligible) throws Exception {
        return tryPrepareVerifiedService(ctx, previewId, fileSha256, throwOnIneligible);
    }

    private Map<String, Object> tryPrepareVerifiedService(AierpWecomBindingService.BoundContext ctx,
                                                          String previewId, String fileSha256,
                                                          boolean throwOnIneligible) throws Exception {
        Map<String, Object> wf = excelService.peekWorkflow(ctx);
        String activeStatus = wf == null ? "" : String.valueOf(wf.get("status"));
        if (wf == null || !("PREVIEWED".equals(activeStatus) || "DRAFT_READY".equals(activeStatus))
                || previewId == null || !previewId.equals(String.valueOf(wf.get("previewId")))
                || fileSha256 == null || !fileSha256.matches("[0-9a-fA-F]{64}")
                || !fileSha256.equalsIgnoreCase(String.valueOf(wf.get("fileSha256")))) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, "文件核对结果已改变，请按最新 Excel 核对结果办理。");
            }
            return null;
        }

        // Idempotent: same preview already has awaiting SERVICE draft.
        if ("DRAFT_READY".equals(activeStatus) && wf.get("draftId") != null
                && String.valueOf(wf.get("confirmPhrase") == null ? "" : wf.get("confirmPhrase")).startsWith("确认耗料")) {
            long existingId = Long.parseLong(String.valueOf(wf.get("draftId")));
            Map<String, Object> status = gatewayService.draftStatusAs(ctx.user, existingId, toOwner(ctx));
            if ("SERVICE".equals(String.valueOf(status.get("bizType")))
                    && !"CONFIRMED".equals(String.valueOf(status.get("status")))
                    && !"CANCELLED".equals(String.valueOf(status.get("status")))) {
                Map<String, Object> out = enrichServiceView(ctx.user, status);
                out.put("autoDraft", true);
                out.put("replayed", true);
                out.put("businessKey", wf.get("businessKey"));
                out.put("userSummaryZh", wf.get("userSummaryZh"));
                out.put("hintZh", wf.get("userSummaryZh"));
                return out;
            }
        }

        JSONObject payload = excelService.loadOwnedPreviewPayload(ctx, previewId);
        JSONArray records = payload.getJSONArray("records");
        if (records == null || records.isEmpty()) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(400, "预览没有业务行");
            }
            return null;
        }
        JSONObject serviceOk = null;
        int otherOk = 0;
        int bad = 0;
        for (int i = 0; i < records.size(); i++) {
            JSONObject rec = records.getJSONObject(i);
            if (rec == null) {
                continue;
            }
            if (!rec.getBooleanValue("canConfirm")) {
                bad++;
                continue;
            }
            if (BIZ.equals(rec.getString("scene"))) {
                if (serviceOk != null) {
                    otherOk++;
                } else {
                    serviceOk = rec;
                }
            } else {
                otherOk++;
            }
        }
        if (bad > 0 || serviceOk == null || otherOk > 0) {
            String msg;
            if (bad > 0) {
                msg = wf.get("userSummaryZh") == null ? null : String.valueOf(wf.get("userSummaryZh"));
                if (msg == null || msg.trim().isEmpty() || "null".equals(msg)) {
                    msg = "文件还有错误，请改好后重新发送。";
                }
            } else if (serviceOk == null) {
                msg = "当前文件不是服务耗料场景，无法生成服务耗料草稿。";
            } else {
                msg = "当前文件包含多张业务单或非服务耗料场景，请拆成一张服务耗料单后重发。";
            }
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, msg);
            }
            return null;
        }

        String businessKey = serviceOk.getString("businessKey");
        JSONObject normalized = serviceOk.getJSONObject("normalized");
        if (normalized == null) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(400, "预览缺少规范化明细");
            }
            return null;
        }
        JSONObject draftBody = JSON.parseObject(normalized.toJSONString());
        String idem = excelService.shortIdempotencyKeyFor(ctx, fileSha256, businessKey);
        draftBody.put("idempotencyKey", idem);
        if (draftBody.getString("remark") == null || draftBody.getString("remark").trim().isEmpty()) {
            String project = draftBody.getString("serviceProject");
            draftBody.put("remark", project != null && !project.trim().isEmpty()
                    ? ("企微Excel服务耗料 " + businessKey + " / " + project.trim())
                    : ("企微Excel服务耗料 " + businessKey));
        }

        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, BIZ, draftBody, owner);
        Object draftIdObj = created.get("draftId");
        if (draftIdObj == null) {
            throw new BusinessRunTimeException(500, "草稿创建未返回单号");
        }
        long draftId = Long.parseLong(String.valueOf(draftIdObj));
        String confirmPhrase = AierpGatewayService.confirmPhraseFor(BIZ, draftId);
        Map<String, Object> enriched = enrichServiceView(ctx.user, created);
        String summaryZh = buildDraftReadySummary(businessKey, enriched, draftId, confirmPhrase);
        excelService.putOwnedWorkflow(ctx, "DRAFT_READY", previewId, fileSha256, null, null, summaryZh,
                draftId, businessKey, confirmPhrase);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.putAll(enriched);
        out.put("autoDraft", true);
        out.put("businessKey", businessKey);
        out.put("confirmPhrase", confirmPhrase);
        out.put("userSummaryZh", summaryZh);
        out.put("hintZh", summaryZh);
        out.put("posted", false);
        out.put("stockUnchanged", true);
        return out;
    }

    private static AierpGatewayService.WecomDraftOwner toOwner(AierpWecomBindingService.BoundContext ctx) {
        long bindingId = ((Number) ctx.binding.get("id")).longValue();
        long bindingVersion = ctx.binding.get("binding_version") == null
                ? 0L : ((Number) ctx.binding.get("binding_version")).longValue();
        if (bindingVersion < 1L) {
            bindingVersion = 1L;
        }
        String boundAt = String.valueOf(ctx.binding.get("bound_at")).replace('T', ' ');
        if (boundAt.length() > 19) {
            boundAt = boundAt.substring(0, 19);
        }
        return new AierpGatewayService.WecomDraftOwner(
                CHANNEL, ctx.botId, ctx.wecomUserId, bindingId, bindingVersion, boundAt);
    }

    private JSONObject buildServiceBody(JSONObject body) {
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
            throw new BusinessRunTimeException(400, "服务耗料草稿需要 barCode、depotName、unit、organName（客户）");
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
        String serviceProject = trimToNull(body.getString("serviceProject"));
        if (serviceProject != null) {
            draftBody.put("serviceProject", serviceProject);
        }
        String remark = trimToNull(body.getString("remark"));
        if (remark == null && serviceProject != null) {
            remark = "服务项目：" + serviceProject;
        }
        draftBody.put("remark", remark == null ? "企微对话服务耗料草稿" : remark);
        return draftBody;
    }

    Map<String, Object> enrichServiceView(User user, Map<String, Object> created) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.putAll(created);
        data.put("boundErpLoginName", user.getLoginName());
        data.put("tenantId", user.getTenantId());
        data.put("nature", "REAL_ERP");
        data.put("bizType", BIZ);
        data.put("billKindLabel", "服务耗料出库");
        String status = String.valueOf(created.get("status"));
        boolean confirmed = "CONFIRMED".equals(status);
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
            summary.put("partnerType", "客户");
            summary.put("serviceProject", payload.getString("serviceProject"));
            JSONArray lines = payload.getJSONArray("lines");
            if (lines != null && !lines.isEmpty()) {
                JSONObject line = lines.getJSONObject(0);
                summary.put("materialName", line.getString("name"));
                summary.put("barCode", line.getString("barCode"));
                Object qty = line.get("operNumber") != null ? line.get("operNumber") : line.get("qty");
                summary.put("qty", qty);
                summary.put("unit", line.getString("unit"));
                summary.put("depotName", line.getString("depotName"));
                summary.put("currentStock", line.get("currentStock"));
                summary.put("stockDeltaHint", confirmed
                        ? "已出库"
                        : ("-" + stripNumber(qty) + " @ " + line.getString("depotName") + "（仅确认后扣减）"));
            }
        }
        data.put("summary", summary);
        Object draftId = created.get("draftId");
        String phrase = created.get("confirmPhrase") != null
                ? String.valueOf(created.get("confirmPhrase"))
                : AierpGatewayService.confirmPhraseFor(BIZ, Long.parseLong(String.valueOf(draftId)));
        data.put("confirmPhrase", phrase);
        if (!confirmed) {
            Object challenge = created.get("challenge");
            if (challenge instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> ch = (Map<String, Object>) challenge;
                data.put("challenge", ch);
                data.put("hint", ch.get("hint") != null ? ch.get("hint")
                        : ("待确认、未出库。请回复「" + phrase + "」完成服务耗料出库。"));
            } else {
                data.put("hint", "待确认、未出库。请回复「" + phrase + "」完成服务耗料出库。");
            }
        }
        return data;
    }

    private String buildDraftReadySummary(String businessKey, Map<String, Object> enriched,
                                          long draftId, String confirmPhrase) {
        @SuppressWarnings("unchecked")
        Map<String, Object> summary = enriched.get("summary") instanceof Map
                ? (Map<String, Object>) enriched.get("summary") : new LinkedHashMap<String, Object>();
        StringBuilder sb = new StringBuilder();
        sb.append("服务耗料单待确认 #").append(draftId);
        if (businessKey != null && !businessKey.isEmpty()) {
            sb.append("（").append(businessKey).append("）");
        }
        sb.append("\n");
        sb.append("客户：").append(nullToDash(summary.get("partnerName"))).append("\n");
        if (summary.get("serviceProject") != null) {
            sb.append("服务项目：").append(summary.get("serviceProject")).append("\n");
        }
        sb.append(nullToDash(summary.get("materialName")))
                .append("（").append(nullToDash(summary.get("barCode"))).append("）  ")
                .append(stripNumber(summary.get("qty"))).append(" ")
                .append(nullToDash(summary.get("unit")))
                .append(" → ").append(nullToDash(summary.get("depotName"))).append("\n");
        if (summary.get("currentStock") != null) {
            sb.append("当前库存：").append(stripNumber(summary.get("currentStock")))
                    .append(" ").append(nullToDash(summary.get("unit"))).append("（确认前不变）\n");
        }
        sb.append("待确认、未出库。回复「").append(confirmPhrase).append("」完成服务耗料出库。");
        return sb.toString();
    }

    private static String statusLabel(String status) {
        if ("DRAFT".equals(status) || "AWAITING_CONFIRM".equals(status)) {
            return "待确认、未出库";
        }
        if ("CANCELLED".equals(status)) {
            return "已取消";
        }
        if ("CONFIRMED".equals(status)) {
            return "已出库";
        }
        return status == null ? "?" : status;
    }

    private static String stripNumber(Object n) {
        if (n == null) {
            return "";
        }
        try {
            return new BigDecimal(String.valueOf(n)).stripTrailingZeros().toPlainString();
        } catch (Exception ex) {
            return String.valueOf(n);
        }
    }

    private static String nullToDash(Object v) {
        return v == null ? "-" : String.valueOf(v);
    }

    private static String trimToNull(String s) {
        if (s == null || "null".equals(s)) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
