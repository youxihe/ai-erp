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

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * AIERP-017A/017B1/017B2: WeCom Excel template + preview + verified PURCHASE DRAFT(s).
 * Drafts are created from persisted preview payload only (never model-guessed qty).
 * Multi-purchase creates a server batch of unaudited drafts; never posts inventory.
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
    private AierpWecomMixService mixService;

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
        data.put("summary", "已生成 " + fileName + "。请填写后发回；合法采购单将生成待确认采购草稿。");
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
                    null, null, null, null, null);
            try {
                Map<String, Object> drafted = tryPrepareVerifiedPurchase(ctx,
                        String.valueOf(preview.get("previewId")), fileSha256, false, null);
                if (drafted != null) {
                    preview.putAll(drafted);
                } else {
                    // AIERP-016M: single MIX Excel → unposted draft (confirm配制 only).
                    Map<String, Object> mixDrafted = mixService.tryPrepareVerifiedMixFromPreview(ctx,
                            String.valueOf(preview.get("previewId")), fileSha256, false);
                    if (mixDrafted != null && Boolean.TRUE.equals(mixDrafted.get("autoDraft"))) {
                        preview.putAll(mixDrafted);
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
     * AIERP-017B1/017B2: create/reuse unposted PURCHASE draft(s) from persisted preview rows.
     * Safe to call again (idempotent by fileSha256 + businessKey + binding).
     */
    public Map<String, Object> prepareVerified(JSONObject body) throws Exception {
        return prepareVerifiedBatch(body);
    }

    /**
     * AIERP-017B2: prepare one or many PURCHASE drafts from authoritative preview payload.
     * Optional selectedBusinessKeys: only when caller explicitly chooses subset after row errors.
     */
    public Map<String, Object> prepareVerifiedBatch(JSONObject body) throws Exception {
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
        Set<String> selected = null;
        if (body != null && body.getJSONArray("selectedBusinessKeys") != null
                && !body.getJSONArray("selectedBusinessKeys").isEmpty()) {
            selected = new LinkedHashSet<String>();
            JSONArray arr = body.getJSONArray("selectedBusinessKeys");
            for (int i = 0; i < arr.size(); i++) {
                String k = trimToNull(arr.getString(i));
                if (k != null) {
                    selected.add(k);
                }
            }
        }
        Map<String, Object> drafted = tryPrepareVerifiedPurchase(ctx, previewId, fileSha256, true, selected);
        if (drafted == null) {
            throw new BusinessRunTimeException(409, "当前 Excel 不能生成采购草稿（请先改好错误行，或明确选择有效业务单号）。");
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
                    body.get("draftId"), body.getString("businessKey"), body.getString("confirmPhrase"),
                    body.getString("batchId"), body.get("drafts"));
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
                ("PREVIEWED".equals(status) || "DRAFT_READY".equals(status) || "POSTED".equals(status))
                        && current.get("previewId") != null);
        current.put("hasAwaitingDraft", "DRAFT_READY".equals(status)
                && (current.get("draftId") != null || current.get("drafts") != null));
        return current;
    }

    public Map<String, Object> workflowCancel(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        Map<String, Object> current = getWorkflow(ctx);
        if (current != null) {
            cancelWorkflowDrafts(ctx, current);
        }
        putWorkflow(ctx, "CANCELLED", null, null, body == null ? null : body.getString("messageMsgId"),
                "USER_CANCEL", null, null, null, null, null, null);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("status", "CANCELLED");
        data.put("blocksPurchasePrepare", false);
        data.put("hasValidPreview", false);
        data.put("hasAwaitingDraft", false);
        data.put("hint", "文件流程已关闭，可重新口头采购。");
        return data;
    }

    /** Clear Excel workflow after native confirm so verbal purchase is unblocked. */
    public void markWorkflowPosted(AierpWecomBindingService.BoundContext ctx, long draftId) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null) {
            return;
        }
        boolean matched = false;
        if (current.get("draftId") != null
                && String.valueOf(draftId).equals(String.valueOf(current.get("draftId")))) {
            matched = true;
        }
        Object draftsObj = current.get("drafts");
        if (!matched && draftsObj instanceof List) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> drafts = (List<Map<String, Object>>) draftsObj;
            for (Map<String, Object> d : drafts) {
                if (d != null && String.valueOf(draftId).equals(String.valueOf(d.get("draftId")))) {
                    matched = true;
                    break;
                }
            }
        }
        if (!matched) {
            return;
        }
        putWorkflow(ctx, "POSTED",
                current.get("previewId") == null ? null : String.valueOf(current.get("previewId")),
                current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256")),
                null, "CONFIRMED",
                "采购单 #" + draftId + " 已入库。",
                draftId, current.get("businessKey") == null ? null : String.valueOf(current.get("businessKey")),
                null,
                current.get("batchId") == null ? null : String.valueOf(current.get("batchId")),
                current.get("drafts"));
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
                throw new BusinessRunTimeException(409,
                        "当前有待确认的 Excel 采购单 #" + draftId
                                + "。请回复「确认采购" + draftId + "」入库，或「取消文件」后口头下单。");
            }
            if ("DRAFT_READY".equals(status) && current.get("batchId") != null) {
                throw new BusinessRunTimeException(409,
                        "当前有待确认的 Excel 批量采购草稿。请按提示逐张确认采购，或回复「取消文件」后口头下单。");
            }
            throw new BusinessRunTimeException(409,
                    "当前有未关闭的 Excel 文件核对流程，不能用口头或文件名猜测创建采购草稿。"
                            + "请按已核对的文件继续，或回复「取消文件」后再口头下单。");
        }
    }

    private Map<String, Object> tryPrepareVerifiedPurchase(AierpWecomBindingService.BoundContext ctx,
                                                           String previewId, String fileSha256,
                                                           boolean throwOnIneligible,
                                                           Set<String> selectedBusinessKeys) throws Exception {
        Map<String, Object> active = getWorkflow(ctx);
        String activeStatus = active == null ? "" : String.valueOf(active.get("status"));
        if (active == null
                || !("PREVIEWED".equals(activeStatus) || "DRAFT_READY".equals(activeStatus)
                || "POSTED".equals(activeStatus))
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

        List<JSONObject> purchaseOk = new ArrayList<JSONObject>();
        List<JSONObject> otherOk = new ArrayList<JSONObject>();
        List<JSONObject> bad = new ArrayList<JSONObject>();
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
        // Soft path: pure MIX/SERVICE (no PURCHASE rows) → null so 016M helpers can run.
        if (!throwOnIneligible && bad.isEmpty() && purchaseOk.isEmpty() && !otherOk.isEmpty()) {
            return null;
        }

        if (!otherOk.isEmpty()) {
            String msg = "当前文件包含非采购场景，请拆成采购入库表后重发。";
            putWorkflow(ctx, "PREVIEWED", previewId, fileSha256, null, "NOT_PURCHASE_ONLY", msg,
                    null, null, null, null, null);
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, msg);
            }
            return previewOnly(msg);
        }

        if (purchaseOk.isEmpty() && bad.isEmpty()) {
            String msg = "没有可生成的采购单。";
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, msg);
            }
            return previewOnly(msg);
        }

        // Errors present: never silently skip. Auto-path only drafts when zero errors.
        // Explicit selectedBusinessKeys (user choice) may prepare the valid subset.
        if (!bad.isEmpty()) {
            if (selectedBusinessKeys == null || selectedBusinessKeys.isEmpty()) {
                String msg = buildErrorOnlySummary(purchaseOk.size() + bad.size(), purchaseOk.size(), bad);
                putWorkflow(ctx, "PREVIEWED", previewId, fileSha256, null, "ROW_ERRORS", msg,
                        null, null, null, null, null);
                if (throwOnIneligible) {
                    throw new BusinessRunTimeException(409, msg);
                }
                Map<String, Object> only = previewOnly(msg);
                only.put("totalBills", purchaseOk.size() + bad.size());
                only.put("validBills", purchaseOk.size());
                only.put("errorBills", bad.size());
                only.put("rowErrors", rowErrorList(bad));
                return only;
            }
            List<JSONObject> filtered = new ArrayList<JSONObject>();
            for (JSONObject rec : purchaseOk) {
                if (selectedBusinessKeys.contains(rec.getString("businessKey"))) {
                    filtered.add(rec);
                }
            }
            for (JSONObject rec : bad) {
                if (selectedBusinessKeys.contains(rec.getString("businessKey"))) {
                    throw new BusinessRunTimeException(409,
                            "所选业务单仍有错误，不能生成草稿：" + rec.getString("businessKey"));
                }
            }
            if (filtered.isEmpty()) {
                throw new BusinessRunTimeException(409, "所选业务单均不可办理，请改错后重发或另选有效单号。");
            }
            purchaseOk = filtered;
        }

        if (purchaseOk.isEmpty()) {
            if (throwOnIneligible) {
                throw new BusinessRunTimeException(409, "没有可生成的采购单。");
            }
            return null;
        }

        List<Map<String, Object>> draftRows = new ArrayList<Map<String, Object>>();
        int alreadyPosted = 0;
        int awaiting = 0;
        int reconciling = 0;
        int rowErrors = 0;
        for (JSONObject record : purchaseOk) {
            Map<String, Object> one = prepareOnePurchase(ctx, fileSha256, record);
            draftRows.add(one);
            String state = String.valueOf(one.get("state"));
            if ("POSTED".equals(state) || "CONFIRMED".equals(state)) {
                alreadyPosted++;
            } else if ("DRAFT_READY".equals(state)) {
                awaiting++;
            } else if ("RECONCILIATION_REQUIRED".equals(state)) {
                reconciling++;
            } else if ("ERROR".equals(state) || "CANCELLED".equals(state)) {
                rowErrors++;
            }
        }
        int problemCount = reconciling + rowErrors;

        Map<String, Object> batchMeta = upsertBatch(ctx, previewId, fileSha256, draftRows);
        String batchId = String.valueOf(batchMeta.get("batchId"));
        Object primaryDraftId = draftRows.size() == 1 ? draftRows.get(0).get("draftId") : null;
        String primaryBiz = draftRows.size() == 1 ? String.valueOf(draftRows.get(0).get("businessKey")) : null;
        boolean singleAwaiting = draftRows.size() == 1 && awaiting == 1
                && "DRAFT_READY".equals(String.valueOf(draftRows.get(0).get("state")));
        String confirmPhrase = singleAwaiting && primaryDraftId != null
                ? "确认采购" + primaryDraftId : null;
        String summaryZh;
        if (singleAwaiting && confirmPhrase != null) {
            summaryZh = buildSingleDraftReadySummary(primaryBiz, draftRows.get(0),
                    Long.parseLong(String.valueOf(primaryDraftId)), confirmPhrase);
        } else if (draftRows.size() == 1 && alreadyPosted == 1) {
            summaryZh = postedSummaryZh(primaryBiz, draftRows.get(0));
        } else if (draftRows.size() == 1 && reconciling == 1) {
            summaryZh = reconciliationSummaryZh(primaryBiz, draftRows.get(0));
        } else {
            summaryZh = buildBatchSummaryZh(purchaseOk.size(), draftRows, alreadyPosted, awaiting, problemCount);
        }
        // Audited replay must never surface 待确认 / 未入库 (AIERP-017B2 P0 #119).
        // Only strip when every row is verified POSTED — never mask reconciliation.
        if (alreadyPosted > 0 && awaiting == 0 && problemCount == 0) {
            summaryZh = stripPendingWording(summaryZh);
        }

        String wfStatus;
        if (awaiting == 0 && alreadyPosted > 0 && problemCount == 0) {
            wfStatus = "POSTED";
        } else if (awaiting > 0) {
            wfStatus = "DRAFT_READY";
        } else if (reconciling > 0) {
            wfStatus = "RECONCILIATION_REQUIRED";
        } else {
            wfStatus = "PREVIEWED";
        }
        putWorkflow(ctx, wfStatus, previewId, fileSha256, null, null, summaryZh,
                primaryDraftId, primaryBiz, confirmPhrase, batchId, draftRows);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("autoDraft", awaiting > 0 || alreadyPosted > 0 || reconciling > 0);
        out.put("batchId", batchId);
        out.put("revision", batchMeta.get("revision"));
        out.put("previewId", previewId);
        out.put("fileSha256", fileSha256);
        out.put("drafts", draftRows);
        out.put("totalBills", purchaseOk.size());
        out.put("validBills", awaiting + alreadyPosted);
        out.put("errorBills", problemCount);
        out.put("awaitingDrafts", awaiting);
        out.put("alreadyPosted", alreadyPosted);
        out.put("reconciliationRequired", reconciling);
        out.put("userSummaryZh", summaryZh);
        out.put("hintZh", summaryZh);
        out.put("posted", awaiting == 0 && alreadyPosted > 0 && problemCount == 0);
        out.put("stockUnchanged", true);
        if (primaryDraftId != null || (draftRows.size() == 1 && reconciling == 1)) {
            Map<String, Object> first = draftRows.get(0);
            if (primaryDraftId != null) {
                out.put("draftId", primaryDraftId);
            } else if (first.get("draftId") != null) {
                out.put("draftId", first.get("draftId"));
            }
            out.put("businessKey", primaryBiz);
            if (confirmPhrase != null) {
                out.put("confirmPhrase", confirmPhrase);
            }
            out.put("replayed", first.get("replayed"));
            out.put("challenge", first.get("challenge"));
            if ("POSTED".equals(String.valueOf(first.get("state")))) {
                out.put("statusLabel", "已审核、已入库");
                out.put("billNumber", first.get("nativeBillNumber"));
                out.put("receiptHint", first.get("receiptHint"));
                // Never leave confirmPhrase on audited replay.
                out.remove("confirmPhrase");
            } else if ("RECONCILIATION_REQUIRED".equals(String.valueOf(first.get("state")))) {
                out.put("statusLabel", "需人工对账");
                out.put("billNumber", first.get("nativeBillNumber"));
                out.put("reconciliationReason", first.get("reconciliationReason"));
                out.remove("confirmPhrase");
            } else if ("DRAFT_READY".equals(String.valueOf(first.get("state")))) {
                out.put("statusLabel", "待确认、未入库");
            } else {
                out.put("statusLabel", String.valueOf(first.get("state")));
            }
        } else if (alreadyPosted > 0 && awaiting == 0 && problemCount == 0) {
            out.put("statusLabel", "已审核、已入库");
        } else if (reconciling > 0 && awaiting == 0) {
            out.put("statusLabel", "需人工对账");
        } else if (awaiting > 0) {
            out.put("statusLabel", "待确认、未入库");
        } else {
            out.put("statusLabel", "核对完成");
        }
        return out;
    }

    private Map<String, Object> prepareOnePurchase(AierpWecomBindingService.BoundContext ctx,
                                                   String fileSha256, JSONObject record) throws Exception {
        String businessKey = record.getString("businessKey");
        JSONObject normalized = record.getJSONObject("normalized");
        if (normalized == null) {
            throw new BusinessRunTimeException(400, "预览缺少规范化明细");
        }
        Map<String, Object> existing = findExistingByIdemOrBusinessKey(ctx, fileSha256, businessKey);
        if (existing != null) {
            Map<String, Object> confirmedOutcome = outcomeForConfirmedDraft(ctx, businessKey, existing, true);
            if (confirmedOutcome != null) {
                return confirmedOutcome;
            }
        }
        if (existing != null && "CANCELLED".equals(String.valueOf(existing.get("status")))) {
            // Fall through to create a fresh draft under same idempotency only if payload matches create path.
            // createDraftAs will 409 on payload mismatch; cancelled rows stay cancelled — use new key suffix? No:
            // cancelled drafts keep idempotency_key unique; creating again fails. Cancelled → report state.
            return cancelledRow(businessKey, existing);
        }

        JSONObject draftBody = JSON.parseObject(normalized.toJSONString());
        if (trimToNull(draftBody.getString("businessKey")) == null) {
            draftBody.put("businessKey", businessKey);
        }
        String idem = shortIdempotencyKey(ctx, fileSha256, businessKey);
        draftBody.put("idempotencyKey", idem);
        if (draftBody.getString("remark") == null || draftBody.getString("remark").trim().isEmpty()) {
            draftBody.put("remark", "企微Excel采购 " + businessKey);
        }
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
        Map<String, Object> created;
        try {
            created = gatewayService.createDraftAs(ctx.user, "PURCHASE", draftBody, owner);
        } catch (BusinessRunTimeException ex) {
            // Idempotent key occupied (payload drift vs already-audited) — never invent a new draft.
            Map<String, Object> again = findExistingByIdemOrBusinessKey(ctx, fileSha256, businessKey);
            if (again != null) {
                Map<String, Object> confirmedOutcome = outcomeForConfirmedDraft(ctx, businessKey, again, true);
                if (confirmedOutcome != null) {
                    return confirmedOutcome;
                }
            }
            Map<String, Object> fail = new LinkedHashMap<String, Object>();
            fail.put("businessKey", businessKey);
            fail.put("state", "ERROR");
            fail.put("error", ex.getMessage());
            fail.put("draftId", null);
            fail.put("nativeBillNumber", null);
            return fail;
        }

        if ("CONFIRMED".equals(String.valueOf(created.get("status")))
                || Boolean.TRUE.equals(created.get("posted"))) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("draftId", created.get("draftId"));
            row.put("status", "CONFIRMED");
            row.put("bill_number", created.get("billNumber"));
            Map<String, Object> confirmedOutcome = outcomeForConfirmedDraft(
                    ctx, businessKey, row, created.get("replayed"));
            if (confirmedOutcome != null) {
                return confirmedOutcome;
            }
            // Gateway claimed CONFIRMED/posted but native audit could not be verified.
            return reconciliationRow(businessKey, row, "NATIVE_NOT_AUDITED");
        }

        Object draftIdObj = created.get("draftId");
        if (draftIdObj == null) {
            throw new BusinessRunTimeException(500, "草稿创建未返回单号");
        }
        long draftId = Long.parseLong(String.valueOf(draftIdObj));
        Map<String, Object> one = new LinkedHashMap<String, Object>();
        one.put("businessKey", businessKey);
        one.put("draftId", draftId);
        one.put("state", "DRAFT_READY");
        one.put("confirmPhrase", "确认采购" + draftId);
        one.put("nativeBillNumber", null);
        one.put("error", null);
        one.put("replayed", created.get("replayed"));
        one.put("challenge", created.get("challenge"));
        one.put("normalizedHash", sha256Hex(normalized.toJSONString()));
        one.put("lineCount", lines == null ? 0 : lines.size());
        one.put("amountHint", amountHint(created));
        one.put("payload", created.get("payload"));
        return one;
    }

    /** 017B1-compatible single-bill summary (qty from cells, no tech jargon). */
    private String buildSingleDraftReadySummary(String businessKey, Map<String, Object> draftRow,
                                                long draftId, String confirmPhrase) {
        String organ = "";
        String material = "";
        String barCode = "";
        String depot = "";
        String qty = "";
        String unit = "";
        String price = "";
        String amount = "";
        Object payloadObj = draftRow.get("payload");
        JSONObject payload = null;
        if (payloadObj instanceof JSONObject) {
            payload = (JSONObject) payloadObj;
        } else if (payloadObj != null) {
            try {
                payload = JSONObject.parseObject(String.valueOf(payloadObj));
            } catch (Exception ignore) {
                payload = null;
            }
        }
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

    private static String stripNumber(Object n) {
        try {
            return new BigDecimal(String.valueOf(n)).stripTrailingZeros().toPlainString();
        } catch (Exception ex) {
            return String.valueOf(n);
        }
    }

    private Map<String, Object> findExistingByIdemOrBusinessKey(AierpWecomBindingService.BoundContext ctx,
                                                                String fileSha256, String businessKey) {
        String idem = shortIdempotencyKey(ctx, fileSha256, businessKey);
        List<Map<String, Object>> byIdem = jdbcTemplate.queryForList(
                "SELECT id AS draftId, status, bill_number, payload_json, binding_id, binding_version, wecom_user_id "
                        + "FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND idempotency_key=? LIMIT 1",
                ctx.user.getTenantId(), ctx.user.getId(), idem);
        if (!byIdem.isEmpty()) {
            // Idempotency key is already scoped to binding generation + file + businessKey.
            return byIdem.get(0);
        }
        // Historical fallback: exact sender + binding generation only (never cross-generation).
        if (ctx.binding.get("id") == null || ctx.binding.get("binding_version") == null
                || ctx.wecomUserId == null || ctx.wecomUserId.trim().isEmpty()) {
            return null;
        }
        List<Map<String, Object>> byBiz = jdbcTemplate.queryForList(
                "SELECT id AS draftId, status, bill_number, payload_json, binding_id, binding_version, wecom_user_id "
                        + "FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND status='CONFIRMED' "
                        + "AND binding_id=? AND binding_version=? AND wecom_user_id=? "
                        + "AND (payload_json LIKE ? OR payload_json LIKE ?) ORDER BY id DESC LIMIT 8",
                ctx.user.getTenantId(), ctx.user.getId(),
                ctx.binding.get("id"), ctx.binding.get("binding_version"), ctx.wecomUserId,
                "%\"businessKey\":\"" + escapeLike(businessKey) + "\"%",
                "%企微Excel采购 " + escapeLike(businessKey) + "%");
        for (Map<String, Object> row : byBiz) {
            if (sameBoundActor(ctx, row) && payloadMentionsBusinessKey(row, businessKey)) {
                return row;
            }
        }
        return null;
    }

    /** Exact binding id + generation + WeCom sender — nulls never match. */
    private boolean sameBoundActor(AierpWecomBindingService.BoundContext ctx, Map<String, Object> row) {
        if (row.get("binding_id") == null || ctx.binding.get("id") == null) {
            return false;
        }
        if (!String.valueOf(ctx.binding.get("id")).equals(String.valueOf(row.get("binding_id")))) {
            return false;
        }
        if (row.get("binding_version") == null || ctx.binding.get("binding_version") == null) {
            return false;
        }
        if (!String.valueOf(ctx.binding.get("binding_version")).equals(String.valueOf(row.get("binding_version")))) {
            return false;
        }
        if (row.get("wecom_user_id") == null || ctx.wecomUserId == null || ctx.wecomUserId.trim().isEmpty()) {
            return false;
        }
        return ctx.wecomUserId.equals(String.valueOf(row.get("wecom_user_id")));
    }

    private static boolean payloadMentionsBusinessKey(Map<String, Object> row, String businessKey) {
        String payload = String.valueOf(row.get("payload_json"));
        if (payload.contains("\"businessKey\":\"" + businessKey + "\"")) {
            return true;
        }
        return payload.contains("企微Excel采购 " + businessKey);
    }

    /**
     * For CONFIRMED gateway drafts: POSTED only when native depot_head status=1 for current tenant.
     * Missing bill / missing head / unapproved head → RECONCILIATION_REQUIRED (no new draft).
     * Non-CONFIRMED → null (caller continues).
     */
    private Map<String, Object> outcomeForConfirmedDraft(AierpWecomBindingService.BoundContext ctx,
                                                         String businessKey, Map<String, Object> draftRow,
                                                         Object replayed) {
        if (!"CONFIRMED".equals(String.valueOf(draftRow.get("status")))) {
            return null;
        }
        String reason = nativeAuditGapReason(ctx, draftRow);
        if (reason == null) {
            return alreadyPostedRow(ctx, businessKey, draftRow, replayed);
        }
        return reconciliationRow(businessKey, draftRow, reason);
    }

    /**
     * @return null when verified native audited (POSTED-eligible); otherwise gap reason code.
     */
    private String nativeAuditGapReason(AierpWecomBindingService.BoundContext ctx, Map<String, Object> draftRow) {
        Object billObj = draftRow.get("bill_number");
        if (billObj == null || String.valueOf(billObj).trim().isEmpty()) {
            return "MISSING_BILL";
        }
        String bill = String.valueOf(billObj).trim();
        List<Map<String, Object>> heads = jdbcTemplate.queryForList(
                "SELECT number, status FROM jsh_depot_head WHERE number=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                bill, ctx.user.getTenantId());
        if (heads.isEmpty()) {
            return "MISSING_NATIVE_HEAD";
        }
        // Native audited flag in jshERP is status='1'
        if (!"1".equals(String.valueOf(heads.get(0).get("status")))) {
            return "NATIVE_NOT_AUDITED";
        }
        return null;
    }

    private Map<String, Object> alreadyPostedRow(AierpWecomBindingService.BoundContext ctx,
                                                 String businessKey, Map<String, Object> draftRow,
                                                 Object replayed) {
        Object draftId = draftRow.get("draftId") != null ? draftRow.get("draftId") : draftRow.get("id");
        String bill = draftRow.get("bill_number") == null ? null : String.valueOf(draftRow.get("bill_number"));
        Map<String, Object> one = new LinkedHashMap<String, Object>();
        one.put("businessKey", businessKey);
        one.put("draftId", draftId);
        one.put("state", "POSTED");
        one.put("confirmPhrase", null);
        one.put("nativeBillNumber", bill);
        one.put("error", null);
        one.put("replayed", replayed == null ? Boolean.TRUE : replayed);
        one.put("receiptHint", postedSummaryZh(businessKey, one));
        one.put("statusLabel", "已审核、已入库");
        return one;
    }

    private Map<String, Object> reconciliationRow(String businessKey, Map<String, Object> draftRow, String reason) {
        Object draftId = draftRow.get("draftId") != null ? draftRow.get("draftId") : draftRow.get("id");
        String bill = draftRow.get("bill_number") == null ? null : String.valueOf(draftRow.get("bill_number"));
        Map<String, Object> one = new LinkedHashMap<String, Object>();
        one.put("businessKey", businessKey);
        one.put("draftId", draftId);
        one.put("state", "RECONCILIATION_REQUIRED");
        one.put("confirmPhrase", null);
        one.put("nativeBillNumber", bill);
        one.put("reconciliationReason", reason);
        one.put("error", "网关已确认但原生单据未核对成功（" + reason + "），请人工对账，勿重复确认或新建草稿。");
        one.put("replayed", Boolean.TRUE);
        one.put("statusLabel", "需人工对账");
        return one;
    }

    private static String reconciliationSummaryZh(String businessKey, Map<String, Object> draftRow) {
        StringBuilder sb = new StringBuilder();
        sb.append("采购单 ");
        if (businessKey != null && !businessKey.trim().isEmpty()) {
            sb.append(businessKey.trim());
        } else if (draftRow.get("draftId") != null) {
            sb.append("#").append(draftRow.get("draftId"));
        }
        sb.append(" 需人工对账");
        Object reason = draftRow.get("reconciliationReason");
        if (reason != null) {
            sb.append("（").append(reason).append("）");
        }
        sb.append("：网关已确认但原生已审核单据未核验成功，未新建草稿、请勿再次确认入库。");
        return sb.toString();
    }

    /** User-facing audited replay: always 已审核 + native bill / PDF offer; never 未入库/待确认. */
    private static String postedSummaryZh(String businessKey, Map<String, Object> draftRow) {
        String bill = draftRow.get("nativeBillNumber") == null
                ? (draftRow.get("bill_number") == null ? null : String.valueOf(draftRow.get("bill_number")))
                : String.valueOf(draftRow.get("nativeBillNumber"));
        StringBuilder sb = new StringBuilder();
        sb.append("采购单 ");
        if (businessKey != null && !businessKey.trim().isEmpty()) {
            sb.append(businessKey.trim());
        } else if (draftRow.get("draftId") != null) {
            sb.append("#").append(draftRow.get("draftId"));
        }
        sb.append(" 已审核完成");
        if (bill != null && !bill.trim().isEmpty()) {
            sb.append("（").append(bill.trim()).append("）");
        }
        sb.append("，无需再次入库。");
        if (bill != null && !bill.trim().isEmpty()) {
            sb.append("可回复「发 ").append(bill.trim()).append(" 回执」领取 PDF。");
        } else {
            sb.append("可回复「发回执」领取 PDF。");
        }
        return sb.toString();
    }

    private static String stripPendingWording(String summary) {
        if (summary == null) {
            return "";
        }
        String s = summary;
        s = s.replace("待确认、未入库", "已审核、已入库");
        s = s.replace("待确认", "已审核");
        s = s.replace("未入库", "已入库");
        s = s.replace("尚未入库", "已审核完成");
        return s;
    }

    private Map<String, Object> cancelledRow(String businessKey, Map<String, Object> draftRow) {
        Map<String, Object> one = new LinkedHashMap<String, Object>();
        one.put("businessKey", businessKey);
        one.put("draftId", draftRow.get("draftId"));
        one.put("state", "CANCELLED");
        one.put("nativeBillNumber", draftRow.get("bill_number"));
        one.put("error", "该业务单对应草稿已取消，请修改文件后重新上传。");
        one.put("replayed", true);
        return one;
    }

    private Map<String, Object> upsertBatch(AierpWecomBindingService.BoundContext ctx, String previewId,
                                            String fileSha256, List<Map<String, Object>> draftRows) {
        String batchKey = "wb:" + sha256Hex(
                String.valueOf(ctx.binding.get("id")) + "|"
                        + String.valueOf(ctx.binding.get("binding_version")) + "|"
                        + fileSha256.toLowerCase(Locale.ROOT)).substring(0, 32);
        String newManifest = batchManifestFingerprint(draftRows);
        JSONObject result = new JSONObject(true);
        result.put("batchId", batchKey);
        result.put("previewId", previewId);
        result.put("fileSha256", fileSha256);
        result.put("manifestHash", newManifest);
        result.put("revision", 1);
        result.put("botId", ctx.botId);
        result.put("wecomUserIdMasked", mask(ctx.wecomUserId));
        result.put("bindingId", ctx.binding.get("id"));
        result.put("bindingVersion", ctx.binding.get("binding_version"));
        result.put("tenantId", ctx.user.getTenantId());
        result.put("userId", ctx.user.getId());
        result.put("drafts", draftRows);
        result.put("posted", false);
        result.put("stockUnchanged", true);
        result.put("updatedAt", System.currentTimeMillis());

        int rev = 1;
        List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                "SELECT id, result_json FROM aierp_excel_batch WHERE tenant_id=? AND user_id=? AND batch_key=?",
                ctx.user.getTenantId(), ctx.user.getId(), batchKey);
        if (!existing.isEmpty()) {
            JSONObject prev = JSON.parseObject(String.valueOf(existing.get(0).get("result_json")));
            int prevRev = prev == null || prev.get("revision") == null ? 1 : prev.getIntValue("revision");
            if (prevRev <= 0) {
                prevRev = 1;
            }
            String prevManifest = prev != null && prev.getString("manifestHash") != null
                    ? prev.getString("manifestHash")
                    : batchManifestFingerprint(prev == null ? null : prev.get("drafts"));
            // Idempotent same-file reupload: keep immutable revision unless draft manifest changed.
            rev = prevManifest.equals(newManifest) ? prevRev : prevRev + 1;
            result.put("revision", rev);
            jdbcTemplate.update(
                    "UPDATE aierp_excel_batch SET preview_key=?, result_json=? WHERE id=?",
                    previewId, result.toJSONString(), existing.get(0).get("id"));
        } else {
            jdbcTemplate.update(
                    "INSERT INTO aierp_excel_batch (batch_key, preview_key, tenant_id, user_id, result_json, create_time) "
                            + "VALUES (?,?,?,?,?,NOW())",
                    batchKey, previewId, ctx.user.getTenantId(), ctx.user.getId(), result.toJSONString());
        }
        Map<String, Object> meta = new LinkedHashMap<String, Object>();
        meta.put("batchId", batchKey);
        meta.put("revision", rev);
        meta.put("manifestHash", newManifest);
        return meta;
    }

    /** Stable fingerprint of batch draft rows (excludes previewId / updatedAt / volatile challenge). */
    private static String batchManifestFingerprint(Object draftsObj) {
        List<JSONObject> sorted = new ArrayList<JSONObject>();
        if (draftsObj instanceof List) {
            @SuppressWarnings("unchecked")
            List<?> list = (List<?>) draftsObj;
            for (Object item : list) {
                JSONObject src;
                if (item instanceof JSONObject) {
                    src = (JSONObject) item;
                } else if (item instanceof Map) {
                    src = new JSONObject(true);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> map = (Map<String, Object>) item;
                    src.putAll(map);
                } else {
                    continue;
                }
                sorted.add(manifestDraftRow(src));
            }
        } else if (draftsObj instanceof JSONArray) {
            JSONArray arr = (JSONArray) draftsObj;
            for (int i = 0; i < arr.size(); i++) {
                JSONObject src = arr.getJSONObject(i);
                if (src != null) {
                    sorted.add(manifestDraftRow(src));
                }
            }
        } else if (draftsObj != null) {
            JSONArray arr = JSON.parseArray(JSON.toJSONString(draftsObj));
            if (arr != null) {
                for (int i = 0; i < arr.size(); i++) {
                    JSONObject src = arr.getJSONObject(i);
                    if (src != null) {
                        sorted.add(manifestDraftRow(src));
                    }
                }
            }
        }
        sorted.sort(new java.util.Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                String ka = a.getString("businessKey") == null ? "" : a.getString("businessKey");
                String kb = b.getString("businessKey") == null ? "" : b.getString("businessKey");
                int c = ka.compareTo(kb);
                if (c != 0) {
                    return c;
                }
                String da = a.getString("draftId") == null ? "" : a.getString("draftId");
                String db = b.getString("draftId") == null ? "" : b.getString("draftId");
                return da.compareTo(db);
            }
        });
        JSONArray out = new JSONArray();
        out.addAll(sorted);
        return sha256Hex(out.toJSONString());
    }

    private static JSONObject manifestDraftRow(JSONObject src) {
        JSONObject row = new JSONObject(true);
        row.put("businessKey", src.get("businessKey"));
        row.put("draftId", src.get("draftId") == null ? null : String.valueOf(src.get("draftId")));
        row.put("state", src.get("state"));
        row.put("nativeBillNumber", src.get("nativeBillNumber"));
        row.put("normalizedHash", src.get("normalizedHash"));
        row.put("error", src.get("error"));
        row.put("reconciliationReason", src.get("reconciliationReason"));
        return row;
    }

    private String buildBatchSummaryZh(int total, List<Map<String, Object>> drafts,
                                       int alreadyPosted, int awaiting, int errors) {
        int lineCount = 0;
        for (Map<String, Object> d : drafts) {
            Object lc = d.get("lineCount");
            if (lc instanceof Number) {
                lineCount += ((Number) lc).intValue();
            } else {
                lineCount += 1;
            }
        }
        StringBuilder sb = new StringBuilder();
        if (alreadyPosted > 0 && awaiting == 0 && errors == 0) {
            sb.append("批量采购已核对：").append(total).append(" 张 / ").append(Math.max(lineCount, total)).append(" 行；");
            sb.append("全部已审核完成，无需再次入库。\n");
            int shown = 0;
            for (Map<String, Object> d : drafts) {
                if (shown >= 3) {
                    sb.append("…其余已省略\n");
                    break;
                }
                shown++;
                sb.append(d.get("businessKey"));
                if (d.get("nativeBillNumber") != null) {
                    sb.append(" → ").append(d.get("nativeBillNumber"));
                }
                sb.append("（已完成）\n");
            }
            Object hint = drafts.isEmpty() ? null : drafts.get(0).get("receiptHint");
            if (hint != null) {
                sb.append(hint);
            } else {
                sb.append("可回复「发回执」领取 PDF。");
            }
            return sb.toString().trim();
        }

        sb.append("批量采购已核对：").append(total).append(" 张 / ").append(Math.max(lineCount, total)).append(" 行；");
        sb.append(awaiting).append(" 张可办理");
        if (alreadyPosted > 0) {
            sb.append("、").append(alreadyPosted).append(" 张已完成");
        }
        if (errors > 0) {
            sb.append("、").append(errors).append(" 张需处理");
        }
        sb.append("。\n");
        int shown = 0;
        for (Map<String, Object> d : drafts) {
            if (shown >= 3) {
                sb.append("…其余已省略\n");
                break;
            }
            shown++;
            String state = String.valueOf(d.get("state"));
            sb.append(d.get("businessKey"));
            if ("DRAFT_READY".equals(state) && d.get("draftId") != null) {
                sb.append("｜待确认 #").append(d.get("draftId"));
            }
            if ("POSTED".equals(state) && d.get("nativeBillNumber") != null) {
                sb.append("｜已完成 ").append(d.get("nativeBillNumber"));
            }
            if ("RECONCILIATION_REQUIRED".equals(state)) {
                sb.append("｜需人工对账");
                if (d.get("reconciliationReason") != null) {
                    sb.append(" ").append(d.get("reconciliationReason"));
                }
            }
            if (d.get("amountHint") != null) {
                sb.append("｜").append(d.get("amountHint"));
            }
            sb.append("\n");
        }
        sb.append("库存未变化。");
        if (awaiting == 1 && drafts.size() == 1 && drafts.get(0).get("confirmPhrase") != null) {
            sb.append("\n请回复「").append(drafts.get(0).get("confirmPhrase")).append("」完成入库");
        } else if (awaiting > 1) {
            sb.append("\n请逐张回复「确认采购{数字草稿号}」完成入库（整批确认尚未开通）");
        }
        return sb.toString().trim();
    }

    private String buildErrorOnlySummary(int total, int valid, List<JSONObject> bad) {
        StringBuilder sb = new StringBuilder();
        sb.append("批量采购已核对：").append(total).append(" 张；")
                .append(valid).append(" 张可办理、").append(bad.size()).append(" 张有错。\n");
        List<String> errs = rowErrorList(bad);
        for (int i = 0; i < Math.min(errs.size(), 5); i++) {
            sb.append("- ").append(errs.get(i)).append("\n");
        }
        sb.append("错误不可忽略。请改好后重发，或明确指定仅办理有效业务单号。库存未变化，未创建采购草稿。");
        return sb.toString().trim();
    }

    private List<String> rowErrorList(List<JSONObject> bad) {
        List<String> errs = new ArrayList<String>();
        for (JSONObject rec : bad) {
            String bk = rec.getString("businessKey");
            JSONArray sourceRows = rec.getJSONArray("sourceRows");
            String rowLabel = sourceRows == null || sourceRows.isEmpty()
                    ? "?" : String.valueOf(sourceRows.get(0));
            JSONArray e = rec.getJSONArray("errors");
            String detail = "";
            if (e != null && !e.isEmpty()) {
                StringBuilder d = new StringBuilder();
                for (int i = 0; i < e.size(); i++) {
                    if (i > 0) {
                        d.append("；");
                    }
                    d.append(String.valueOf(e.get(i)));
                }
                detail = d.toString();
            }
            errs.add("第" + rowLabel + "行" + (bk == null ? "" : "（" + bk + "）")
                    + (detail.isEmpty() ? "数据有误" : "：" + detail));
        }
        return errs;
    }

    private static Map<String, Object> previewOnly(String msg) {
        Map<String, Object> only = new LinkedHashMap<String, Object>();
        only.put("userSummaryZh", msg);
        only.put("hintZh", msg);
        only.put("autoDraft", false);
        only.put("posted", false);
        only.put("stockUnchanged", true);
        return only;
    }

    private static String amountHint(Map<String, Object> created) {
        try {
            Object payloadObj = created.get("payload");
            JSONObject payload = payloadObj instanceof JSONObject
                    ? (JSONObject) payloadObj
                    : JSONObject.parseObject(String.valueOf(payloadObj));
            if (payload == null) {
                return null;
            }
            JSONArray lines = payload.getJSONArray("lines");
            if (lines == null || lines.isEmpty()) {
                return null;
            }
            BigDecimal total = BigDecimal.ZERO;
            BigDecimal qtySum = BigDecimal.ZERO;
            String unit = null;
            boolean sameUnit = true;
            for (int i = 0; i < lines.size(); i++) {
                JSONObject line = lines.getJSONObject(i);
                BigDecimal all = line.getBigDecimal("allPrice");
                if (all != null) {
                    total = total.add(all);
                }
                Object q = line.get("operNumber") != null ? line.get("operNumber") : line.get("qty");
                if (q != null) {
                    qtySum = qtySum.add(new BigDecimal(String.valueOf(q)));
                }
                String u = line.getString("unit");
                if (unit == null) {
                    unit = u;
                } else if (u != null && !unit.equalsIgnoreCase(u)) {
                    sameUnit = false;
                }
            }
            StringBuilder sb = new StringBuilder();
            if (sameUnit && unit != null) {
                sb.append(qtySum.stripTrailingZeros().toPlainString()).append(unit);
            } else {
                sb.append(lines.size()).append(" 行");
            }
            if (total.compareTo(BigDecimal.ZERO) > 0) {
                sb.append("／").append(total.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString())
                        .append(" 元");
            }
            return sb.toString();
        } catch (Exception ex) {
            return null;
        }
    }

    private void invalidateStaleDraftIfFileChanged(AierpWecomBindingService.BoundContext ctx, String newSha) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null || !"DRAFT_READY".equals(String.valueOf(current.get("status")))) {
            return;
        }
        String oldSha = current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256"));
        if (newSha != null && oldSha != null && newSha.equalsIgnoreCase(oldSha)) {
            return;
        }
        cancelWorkflowDrafts(ctx, current);
    }

    /** Cancel only unaudited drafts; never touch CONFIRMED native bills. */
    private void cancelWorkflowDrafts(AierpWecomBindingService.BoundContext ctx, Map<String, Object> current) {
        List<Long> ids = new ArrayList<Long>();
        if (current.get("draftId") != null) {
            try {
                ids.add(Long.parseLong(String.valueOf(current.get("draftId"))));
            } catch (Exception ignore) {
                // skip
            }
        }
        Object draftsObj = current.get("drafts");
        if (draftsObj instanceof List) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> drafts = (List<Map<String, Object>>) draftsObj;
            for (Map<String, Object> d : drafts) {
                if (d == null || d.get("draftId") == null) {
                    continue;
                }
                if ("POSTED".equals(String.valueOf(d.get("state")))
                        || "CONFIRMED".equals(String.valueOf(d.get("state")))) {
                    continue;
                }
                try {
                    ids.add(Long.parseLong(String.valueOf(d.get("draftId"))));
                } catch (Exception ignore) {
                    // skip
                }
            }
        }
        for (Long draftId : ids) {
            try {
                Map<String, Object> st = gatewayService.draftStatusAs(ctx.user, draftId, toOwner(ctx));
                if ("CONFIRMED".equals(String.valueOf(st.get("status")))) {
                    continue;
                }
                gatewayService.cancelDraftAs(ctx.user, draftId, toOwner(ctx));
            } catch (BusinessRunTimeException ex) {
                if (ex.getMessage() != null && ex.getMessage().contains("已过账")) {
                    continue;
                }
                throw new BusinessRunTimeException(409,
                        "上一份文件的待确认采购单尚未安全取消，请先处理上一张草稿后重试。");
            } catch (Exception ex) {
                throw new BusinessRunTimeException(409,
                        "上一份文件的待确认采购单尚未安全取消，请先处理上一张草稿后重试。");
            }
        }
    }

    private void refreshDraftLifecycle(AierpWecomBindingService.BoundContext ctx, Map<String, Object> current) {
        if (!"DRAFT_READY".equals(String.valueOf(current.get("status")))) {
            return;
        }
        Object draftsObj = current.get("drafts");
        if (draftsObj instanceof List) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> drafts = (List<Map<String, Object>>) draftsObj;
            int posted = 0;
            int open = 0;
            for (Map<String, Object> d : drafts) {
                if (d == null || d.get("draftId") == null) {
                    continue;
                }
                try {
                    long draftId = Long.parseLong(String.valueOf(d.get("draftId")));
                    Map<String, Object> st = gatewayService.draftStatusAs(ctx.user, draftId, toOwner(ctx));
                    String status = String.valueOf(st.get("status"));
                    if ("CONFIRMED".equals(status)) {
                        d.put("state", "POSTED");
                        d.put("nativeBillNumber", st.get("billNumber"));
                        posted++;
                    } else if ("CANCELLED".equals(status)) {
                        d.put("state", "CANCELLED");
                    } else {
                        open++;
                    }
                } catch (Exception ignore) {
                    open++;
                }
            }
            if (open == 0 && posted > 0) {
                current.put("status", "POSTED");
                putWorkflow(ctx, "POSTED",
                        current.get("previewId") == null ? null : String.valueOf(current.get("previewId")),
                        current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256")),
                        null, "CONFIRMED", String.valueOf(current.get("userSummaryZh")),
                        current.get("draftId"),
                        current.get("businessKey") == null ? null : String.valueOf(current.get("businessKey")),
                        null,
                        current.get("batchId") == null ? null : String.valueOf(current.get("batchId")),
                        drafts);
            }
            return;
        }
        if (current.get("draftId") == null) {
            return;
        }
        try {
            long draftId = Long.parseLong(String.valueOf(current.get("draftId")));
            Map<String, Object> st = gatewayService.draftStatusAs(ctx.user, draftId, toOwner(ctx));
            String status = String.valueOf(st.get("status"));
            if ("CONFIRMED".equals(status)) {
                current.put("status", "POSTED");
                String bill = st.get("billNumber") == null ? null : String.valueOf(st.get("billNumber"));
                String summary = bill == null
                        ? ("采购单 #" + draftId + " 已入库。可回复「发回执」领取 PDF。")
                        : ("采购单 #" + draftId + " 已入库（" + bill + "）。可回复「发 " + bill + " 回执」领取 PDF。");
                current.put("userSummaryZh", summary);
                putWorkflow(ctx, "POSTED",
                        current.get("previewId") == null ? null : String.valueOf(current.get("previewId")),
                        current.get("fileSha256") == null ? null : String.valueOf(current.get("fileSha256")),
                        null, "CONFIRMED", summary,
                        draftId,
                        current.get("businessKey") == null ? null : String.valueOf(current.get("businessKey")),
                        null, null, null);
            } else if ("CANCELLED".equals(status)) {
                current.put("status", "CANCELLED");
                current.put("draftId", null);
                putWorkflow(ctx, "CANCELLED", null, null, null, "DRAFT_CANCELLED", null, null, null, null, null, null);
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
                             Object draftId, String businessKey, String confirmPhrase,
                             String batchId, Object drafts) {
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
        if (batchId != null && !batchId.trim().isEmpty()) {
            wf.put("batchId", batchId.trim());
        }
        if (drafts != null) {
            wf.put("drafts", drafts);
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

    private static String escapeLike(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace("'", "");
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
