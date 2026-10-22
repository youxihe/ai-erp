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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AIERP-016M: WeCom MIX (组装/配制) unposted DRAFT from Excel preview or slot recipe.
 * Never posts inventory; post remains trusted before_dispatch「确认配制{draftId}」only.
 * Slot path: recipe-preview (PROPOSED) → trusted「确认配方{hash}」(USER_ACKED) → prepare.
 * Model booleans never equal human approval; ratios are never AI-derived.
 */
@Service
public class AierpWecomMixService {

    private static final String WF_PREFIX = "aierp:excel-wf:";
    private static final String RECIPE_PREFIX = "aierp:mix-recipe:";
    private static final String RECIPE_LATEST_PREFIX = "aierp:mix-recipe-latest:";
    private static final long WF_TTL_SECONDS = 6L * 60L * 60L;
    private static final long RECIPE_TTL_SECONDS = 6L * 60L * 60L;
    private static final String CHANNEL = "wecom";
    private static final String DEFAULT_FG_DEPOT = "成品仓";
    private static final String DEFAULT_RM_DEPOT = "原料仓";
    private static final String RECIPE_STATUS_PROPOSED = "PROPOSED";
    private static final String RECIPE_STATUS_USER_ACKED = "USER_ACKED";
    private static final String RECIPE_SOURCE_EXCEL = "EXCEL";
    private static final String RECIPE_SOURCE_SLOT = "SLOT_PREVIEW";
    private static final int RECIPE_ACK_SHORT_LEN = 12;
    private static final int RECIPE_HASH_SHORT_LEN = 12;
    /** Trusted inbound only: 「确认配方{8–64 hex}」 — never model tool args. */
    private static final Pattern RECIPE_ACK_PHRASE = Pattern.compile(
            "^\\s*确认\\s*配方\\s*[：:#＃]?\\s*([0-9a-fA-F]{8,64})\\s*$");

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
     * Display a proposed slot recipe DRAFT and register its server-side formula hash.
     * Does not create an ERP draft or change stock. Model booleans are ignored.
     */
    public Map<String, Object> recipePreview(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        JSONObject finished = parseFinished(body == null ? null : body.getJSONObject("finished"));
        JSONArray lines = parseRawLines(body == null ? null : body.getJSONArray("lines"));
        String recipeHash = computeRecipeHash(finished, lines);
        String shortH = shortHash(recipeHash);
        String ackPhrase = "确认配方" + shortH;
        String displayZh = buildRecipeDisplayZh(finished, lines, recipeHash, RECIPE_STATUS_PROPOSED, ackPhrase);
        Map<String, Object> stored = new LinkedHashMap<String, Object>();
        stored.put("recipeHash", recipeHash);
        stored.put("recipeShortHash", shortH);
        stored.put("recipeStatus", RECIPE_STATUS_PROPOSED);
        stored.put("finished", finished);
        stored.put("lines", lines);
        stored.put("recipeDisplayZh", displayZh);
        stored.put("ackPhrase", ackPhrase);
        stored.put("erpUserId", ctx.user.getId());
        stored.put("tenantId", ctx.user.getTenantId());
        stored.put("bindingId", ctx.binding.get("id"));
        stored.put("bindingVersion", ctx.binding.get("binding_version"));
        stored.put("updatedAt", System.currentTimeMillis());
        String key = recipeKey(ctx, recipeHash);
        redisService.setCacheObject(key, JSON.toJSONString(stored));
        try {
            redisService.redisTemplate.expire(key, RECIPE_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignore) {
            // best-effort TTL
        }
        putLatestRecipePointer(ctx, recipeHash);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("recipeHash", recipeHash);
        out.put("recipeConfirmHash", recipeHash);
        out.put("recipeShortHash", shortH);
        out.put("ackPhrase", ackPhrase);
        out.put("recipeStatus", RECIPE_STATUS_PROPOSED);
        out.put("recipeSource", RECIPE_SOURCE_SLOT);
        out.put("recipeDisplayZh", displayZh);
        out.put("finished", finished);
        out.put("lines", lines);
        out.put("posted", false);
        out.put("stockUnchanged", true);
        out.put("hintZh", displayZh + "\n请用户核对以上成品与全部原料用量后，私聊原文回复「"
                + ackPhrase + "」。模型布尔/代报哈希不能代替用户确认；确认配方后才能 /mix/prepare。");
        out.put("userSummaryZh", out.get("hintZh"));
        return out;
    }

    /**
     * Trusted WeCom before_dispatch: 「确认配方{hash}」marks displayed proposal USER_ACKED.
     * Does not post inventory. Model tool args alone cannot reach this path.
     */
    public Map<String, Object> ackRecipeFromTrustedInbound(JSONObject body) throws Exception {
        String source = trimToNull(body == null ? null : body.getString("eventSource"));
        if (!"WECOM_BEFORE_DISPATCH".equals(source)) {
            throw new BusinessRunTimeException(403, "配方确认事件来源必须是 WECOM_BEFORE_DISPATCH");
        }
        if (body != null && (Boolean.TRUE.equals(body.getBoolean("isGroup"))
                || Boolean.TRUE.equals(body.getBoolean("groupChat")))) {
            throw new BusinessRunTimeException(403, "禁止在群聊中确认配制配方");
        }
        String rawText = trimToNull(body == null ? null : body.getString("rawText"));
        if (rawText == null) {
            throw new BusinessRunTimeException(400, "缺少 rawText（须为企微原始私聊原文）");
        }
        String presented = parseRecipeAckHash(rawText);
        if (presented == null) {
            throw new BusinessRunTimeException(400, "不是有效的配方确认指令，请回复「确认配方」加配方哈希");
        }
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        String recipeHash = resolveRecipeHashFromAck(ctx, presented);
        Map<String, Object> stored = loadRecipePreview(ctx, recipeHash);
        if (stored == null) {
            throw new BusinessRunTimeException(404, "没有待确认的配制配方，请先预览完整成品/原料配比。");
        }
        String status = String.valueOf(stored.get("recipeStatus"));
        if (RECIPE_STATUS_USER_ACKED.equals(status)) {
            Map<String, Object> replay = new LinkedHashMap<String, Object>();
            replay.putAll(stored);
            replay.put("recipeAcked", true);
            replay.put("recipeConfirmHash", recipeHash);
            replay.put("replayed", true);
            replay.put("posted", false);
            replay.put("stockUnchanged", true);
            replay.put("hintZh", "配方哈希已确认过。可携带 recipeHash 调用 /mix/prepare 生成未审核配制草稿；"
                    + "过账仍须原文「确认配制{草稿号}」。配制回执为文字（无 MIX 专用 PDF）。");
            return replay;
        }
        if (!RECIPE_STATUS_PROPOSED.equals(status)) {
            throw new BusinessRunTimeException(409, "配方状态不可确认：" + status);
        }
        stored.put("recipeStatus", RECIPE_STATUS_USER_ACKED);
        stored.put("ackedAt", System.currentTimeMillis());
        stored.put("ackRawText", rawText);
        String messageMsgId = trimToNull(body.getString("messageMsgId"));
        if (messageMsgId != null) {
            stored.put("ackMessageMsgId", messageMsgId);
        }
        String key = recipeKey(ctx, recipeHash);
        redisService.setCacheObject(key, JSON.toJSONString(stored));
        try {
            redisService.redisTemplate.expire(key, RECIPE_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignore) {
            // best-effort TTL
        }
        String shortH = shortHash(recipeHash);
        String displayZh = buildRecipeDisplayZh(
                toJsonObject(stored.get("finished")), toJsonArray(stored.get("lines")),
                recipeHash, RECIPE_STATUS_USER_ACKED, "确认配方" + shortH);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("recipeHash", recipeHash);
        out.put("recipeConfirmHash", recipeHash);
        out.put("recipeShortHash", shortH);
        out.put("recipeStatus", RECIPE_STATUS_USER_ACKED);
        out.put("recipeAcked", true);
        out.put("recipeDisplayZh", displayZh);
        out.put("finished", stored.get("finished"));
        out.put("lines", stored.get("lines"));
        out.put("posted", false);
        out.put("stockUnchanged", true);
        out.put("hintZh", displayZh + "\n用户已原文确认配方哈希。可调用 /mix/prepare（携带 recipeHash+"
                + "idempotencyKey）生成未审核配制草稿；过账须再回复「确认配制{草稿号}」。"
                + "配制场景仅文字回执，无采购 PDF。");
        out.put("userSummaryZh", out.get("hintZh"));
        return out;
    }

    /**
     * Create MIX draft from a USER_ACKED recipeHash (trusted「确认配方」 first).
     * Model booleans never equal approval. Posting remains「确认配制{draftId}」only.
     */
    public Map<String, Object> mixPrepare(JSONObject body) throws Exception {
        // Reject model-boolean shortcuts before workflow gates (so boolean alone never looks like success).
        rejectModelRecipeBooleanAlone(body);
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        assertNoBlockingWorkflow(ctx);
        JSONObject draftBody = buildMixBodyFromSlots(ctx, body);
        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, "MIX", draftBody, owner);
        Map<String, Object> view = enrichMixView(ctx, created, draftBody.getString("businessKey"), false);
        view.put("recipeHash", draftBody.getString("recipeHash"));
        view.put("recipeConfirmHash", draftBody.getString("recipeHash"));
        view.put("recipeStatus", RECIPE_STATUS_USER_ACKED);
        view.put("recipeSource", RECIPE_SOURCE_SLOT);
        Object finishedObj = draftBody.get("finished");
        Object linesObj = draftBody.get("lines");
        if (finishedObj instanceof JSONObject && linesObj instanceof JSONArray) {
            view.put("recipeDisplayZh", buildRecipeDisplayZh(
                    (JSONObject) finishedObj, (JSONArray) linesObj,
                    draftBody.getString("recipeHash"), RECIPE_STATUS_USER_ACKED, null));
        }
        return view;
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
        String recipeHash = computeRecipeHash(
                draftBody.getJSONObject("finished"), draftBody.getJSONArray("lines"));
        draftBody.put("recipeHash", recipeHash);
        String idem = shortIdempotencyKey(ctx, fileSha256, businessKey);
        draftBody.put("idempotencyKey", idem);
        if (draftBody.getString("remark") == null || draftBody.getString("remark").trim().isEmpty()) {
            draftBody.put("remark", "企微Excel配制 " + businessKey
                    + "（Excel 测试配方草案 recipeHash=" + shortHash(recipeHash) + "，待原文确认配制）");
        }

        AierpGatewayService.WecomDraftOwner owner = toOwner(ctx);
        Map<String, Object> created = gatewayService.createDraftAs(ctx.user, "MIX", draftBody, owner);
        Object draftIdObj = created.get("draftId");
        if (draftIdObj == null) {
            throw new BusinessRunTimeException(500, "草稿创建未返回单号");
        }
        long draftId = Long.parseLong(String.valueOf(draftIdObj));
        String confirmPhrase = "确认配制" + draftId;
        String summaryZh = buildMixDraftSummary(businessKey, created, draftId, confirmPhrase, recipeHash);
        putWorkflow(ctx, "DRAFT_READY", previewId, fileSha256, null, null, summaryZh,
                draftId, businessKey, confirmPhrase);
        Map<String, Object> out = enrichMixView(ctx, created, businessKey, true);
        out.put("autoDraft", true);
        out.put("confirmPhrase", confirmPhrase);
        out.put("userSummaryZh", summaryZh);
        out.put("hintZh", summaryZh);
        out.put("businessKey", businessKey);
        out.put("recipeHash", recipeHash);
        out.put("recipeConfirmHash", recipeHash);
        out.put("recipeStatus", RECIPE_STATUS_PROPOSED);
        out.put("recipeSource", RECIPE_SOURCE_EXCEL);
        out.put("recipeDisplayZh", buildRecipeDisplayZh(
                draftBody.getJSONObject("finished"), draftBody.getJSONArray("lines"),
                recipeHash, RECIPE_STATUS_PROPOSED, "确认配方" + shortHash(recipeHash)));
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
        finished.put("qty", normalizeQtyString(required(finishedIn, "qty")));
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
            line.put("qty", normalizeQtyString(required(src, "qty")));
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

    /**
     * Model booleans alone never authorize prepare — fail fast before workflow gates.
     */
    private static void rejectModelRecipeBooleanAlone(JSONObject body) {
        if (body == null) {
            return;
        }
        if (!(body.getBooleanValue("recipeUserConfirmed") || body.getBooleanValue("userConfirmedRecipe"))) {
            return;
        }
        String maybeHash = firstNonBlank(
                trimToNull(body.getString("recipeHash")),
                trimToNull(body.getString("recipeConfirmHash")));
        if (maybeHash == null) {
            throw new BusinessRunTimeException(400,
                    "模型布尔 recipeUserConfirmed/userConfirmedRecipe 不能证明用户已核对配方。"
                            + "请先调用 /mix/recipe-preview 展示完整成品/原料配比，再用返回的 recipeHash 准备草稿。"
                            + "系统不会自动推导化学比例；过账仅接受原文「确认配制{草稿号}」。");
        }
    }

    /**
     * Slot prepare: recipeHash must be USER_ACKED via trusted「确认配方{hash}」.
     * Never treat recipeUserConfirmed / userConfirmedRecipe as approval evidence.
     * 「确认配制{id}」remains the only trusted confirm/post path.
     */
    private JSONObject buildMixBodyFromSlots(AierpWecomBindingService.BoundContext ctx, JSONObject body) {
        if (body == null) {
            throw new BusinessRunTimeException(400, "缺少配制槽位");
        }
        rejectModelRecipeBooleanAlone(body);
        String recipeHash = firstNonBlank(
                trimToNull(body.getString("recipeHash")),
                trimToNull(body.getString("recipeConfirmHash")));
        if (recipeHash == null || !recipeHash.matches("[0-9a-fA-F]{64}")) {
            throw new BusinessRunTimeException(400,
                    "缺少有效 recipeHash。请先 /mix/recipe-preview 展示完整配方草案，再携带服务端返回的 hash 准备草稿。"
                            + "禁止用模型布尔标记冒充用户确认；系统不会自动推导化学比例。");
        }
        recipeHash = recipeHash.toLowerCase(Locale.ROOT);
        String idem = trimToNull(body.getString("idempotencyKey"));
        if (idem == null) {
            throw new BusinessRunTimeException(400, "缺少 idempotencyKey");
        }
        if (idem.length() > 80) {
            throw new BusinessRunTimeException(400, "idempotencyKey 过长");
        }

        Map<String, Object> stored = loadRecipePreview(ctx, recipeHash);
        if (stored == null) {
            throw new BusinessRunTimeException(404,
                    "recipeHash 未登记或已过期。请重新 /mix/recipe-preview 展示完整成品/原料配比后再准备草稿。");
        }
        if (!RECIPE_STATUS_USER_ACKED.equals(String.valueOf(stored.get("recipeStatus")))) {
            throw new BusinessRunTimeException(409,
                    "配方尚未经用户原文确认。请用户私聊回复「确认配方" + shortHash(recipeHash)
                            + "」后再准备草稿（模型代报哈希或布尔无效）。");
        }
        JSONObject finished = toJsonObject(stored.get("finished"));
        JSONArray lines = toJsonArray(stored.get("lines"));
        if (finished == null || lines == null || lines.isEmpty()) {
            throw new BusinessRunTimeException(500, "已登记配方缺少成品或原料行");
        }
        // Optional client finished/lines must match server-stored formula (prevent swap after display).
        if (body.getJSONObject("finished") != null || body.getJSONArray("lines") != null) {
            JSONObject clientFinished = body.getJSONObject("finished") == null
                    ? null : parseFinished(body.getJSONObject("finished"));
            JSONArray clientLines = body.getJSONArray("lines") == null
                    ? null : parseRawLines(body.getJSONArray("lines"));
            if (clientFinished != null && clientLines != null) {
                String clientHash = computeRecipeHash(clientFinished, clientLines);
                if (!recipeHash.equals(clientHash)) {
                    throw new BusinessRunTimeException(409,
                            "请求中的成品/原料与已展示 recipeHash 不一致，请重新预览后再准备。");
                }
            }
        }

        JSONObject draftBody = new JSONObject(true);
        draftBody.put("idempotencyKey", idem);
        draftBody.put("finished", finished);
        draftBody.put("lines", lines);
        draftBody.put("recipeHash", recipeHash);
        String remark = trimToNull(body.getString("remark"));
        draftBody.put("remark", remark == null
                ? ("企微对话配制（测试配方草案 recipeHash=" + shortHash(recipeHash)
                + "，已展示待原文确认配制）")
                : remark);
        return draftBody;
    }

    private JSONObject parseFinished(JSONObject finishedIn) {
        if (finishedIn == null) {
            throw new BusinessRunTimeException(400, "缺少 finished（成品编码/产出数量/单位）");
        }
        JSONObject finished = new JSONObject(true);
        finished.put("barCode", required(finishedIn, "barCode"));
        finished.put("depotName", firstNonBlank(finishedIn.getString("depotName"), DEFAULT_FG_DEPOT));
        finished.put("qty", normalizeQtyString(required(finishedIn, "qty")));
        finished.put("unit", required(finishedIn, "unit"));
        assertPositiveQty(finished.getString("qty"), "成品产出数量");
        return finished;
    }

    private JSONArray parseRawLines(JSONArray rawLines) {
        if (rawLines == null || rawLines.isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少 lines（至少一行原料）");
        }
        List<JSONObject> sorted = new java.util.ArrayList<JSONObject>();
        for (int i = 0; i < rawLines.size(); i++) {
            JSONObject src = rawLines.getJSONObject(i);
            if (src == null) {
                continue;
            }
            JSONObject line = new JSONObject(true);
            line.put("barCode", required(src, "barCode"));
            line.put("depotName", firstNonBlank(src.getString("depotName"), DEFAULT_RM_DEPOT));
            line.put("qty", normalizeQtyString(required(src, "qty")));
            line.put("unit", required(src, "unit"));
            assertPositiveQty(line.getString("qty"), "原料领用数量");
            sorted.add(line);
        }
        if (sorted.isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少有效原料行");
        }
        sorted.sort(new java.util.Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return String.valueOf(a.getString("barCode"))
                        .compareTo(String.valueOf(b.getString("barCode")));
            }
        });
        JSONArray lines = new JSONArray();
        lines.addAll(sorted);
        return lines;
    }

    private Map<String, Object> loadRecipePreview(AierpWecomBindingService.BoundContext ctx, String recipeHash) {
        Object raw;
        try {
            raw = redisService.getCacheObject(recipeKey(ctx, recipeHash));
        } catch (Exception ex) {
            return null;
        }
        if (raw == null) {
            return null;
        }
        try {
            Map<String, Object> stored = JSON.parseObject(String.valueOf(raw));
            if (stored == null
                    || !recipeHash.equalsIgnoreCase(String.valueOf(stored.get("recipeHash")))
                    || !String.valueOf(ctx.user.getId()).equals(String.valueOf(stored.get("erpUserId")))
                    || !String.valueOf(ctx.user.getTenantId()).equals(String.valueOf(stored.get("tenantId")))
                    || !String.valueOf(ctx.binding.get("id")).equals(String.valueOf(stored.get("bindingId")))
                    || !String.valueOf(ctx.binding.get("binding_version"))
                    .equals(String.valueOf(stored.get("bindingVersion")))) {
                return null;
            }
            return stored;
        } catch (Exception ex) {
            return null;
        }
    }

    private static String recipeKey(AierpWecomBindingService.BoundContext ctx, String recipeHash) {
        return RECIPE_PREFIX + ctx.botId + ":" + ctx.wecomUserId + ":" + recipeHash.toLowerCase(Locale.ROOT);
    }

    private static String latestRecipeKey(AierpWecomBindingService.BoundContext ctx) {
        return RECIPE_LATEST_PREFIX + ctx.botId + ":" + ctx.wecomUserId;
    }

    /** Remember last PROPOSED recipe so short-hash「确认配方{12hex}」can resolve. */
    private void putLatestRecipePointer(AierpWecomBindingService.BoundContext ctx, String recipeHash) {
        if (ctx == null || recipeHash == null) {
            return;
        }
        String key = latestRecipeKey(ctx);
        String full = recipeHash.toLowerCase(Locale.ROOT);
        redisService.setCacheObject(key, full);
        try {
            redisService.redisTemplate.expire(key, RECIPE_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignore) {
            // best-effort TTL
        }
    }

    private String getLatestRecipeHash(AierpWecomBindingService.BoundContext ctx) {
        try {
            Object v = redisService.getCacheObject(latestRecipeKey(ctx));
            if (v == null) {
                return null;
            }
            String s = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
            return s.matches("[0-9a-f]{64}") ? s : null;
        } catch (Exception ex) {
            return null;
        }
    }

    /**
     * Parse hash from trusted WeCom rawText「确认配方{hash}」.
     * Returns lowercase hex fragment (8–64) or null — never invents ratios.
     */
    private static String parseRecipeAckHash(String rawText) {
        if (rawText == null) {
            return null;
        }
        Matcher m = RECIPE_ACK_PHRASE.matcher(rawText.trim());
        if (!m.matches()) {
            return null;
        }
        return m.group(1).toLowerCase(Locale.ROOT);
    }

    /**
     * Resolve presented short/full hash to full SHA-256 via latest pointer or exact key.
     */
    private String resolveRecipeHashFromAck(AierpWecomBindingService.BoundContext ctx, String presented) {
        if (presented == null || presented.isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少配方哈希");
        }
        String p = presented.toLowerCase(Locale.ROOT);
        if (p.matches("[0-9a-f]{64}")) {
            return p;
        }
        if (p.length() < 8 || p.length() > RECIPE_ACK_SHORT_LEN || !p.matches("[0-9a-f]+")) {
            throw new BusinessRunTimeException(400, "配方哈希格式无效，请使用预览返回的短哈希或完整哈希");
        }
        String latest = getLatestRecipeHash(ctx);
        if (latest != null && latest.startsWith(p)) {
            return latest;
        }
        throw new BusinessRunTimeException(404,
                "无法匹配配方哈希「" + p + "」。请先 /mix/recipe-preview 展示完整成品/原料配比，"
                        + "再原文回复「确认配方」加预览短哈希（模型代报无效）。");
    }

    /** Canonical SHA-256 of finished + sorted raw lines (no model flags). */
    static String computeRecipeHash(JSONObject finished, JSONArray lines) {
        StringBuilder canon = new StringBuilder();
        canon.append("FG|").append(normToken(finished.getString("barCode")))
                .append("|").append(normQtyCanon(finished.getString("qty")))
                .append("|").append(normToken(finished.getString("unit")))
                .append("|").append(normToken(firstNonBlank(finished.getString("depotName"), DEFAULT_FG_DEPOT)))
                .append("\n");
        List<JSONObject> sorted = new java.util.ArrayList<JSONObject>();
        for (int i = 0; i < lines.size(); i++) {
            JSONObject line = lines.getJSONObject(i);
            if (line != null) {
                sorted.add(line);
            }
        }
        sorted.sort(new java.util.Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return String.valueOf(a.getString("barCode"))
                        .compareTo(String.valueOf(b.getString("barCode")));
            }
        });
        for (JSONObject line : sorted) {
            canon.append("RM|").append(normToken(line.getString("barCode")))
                    .append("|").append(normQtyCanon(line.getString("qty")))
                    .append("|").append(normToken(line.getString("unit")))
                    .append("|").append(normToken(firstNonBlank(line.getString("depotName"), DEFAULT_RM_DEPOT)))
                    .append("\n");
        }
        return sha256Hex(canon.toString());
    }

    private static String buildRecipeDisplayZh(JSONObject finished, JSONArray lines,
                                               String recipeHash, String recipeStatus,
                                               String ackPhrase) {
        StringBuilder sb = new StringBuilder();
        sb.append("【配制配方草案】").append(recipeStatus == null ? RECIPE_STATUS_PROPOSED : recipeStatus);
        sb.append(" recipeHash=").append(shortHash(recipeHash)).append("\n");
        sb.append("成品：").append(finished.getString("barCode"))
                .append(" ").append(stripNumber(finished.get("qty")))
                .append(" ").append(nullTo(finished.getString("unit"), ""))
                .append(" → ").append(nullTo(finished.getString("depotName"), DEFAULT_FG_DEPOT))
                .append("\n");
        sb.append("原料（预计扣减，确认后生效）：\n");
        for (int i = 0; i < lines.size(); i++) {
            JSONObject line = lines.getJSONObject(i);
            sb.append("- ").append(line.getString("barCode"))
                    .append(" ").append(stripNumber(line.get("qty")))
                    .append(" ").append(nullTo(line.getString("unit"), ""))
                    .append(" @ ").append(nullTo(line.getString("depotName"), DEFAULT_RM_DEPOT))
                    .append("\n");
        }
        if (RECIPE_STATUS_USER_ACKED.equals(recipeStatus)) {
            sb.append("用户已原文确认本配方哈希（非模型布尔）。");
        } else {
            sb.append("此为提案展示，不是过账授权；模型布尔不能代替用户核对。");
            if (ackPhrase != null && !ackPhrase.isEmpty()) {
                sb.append("核对无误请回复「").append(ackPhrase).append("」。");
            }
        }
        sb.append("系统不会自动推导化学比例。过账仅接受原文「确认配制{草稿号}」。");
        return sb.toString().trim();
    }

    private static String shortHash(String recipeHash) {
        if (recipeHash == null || recipeHash.length() < RECIPE_HASH_SHORT_LEN) {
            return recipeHash == null ? "" : recipeHash.toLowerCase(Locale.ROOT);
        }
        return recipeHash.substring(0, RECIPE_HASH_SHORT_LEN).toLowerCase(Locale.ROOT);
    }

    private static JSONObject toJsonObject(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof JSONObject) {
            return (JSONObject) o;
        }
        return JSON.parseObject(JSON.toJSONString(o));
    }

    private static JSONArray toJsonArray(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof JSONArray) {
            return (JSONArray) o;
        }
        return JSON.parseArray(JSON.toJSONString(o));
    }

    private static String normalizeQtyString(String raw) {
        return new BigDecimal(raw.trim()).stripTrailingZeros().toPlainString();
    }

    private static String normQtyCanon(String raw) {
        try {
            return new BigDecimal(String.valueOf(raw).trim()).stripTrailingZeros().toPlainString();
        } catch (Exception ex) {
            return String.valueOf(raw).trim();
        }
    }

    private static String normToken(String s) {
        return s == null ? "" : s.trim().toUpperCase(Locale.ROOT);
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
                    + (fromExcel
                    ? " 配比为 Excel 中用户填写的测试值（非模型布尔）。"
                    : " 配比为已展示的测试配方草案（recipeHash 已登记；非模型布尔确认）。"));
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
                                        long draftId, String confirmPhrase, String recipeHash) {
        StringBuilder sb = new StringBuilder();
        sb.append("配制单 ").append(businessKey == null ? "" : businessKey).append("\n");
        sb.append("待确认单 #").append(draftId).append("（未过账，库存未变）\n");
        if (recipeHash != null && !recipeHash.isEmpty()) {
            sb.append("配方草案 recipeHash=").append(shortHash(recipeHash)).append("\n");
        }
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
        sb.append("测试配方草案已展示；过账须原文「").append(confirmPhrase).append("」（模型布尔无效）");
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
