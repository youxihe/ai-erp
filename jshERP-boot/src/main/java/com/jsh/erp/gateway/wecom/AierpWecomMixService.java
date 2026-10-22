package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import com.jsh.erp.service.RedisService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * AIERP-016M: WeCom MIX (组装/配制) unposted DRAFT from Excel preview or user-confirmed recipe slots.
 * Never posts inventory; confirm remains trusted before_dispatch「确认配制{draftId}」only.
 * Not a full MES/BOM — recipe must be user-confirmed test values.
 */
@Service
public class AierpWecomMixService {

    private static final String WF_PREFIX = "aierp:excel-wf:";
    private static final long WF_TTL_SECONDS = 6L * 60L * 60L;
    private static final String CHANNEL = "wecom";
    private static final String DEFAULT_FG_DEPOT = "成品仓";
    private static final String DEFAULT_RM_DEPOT = "原料仓";

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpGatewayService gatewayService;
    @Resource
    private RedisService redisService;
    @Resource
    private JdbcTemplate jdbcTemplate;

    /**
     * Create/reuse unposted MIX draft from persisted Excel preview (payload_json).
     * Requires exactly one confirmable MIX group (same 配制单号, multi raw lines).
     */
    public Map<String, Object> prepareVerifiedMix(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        Map<String, Object> wf = getWorkflow(ctx);
        String previewId = body == null ? null : trimToNull(body.getString("previewId"));
        String fileSha256 = body == null ? null : trimToNull(body.getString("fileSha256"));
        if (previewId == null && wf != null) {
            previewId = trimToNull(String.valueOf(wf.get("previewId")));
        }
        if (fileSha256 == null && wf != null && wf.get("fileSha256") != null) {
            fileSha256 = trimToNull(String.valueOf(wf.get("fileSha256")));
        }
        if (previewId == null) {
            throw new BusinessRunTimeException(404, "没有可生成配制单的 Excel 核对结果，请先发送填写好的配制文件。");
        }
        Map<String, Object> drafted = tryPrepareVerifiedMix(ctx, previewId, fileSha256, true);
        if (drafted == null) {
            throw new BusinessRunTimeException(409, "当前 Excel 不能自动生成配制单（需恰好 1 张无错误的配制单）。");
        }
        return drafted;
    }

    /**
     * Create MIX draft from explicit user-confirmed recipe slots (not AI-invented ratios).
     * Body: finished{barCode,qty,unit,depotName?}, lines[{barCode,qty,unit,depotName?}], idempotencyKey, remark?
     */
    public Map<String, Object> mixPrepare(JSONObject body) throws Exception {
        // Validate user-confirmed recipe before workflow/binding side effects.
        JSONObject draftBody = buildMixBodyFromSlots(body);
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        assertNoBlockingWorkflow(ctx);
        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, "MIX", draftBody, owner);
        return enrichMixView(ctx, created, draftBody.getString("businessKey"), false);
    }

    /** Soft try used by Excel preview auto-draft (throwOnIneligible=false). */
    public Map<String, Object> tryPrepareVerifiedMixFromPreview(AierpWecomBindingService.BoundContext ctx,
                                                                String previewId, String fileSha256,
                                                                boolean throwOnIneligible) throws Exception {
        return tryPrepareVerifiedMix(ctx, previewId, fileSha256, throwOnIneligible);
    }

    private Map<String, Object> tryPrepareVerifiedMix(AierpWecomBindingService.BoundContext ctx,
                                                      String previewId, String fileSha256,
                                                      boolean throwOnIneligible) throws Exception {
        Map<String, Object> active = getWorkflow(ctx);
        String activeStatus = active == null ? "" : String.valueOf(active.get("status"));
        if (active == null || !("PREVIEWED".equals(activeStatus) || "DRAFT_READY".equals(activeStatus))
                || previewId == null || !previewId.equals(String.valueOf(active.get("previewId")))
                || fileSha256 == null || !fileSha256.matches("[0-9a-fA-F]{64}")
                || !fileSha256.equalsIgnoreCase(String.valueOf(active.get("fileSha256")))) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, "文件核对结果已改变，请按最新 Excel 核对结果办理。");
            }
            return null;
        }
        JSONObject payload = loadPreviewPayload(ctx, previewId);
        JSONArray records = payload.getJSONArray("records");
        if (records == null || records.isEmpty()) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(400, "预览没有业务行");
            }
            return null;
        }
        List<JSONObject> mixOk = new java.util.ArrayList<JSONObject>();
        List<JSONObject> otherOk = new java.util.ArrayList<JSONObject>();
        List<JSONObject> bad = new java.util.ArrayList<JSONObject>();
        for (int i = 0; i < records.size(); i++) {
            JSONObject rec = records.getJSONObject(i);
            if (rec == null) {
                continue;
            }
            if (!rec.getBooleanValue("canConfirm")) {
                bad.add(rec);
                continue;
            }
            if ("MIX".equals(rec.getString("scene"))) {
                mixOk.add(rec);
            } else {
                otherOk.add(rec);
            }
        }
        if (!bad.isEmpty() || mixOk.size() != 1 || !otherOk.isEmpty()) {
            String msg;
            if (!bad.isEmpty()) {
                msg = "配制文件还有错误，请改好后重新发送。";
            } else if (mixOk.size() > 1 || !otherOk.isEmpty()) {
                msg = "当前文件不是单张配制单，请拆成同一配制单号的一张 MIX 后重发。";
            } else {
                msg = "没有可生成的配制单。";
            }
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, msg);
            }
            return null;
        }

        JSONObject record = mixOk.get(0);
        String businessKey = record.getString("businessKey");
        JSONObject normalized = record.getJSONObject("normalized");
        if (normalized == null) {
            throw new BusinessRunTimeException(400, "预览缺少规范化明细");
        }
        JSONObject draftBody = buildMixDraftFromNormalized(normalized, businessKey);
        String idem = shortIdempotencyKey(ctx, fileSha256, businessKey);
        draftBody.put("idempotencyKey", idem);
        if (draftBody.getString("remark") == null || draftBody.getString("remark").trim().isEmpty()) {
            draftBody.put("remark", "企微Excel配制 " + businessKey + "（测试配方，需用户确认）");
        }

        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, "MIX", draftBody, owner);
        Object draftIdObj = created.get("draftId");
        if (draftIdObj == null) {
            throw new BusinessRunTimeException(500, "草稿创建未返回单号");
        }
        long draftId = Long.parseLong(String.valueOf(draftIdObj));
        String confirmPhrase = "确认配制" + draftId;
        String summaryZh = buildMixDraftSummary(businessKey, created, draftId, confirmPhrase);
        putWorkflow(ctx, "DRAFT_READY", previewId, fileSha256, null, null, summaryZh,
                draftId, businessKey, confirmPhrase);
        Map<String, Object> out = enrichMixView(ctx, created, businessKey, true);
        out.put("autoDraft", true);
        out.put("confirmPhrase", confirmPhrase);
        out.put("userSummaryZh", summaryZh);
        out.put("hintZh", summaryZh);
        out.put("businessKey", businessKey);
        return out;
    }

    private JSONObject buildMixDraftFromNormalized(JSONObject normalized, String businessKey) {
        JSONObject finishedIn = normalized.getJSONObject("finished");
        if (finishedIn == null) {
            throw new BusinessRunTimeException(400, "配制单缺少成品行");
        }
        JSONArray rawLines = normalized.getJSONArray("lines");
        if (rawLines == null || rawLines.isEmpty()) {
            throw new BusinessRunTimeException(400, "配制单缺少原料行");
        }
        JSONObject finished = new JSONObject(true);
        finished.put("barCode", required(finishedIn, "barCode"));
        finished.put("depotName", firstNonBlank(finishedIn.getString("depotName"), DEFAULT_FG_DEPOT));
        finished.put("qty", required(finishedIn, "qty"));
        // MIX_HEADERS has two「单位」columns; Excel parser already used unitAt(0)/unitAt(1).
        finished.put("unit", required(finishedIn, "unit"));
        assertPositiveQty(finished.getString("qty"), "成品产出数量");

        JSONArray lines = new JSONArray();
        for (int i = 0; i < rawLines.size(); i++) {
            JSONObject src = rawLines.getJSONObject(i);
            if (src == null) {
                continue;
            }
            JSONObject line = new JSONObject(true);
            line.put("barCode", required(src, "barCode"));
            line.put("depotName", firstNonBlank(src.getString("depotName"), DEFAULT_RM_DEPOT));
            line.put("qty", required(src, "qty"));
            line.put("unit", required(src, "unit"));
            assertPositiveQty(line.getString("qty"), "原料领用数量");
            lines.add(line);
        }
        if (lines.isEmpty()) {
            throw new BusinessRunTimeException(400, "配制单缺少有效原料行");
        }
        assertFinishedConsistent(finished, lines.size());
        JSONObject draftBody = new JSONObject(true);
        draftBody.put("finished", finished);
        draftBody.put("lines", lines);
        draftBody.put("businessKey", businessKey);
        draftBody.put("remark", normalized.getString("remark"));
        return draftBody;
    }

    private JSONObject buildMixBodyFromSlots(JSONObject body) {
        if (body == null) {
            throw new BusinessRunTimeException(400, "缺少配制槽位");
        }
        if (!body.getBooleanValue("recipeUserConfirmed") && !body.getBooleanValue("userConfirmedRecipe")) {
            throw new BusinessRunTimeException(400,
                    "配制配方必须由用户明确确认（测试配方）。请设置 recipeUserConfirmed=true，系统不会自动推导化学比例。");
        }
        String idem = trimToNull(body.getString("idempotencyKey"));
        if (idem == null) {
            throw new BusinessRunTimeException(400, "缺少 idempotencyKey");
        }
        if (idem.length() > 80) {
            throw new BusinessRunTimeException(400, "idempotencyKey 过长");
        }
        JSONObject finishedIn = body.getJSONObject("finished");
        if (finishedIn == null) {
            throw new BusinessRunTimeException(400, "缺少 finished（成品编码/产出数量/单位）");
        }
        JSONArray rawLines = body.getJSONArray("lines");
        if (rawLines == null || rawLines.isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少 lines（至少一行原料）");
        }
        JSONObject finished = new JSONObject(true);
        finished.put("barCode", required(finishedIn, "barCode"));
        finished.put("depotName", firstNonBlank(finishedIn.getString("depotName"), DEFAULT_FG_DEPOT));
        finished.put("qty", required(finishedIn, "qty"));
        finished.put("unit", required(finishedIn, "unit"));
        assertPositiveQty(finished.getString("qty"), "成品产出数量");

        JSONArray lines = new JSONArray();
        for (int i = 0; i < rawLines.size(); i++) {
            JSONObject src = rawLines.getJSONObject(i);
            JSONObject line = new JSONObject(true);
            line.put("barCode", required(src, "barCode"));
            line.put("depotName", firstNonBlank(src.getString("depotName"), DEFAULT_RM_DEPOT));
            line.put("qty", required(src, "qty"));
            line.put("unit", required(src, "unit"));
            assertPositiveQty(line.getString("qty"), "原料领用数量");
            lines.add(line);
        }
        JSONObject draftBody = new JSONObject(true);
        draftBody.put("idempotencyKey", idem);
        draftBody.put("finished", finished);
        draftBody.put("lines", lines);
        String remark = trimToNull(body.getString("remark"));
        draftBody.put("remark", remark == null
                ? "企微对话配制（测试配方，用户已确认）"
                : remark);
        return draftBody;
    }

    private Map<String, Object> enrichMixView(AierpWecomBindingService.BoundContext ctx,
                                              Map<String, Object> created, String businessKey,
                                              boolean fromExcel) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.putAll(created);
        data.put("boundErpLoginName", ctx.user.getLoginName());
        data.put("tenantId", ctx.user.getTenantId());
        data.put("nature", "REAL_ERP");
        data.put("bizType", "MIX");
        data.put("scene", "MIX");
        if (businessKey != null) {
            data.put("businessKey", businessKey);
        }
        String status = String.valueOf(created.get("status"));
        boolean confirmed = "CONFIRMED".equals(status);
        if (created.get("posted") == null) {
            data.put("posted", confirmed);
        }
        if (created.get("stockUnchanged") == null) {
            data.put("stockUnchanged", !confirmed);
        }
        data.put("statusLabel", confirmed ? "已过账" : "待确认、未配制过账");
        Object draftId = created.get("draftId");
        String confirmPhrase = "确认配制" + draftId;
        Object challenge = created.get("challenge");
        if (challenge instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> ch = (Map<String, Object>) challenge;
            data.put("challenge", ch);
            if (ch.get("phrase") != null) {
                confirmPhrase = String.valueOf(ch.get("phrase"));
            }
        }
        data.put("confirmPhrase", confirmPhrase);
        if (!confirmed) {
            data.put("hint", "待确认、库存未变。请回复「" + confirmPhrase + "」完成配制过账。"
                    + (fromExcel ? " 配比为 Excel 中用户填写的测试值。" : " 配比为用户确认的测试配方。"));
        }
        Object payloadObj = created.get("payload");
        JSONObject payload = payloadObj instanceof JSONObject
                ? (JSONObject) payloadObj
                : JSONObject.parseObject(String.valueOf(payloadObj));
        Map<String, Object> summary = new LinkedHashMap<String, Object>();
        if (payload != null) {
            JSONObject finished = payload.getJSONObject("finished");
            if (finished != null) {
                summary.put("finishedBarCode", finished.getString("barCode"));
                summary.put("finishedName", finished.getString("name"));
                summary.put("finishedQty", finished.get("operNumber"));
                summary.put("finishedUnit", finished.getString("unit"));
                summary.put("finishedDepot", finished.getString("depotName"));
            }
            JSONArray lines = payload.getJSONArray("lines");
            if (lines != null) {
                summary.put("rawLineCount", lines.size());
            }
        }
        data.put("summary", summary);
        return data;
    }

    private String buildMixDraftSummary(String businessKey, Map<String, Object> created,
                                        long draftId, String confirmPhrase) {
        StringBuilder sb = new StringBuilder();
        sb.append("配制单 ").append(businessKey == null ? "" : businessKey).append("\n");
        sb.append("待确认单 #").append(draftId).append("（未过账，库存未变）\n");
        Object payloadObj = created.get("payload");
        JSONObject payload = payloadObj instanceof JSONObject
                ? (JSONObject) payloadObj
                : JSONObject.parseObject(String.valueOf(payloadObj));
        if (payload != null) {
            JSONObject finished = payload.getJSONObject("finished");
            if (finished != null) {
                sb.append("成品：").append(nullTo(finished.getString("name"), finished.getString("barCode")))
                        .append("（").append(finished.getString("barCode")).append("） ")
                        .append(stripNumber(finished.get("operNumber"))).append(" ")
                        .append(nullTo(finished.getString("unit"), ""))
                        .append(" → ").append(nullTo(finished.getString("depotName"), DEFAULT_FG_DEPOT))
                        .append("\n");
            }
            JSONArray lines = payload.getJSONArray("lines");
            if (lines != null) {
                sb.append("原料（预计扣减，确认后生效）：\n");
                for (int i = 0; i < lines.size(); i++) {
                    JSONObject line = lines.getJSONObject(i);
                    sb.append("- ").append(nullTo(line.getString("name"), line.getString("barCode")))
                            .append("（").append(line.getString("barCode")).append("） ")
                            .append(stripNumber(line.get("operNumber"))).append(" ")
                            .append(nullTo(line.getString("unit"), ""))
                            .append(" @ ").append(nullTo(line.getString("depotName"), DEFAULT_RM_DEPOT))
                            .append("\n");
                }
            }
        }
        sb.append("测试配方，需用户确认。请回复「").append(confirmPhrase).append("」完成配制");
        return sb.toString();
    }

    private void assertNoBlockingWorkflow(AierpWecomBindingService.BoundContext ctx) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null) {
            return;
        }
        String status = String.valueOf(current.get("status"));
        if ("DRAFT_READY".equals(status) && current.get("draftId") != null) {
            Object phrase = current.get("confirmPhrase");
            throw new BusinessRunTimeException(409,
                    "当前有待确认草稿 #" + current.get("draftId")
                            + "。请回复「" + (phrase == null ? ("确认配制" + current.get("draftId")) : phrase)
                            + "」或「取消文件」后再口头配制。");
        }
        if ("PREVIEWED".equals(status) || "PENDING".equals(status) || "FAILED".equals(status)) {
            throw new BusinessRunTimeException(409,
                    "当前有未关闭的 Excel 文件核对流程，请按已核对文件继续或「取消文件」后再口头配制。");
        }
    }

    private void assertFinishedConsistent(JSONObject finished, int lineCount) {
        if (lineCount < 1) {
            throw new BusinessRunTimeException(400, "配制单至少需要一行原料");
        }
        // finished already single object after Excel mergeGroup; qty/unit validated via resolveLine later
        if (finished.getString("barCode") == null || finished.getString("unit") == null) {
            throw new BusinessRunTimeException(400, "成品编码或单位缺失（注意 MIX 表有两个「单位」列）");
        }
    }

    private void assertPositiveQty(String raw, String label) {
        BigDecimal qty;
        try {
            qty = new BigDecimal(raw.trim());
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, label + "必须是数字");
        }
        if (qty.compareTo(BigDecimal.ZERO) <= 0) {
            throw new BusinessRunTimeException(400, label + "必须为正数");
        }
    }

    private JSONObject loadPreviewPayload(AierpWecomBindingService.BoundContext ctx, String previewId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT payload_json FROM aierp_excel_preview WHERE preview_key=? AND tenant_id=? AND user_id=?",
                previewId, ctx.user.getTenantId(), ctx.user.getId());
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, "预览不存在或不属于当前用户");
        }
        return JSON.parseObject(String.valueOf(rows.get(0).get("payload_json")));
    }

    private void putWorkflow(AierpWecomBindingService.BoundContext ctx, String status, String previewId,
                             String fileSha256, String messageMsgId, String reason, String userSummaryZh,
                             Object draftId, String businessKey, String confirmPhrase) {
        Map<String, Object> wf = new LinkedHashMap<String, Object>();
        wf.put("status", status);
        wf.put("previewId", previewId);
        wf.put("fileSha256", fileSha256);
        wf.put("messageMsgId", messageMsgId);
        wf.put("reason", reason);
        if (userSummaryZh != null && !userSummaryZh.trim().isEmpty()) {
            wf.put("userSummaryZh", userSummaryZh.trim());
        }
        if (draftId != null) {
            wf.put("draftId", draftId);
        }
        if (businessKey != null && !businessKey.trim().isEmpty()) {
            wf.put("businessKey", businessKey.trim());
        }
        if (confirmPhrase != null && !confirmPhrase.trim().isEmpty()) {
            wf.put("confirmPhrase", confirmPhrase.trim());
        }
        wf.put("bizType", "MIX");
        wf.put("erpUserId", ctx.user.getId());
        wf.put("tenantId", ctx.user.getTenantId());
        wf.put("bindingId", ctx.binding.get("id"));
        wf.put("bindingVersion", ctx.binding.get("binding_version"));
        wf.put("updatedAt", System.currentTimeMillis());
        String key = WF_PREFIX + ctx.botId + ":" + ctx.wecomUserId;
        redisService.setCacheObject(key, JSON.toJSONString(wf));
        try {
            redisService.redisTemplate.expire(key, WF_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignore) {
            // best-effort TTL
        }
    }

    private Map<String, Object> getWorkflow(AierpWecomBindingService.BoundContext ctx) {
        Object raw = redisService.getCacheObject(WF_PREFIX + ctx.botId + ":" + ctx.wecomUserId);
        if (raw == null) {
            return null;
        }
        try {
            Map<String, Object> wf = JSON.parseObject(String.valueOf(raw));
            if (wf == null
                    || !String.valueOf(ctx.user.getId()).equals(String.valueOf(wf.get("erpUserId")))
                    || !String.valueOf(ctx.user.getTenantId()).equals(String.valueOf(wf.get("tenantId")))
                    || !String.valueOf(ctx.binding.get("binding_version")).equals(String.valueOf(wf.get("bindingVersion")))
                    || wf.get("bindingId") == null
                    || !String.valueOf(ctx.binding.get("id")).equals(String.valueOf(wf.get("bindingId")))) {
                return null;
            }
            return wf;
        } catch (Exception ex) {
            return null;
        }
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
                CHANNEL, ctx.botId, ctx.wecomUserId, bindingId, bindingVersion, boundAt);
    }

    private static String shortIdempotencyKey(AierpWecomBindingService.BoundContext ctx,
                                              String fileSha256, String businessKey) {
        String raw = String.valueOf(ctx.binding.get("id")) + "|"
                + String.valueOf(ctx.binding.get("binding_version")) + "|"
                + (fileSha256 == null ? "" : fileSha256.trim().toLowerCase(Locale.ROOT)) + "|"
                + (businessKey == null ? "" : businessKey.trim()) + "|MIX";
        String digest = sha256Hex(raw);
        String key = "wx:" + digest;
        return key.length() <= 80 ? key : key.substring(0, 80);
    }

    private static String sha256Hex(String raw) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] dig = md.digest(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(dig.length * 2);
            for (byte b : dig) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception ex) {
            return String.valueOf(Math.abs(raw.hashCode()));
        }
    }

    private static String required(JSONObject obj, String field) {
        if (obj == null || obj.getString(field) == null || obj.getString(field).trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少字段 " + field);
        }
        return obj.getString(field).trim();
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.trim().isEmpty()) {
            return a.trim();
        }
        return b;
    }

    private static String trimToNull(String s) {
        if (s == null || "null".equals(s)) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static String nullTo(String v, String d) {
        return v == null || v.trim().isEmpty() ? d : v;
    }

    private static String stripNumber(Object n) {
        try {
            return new BigDecimal(String.valueOf(n)).stripTrailingZeros().toPlainString();
        } catch (Exception ex) {
            return String.valueOf(n);
        }
    }
}
