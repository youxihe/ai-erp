package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import com.jsh.erp.gateway.excel.AierpExcelService;
import com.jsh.erp.service.RedisService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import org.springframework.context.annotation.Lazy;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * AIERP-017A/017B1/016S: WeCom Excel template + preview + single PURCHASE/SERVICE verified DRAFT.
 * Draft is created from persisted preview payload only (never model-guessed qty).
 */
@Service
public class AierpWecomExcelService {

    private static final String WF_PREFIX = "aierp:excel-wf:";
    private static final long WF_TTL_SECONDS = 6L * 60L * 60L;
    private static final String CHANNEL = "wecom";

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpExcelService excelService;
    @Resource
    private AierpGatewayService gatewayService;
    @Resource
    private RedisService redisService;
    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    @Lazy
    private AierpWecomServiceConsumeService serviceConsumeService;

    public Map<String, Object> template(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        String scene = body == null ? null : body.getString("scene");
        if (scene == null || scene.trim().isEmpty()) {
            scene = "PURCHASE";
        }
        scene = scene.trim().toUpperCase(Locale.ROOT);
        JSONObject fill = null;
        if (body != null) {
            if (body.getJSONObject("fill") != null) {
                fill = body.getJSONObject("fill");
            } else if (body.getJSONArray("rows") != null) {
                fill = new JSONObject();
                fill.put("rows", body.getJSONArray("rows"));
            }
        }
        byte[] bytes = excelService.templateAs(ctx.user, scene, fill);
        String fileName = fileNameFor(scene);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("nature", "REAL_ERP");
        data.put("scene", scene);
        data.put("fileName", fileName);
        data.put("contentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        data.put("byteLength", bytes.length);
        data.put("fileBase64", Base64.getEncoder().encodeToString(bytes));
        data.put("posted", false);
        data.put("confirmSupported", isConfirmableScene(scene));
        data.put("boundErpLoginName", ctx.user.getLoginName());
        if ("SERVICE".equals(scene)) {
            data.put("summary", "已生成 " + fileName + "。请填写后发回；单张合法服务耗料单将生成待确认草稿，回复「确认耗料{草稿号}」出库（非销售）。");
        } else if ("MIX".equals(scene)) {
            data.put("summary", "已生成 " + fileName + "。请填写后发回；配制单确认协议见 016M。");
        } else {
            data.put("summary", "已生成 " + fileName + "。请填写后发回；单张合法采购单将生成待确认采购单。");
        }
        data.put("hint", data.get("summary"));
        return data;
    }

    public Map<String, Object> preview(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        if (body == null || body.getString("fileBase64") == null || body.getString("fileBase64").trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少 fileBase64");
        }
        String fileName = body.getString("fileName");
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "upload.xlsx";
        }
        fileName = fileName.trim();
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(body.getString("fileBase64").trim());
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "fileBase64 无效");
        }
        String scene = body.getString("scene");
        String actualFileSha256 = sha256HexBytes(raw);
        String suppliedFileSha256 = trimToNull(body.getString("fileSha256"));
        if (suppliedFileSha256 != null && !actualFileSha256.equalsIgnoreCase(suppliedFileSha256)) {
            throw new BusinessRunTimeException(400, "上传文件校验不一致，请重新上传原文件。");
        }
        // Server-computed bytes are authoritative for revision and idempotency.
        String fileSha256 = actualFileSha256;
        Map<String, Object> preview = excelService.previewAs(ctx.user, raw, fileName, scene);
        preview.put("boundErpLoginName", ctx.user.getLoginName());
        preview.put("wecomUserIdMasked", mask(ctx.wecomUserId));
        preview.put("messageMsgId", body.getString("messageMsgId"));
        preview.put("fileSha256", fileSha256);
        preview.put("fileNameDisplayOnly", fileName);
        preview.put("qtySource", "XLSX_CELLS");
        if (preview.get("summary") instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> sum = (Map<String, Object>) preview.get("summary");
            sum.put("posted", false);
            sum.put("stockUnchanged", true);
        }
        boolean openWorkflow = body.getBooleanValue("openWorkflow") || body.get("openWorkflow") == null;
        if (openWorkflow && preview.get("previewId") != null) {
            invalidateStaleDraftIfFileChanged(ctx, fileSha256);
            putWorkflow(ctx, "PREVIEWED", String.valueOf(preview.get("previewId")),
                    fileSha256, body.getString("messageMsgId"), null,
                    preview.get("userSummaryZh") == null ? null : String.valueOf(preview.get("userSummaryZh")),
                    null, null, null);
            try {
                Map<String, Object> drafted = tryPrepareVerifiedPurchase(ctx,
                        String.valueOf(preview.get("previewId")), fileSha256, false);
                if (drafted != null && Boolean.TRUE.equals(drafted.get("autoDraft"))) {
                    preview.putAll(drafted);
                } else {
                    // AIERP-016S: single SERVICE Excel → unposted draft or audited CONFIRMED replay.
                    Map<String, Object> serviceDrafted = serviceConsumeService.tryPrepareVerifiedServiceFromPreview(
                            ctx, String.valueOf(preview.get("previewId")), fileSha256, false);
                    if (serviceDrafted != null && (Boolean.TRUE.equals(serviceDrafted.get("autoDraft"))
                            || Boolean.TRUE.equals(serviceDrafted.get("posted"))
                            || Boolean.TRUE.equals(serviceDrafted.get("replayed")))) {
                        preview.putAll(serviceDrafted);
                    } else if (drafted != null) {
                        preview.putAll(drafted);
                    }
                }
            } catch (Exception ex) {
                // Preview must still succeed; draft can be retried via prepare-verified.
                preview.put("autoDraft", false);
                preview.put("autoDraftError", ex.getMessage() == null ? "DRAFT_FAILED" : ex.getMessage());
            }
        }
        return preview;
    }

    /**
     * AIERP-017B1: create/reuse unposted PURCHASE draft from persisted preview rows.
     * Safe to call again (idempotent by fileSha256 + businessKey + binding).
     */
    public Map<String, Object> prepareVerified(JSONObject body) throws Exception {
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
            throw new BusinessRunTimeException(404, "没有可生成采购单的 Excel 核对结果，请先发送填写好的文件。");
        }
        Map<String, Object> drafted = tryPrepareVerifiedPurchase(ctx, previewId, fileSha256, true);
        if (drafted == null) {
            throw new BusinessRunTimeException(409, "当前 Excel 不能自动生成采购单（需恰好 1 张无错误的采购单）。");
        }
        return drafted;
    }

    public Map<String, Object> workflowStatus(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        if (body != null && body.getString("status") != null) {
            putWorkflow(ctx, body.getString("status").trim().toUpperCase(Locale.ROOT),
                    body.getString("previewId"), body.getString("fileSha256"),
                    body.getString("messageMsgId"), body.getString("reason"),
                    body.getString("userSummaryZh"),
                    body.get("draftId"), body.getString("businessKey"), body.getString("confirmPhrase"));
        }
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null) {
            Map<String, Object> empty = new LinkedHashMap<String, Object>();
            empty.put("status", "NONE");
            empty.put("blocksPurchasePrepare", false);
            empty.put("hasValidPreview", false);
            empty.put("hasAwaitingDraft", false);
            return empty;
        }
        refreshDraftLifecycle(ctx, current);
        String status = String.valueOf(current.get("status"));
        current.put("blocksPurchasePrepare", blocksPrepare(status));
        current.put("hasValidPreview",
                ("PREVIEWED".equals(status) || "DRAFT_READY".equals(status)) && current.get("previewId") != null);
        current.put("hasAwaitingDraft", "DRAFT_READY".equals(status) && current.get("draftId") != null);
        return current;
    }

    public Map<String, Object> workflowCancel(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        Map<String, Object> current = getWorkflow(ctx);
        if (current != null && current.get("draftId") != null) {
            try {
                long draftId = Long.parseLong(String.valueOf(current.get("draftId")));
                gatewayService.cancelDraftAs(ctx.user, draftId, toOwner(ctx));
            } catch (Exception ignore) {
                // best-effort cancel of linked draft
            }
        }
        putWorkflow(ctx, "CANCELLED", null, null, body == null ? null : body.getString("messageMsgId"),
                "USER_CANCEL", null, null, null, null);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("status", "CANCELLED");
        data.put("blocksPurchasePrepare", false);
        data.put("hasValidPreview", false);
        data.put("hasAwaitingDraft", false);
        data.put("hint", "文件流程已关闭，可重新口头采购。");
        return data;
    }

    /** Clear Excel workflow after native confirm so verbal purchase/service is unblocked. */
    public void markWorkflowPosted(AierpWecomBindingService.BoundContext ctx, long draftId) {
        markWorkflowPosted(ctx, draftId, null);
    }

    /**
     * Mark Excel workflow POSTED after native confirm.
     * PURCHASE keeps「已入库」; SERVICE uses「已出库」— do not retitle purchase/PDF paths.
     */
    public void markWorkflowPosted(AierpWecomBindingService.BoundContext ctx, long draftId, String bizType) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null || current.get("draftId") == null) {
            return;
        }
        if (!String.valueOf(draftId).equals(String.valueOf(current.get("draftId")))) {
            return;
        }
        String phrase = current.get("confirmPhrase") == null ? "" : String.valueOf(current.get("confirmPhrase"));
        boolean service = "SERVICE".equals(bizType) || phrase.startsWith("确认耗料");
        String summary = service
                ? ("服务耗料单 #" + draftId + " 已出库。")
                : ("采购单 #" + draftId + " 已入库。");
        putWorkflow(ctx, "POSTED",
                current.get("previewId") == null ? null : String.valueOf(current.get("previewId")),
                current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256")),
                null, "CONFIRMED",
                summary,
                draftId, current.get("businessKey") == null ? null : String.valueOf(current.get("businessKey")),
                null);
    }

    public void assertNoOpenFileWorkflow(AierpWecomBindingService.BoundContext ctx) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null) {
            return;
        }
        String status = String.valueOf(current.get("status"));
        if (blocksPrepare(status)) {
            Object draftId = current.get("draftId");
            if (draftId != null && "DRAFT_READY".equals(status)) {
                String phrase = current.get("confirmPhrase") == null
                        ? null : String.valueOf(current.get("confirmPhrase"));
                if (phrase == null || phrase.trim().isEmpty()) {
                    phrase = "确认采购" + draftId;
                }
                throw new BusinessRunTimeException(409,
                        "当前有待确认的 Excel 单据 #" + draftId
                                + "。请回复「" + phrase + "」完成过账，或「取消文件」后口头下单。");
            }
            throw new BusinessRunTimeException(409,
                    "当前有未关闭的 Excel 文件核对流程，不能用口头或文件名猜测创建草稿。"
                            + "请按已核对的文件继续，或回复「取消文件」后再口头下单。");
        }
    }

    /** Package helper for AIERP-016S SERVICE verified prepare. */
    public Map<String, Object> peekWorkflow(AierpWecomBindingService.BoundContext ctx) {
        return getWorkflow(ctx);
    }

    /** Load preview payload owned by the bound ERP user. */
    public JSONObject loadOwnedPreviewPayload(AierpWecomBindingService.BoundContext ctx, String previewId) {
        return loadPreviewPayload(ctx, previewId);
    }

    public void putOwnedWorkflow(AierpWecomBindingService.BoundContext ctx, String status, String previewId,
                                 String fileSha256, String messageMsgId, String reason, String userSummaryZh,
                                 Object draftId, String businessKey, String confirmPhrase) {
        putWorkflow(ctx, status, previewId, fileSha256, messageMsgId, reason, userSummaryZh,
                draftId, businessKey, confirmPhrase);
    }

    public String shortIdempotencyKeyFor(AierpWecomBindingService.BoundContext ctx,
                                         String fileSha256, String businessKey) {
        return shortIdempotencyKey(ctx, fileSha256, businessKey);
    }

    private Map<String, Object> tryPrepareVerifiedPurchase(AierpWecomBindingService.BoundContext ctx,
                                                           String previewId, String fileSha256,
                                                           boolean throwOnIneligible) throws Exception {
        Map<String, Object> active = getWorkflow(ctx);
        String activeStatus = active == null ? "" : String.valueOf(active.get("status"));
        if (active == null || !("PREVIEWED".equals(activeStatus) || "DRAFT_READY".equals(activeStatus))
                || previewId == null || !previewId.equals(String.valueOf(active.get("previewId")))
                || fileSha256 == null || !fileSha256.matches("[0-9a-fA-F]{64}")
                || !fileSha256.equalsIgnoreCase(String.valueOf(active.get("fileSha256")))) {
            throw new BusinessRunTimeException(409, "文件核对结果已改变，请按最新 Excel 核对结果办理。");
        }
        JSONObject payload = loadPreviewPayload(ctx, previewId);
        JSONArray records = payload.getJSONArray("records");
        if (records == null || records.isEmpty()) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(400, "预览没有业务行");
            }
            return null;
        }
        List<JSONObject> purchaseOk = new java.util.ArrayList<JSONObject>();
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
            if ("PURCHASE".equals(rec.getString("scene"))) {
                purchaseOk.add(rec);
            } else {
                otherOk.add(rec);
            }
        }
        if (!bad.isEmpty() || purchaseOk.size() != 1 || !otherOk.isEmpty()) {
            String msg;
            if (!bad.isEmpty()) {
                msg = String.valueOf(getWorkflow(ctx) != null ? getWorkflow(ctx).get("userSummaryZh") : null);
                if (msg == null || msg.trim().isEmpty() || "null".equals(msg)) {
                    msg = "文件还有错误，请改好后重新发送。";
                }
            } else if (purchaseOk.size() > 1 || !otherOk.isEmpty()) {
                msg = "当前文件包含多张业务单或非采购场景，单张采购快线暂不支持，请拆成一张采购单后重发。";
            } else {
                msg = "没有可生成的采购单。";
            }
            putWorkflow(ctx, "PREVIEWED", previewId, fileSha256, null, "NOT_SINGLE_PURCHASE", msg,
                    null, null, null);
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, msg);
            }
            Map<String, Object> only = new LinkedHashMap<String, Object>();
            only.put("userSummaryZh", msg);
            only.put("hintZh", msg);
            only.put("autoDraft", false);
            return only;
        }

        JSONObject record = purchaseOk.get(0);
        String businessKey = record.getString("businessKey");
        JSONObject normalized = record.getJSONObject("normalized");
        if (normalized == null) {
            throw new BusinessRunTimeException(400, "预览缺少规范化明细");
        }
        // Copy so we do not mutate stored preview JSON object graph unexpectedly.
        JSONObject draftBody = JSON.parseObject(normalized.toJSONString());
        // aierp_gateway_draft.idempotency_key is varchar(80)
        String idem = shortIdempotencyKey(ctx, fileSha256, businessKey);
        draftBody.put("idempotencyKey", idem);
        if (draftBody.getString("remark") == null || draftBody.getString("remark").trim().isEmpty()) {
            draftBody.put("remark", "企微Excel采购 " + businessKey);
        }
        // Ensure unitPrice key (excel may use price).
        JSONArray lines = draftBody.getJSONArray("lines");
        if (lines != null) {
            for (int i = 0; i < lines.size(); i++) {
                JSONObject line = lines.getJSONObject(i);
                if (line != null && line.get("unitPrice") == null && line.get("price") != null) {
                    line.put("unitPrice", line.get("price"));
                }
            }
        }

        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, "PURCHASE", draftBody, owner);
        Object draftIdObj = created.get("draftId");
        if (draftIdObj == null) {
            throw new BusinessRunTimeException(500, "草稿创建未返回单号");
        }
        long draftId = Long.parseLong(String.valueOf(draftIdObj));
        String confirmPhrase = AierpGatewayService.confirmPhraseFor("PURCHASE", draftId);
        String summaryZh = buildDraftReadySummary(businessKey, created, draftId, confirmPhrase);
        putWorkflow(ctx, "DRAFT_READY", previewId, fileSha256, null, null, summaryZh,
                draftId, businessKey, confirmPhrase);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("autoDraft", true);
        out.put("draftId", draftId);
        out.put("businessKey", businessKey);
        out.put("confirmPhrase", confirmPhrase);
        out.put("userSummaryZh", summaryZh);
        out.put("hintZh", summaryZh);
        out.put("posted", false);
        out.put("stockUnchanged", true);
        out.put("statusLabel", "待确认、未入库");
        out.put("replayed", created.get("replayed"));
        out.put("challenge", created.get("challenge"));
        return out;
    }

    private String buildDraftReadySummary(String businessKey, Map<String, Object> created,
                                          long draftId, String confirmPhrase) {
        String organ = "";
        String material = "";
        String barCode = "";
        String depot = "";
        String qty = "";
        String unit = "";
        String price = "";
        String amount = "";
        Object payloadObj = created.get("payload");
        JSONObject payload = payloadObj instanceof JSONObject
                ? (JSONObject) payloadObj
                : JSONObject.parseObject(String.valueOf(payloadObj));
        if (payload != null) {
            organ = payload.getString("organName") == null ? "" : payload.getString("organName");
            JSONArray lines = payload.getJSONArray("lines");
            if (lines != null && !lines.isEmpty()) {
                JSONObject line = lines.getJSONObject(0);
                material = line.getString("name") == null ? "" : line.getString("name");
                barCode = line.getString("barCode") == null ? "" : line.getString("barCode");
                depot = line.getString("depotName") == null ? "" : line.getString("depotName");
                Object q = line.get("operNumber") != null ? line.get("operNumber") : line.get("qty");
                qty = q == null ? "" : stripNumber(q);
                unit = line.getString("unit") == null ? "" : line.getString("unit");
                BigDecimal unitPrice = line.getBigDecimal("unitPrice");
                BigDecimal allPrice = line.getBigDecimal("allPrice");
                if (unitPrice != null) {
                    price = unitPrice.stripTrailingZeros().toPlainString();
                }
                if (allPrice != null) {
                    amount = allPrice.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
                } else if (unitPrice != null && q != null) {
                    try {
                        amount = unitPrice.multiply(new BigDecimal(String.valueOf(q)))
                                .setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
                    } catch (Exception ignore) {
                        amount = "";
                    }
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append("采购单 ").append(businessKey == null ? "" : businessKey);
        if (!organ.isEmpty()) {
            sb.append("｜").append(organ);
        }
        sb.append("\n");
        if (!material.isEmpty() || !barCode.isEmpty()) {
            sb.append(material.isEmpty() ? barCode : material);
            if (!barCode.isEmpty() && !material.isEmpty()) {
                sb.append(" ").append(barCode);
            }
            sb.append("｜");
        }
        if (!depot.isEmpty()) {
            sb.append(depot).append("｜");
        }
        sb.append(qty).append(unit);
        if (!price.isEmpty()) {
            sb.append(" × ").append(price).append(" 元");
            if (!amount.isEmpty()) {
                sb.append("＝").append(amount).append(" 元");
            }
        }
        sb.append("\n未入库\n");
        sb.append("待确认单 #").append(draftId).append("\n");
        sb.append("请回复「").append(confirmPhrase).append("」完成入库");
        return sb.toString();
    }

    private void invalidateStaleDraftIfFileChanged(AierpWecomBindingService.BoundContext ctx, String newSha) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null || current.get("draftId") == null
                || !"DRAFT_READY".equals(String.valueOf(current.get("status")))) {
            return;
        }
        String oldSha = current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256"));
        if (newSha != null && oldSha != null && newSha.equalsIgnoreCase(oldSha)) {
            return;
        }
        try {
            long draftId = Long.parseLong(String.valueOf(current.get("draftId")));
            gatewayService.cancelDraftAs(ctx.user, draftId, toOwner(ctx));
        } catch (Exception ex) {
            // Do not open two confirmable purchases from one changing Excel workflow.
            throw new BusinessRunTimeException(409,
                    "上一份文件的待确认采购单尚未安全取消，请先处理上一张草稿后重试。");
        }
    }

    private void refreshDraftLifecycle(AierpWecomBindingService.BoundContext ctx, Map<String, Object> current) {
        if (current.get("draftId") == null) {
            return;
        }
        if (!"DRAFT_READY".equals(String.valueOf(current.get("status")))) {
            return;
        }
        try {
            long draftId = Long.parseLong(String.valueOf(current.get("draftId")));
            Map<String, Object> st = gatewayService.draftStatusAs(ctx.user, draftId, toOwner(ctx));
            String status = String.valueOf(st.get("status"));
            if ("CONFIRMED".equals(status)) {
                String biz = String.valueOf(st.get("bizType"));
                String phrase = current.get("confirmPhrase") == null ? "" : String.valueOf(current.get("confirmPhrase"));
                boolean service = "SERVICE".equals(biz) || phrase.startsWith("确认耗料");
                String summary = service
                        ? ("服务耗料单 #" + draftId + " 已出库。")
                        : ("采购单 #" + draftId + " 已入库。");
                current.put("status", "POSTED");
                current.put("userSummaryZh", summary);
                putWorkflow(ctx, "POSTED",
                        current.get("previewId") == null ? null : String.valueOf(current.get("previewId")),
                        current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256")),
                        null, "CONFIRMED", summary,
                        draftId,
                        current.get("businessKey") == null ? null : String.valueOf(current.get("businessKey")),
                        null);
            } else if ("CANCELLED".equals(status)) {
                current.put("status", "CANCELLED");
                current.put("draftId", null);
                putWorkflow(ctx, "CANCELLED", null, null, null, "DRAFT_CANCELLED", null, null, null, null);
            }
        } catch (Exception ignore) {
            // keep cached workflow
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
        wf.put("erpUserId", ctx.user.getId());
        wf.put("tenantId", ctx.user.getTenantId());
        wf.put("wecomUserIdMasked", mask(ctx.wecomUserId));
        wf.put("bindingId", ctx.binding.get("id"));
        wf.put("bindingVersion", ctx.binding.get("binding_version"));
        wf.put("updatedAt", System.currentTimeMillis());
        String key = workflowKey(ctx);
        redisService.setCacheObject(key, JSON.toJSONString(wf));
        try {
            redisService.redisTemplate.expire(key, WF_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignore) {
            // best-effort TTL
        }
    }

    private Map<String, Object> getWorkflow(AierpWecomBindingService.BoundContext ctx) {
        Object raw = redisService.getCacheObject(workflowKey(ctx));
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

    private static String workflowKey(AierpWecomBindingService.BoundContext ctx) {
        return WF_PREFIX + ctx.botId + ":" + ctx.wecomUserId;
    }

    private static boolean blocksPrepare(String status) {
        return "PENDING".equals(status) || "PREVIEWED".equals(status)
                || "FAILED".equals(status) || "DRAFT_READY".equals(status);
    }

    private static boolean isConfirmableScene(String scene) {
        return "PURCHASE".equals(scene) || "MIX".equals(scene) || "SERVICE".equals(scene) || "PACK".equals(scene);
    }

    private static String fileNameFor(String scene) {
        if ("MIX".equals(scene)) {
            return "配制生产模板.xlsx";
        }
        if ("SERVICE".equals(scene)) {
            return "服务耗料模板.xlsx";
        }
        if ("SALE".equals(scene)) {
            return "销售出库模板（仅模板不可过账）.xlsx";
        }
        if ("INITIAL".equals(scene)) {
            return "物料期初模板（仅模板不可过账）.xlsx";
        }
        if ("PACK".equals(scene)) {
            return "进销存演示模板包.xlsx";
        }
        return "采购入库模板.xlsx";
    }

    private static String mask(String wecomUserId) {
        if (wecomUserId == null || wecomUserId.length() < 4) {
            return "***";
        }
        return wecomUserId.substring(0, 2) + "***";
    }

    private static String trimToNull(String s) {
        if (s == null || "null".equals(s)) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static String stripNumber(Object n) {
        try {
            return new BigDecimal(String.valueOf(n)).stripTrailingZeros().toPlainString();
        } catch (Exception ex) {
            return String.valueOf(n);
        }
    }

    /** Stable <=80 char key: wx: + sha256(binding|version|file|biz). */
    private static String shortIdempotencyKey(AierpWecomBindingService.BoundContext ctx,
                                              String fileSha256, String businessKey) {
        String raw = String.valueOf(ctx.binding.get("id")) + "|"
                + String.valueOf(ctx.binding.get("binding_version")) + "|"
                + (fileSha256 == null ? "" : fileSha256.trim().toLowerCase(Locale.ROOT)) + "|"
                + (businessKey == null ? "" : businessKey.trim());
        String digest = sha256Hex(raw);
        String key = "wx:" + digest;
        return key.length() <= 80 ? key : key.substring(0, 80);
    }

    private static String sha256HexBytes(byte[] raw) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] dig = md.digest(raw);
            StringBuilder sb = new StringBuilder(dig.length * 2);
            for (byte b : dig) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception ex) {
            throw new IllegalStateException("服务器文件摘要算法不可用", ex);
        }
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
}
