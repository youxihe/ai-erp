package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.constants.BusinessConstants;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.service.LogService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.annotation.Resource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AIERP-021B: WeCom material master-data prepare/commit.
 * Distinct from partner master-data ({@code PartnerMasterDataService} on #44) — unique class path,
 * never shares a combined {@code AierpWecomMasterDataService}. Explicit {@link User} actor;
 * whitelist only; never touches stock / depotHead / historical bills.
 * Confirm phrases (mirror partner verb+type order): 确认建档物料{id} / 确认修改物料{id}.
 */
@Service
public class MaterialMasterDataService {

    /** Native ERP menu function「商品信息」(/material/material). */
    private static final long FUN_MATERIAL = 23L;

    private static final String CHANNEL = "wecom";
    private static final long CHALLENGE_TTL_SEC = 1800L;
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();
    /**
     * Material-namespaced confirms — must not collide with partner
     * 确认建档供应商/客户{id} or bare 确认建档{id}.
     */
    private static final Pattern CONFIRM_CREATE = Pattern.compile("^\\s*确认建档物料(\\d+)\\s*$");
    private static final Pattern CONFIRM_UPDATE = Pattern.compile("^\\s*确认修改物料(\\d+)\\s*$");
    private static final Set<String> FORBIDDEN_STOCK_KEYS = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "stock", "initStock", "initialStock", "currentStock", "current_number", "lowSafeStock",
            "highSafeStock", "safeStock", "depotHead", "depotItem", "库存", "期初库存", "初始库存")));
    private static final Set<String> CREATE_WHITELIST = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "opType", "name", "barCode", "unit", "categoryId", "categoryName", "standard", "spec",
            "brand", "remark", "sku", "wecomUserId", "botId", "channel", "messageMsgId",
            "eventSource", "isGroup", "rawText", "phrase", "requestId", "idempotencyKey")));
    private static final Set<String> UPDATE_WHITELIST = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "opType", "materialId", "barCode", "name", "standard", "spec", "brand", "remark",
            "wecomUserId", "botId", "channel", "messageMsgId", "eventSource", "isGroup",
            "rawText", "phrase", "requestId", "idempotencyKey", "recordDigest")));

    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private PlatformTransactionManager transactionManager;
    @Resource
    private LogService logService;

    /** Prepare create/update material challenge — does not write jsh_material. */
    public Map<String, Object> prepareMaterial(JSONObject body) throws Exception {
        rejectForbiddenFields(body);
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        User actor = ctx.user;
        String opType = normalizeOpType(body.getString("opType"));
        assertMaterialPermission(actor, opType);
        JSONObject normalized;
        String recordDigest = null;
        Long materialId = null;
        String barCode;
        List<Map<String, Object>> nameCandidates = Collections.emptyList();
        if ("CREATE".equals(opType)) {
            normalized = normalizeCreate(actor, body);
            barCode = normalized.getString("barCode");
            nameCandidates = findNameCandidates(actor.getTenantId(), normalized.getString("name"),
                    normalized.getString("standard"));
        } else {
            NormalizedUpdate upd = normalizeUpdate(actor, body);
            normalized = upd.payload;
            recordDigest = upd.recordDigest;
            materialId = upd.materialId;
            barCode = upd.barCode;
        }
        final String payloadJson = normalized.toJSONString();
        final String payloadHash = sha256Hex(payloadJson);
        final long bindingId = ((Number) ctx.binding.get("id")).longValue();
        final long bindingVersion = bindingVersionOf(ctx.binding);
        final String phrasePrefix = "CREATE".equals(opType) ? "确认建档物料" : "确认修改物料";
        final String finalBarCode = barCode;
        final String finalRecordDigest = recordDigest;
        final Long finalMaterialId = materialId;
        final String finalOpType = opType;
        final List<Map<String, Object>> finalNameCandidates = nameCandidates;

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(status -> {
            // Supersede prior pending requests for same owner+op+barcode.
            jdbcTemplate.update(
                    "UPDATE aierp_master_material_request SET status='SUPERSEDED' WHERE channel=? AND bot_id=? "
                            + "AND wecom_user_id=? AND tenant_id=? AND erp_user_id=? AND op_type=? "
                            + "AND IFNULL(bar_code,'')=? AND status='PENDING'",
                    CHANNEL, ctx.botId, ctx.wecomUserId, actor.getTenantId(), actor.getId(), finalOpType,
                    finalBarCode == null ? "" : finalBarCode);

            String challengeId = randomToken(16);
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime exp = now.plusSeconds(CHALLENGE_TTL_SEC);
            // Placeholder phrase; rewritten with auto-id after insert.
            KeyHolder keys = new GeneratedKeyHolder();
            final String placeholderPhrase = phrasePrefix + "0";
            jdbcTemplate.update(con -> {
                PreparedStatement ps = con.prepareStatement(
                        "INSERT INTO aierp_master_material_request (challenge_id, channel, bot_id, wecom_user_id, "
                                + "tenant_id, erp_user_id, binding_id, binding_version, op_type, material_id, bar_code, "
                                + "record_digest, payload_json, payload_hash, expected_phrase, status, expires_at, created_at) "
                                + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING', ?, ?)",
                        Statement.RETURN_GENERATED_KEYS);
                int i = 1;
                ps.setString(i++, challengeId);
                ps.setString(i++, CHANNEL);
                ps.setString(i++, ctx.botId);
                ps.setString(i++, ctx.wecomUserId);
                ps.setLong(i++, actor.getTenantId());
                ps.setLong(i++, actor.getId());
                ps.setLong(i++, bindingId);
                ps.setLong(i++, bindingVersion);
                ps.setString(i++, finalOpType);
                if (finalMaterialId == null) {
                    ps.setObject(i++, null);
                } else {
                    ps.setLong(i++, finalMaterialId);
                }
                ps.setString(i++, finalBarCode);
                ps.setString(i++, finalRecordDigest);
                ps.setString(i++, payloadJson);
                ps.setString(i++, payloadHash);
                ps.setString(i++, placeholderPhrase);
                ps.setString(i++, TS.format(exp));
                ps.setString(i++, TS.format(now));
                return ps;
            }, keys);
            Number key = keys.getKey();
            if (key == null) {
                throw new BusinessRunTimeException(500, "无法创建物料主数据申请");
            }
            long requestId = key.longValue();
            String phrase = phrasePrefix + requestId;
            jdbcTemplate.update(
                    "UPDATE aierp_master_material_request SET expected_phrase=? WHERE id=?",
                    phrase, requestId);

            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("requestId", requestId);
            out.put("challengeId", challengeId);
            out.put("opType", finalOpType);
            out.put("status", "PENDING");
            out.put("expiresInSec", CHALLENGE_TTL_SEC);
            out.put("boundErpLoginName", actor.getLoginName());
            out.put("tenantId", actor.getTenantId());
            out.put("nature", "REAL_ERP");
            out.put("stockUnchanged", true);
            out.put("posted", false);
            out.put("normalized", JSON.parseObject(payloadJson));
            out.put("summaryZh", buildSummaryZh(finalOpType, JSON.parseObject(payloadJson)));
            if (finalRecordDigest != null) {
                out.put("recordDigest", finalRecordDigest);
                out.put("diff", JSON.parseObject(payloadJson).get("diff"));
            }
            if (!finalNameCandidates.isEmpty()) {
                out.put("nameCandidates", finalNameCandidates);
                out.put("nameHint", "发现近似名称物料，请确认是否仍要新建（避免重复建档）");
            }
            Map<String, Object> challenge = new LinkedHashMap<String, Object>();
            challenge.put("phrase", phrase);
            challenge.put("expiresInSec", CHALLENGE_TTL_SEC);
            challenge.put("hint", "请本人回复「" + phrase + "」完成提交；未确认前 ERP 不建档/不修改。");
            out.put("challenge", challenge);
            out.put("hint", challenge.get("hint"));
            return out;
        });
    }

    /**
     * Trusted WeCom commit: re-validate binding generation + phrase + digest, then write Material+Extend.
     * LLM must never call this; only HMAC before_dispatch with exact confirm phrase.
     * Requires exact {@code eventSource=WECOM_BEFORE_DISPATCH} (null / LLM self-report rejected).
     */
    public Map<String, Object> commitMaterial(JSONObject body) throws Exception {
        rejectForbiddenFields(body);
        String eventSource = trimToNull(body == null ? null : body.getString("eventSource"));
        if (!"WECOM_BEFORE_DISPATCH".equals(eventSource)) {
            throw new BusinessRunTimeException(403, "确认事件来源必须是 WECOM_BEFORE_DISPATCH");
        }
        if (body != null && (Boolean.TRUE.equals(body.getBoolean("isGroup"))
                || Boolean.TRUE.equals(body.getBoolean("groupChat")))) {
            throw new BusinessRunTimeException(403, "主数据确认仅支持本人私聊，群聊拒绝");
        }
        // Resolve binding first — independent of LLM-reported identity fields beyond HMAC+wecomUserId.
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        if (ctx.wecomUserId == null || ctx.wecomUserId.isEmpty() || ctx.botId == null || ctx.botId.isEmpty()) {
            throw new BusinessRunTimeException(403, "缺少可信企微发送方身份");
        }
        if (ctx.user == null || ctx.user.getId() == null || ctx.user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 绑定用户");
        }
        String rawText = firstNonEmpty(body.getString("rawText"), body.getString("phrase"));
        if (rawText == null) {
            throw new BusinessRunTimeException(400, "缺少 rawText（须为企微原始私聊原文）");
        }
        ParsedMasterConfirm intent = parseConfirm(rawText);
        if (!intent.confirm || intent.requestId == null) {
            throw new BusinessRunTimeException(400, "请回复「确认建档物料{申请号}」或「确认修改物料{申请号}」");
        }
        Long bodyRequestId = body.getLong("requestId");
        if (bodyRequestId != null && !bodyRequestId.equals(intent.requestId)) {
            throw new BusinessRunTimeException(400, "申请号与确认原文不匹配");
        }

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(status -> {
            try {
                return commitMaterialAs(ctx.user, ctx, intent.requestId,
                        trimToNull(body.getString("messageMsgId")), intent.rawText);
            } catch (BusinessRunTimeException ex) {
                throw ex;
            } catch (Exception ex) {
                throw new BusinessRunTimeException(500, "物料主数据提交失败: " + ex.getMessage());
            }
        });
    }

    /** Explicit-actor commit used by transactional wrapper. */
    public Map<String, Object> commitMaterialAs(User actor, AierpWecomBindingService.BoundContext ctx,
                                                 long requestId, String messageMsgId, String rawText) throws Exception {
        if (actor == null || actor.getId() == null || actor.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 用户");
        }
        if (ctx == null || ctx.wecomUserId == null || ctx.botId == null) {
            throw new BusinessRunTimeException(403, "缺少可信企微发送方身份");
        }
        long bindingId = ((Number) ctx.binding.get("id")).longValue();
        long bindingVersion = bindingVersionOf(ctx.binding);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM aierp_master_material_request WHERE id=? AND channel=? AND bot_id=? "
                        + "AND wecom_user_id=? AND tenant_id=? AND erp_user_id=? FOR UPDATE",
                requestId, CHANNEL, ctx.botId, ctx.wecomUserId, actor.getTenantId(), actor.getId());
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, "主数据申请不存在或不属于当前绑定用户");
        }
        Map<String, Object> row = rows.get(0);
        String status = String.valueOf(row.get("status"));
        if ("CONSUMED".equals(status)) {
            // Idempotent replay of same message / same request.
            Long resultId = row.get("result_material_id") == null ? null
                    : ((Number) row.get("result_material_id")).longValue();
            return buildCommitReplay(actor, row, resultId);
        }
        if (!"PENDING".equals(status)) {
            throw new BusinessRunTimeException(409, "申请已失效，请重新 prepare");
        }
        LocalDateTime exp = LocalDateTime.parse(String.valueOf(row.get("expires_at")).replace(' ', 'T').substring(0, 19));
        if (LocalDateTime.now().isAfter(exp)) {
            jdbcTemplate.update("UPDATE aierp_master_material_request SET status='EXPIRED' WHERE id=?", requestId);
            throw new BusinessRunTimeException(410, "确认已过期，请重新申请");
        }
        long rowBindingId = ((Number) row.get("binding_id")).longValue();
        long rowBindingVersion = ((Number) row.get("binding_version")).longValue();
        if (rowBindingId != bindingId || rowBindingVersion != bindingVersion) {
            jdbcTemplate.update("UPDATE aierp_master_material_request SET status='SUPERSEDED' WHERE id=?", requestId);
            throw new BusinessRunTimeException(403, "绑定已更新，原申请不可再确认");
        }
        // Cross-binding / identity: request row must match live WeCom sender + ERP actor.
        if (!CHANNEL.equals(String.valueOf(row.get("channel")))
                || !ctx.botId.equals(String.valueOf(row.get("bot_id")))
                || !ctx.wecomUserId.equals(String.valueOf(row.get("wecom_user_id")))) {
            throw new BusinessRunTimeException(403, "申请与当前企微身份不匹配");
        }
        long reqTenant = ((Number) row.get("tenant_id")).longValue();
        long reqUser = ((Number) row.get("erp_user_id")).longValue();
        if (!actor.getTenantId().equals(reqTenant) || !actor.getId().equals(reqUser)) {
            throw new BusinessRunTimeException(403, "申请与当前绑定 ERP 用户不匹配");
        }

        String expected = String.valueOf(row.get("expected_phrase"));
        if (rawText == null || !expected.equals(rawText.trim())) {
            throw new BusinessRunTimeException(400, "确认原文不匹配，请回复「" + expected + "」");
        }

        // Message-id idempotency: same actor only. Cross-sender collisions must not leak other.result.
        if (messageMsgId != null && !messageMsgId.isEmpty()) {
            List<Map<String, Object>> byMsg = jdbcTemplate.queryForList(
                    "SELECT id, tenant_id, erp_user_id, bot_id, wecom_user_id FROM aierp_master_material_request "
                            + "WHERE consume_message_id=? AND id<>? LIMIT 1",
                    messageMsgId, requestId);
            if (!byMsg.isEmpty()) {
                Map<String, Object> prev = byMsg.get(0);
                boolean sameActor = ctx.botId.equals(String.valueOf(prev.get("bot_id")))
                        && ctx.wecomUserId.equals(String.valueOf(prev.get("wecom_user_id")))
                        && actor.getTenantId().equals(((Number) prev.get("tenant_id")).longValue())
                        && actor.getId().equals(((Number) prev.get("erp_user_id")).longValue());
                if (sameActor) {
                    throw new BusinessRunTimeException(409, "同一企微消息已用于其他申请");
                }
            }
        }

        JSONObject payload = JSON.parseObject(String.valueOf(row.get("payload_json")));
        String opType = String.valueOf(row.get("op_type"));
        // Re-enforce native material-master permission at commit (role may have been revoked after prepare).
        assertMaterialPermission(actor, opType);
        Long materialId;
        if ("CREATE".equals(opType)) {
            materialId = insertMaterialZeroStock(actor, payload);
        } else {
            materialId = updateMaterialWhitelist(actor, payload, String.valueOf(row.get("record_digest")));
        }

        int n = jdbcTemplate.update(
                "UPDATE aierp_master_material_request SET status='CONSUMED', consumed_at=?, consume_message_id=?, "
                        + "result_material_id=? WHERE id=? AND status='PENDING'",
                TS.format(LocalDateTime.now()), messageMsgId, materialId, requestId);
        if (n != 1) {
            throw new BusinessRunTimeException(409, "申请已被消费，请勿重复提交");
        }

        Map<String, Object> materialView = loadMaterialView(actor.getTenantId(), materialId);
        try {
            logService.insertLogWithUserId(actor.getId(), actor.getTenantId(), "商品",
                    ("CREATE".equals(opType) ? BusinessConstants.LOG_OPERATION_TYPE_ADD : BusinessConstants.LOG_OPERATION_TYPE_EDIT)
                            + String.valueOf(materialView.get("name")) + "(企微主数据)",
                    null);
        } catch (Exception ignore) {
            // audit best-effort
        }

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("requestId", requestId);
        out.put("opType", opType);
        out.put("status", "CONSUMED");
        out.put("replayed", false);
        out.put("materialId", materialId);
        out.put("barCode", materialView.get("barCode"));
        out.put("name", materialView.get("name"));
        out.put("unit", materialView.get("unit"));
        out.put("tenantId", actor.getTenantId());
        out.put("boundErpLoginName", actor.getLoginName());
        out.put("nature", "REAL_ERP");
        out.put("stockUnchanged", true);
        out.put("posted", false);
        out.put("initialStockRows", 0);
        out.put("currentStockTotal", materialView.get("currentStockTotal"));
        out.put("material", materialView);
        out.put("hint", "CREATE".equals(opType)
                ? "物料已建档，全部仓库库存为 0；可用编码检索或用于未审核采购草稿。"
                : "物料资料已更新；编码/基础单位/库存未改动。");
        return out;
    }

    private Map<String, Object> buildCommitReplay(User actor, Map<String, Object> row, Long materialId) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("requestId", ((Number) row.get("id")).longValue());
        out.put("opType", row.get("op_type"));
        out.put("status", "CONSUMED");
        out.put("replayed", true);
        out.put("materialId", materialId);
        out.put("boundErpLoginName", actor.getLoginName());
        out.put("tenantId", actor.getTenantId());
        out.put("nature", "REAL_ERP");
        out.put("stockUnchanged", true);
        out.put("posted", false);
        if (materialId != null) {
            Map<String, Object> view = loadMaterialView(actor.getTenantId(), materialId);
            out.put("barCode", view.get("barCode"));
            out.put("name", view.get("name"));
            out.put("unit", view.get("unit"));
            out.put("currentStockTotal", view.get("currentStockTotal"));
            out.put("material", view);
        }
        out.put("hint", "同一申请已执行过，未重复建档/修改。");
        return out;
    }

    private Long insertMaterialZeroStock(User actor, JSONObject payload) {
        String barCode = required(payload, "barCode");
        String name = required(payload, "name");
        String unit = required(payload, "unit");
        Long categoryId = payload.getLong("categoryId");
        String standard = trimToNull(payload.getString("standard"));
        String brand = trimToNull(payload.getString("brand"));
        String remark = trimToNull(payload.getString("remark"));
        String sku = normalizeSku(payload.getString("sku"));

        // Named lock serializes parallel creates for the same tenant+barcode (check-then-insert race).
        String lockName = barcodeLockName(actor.getTenantId(), barCode);
        Integer locked = jdbcTemplate.queryForObject("SELECT GET_LOCK(?, 10)", Integer.class, lockName);
        if (locked == null || locked != 1) {
            throw new BusinessRunTimeException(409, "条码写入繁忙，请重试: " + barCode);
        }
        try {
            // Gap/next-key friendly lock on existing barcode rows; re-check after lock.
            jdbcTemplate.queryForList(
                    "SELECT e.id FROM jsh_material_extend e "
                            + "JOIN jsh_material m ON m.id=e.material_id AND m.tenant_id=? "
                            + "AND IFNULL(m.delete_flag,'0')<>'1' "
                            + "WHERE e.bar_code=? AND e.tenant_id=? AND IFNULL(e.delete_flag,'0')<>'1' "
                            + "FOR UPDATE",
                    actor.getTenantId(), barCode, actor.getTenantId());
            assertBarCodeUnique(actor.getTenantId(), barCode, null);
            assertCategoryExists(actor.getTenantId(), categoryId);
            assertUnitExists(actor.getTenantId(), unit);
            if (sku != null) {
                assertSkuSemantics(actor.getTenantId(), sku, barCode, null);
            }

            KeyHolder keys = new GeneratedKeyHolder();
            jdbcTemplate.update(con -> {
                PreparedStatement ps = con.prepareStatement(
                        "INSERT INTO jsh_material (category_id, name, model, standard, brand, unit, remark, enabled, "
                                + "enable_serial_number, enable_batch_number, tenant_id, delete_flag) "
                                + "VALUES (?,?,?,?,?,?,?, b'1', '0', '0', ?, '0')",
                        Statement.RETURN_GENERATED_KEYS);
                int i = 1;
                if (categoryId == null) {
                    ps.setObject(i++, null);
                } else {
                    ps.setLong(i++, categoryId);
                }
                ps.setString(i++, name);
                ps.setString(i++, barCode);
                ps.setString(i++, standard);
                ps.setString(i++, brand);
                ps.setString(i++, unit);
                ps.setString(i++, remark);
                ps.setLong(i++, actor.getTenantId());
                return ps;
            }, keys);
            Number mid = keys.getKey();
            if (mid == null) {
                throw new BusinessRunTimeException(500, "物料主档写入失败");
            }
            long materialId = mid.longValue();
            String login = actor.getLoginName();
            long nowMs = System.currentTimeMillis();
            int ext = jdbcTemplate.update(
                    "INSERT INTO jsh_material_extend (material_id, bar_code, commodity_unit, sku, default_flag, "
                            + "create_time, create_serial, update_serial, update_time, tenant_id, delete_flag) "
                            + "VALUES (?,?,?,?, '1', NOW(), ?, ?, ?, ?, '0')",
                    materialId, barCode, unit, sku, login, login, nowMs, actor.getTenantId());
            if (ext != 1) {
                throw new BusinessRunTimeException(500, "物料条码扩展写入失败");
            }
            // Hard invariant: no initial/current stock rows; every warehouse stays 0.
            Integer initCnt = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM jsh_material_initial_stock WHERE material_id=? AND tenant_id=? "
                            + "AND IFNULL(delete_flag,'0')<>'1'",
                    Integer.class, materialId, actor.getTenantId());
            Integer curCnt = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM jsh_material_current_stock WHERE material_id=? AND tenant_id=? "
                            + "AND IFNULL(delete_flag,'0')<>'1'",
                    Integer.class, materialId, actor.getTenantId());
            if ((initCnt != null && initCnt > 0) || (curCnt != null && curCnt > 0)) {
                throw new BusinessRunTimeException(500, "内部错误：建档不应产生库存行");
            }
            Integer nonzeroDepots = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM ("
                            + "SELECT d.id FROM jsh_depot d "
                            + "LEFT JOIN jsh_material_current_stock cs ON cs.depot_id=d.id AND cs.material_id=? "
                            + "AND IFNULL(cs.delete_flag,'0')<>'1' "
                            + "WHERE IFNULL(d.delete_flag,'0')<>'1' AND IFNULL(d.tenant_id,?) = ? "
                            + "GROUP BY d.id HAVING IFNULL(SUM(IFNULL(cs.current_number,0)),0)<>0"
                            + ") t",
                    Integer.class, materialId, actor.getTenantId(), actor.getTenantId());
            if (nonzeroDepots != null && nonzeroDepots > 0) {
                throw new BusinessRunTimeException(500, "内部错误：建档后存在非零仓库库存");
            }
            return materialId;
        } finally {
            try {
                jdbcTemplate.queryForObject("SELECT RELEASE_LOCK(?)", Integer.class, lockName);
            } catch (Exception ignore) {
                // best-effort unlock
            }
        }
    }

    private Long updateMaterialWhitelist(User actor, JSONObject payload, String expectedDigest) {
        Long materialId = payload.getLong("materialId");
        if (materialId == null) {
            throw new BusinessRunTimeException(400, "缺少 materialId");
        }
        List<Map<String, Object>> mats = jdbcTemplate.queryForList(
                "SELECT m.id, m.name, m.standard, m.brand, m.remark, m.unit, e.bar_code, e.commodity_unit, e.id AS extend_id "
                        + "FROM jsh_material m "
                        + "JOIN jsh_material_extend e ON e.material_id=m.id AND IFNULL(e.delete_flag,'0')<>'1' "
                        + "WHERE m.id=? AND m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' "
                        + "ORDER BY e.default_flag DESC, e.id ASC LIMIT 1 FOR UPDATE",
                materialId, actor.getTenantId());
        if (mats.isEmpty()) {
            throw new BusinessRunTimeException(404, "物料不存在或不属于当前租户");
        }
        Map<String, Object> cur = mats.get(0);
        String liveDigest = digestOfMaterial(cur);
        if (expectedDigest != null && !expectedDigest.equals(liveDigest)) {
            throw new BusinessRunTimeException(409, "物料已被他人修改，请重新 prepare 后确认");
        }
        // Sprint rule: forbid bar_code / base unit change.
        if (payload.containsKey("barCode") && payload.getString("barCode") != null
                && !String.valueOf(cur.get("bar_code")).equals(payload.getString("barCode"))) {
            throw new BusinessRunTimeException(400, "本功能禁止修改物料编码/条码");
        }
        if (payload.containsKey("unit") && payload.getString("unit") != null
                && !String.valueOf(cur.get("unit")).equals(payload.getString("unit"))) {
            throw new BusinessRunTimeException(400, "本功能禁止修改基础单位");
        }

        String name = payload.getString("name") != null ? payload.getString("name") : String.valueOf(cur.get("name"));
        String standard = payload.containsKey("standard") ? trimToNull(payload.getString("standard"))
                : (cur.get("standard") == null ? null : String.valueOf(cur.get("standard")));
        String brand = payload.containsKey("brand") ? trimToNull(payload.getString("brand"))
                : (cur.get("brand") == null ? null : String.valueOf(cur.get("brand")));
        String remark = payload.containsKey("remark") ? trimToNull(payload.getString("remark"))
                : (cur.get("remark") == null ? null : String.valueOf(cur.get("remark")));

        // Whitelist columns only — never touch bar_code/unit/extend, stock tables, or depot_head/item
        // (no historical bill mutation via this path).
        jdbcTemplate.update(
                "UPDATE jsh_material SET name=?, standard=?, brand=?, remark=? WHERE id=? AND tenant_id=?",
                name, standard, brand, remark, materialId, actor.getTenantId());
        return materialId;
    }

    private JSONObject normalizeCreate(User actor, JSONObject body) {
        String name = required(body, "name");
        String barCode = required(body, "barCode");
        String unit = required(body, "unit");
        if (barCode.length() > 64 || !barCode.matches("^[A-Za-z0-9._\\-]{2,64}$")) {
            throw new BusinessRunTimeException(400, "条码/编码格式无效");
        }
        if (name.length() > 100) {
            throw new BusinessRunTimeException(400, "物料名称过长");
        }
        Long categoryId = resolveCategoryId(actor.getTenantId(), body);
        assertCategoryExists(actor.getTenantId(), categoryId);
        assertUnitExists(actor.getTenantId(), unit);
        assertBarCodeUnique(actor.getTenantId(), barCode, null);

        String standard = firstNonEmpty(trimToNull(body.getString("standard")), trimToNull(body.getString("spec")));
        String brand = trimToNull(body.getString("brand"));
        String remark = trimToNull(body.getString("remark"));
        String sku = normalizeSku(body.getString("sku"));
        if (remark != null && remark.length() > 500) {
            throw new BusinessRunTimeException(400, "备注过长");
        }
        if (sku != null) {
            assertSkuSemantics(actor.getTenantId(), sku, barCode, null);
        }

        JSONObject n = new JSONObject(true);
        n.put("opType", "CREATE");
        n.put("name", name);
        n.put("barCode", barCode);
        n.put("unit", unit);
        if (categoryId != null) {
            n.put("categoryId", categoryId);
            n.put("categoryName", loadCategoryName(actor.getTenantId(), categoryId));
        }
        if (standard != null) {
            n.put("standard", standard);
        }
        if (brand != null) {
            n.put("brand", brand);
        }
        if (remark != null) {
            n.put("remark", remark);
        }
        if (sku != null) {
            n.put("sku", sku);
        }
        return n;
    }

    private NormalizedUpdate normalizeUpdate(User actor, JSONObject body) {
        Long materialId = body.getLong("materialId");
        String barCode = trimToNull(body.getString("barCode"));
        if (materialId == null && barCode == null) {
            throw new BusinessRunTimeException(400, "修改需要 materialId 或 barCode");
        }
        // Forbid barCode/unit mutation fields even if present with same value intent elsewhere.
        if (body.containsKey("unit") && trimToNull(body.getString("unit")) != null
                && body.get("name") == null && body.get("remark") == null
                && body.get("standard") == null && body.get("spec") == null && body.get("brand") == null) {
            // Allow locating-only; unit change attempted below.
        }
        if (body.containsKey("newBarCode") || body.containsKey("newUnit") || body.containsKey("commodityUnit")) {
            throw new BusinessRunTimeException(400, "本功能禁止修改编码或基础单位");
        }

        List<Map<String, Object>> mats;
        if (materialId != null) {
            mats = jdbcTemplate.queryForList(
                    "SELECT m.id, m.name, m.standard, m.brand, m.remark, m.unit, e.bar_code, e.commodity_unit "
                            + "FROM jsh_material m "
                            + "JOIN jsh_material_extend e ON e.material_id=m.id AND IFNULL(e.delete_flag,'0')<>'1' "
                            + "WHERE m.id=? AND m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' "
                            + "ORDER BY e.default_flag DESC, e.id ASC LIMIT 1",
                    materialId, actor.getTenantId());
        } else {
            mats = jdbcTemplate.queryForList(
                    "SELECT m.id, m.name, m.standard, m.brand, m.remark, m.unit, e.bar_code, e.commodity_unit "
                            + "FROM jsh_material m "
                            + "JOIN jsh_material_extend e ON e.material_id=m.id AND IFNULL(e.delete_flag,'0')<>'1' "
                            + "WHERE e.bar_code=? AND m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' LIMIT 2",
                    barCode, actor.getTenantId());
            if (mats.size() > 1) {
                throw new BusinessRunTimeException(409, "条码对应多条物料，请使用 materialId");
            }
        }
        if (mats.isEmpty()) {
            throw new BusinessRunTimeException(404, "物料不存在");
        }
        Map<String, Object> cur = mats.get(0);
        materialId = ((Number) cur.get("id")).longValue();
        barCode = String.valueOf(cur.get("bar_code"));

        if (body.containsKey("unit") && trimToNull(body.getString("unit")) != null
                && !String.valueOf(cur.get("unit")).equals(trimToNull(body.getString("unit")))) {
            throw new BusinessRunTimeException(400, "本功能禁止修改基础单位");
        }
        if (body.containsKey("barCode") && trimToNull(body.getString("barCode")) != null
                && !barCode.equals(trimToNull(body.getString("barCode")))) {
            throw new BusinessRunTimeException(400, "本功能禁止修改物料编码/条码");
        }

        boolean hasChange = false;
        JSONObject diff = new JSONObject(true);
        JSONObject n = new JSONObject(true);
        n.put("opType", "UPDATE");
        n.put("materialId", materialId);
        n.put("barCode", barCode);

        if (body.containsKey("name")) {
            String name = required(body, "name");
            String old = String.valueOf(cur.get("name"));
            if (!name.equals(old)) {
                diff.put("name", mapOf("old", old, "new", name));
                hasChange = true;
            }
            n.put("name", name);
        }
        if (body.containsKey("standard") || body.containsKey("spec")) {
            String standard = firstNonEmpty(trimToNull(body.getString("standard")), trimToNull(body.getString("spec")));
            String old = cur.get("standard") == null ? null : String.valueOf(cur.get("standard"));
            if ((standard == null && old != null) || (standard != null && !standard.equals(old))) {
                diff.put("standard", mapOf("old", old, "new", standard));
                hasChange = true;
            }
            n.put("standard", standard);
        }
        if (body.containsKey("brand")) {
            String brand = trimToNull(body.getString("brand"));
            String old = cur.get("brand") == null ? null : String.valueOf(cur.get("brand"));
            if ((brand == null && old != null) || (brand != null && !brand.equals(old))) {
                diff.put("brand", mapOf("old", old, "new", brand));
                hasChange = true;
            }
            n.put("brand", brand);
        }
        if (body.containsKey("remark")) {
            String remark = trimToNull(body.getString("remark"));
            if (remark != null && remark.length() > 500) {
                throw new BusinessRunTimeException(400, "备注过长");
            }
            String old = cur.get("remark") == null ? null : String.valueOf(cur.get("remark"));
            if ((remark == null && old != null) || (remark != null && !remark.equals(old))) {
                diff.put("remark", mapOf("old", old, "new", remark));
                hasChange = true;
            }
            n.put("remark", remark);
        }
        if (!hasChange) {
            throw new BusinessRunTimeException(400, "没有可更新的白名单字段变更");
        }
        n.put("diff", diff);
        NormalizedUpdate out = new NormalizedUpdate();
        out.payload = n;
        out.materialId = materialId;
        out.barCode = barCode;
        out.recordDigest = digestOfMaterial(cur);
        return out;
    }

    private Map<String, Object> loadMaterialView(long tenantId, long materialId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT m.id AS materialId, m.name, m.standard, m.brand, m.remark, m.unit, m.category_id AS categoryId, "
                        + "c.name AS categoryName, e.bar_code AS barCode, e.commodity_unit AS commodityUnit, e.sku, "
                        + "e.id AS materialExtendId, m.tenant_id AS tenantId "
                        + "FROM jsh_material m "
                        + "JOIN jsh_material_extend e ON e.material_id=m.id AND IFNULL(e.delete_flag,'0')<>'1' "
                        + "LEFT JOIN jsh_material_category c ON c.id=m.category_id AND IFNULL(c.delete_flag,'0')<>'1' "
                        + "WHERE m.id=? AND m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' "
                        + "ORDER BY e.default_flag DESC, e.id ASC LIMIT 1",
                materialId, tenantId);
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(500, "建档后无法读回物料");
        }
        Map<String, Object> view = new LinkedHashMap<String, Object>(rows.get(0));
        Integer initCnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_material_initial_stock WHERE material_id=? AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, materialId);
        Number stockSum = jdbcTemplate.queryForObject(
                "SELECT IFNULL(SUM(current_number),0) FROM jsh_material_current_stock "
                        + "WHERE material_id=? AND IFNULL(delete_flag,'0')<>'1'",
                Number.class, materialId);
        view.put("initialStockRows", initCnt == null ? 0 : initCnt);
        view.put("currentStockTotal", stockSum == null ? 0 : stockSum);
        return view;
    }

    private List<Map<String, Object>> findNameCandidates(long tenantId, String name, String standard) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT m.id AS materialId, m.name, m.standard, e.bar_code AS barCode, m.unit "
                        + "FROM jsh_material m "
                        + "JOIN jsh_material_extend e ON e.material_id=m.id AND e.default_flag='1' "
                        + "AND IFNULL(e.delete_flag,'0')<>'1' "
                        + "WHERE m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' AND m.name=? "
                        + "LIMIT 5",
                tenantId, name);
        if (rows.isEmpty() && name.length() >= 2) {
            rows = jdbcTemplate.queryForList(
                    "SELECT m.id AS materialId, m.name, m.standard, e.bar_code AS barCode, m.unit "
                            + "FROM jsh_material m "
                            + "JOIN jsh_material_extend e ON e.material_id=m.id AND e.default_flag='1' "
                            + "AND IFNULL(e.delete_flag,'0')<>'1' "
                            + "WHERE m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' AND m.name LIKE ? "
                            + "LIMIT 5",
                    tenantId, "%" + name + "%");
        }
        if (standard != null && !rows.isEmpty()) {
            List<Map<String, Object>> filtered = new ArrayList<Map<String, Object>>();
            for (Map<String, Object> r : rows) {
                Object st = r.get("standard");
                if (st == null || standard.equals(String.valueOf(st)) || String.valueOf(st).contains(standard)) {
                    filtered.add(r);
                }
            }
            if (!filtered.isEmpty()) {
                return filtered;
            }
        }
        return rows;
    }

    private Long resolveCategoryId(long tenantId, JSONObject body) {
        Long categoryId = body.getLong("categoryId");
        String categoryName = trimToNull(body.getString("categoryName"));
        if (categoryId != null) {
            return categoryId;
        }
        if (categoryName == null) {
            List<Map<String, Object>> cats = listCategories(tenantId);
            if (cats.isEmpty()) {
                return null;
            }
            Map<String, Object> err = new LinkedHashMap<String, Object>();
            err.put("message", "请选择已有物料类别（categoryId 或 categoryName）");
            err.put("categories", cats);
            throw new BusinessRunTimeException(400, JSON.toJSONString(err));
        }
        List<Map<String, Object>> found = jdbcTemplate.queryForList(
                "SELECT id, name FROM jsh_material_category WHERE tenant_id=? AND name=? "
                        + "AND IFNULL(delete_flag,'0')<>'1' LIMIT 2",
                tenantId, categoryName);
        if (found.isEmpty()) {
            Map<String, Object> err = new LinkedHashMap<String, Object>();
            err.put("message", "类别不存在，请从已有类别中选择");
            err.put("categories", listCategories(tenantId));
            throw new BusinessRunTimeException(400, JSON.toJSONString(err));
        }
        if (found.size() > 1) {
            throw new BusinessRunTimeException(409, "类别名称不唯一，请传 categoryId");
        }
        return ((Number) found.get(0).get("id")).longValue();
    }

    private List<Map<String, Object>> listCategories(long tenantId) {
        return jdbcTemplate.queryForList(
                "SELECT id AS categoryId, name AS categoryName FROM jsh_material_category "
                        + "WHERE tenant_id=? AND IFNULL(delete_flag,'0')<>'1' ORDER BY id ASC LIMIT 50",
                tenantId);
    }

    private void assertCategoryExists(long tenantId, Long categoryId) {
        if (categoryId == null) {
            return;
        }
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_material_category WHERE id=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, categoryId, tenantId);
        if (n == null || n < 1) {
            Map<String, Object> err = new LinkedHashMap<String, Object>();
            err.put("message", "类别不存在或不属于当前租户");
            err.put("categories", listCategories(tenantId));
            throw new BusinessRunTimeException(400, JSON.toJSONString(err));
        }
    }

    private String loadCategoryName(long tenantId, long categoryId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT name FROM jsh_material_category WHERE id=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                categoryId, tenantId);
        return rows.isEmpty() ? null : String.valueOf(rows.get(0).get("name"));
    }

    private void assertUnitExists(long tenantId, String unit) {
        Integer fromMaterial = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_material WHERE tenant_id=? AND unit=? AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, tenantId, unit);
        if (fromMaterial != null && fromMaterial > 0) {
            return;
        }
        Integer fromExtend = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_material_extend WHERE tenant_id=? AND commodity_unit=? "
                        + "AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, tenantId, unit);
        if (fromExtend != null && fromExtend > 0) {
            return;
        }
        Integer fromUnit = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_unit WHERE tenant_id=? AND IFNULL(delete_flag,'0')<>'1' "
                        + "AND (basic_unit=? OR other_unit=? OR other_unit_two=? OR other_unit_three=?)",
                Integer.class, tenantId, unit, unit, unit, unit);
        if (fromUnit != null && fromUnit > 0) {
            return;
        }
        List<String> samples = jdbcTemplate.queryForList(
                "SELECT DISTINCT unit FROM jsh_material WHERE tenant_id=? AND IFNULL(delete_flag,'0')<>'1' "
                        + "AND unit IS NOT NULL AND unit<>'' LIMIT 20",
                String.class, tenantId);
        throw new BusinessRunTimeException(400, "单位不在当前租户已有单位中，可选: " + samples);
    }

    private void assertBarCodeUnique(long tenantId, String barCode, Long excludeMaterialId) {
        List<Object> args = new ArrayList<Object>();
        String sql = "SELECT COUNT(*) FROM jsh_material_extend e "
                + "JOIN jsh_material m ON m.id=e.material_id AND m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' "
                + "WHERE e.bar_code=? AND e.tenant_id=? AND IFNULL(e.delete_flag,'0')<>'1'";
        args.add(tenantId);
        args.add(barCode);
        args.add(tenantId);
        if (excludeMaterialId != null) {
            sql += " AND e.material_id<>?";
            args.add(excludeMaterialId);
        }
        Integer n = jdbcTemplate.queryForObject(sql, Integer.class, args.toArray());
        if (n != null && n > 0) {
            throw new BusinessRunTimeException(409, "条码已存在: " + barCode);
        }
    }

    /**
     * Enforce native ERP「商品信息」RoleFunctions (funId=23) for create/update.
     * Stock-read-only / sales roles without material-master must fail prepare and commit.
     */
    private void assertMaterialPermission(User user, String op) {
        String action = "CREATE".equals(op) ? "新建商品信息" : "修改商品信息";
        List<Long> roles = roleIds(user);
        if (roles.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有业务角色，拒绝" + action);
        }
        boolean hasFun = false;
        for (Long roleId : roles) {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT `value` FROM jsh_user_business WHERE type='RoleFunctions' AND key_id=? "
                            + "AND IFNULL(delete_flag,'0')<>'1'",
                    String.valueOf(roleId));
            for (Map<String, Object> row : rows) {
                String value = row.get("value") == null ? "" : String.valueOf(row.get("value"));
                if (value.contains("[" + FUN_MATERIAL + "]")) {
                    hasFun = true;
                    break;
                }
            }
            if (hasFun) {
                break;
            }
        }
        if (!hasFun) {
            throw new BusinessRunTimeException(403, "当前角色无权" + action + "（需要商品信息权限）");
        }
    }

    private List<Long> roleIds(User user) {
        List<String> values = jdbcTemplate.query(
                "SELECT `value` FROM jsh_user_business WHERE type='UserRole' AND key_id=? "
                        + "AND IFNULL(delete_flag,'0')<>'1'",
                (rs, i) -> rs.getString(1), String.valueOf(user.getId()));
        List<Long> ids = new ArrayList<Long>();
        for (String value : values) {
            if (value == null || value.isEmpty()) {
                continue;
            }
            Matcher m = Pattern.compile("\\[(\\d+)]").matcher(value);
            while (m.find()) {
                ids.add(Long.parseLong(m.group(1)));
            }
        }
        return ids;
    }

    private static String normalizeSku(String raw) {
        String sku = trimToNull(raw);
        if (sku == null) {
            return null;
        }
        if (sku.length() > 50) {
            throw new BusinessRunTimeException(400, "SKU 过长（最多 50）");
        }
        if (!sku.matches("^[A-Za-z0-9._\\-]{1,50}$")) {
            throw new BusinessRunTimeException(400, "SKU 格式无效");
        }
        return sku;
    }

    /** SKU is optional metadata on MaterialExtend; must not collide with a different barcode's sku. */
    private void assertSkuSemantics(long tenantId, String sku, String barCode, Long excludeMaterialId) {
        List<Object> args = new ArrayList<Object>();
        String sql = "SELECT e.bar_code FROM jsh_material_extend e "
                + "JOIN jsh_material m ON m.id=e.material_id AND m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' "
                + "WHERE e.sku=? AND e.tenant_id=? AND IFNULL(e.delete_flag,'0')<>'1'";
        args.add(tenantId);
        args.add(sku);
        args.add(tenantId);
        if (excludeMaterialId != null) {
            sql += " AND e.material_id<>?";
            args.add(excludeMaterialId);
        }
        sql += " LIMIT 5";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, args.toArray());
        for (Map<String, Object> row : rows) {
            String existingBar = row.get("bar_code") == null ? "" : String.valueOf(row.get("bar_code"));
            if (!existingBar.equals(barCode)) {
                throw new BusinessRunTimeException(409, "SKU 已用于其他条码: " + existingBar);
            }
        }
    }

    private static String barcodeLockName(long tenantId, String barCode) {
        // MySQL GET_LOCK name max 64 chars.
        String raw = "aierp_mat_bc_" + tenantId + "_" + barCode;
        if (raw.length() <= 64) {
            return raw;
        }
        return "aierp_mat_bc_" + tenantId + "_" + sha256Hex(barCode).substring(0, 24);
    }

    private void rejectForbiddenFields(JSONObject body) {
        if (body == null) {
            return;
        }
        for (String key : body.keySet()) {
            if (FORBIDDEN_STOCK_KEYS.contains(key)
                    || FORBIDDEN_STOCK_KEYS.contains(key.toLowerCase(Locale.ROOT))) {
                throw new BusinessRunTimeException(400,
                        "主数据接口拒绝库存字段「" + key + "」，请走采购/盘点等独立流程");
            }
        }
        // Soft-warn unknown keys for create/update payloads (ignore identity/meta).
        String op = trimToNull(body.getString("opType"));
        Set<String> allowed = "UPDATE".equalsIgnoreCase(op) ? UPDATE_WHITELIST : CREATE_WHITELIST;
        if (op != null) {
            for (String key : body.keySet()) {
                if (!allowed.contains(key) && !FORBIDDEN_STOCK_KEYS.contains(key)) {
                    // Ignore unknown non-stock keys quietly except dangerous ones already handled.
                }
            }
        }
    }

    private static String buildSummaryZh(String opType, JSONObject n) {
        if ("CREATE".equals(opType)) {
            StringBuilder sb = new StringBuilder();
            sb.append("新增原料 ").append(n.getString("name"))
                    .append("｜编码 ").append(n.getString("barCode"))
                    .append("｜单位 ").append(n.getString("unit"));
            if (n.getString("categoryName") != null) {
                sb.append("｜分类 ").append(n.getString("categoryName"));
            }
            if (n.getString("standard") != null) {
                sb.append("｜规格 ").append(n.getString("standard"));
            }
            if (n.getString("brand") != null) {
                sb.append("｜品牌 ").append(n.getString("brand"));
            }
            if (n.getString("remark") != null) {
                sb.append("｜备注 ").append(n.getString("remark"));
            }
            sb.append("（建档后库存为 0）");
            return sb.toString();
        }
        StringBuilder sb = new StringBuilder("修改物料 ").append(n.getString("barCode"));
        JSONObject diff = n.getJSONObject("diff");
        if (diff != null) {
            for (String k : diff.keySet()) {
                JSONObject d = diff.getJSONObject(k);
                sb.append("｜").append(k).append(" ")
                        .append(d.get("old")).append(" → ").append(d.get("new"));
            }
        }
        return sb.toString();
    }

    private static String digestOfMaterial(Map<String, Object> cur) {
        String raw = String.valueOf(cur.get("id")) + "|"
                + nullToEmpty(cur.get("name")) + "|"
                + nullToEmpty(cur.get("standard")) + "|"
                + nullToEmpty(cur.get("brand")) + "|"
                + nullToEmpty(cur.get("remark")) + "|"
                + nullToEmpty(cur.get("unit")) + "|"
                + nullToEmpty(cur.get("bar_code"));
        return sha256Hex(raw);
    }

    private static String normalizeOpType(String raw) {
        String op = trimToNull(raw);
        if (op == null) {
            throw new BusinessRunTimeException(400, "缺少 opType（CREATE|UPDATE）");
        }
        op = op.toUpperCase(Locale.ROOT);
        if ("CREATE".equals(op) || "ADD".equals(op) || "INSERT".equals(op)) {
            return "CREATE";
        }
        if ("UPDATE".equals(op) || "EDIT".equals(op) || "MODIFY".equals(op)) {
            return "UPDATE";
        }
        throw new BusinessRunTimeException(400, "opType 仅支持 CREATE 或 UPDATE");
    }

    private static ParsedMasterConfirm parseConfirm(String text) {
        ParsedMasterConfirm out = new ParsedMasterConfirm();
        if (text == null) {
            return out;
        }
        String t = text.trim();
        out.rawText = t;
        Matcher m = CONFIRM_CREATE.matcher(t);
        if (m.matches()) {
            out.confirm = true;
            out.requestId = Long.parseLong(m.group(1));
            out.opType = "CREATE";
            return out;
        }
        m = CONFIRM_UPDATE.matcher(t);
        if (m.matches()) {
            out.confirm = true;
            out.requestId = Long.parseLong(m.group(1));
            out.opType = "UPDATE";
            return out;
        }
        return out;
    }

    private static long bindingVersionOf(Map<String, Object> binding) {
        long v = binding.get("binding_version") == null ? 0L : ((Number) binding.get("binding_version")).longValue();
        return v < 1L ? 1L : v;
    }

    private static String required(JSONObject body, String field) {
        String v = trimToNull(body.getString(field));
        if (v == null) {
            throw new BusinessRunTimeException(400, "缺少必填字段 " + field);
        }
        return v;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) {
            return null;
        }
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) {
                return v.trim();
            }
        }
        return null;
    }

    private static String nullToEmpty(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static Map<String, Object> mapOf(String k1, Object v1, String k2, Object v2) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put(k1, v1);
        m.put(k2, v2);
        return m;
    }

    private static String randomToken(int bytes) {
        byte[] buf = new byte[bytes];
        RANDOM.nextBytes(buf);
        StringBuilder sb = new StringBuilder(bytes * 2);
        for (byte b : buf) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] dig = md.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(dig.length * 2);
            for (byte b : dig) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception ex) {
            throw new BusinessRunTimeException(500, "哈希失败");
        }
    }

    private static final class NormalizedUpdate {
        JSONObject payload;
        Long materialId;
        String barCode;
        String recordDigest;
    }

    private static final class ParsedMasterConfirm {
        boolean confirm;
        Long requestId;
        String opType;
        String rawText;
    }
}
