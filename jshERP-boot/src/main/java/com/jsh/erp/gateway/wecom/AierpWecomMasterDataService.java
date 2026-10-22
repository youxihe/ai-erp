package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.service.LogService;
import com.jsh.erp.service.RedisService;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AIERP-021A: WeCom partner (供应商/客户) master-data prepare + trusted commit.
 * Writes use explicit {@link User} actor via JDBC — no fake HttpServletRequest / admin session.
 */
@Service
public class AierpWecomMasterDataService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String CHANNEL = "wecom";
    private static final long REQUEST_TTL_SEC = 420L;
    private static final int REMARK_MAX = 500;
    private static final int NAME_MAX = 100;
    private static final long FUN_PURCHASE = 33L;
    private static final long FUN_SERVICE = 202L;

    private static final List<String> WHITELIST = Collections.unmodifiableList(
            Arrays.asList("name", "contacts", "phone", "address", "remark"));
    private static final List<String> FORBIDDEN = Collections.unmodifiableList(Arrays.asList(
            "bankName", "bank_name", "accountNumber", "account_number", "taxNum", "tax_num",
            "taxRate", "tax_rate", "beginNeedPay", "begin_need_pay", "beginNeedGet", "begin_need_get",
            "advanceIn", "advance_in", "enabled", "deleteFlag", "delete_flag", "isystem",
            "fax", "email", "sort", "allNeedPay", "allNeedGet", "phoneNum", "telephone"));

    private static final Pattern CONFIRM_CREATE = Pattern.compile("^\\s*确认\\s*建档\\s*[：:#＃]?\\s*(\\d+)\\s*$");
    private static final Pattern CONFIRM_UPDATE = Pattern.compile("^\\s*确认\\s*修改\\s*[：:#＃]?\\s*(\\d+)\\s*$");
    private static final Pattern PHONE_OK = Pattern.compile("^[0-9+\\-\\s()]{5,32}$");

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private PlatformTransactionManager transactionManager;
    @Resource
    private LogService logService;
    @Resource
    private RedisService redisService;

    /** Adapter prepare: challenge + digest only; never inserts into jsh_supplier. */
    public Map<String, Object> preparePartner(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        rejectSensitiveKeys(body);
        String op = normalizeOp(body.getString("op"));
        String partnerType = normalizePartnerType(firstNonEmpty(body.getString("type"), body.getString("partnerType")));
        assertPartnerPermission(ctx.user, partnerType, op);

        JSONObject fields = normalizeFields(body, op);
        Long partnerId = null;
        String recordDigest = null;
        Map<String, Object> existing = null;
        List<Map<String, Object>> fieldDiffs = new ArrayList<Map<String, Object>>();

        if ("CREATE".equals(op)) {
            String name = fields.getString("name");
            assertNameAvailable(ctx.user.getTenantId(), name, partnerType, null);
        } else {
            partnerId = requirePartnerId(body);
            existing = loadPartnerRow(ctx.user.getTenantId(), partnerId);
            if (existing == null) {
                throw new BusinessRunTimeException(404, "往来单位不存在或不属于当前租户");
            }
            if (!partnerType.equals(String.valueOf(existing.get("type")))) {
                throw new BusinessRunTimeException(400, "类型与现有记录不一致，禁止跨类型修改");
            }
            if (!isEnabled(existing.get("enabled"))) {
                throw new BusinessRunTimeException(403, "该往来单位已停用，禁止修改");
            }
            if ("客户".equals(partnerType)) {
                assertCustomerVisible(ctx.user, partnerId);
            }
            String newName = fields.containsKey("name") ? fields.getString("name")
                    : nz(existing.get("supplier"));
            if (fields.containsKey("name") && !newName.equals(nz(existing.get("supplier")))) {
                assertNameAvailable(ctx.user.getTenantId(), newName, partnerType, partnerId);
            }
            recordDigest = digestExisting(existing);
            fieldDiffs = buildDiffs(existing, fields);
            if (fieldDiffs.isEmpty()) {
                throw new BusinessRunTimeException(400, "没有可更新的白名单字段变化");
            }
        }

        long bindingId = ((Number) ctx.binding.get("id")).longValue();
        long bindingVersion = bindingVersionOf(ctx.binding);
        String payloadHash = sha256Hex(stablePayloadJson(op, partnerType, partnerId, fields, recordDigest));
        String challengeId = randomToken(16);

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        final Long finalPartnerId = partnerId;
        final String finalDigest = recordDigest;
        Long requestId = tx.execute(status -> {
            supersedePriorPending(ctx, op, partnerType, finalPartnerId);
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime exp = now.plusSeconds(REQUEST_TTL_SEC);
            String phrasePrefix = "CREATE".equals(op) ? "确认建档" : "确认修改";
            // phrase filled after insert with auto id
            KeyHolder keys = new GeneratedKeyHolder();
            jdbcTemplate.update(con -> {
                PreparedStatement ps = con.prepareStatement(
                        "INSERT INTO aierp_master_partner_request ("
                                + "challenge_id, channel, bot_id, wecom_user_id, tenant_id, erp_user_id, "
                                + "binding_id, binding_version, op_type, partner_type, partner_id, record_digest, "
                                + "payload_json, payload_hash, expected_phrase, status, expires_at, created_at"
                                + ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?)",
                        Statement.RETURN_GENERATED_KEYS);
                int i = 1;
                ps.setString(i++, challengeId);
                ps.setString(i++, CHANNEL);
                ps.setString(i++, ctx.botId);
                ps.setString(i++, ctx.wecomUserId);
                ps.setLong(i++, ctx.user.getTenantId());
                ps.setLong(i++, ctx.user.getId());
                ps.setLong(i++, bindingId);
                ps.setLong(i++, bindingVersion);
                ps.setString(i++, op);
                ps.setString(i++, partnerType);
                if (finalPartnerId == null) {
                    ps.setObject(i++, null);
                } else {
                    ps.setLong(i++, finalPartnerId);
                }
                ps.setString(i++, finalDigest);
                ps.setString(i++, fields.toJSONString());
                ps.setString(i++, payloadHash);
                ps.setString(i++, phrasePrefix); // temporary; updated below
                ps.setString(i++, TS.format(exp));
                ps.setString(i, TS.format(now));
                return ps;
            }, keys);
            Number key = keys.getKey();
            if (key == null) {
                throw new BusinessRunTimeException(500, "无法创建主数据申请");
            }
            long id = key.longValue();
            String phrase = phrasePrefix + id;
            jdbcTemplate.update(
                    "UPDATE aierp_master_partner_request SET expected_phrase=? WHERE id=?",
                    phrase, id);
            return id;
        });

        Map<String, Object> challenge = new LinkedHashMap<String, Object>();
        challenge.put("requestId", requestId);
        challenge.put("challengeId", challengeId);
        challenge.put("expiresInSec", REQUEST_TTL_SEC);
        String phrase = ("CREATE".equals(op) ? "确认建档" : "确认修改") + requestId;
        challenge.put("phrase", phrase);
        challenge.put("hint", "请本人私聊回复「" + phrase + "」生效；群聊或模型自称确认无效。");

        // Dual store: DB is authority; Redis mirrors challenge for TTL / rebind invalidation lookup.
        cacheChallengeInRedis(challengeId, requestId, ctx, bindingVersion, payloadHash, phrase);

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("nature", "REAL_ERP");
        data.put("op", op);
        data.put("type", partnerType);
        data.put("requestId", requestId);
        data.put("payload", fields);
        data.put("payloadHash", payloadHash);
        data.put("recordDigest", recordDigest);
        data.put("partnerId", partnerId);
        data.put("fieldDiffs", fieldDiffs);
        data.put("summary", buildSummary(op, partnerType, fields, existing, fieldDiffs));
        data.put("challenge", challenge);
        data.put("dbWrite", false);
        data.put("posted", false);
        data.put("stockUnchanged", true);
        data.put("boundErpLoginName", ctx.user.getLoginName());
        data.put("tenantId", ctx.user.getTenantId());
        data.put("hint", challenge.get("hint"));
        return data;
    }

    /**
     * Trusted WeCom before_dispatch commit. LLM self-report / group chat rejected.
     */
    public Map<String, Object> commitPartner(JSONObject body) throws Exception {
        String source = trimToNull(body == null ? null : body.getString("eventSource"));
        if (!"WECOM_BEFORE_DISPATCH".equals(source)) {
            throw new BusinessRunTimeException(403, "确认事件来源必须是 WECOM_BEFORE_DISPATCH");
        }
        if (body != null && (Boolean.TRUE.equals(body.getBoolean("isGroup"))
                || Boolean.TRUE.equals(body.getBoolean("groupChat")))) {
            throw new BusinessRunTimeException(403, "禁止在群聊中确认主数据");
        }
        String rawText = trimToNull(body == null ? null : body.getString("rawText"));
        if (rawText == null) {
            throw new BusinessRunTimeException(400, "缺少 rawText（须为企微原始私聊原文）");
        }
        ParsedConfirm parsed = parseConfirmPhrase(rawText);
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        String messageMsgId = trimToNull(body.getString("messageMsgId"));

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(status -> {
            try {
                return commitInTx(ctx, parsed, messageMsgId);
            } catch (BusinessRunTimeException ex) {
                throw ex;
            } catch (Exception ex) {
                throw new BusinessRunTimeException(500, "主数据确认失败：" + safeMsg(ex));
            }
        });
    }

    private Map<String, Object> commitInTx(AierpWecomBindingService.BoundContext ctx,
                                           ParsedConfirm parsed, String messageMsgId) throws Exception {
        if (messageMsgId != null) {
            List<Map<String, Object>> byMsg = jdbcTemplate.queryForList(
                    "SELECT id, status, result_partner_id, op_type, partner_type FROM aierp_master_partner_request "
                            + "WHERE consume_message_id=? LIMIT 1",
                    messageMsgId);
            if (!byMsg.isEmpty()) {
                return alreadyConsumedView(ctx, byMsg.get(0));
            }
        }

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM aierp_master_partner_request WHERE id=? FOR UPDATE",
                parsed.requestId);
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, "申请不存在");
        }
        Map<String, Object> req = rows.get(0);
        if (!CHANNEL.equals(String.valueOf(req.get("channel")))
                || !ctx.botId.equals(String.valueOf(req.get("bot_id")))
                || !ctx.wecomUserId.equals(String.valueOf(req.get("wecom_user_id")))) {
            throw new BusinessRunTimeException(403, "申请与当前企微身份不匹配");
        }
        long reqTenant = ((Number) req.get("tenant_id")).longValue();
        long reqUser = ((Number) req.get("erp_user_id")).longValue();
        if (!ctx.user.getTenantId().equals(reqTenant) || !ctx.user.getId().equals(reqUser)) {
            throw new BusinessRunTimeException(403, "申请与当前绑定 ERP 用户不匹配");
        }
        long liveBindingId = ((Number) ctx.binding.get("id")).longValue();
        long liveBindingVersion = bindingVersionOf(ctx.binding);
        long reqBindingId = ((Number) req.get("binding_id")).longValue();
        long reqBindingVersion = ((Number) req.get("binding_version")).longValue();
        if (liveBindingId != reqBindingId || liveBindingVersion != reqBindingVersion) {
            jdbcTemplate.update(
                    "UPDATE aierp_master_partner_request SET status='CANCELLED' WHERE id=? AND status='PENDING'",
                    parsed.requestId);
            evictChallengeRedis(req.get("challenge_id") == null ? null : String.valueOf(req.get("challenge_id")),
                    parsed.requestId);
            throw new BusinessRunTimeException(403, "绑定已变更，旧申请已失效，请重新准备");
        }

        String status = String.valueOf(req.get("status"));
        if ("CONSUMED".equals(status)) {
            return alreadyConsumedView(ctx, req);
        }
        if (!"PENDING".equals(status)) {
            throw new BusinessRunTimeException(409, "申请状态不可确认：" + status);
        }
        LocalDateTime exp = LocalDateTime.parse(
                String.valueOf(req.get("expires_at")).replace(' ', 'T').substring(0, 19));
        if (LocalDateTime.now().isAfter(exp)) {
            jdbcTemplate.update(
                    "UPDATE aierp_master_partner_request SET status='EXPIRED' WHERE id=?",
                    parsed.requestId);
            throw new BusinessRunTimeException(410, "申请已过期，请重新准备");
        }

        String expected = String.valueOf(req.get("expected_phrase"));
        if (!expected.equals(parsed.phrase)) {
            throw new BusinessRunTimeException(400, "确认原文须为「" + expected + "」");
        }
        String op = String.valueOf(req.get("op_type"));
        if ("CREATE".equals(op) && !"CREATE".equals(parsed.op)) {
            throw new BusinessRunTimeException(400, "该申请需回复「确认建档" + parsed.requestId + "」");
        }
        if ("UPDATE".equals(op) && !"UPDATE".equals(parsed.op)) {
            throw new BusinessRunTimeException(400, "该申请需回复「确认修改" + parsed.requestId + "」");
        }

        String partnerType = String.valueOf(req.get("partner_type"));
        assertPartnerPermission(ctx.user, partnerType, op);
        JSONObject fields = JSON.parseObject(String.valueOf(req.get("payload_json")));
        String payloadHash = sha256Hex(stablePayloadJson(op, partnerType,
                req.get("partner_id") == null ? null : ((Number) req.get("partner_id")).longValue(),
                fields,
                req.get("record_digest") == null ? null : String.valueOf(req.get("record_digest"))));
        if (!payloadHash.equals(String.valueOf(req.get("payload_hash")))) {
            throw new BusinessRunTimeException(409, "申请数据摘要不匹配，请重新准备");
        }

        Long resultId;
        List<Map<String, Object>> appliedDiffs = new ArrayList<Map<String, Object>>();
        if ("CREATE".equals(op)) {
            resultId = createPartnerAs(ctx.user, partnerType, fields);
        } else {
            long partnerId = ((Number) req.get("partner_id")).longValue();
            String expectedDigest = req.get("record_digest") == null ? null
                    : String.valueOf(req.get("record_digest"));
            Map<String, Object> updated = updatePartnerAs(ctx.user, partnerId, partnerType, fields, expectedDigest);
            resultId = partnerId;
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> diffs = (List<Map<String, Object>>) updated.get("fieldDiffs");
            if (diffs != null) {
                appliedDiffs = diffs;
            }
        }

        int consumed = jdbcTemplate.update(
                "UPDATE aierp_master_partner_request SET status='CONSUMED', consumed_at=?, "
                        + "consume_message_id=?, result_partner_id=? WHERE id=? AND status='PENDING'",
                TS.format(LocalDateTime.now()),
                messageMsgId,
                resultId,
                parsed.requestId);
        if (consumed != 1) {
            throw new BusinessRunTimeException(409, "申请确认冲突，请重试");
        }
        evictChallengeRedis(req.get("challenge_id") == null ? null : String.valueOf(req.get("challenge_id")),
                parsed.requestId);

        Map<String, Object> saved = loadPartnerRow(ctx.user.getTenantId(), resultId);
        if (saved == null) {
            throw new BusinessRunTimeException(500, "写入后未能读回往来单位记录");
        }
        try {
            logService.insertLogWithUserId(ctx.user.getId(), ctx.user.getTenantId(), "往来单位",
                    ("CREATE".equals(op) ? "企微建档" : "企微修改") + partnerType + ":" + nz(saved.get("supplier"))
                            + "(id=" + resultId + ")",
                    null);
        } catch (Exception ignore) {
            // audit best-effort
        }

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("nature", "REAL_ERP");
        data.put("op", op);
        data.put("status", "CONSUMED");
        data.put("requestId", parsed.requestId);
        data.put("partnerId", resultId);
        data.put("type", partnerType);
        data.put("name", nz(saved.get("supplier")));
        data.put("contacts", nz(saved.get("contacts")));
        data.put("phone", phoneOf(saved));
        data.put("address", nz(saved.get("address")));
        data.put("remark", nz(saved.get("description")));
        data.put("fieldDiffs", appliedDiffs.isEmpty() && "CREATE".equals(op)
                ? Collections.emptyList() : appliedDiffs);
        data.put("creator", saved.get("creator"));
        data.put("tenantId", saved.get("tenant_id"));
        data.put("boundErpLoginName", ctx.user.getLoginName());
        data.put("posted", false);
        data.put("stockUnchanged", true);
        data.put("purchasePosted", false);
        data.put("servicePosted", false);
        data.put("hint", "CREATE".equals(op)
                ? (partnerType + "已建档，ID=" + resultId + "。可用于采购/服务选择；未过账。")
                : (partnerType + "已更新，ID=" + resultId + "。敏感财务字段未改；未过账。"));
        return data;
    }

    /**
     * Explicit-actor create into jsh_supplier. No HttpServletRequest.
     */
    public Long createPartnerAs(User actor, String partnerType, JSONObject fields) throws Exception {
        if (actor == null || actor.getId() == null || actor.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少明确 ERP 操作者");
        }
        partnerType = normalizePartnerType(partnerType);
        assertPartnerPermission(actor, partnerType, "CREATE");
        JSONObject normalized = normalizeFields(fields, "CREATE");
        String name = normalized.getString("name");
        assertNameAvailable(actor.getTenantId(), name, partnerType, null);

        KeyHolder keys = new GeneratedKeyHolder();
        final String typeFinal = partnerType;
        jdbcTemplate.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO jsh_supplier ("
                            + "supplier, contacts, phone_num, address, description, type, enabled, "
                            + "creator, tenant_id, delete_flag, begin_need_pay, begin_need_get, advance_in"
                            + ") VALUES (?,?,?,?,?,?, b'1', ?, ?, '0', 0, 0, 0)",
                    Statement.RETURN_GENERATED_KEYS);
            int i = 1;
            ps.setString(i++, name);
            ps.setString(i++, normalized.getString("contacts"));
            ps.setString(i++, normalized.getString("phone"));
            ps.setString(i++, normalized.getString("address"));
            ps.setString(i++, normalized.getString("remark"));
            ps.setString(i++, typeFinal);
            ps.setLong(i++, actor.getId());
            ps.setLong(i, actor.getTenantId());
            return ps;
        }, keys);
        Number key = keys.getKey();
        if (key == null) {
            throw new BusinessRunTimeException(500, "建档写入失败");
        }
        long id = key.longValue();
        Map<String, Object> saved = loadPartnerRow(actor.getTenantId(), id);
        if (saved == null || !name.equals(nz(saved.get("supplier")))
                || !typeFinal.equals(String.valueOf(saved.get("type")))
                || !actor.getId().equals(((Number) saved.get("creator")).longValue())) {
            throw new BusinessRunTimeException(500, "建档后事实校验失败");
        }
        if ("客户".equals(typeFinal)) {
            grantCustomerPermission(actor, id);
        }
        return id;
    }

    /**
     * Explicit-actor whitelist partial update. Rejects optimistic concurrency conflicts.
     */
    public Map<String, Object> updatePartnerAs(User actor, long partnerId, String partnerType,
                                               JSONObject fields, String expectedRecordDigest) throws Exception {
        if (actor == null || actor.getId() == null || actor.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少明确 ERP 操作者");
        }
        partnerType = normalizePartnerType(partnerType);
        assertPartnerPermission(actor, partnerType, "UPDATE");
        Map<String, Object> existing = loadPartnerRow(actor.getTenantId(), partnerId);
        if (existing == null) {
            throw new BusinessRunTimeException(404, "往来单位不存在或不属于当前租户");
        }
        if (!partnerType.equals(String.valueOf(existing.get("type")))) {
            throw new BusinessRunTimeException(400, "禁止跨类型修改");
        }
        if (!isEnabled(existing.get("enabled"))) {
            throw new BusinessRunTimeException(403, "该往来单位已停用，禁止修改");
        }
        if ("客户".equals(partnerType)) {
            assertCustomerVisible(actor, partnerId);
        }
        String liveDigest = digestExisting(existing);
        if (expectedRecordDigest != null && !expectedRecordDigest.equals(liveDigest)) {
            throw new BusinessRunTimeException(409, "记录已被他人修改，请重新准备后确认");
        }

        JSONObject patch = normalizeFields(fields, "UPDATE");
        if (patch.containsKey("name")) {
            assertNameAvailable(actor.getTenantId(), patch.getString("name"), partnerType, partnerId);
        }
        List<Map<String, Object>> diffs = buildDiffs(existing, patch);
        if (diffs.isEmpty()) {
            throw new BusinessRunTimeException(400, "没有可更新的白名单字段变化");
        }

        // Snapshot sensitive fields before update for post-check.
        String bankBefore = nz(existing.get("bank_name"));
        String acctBefore = nz(existing.get("account_number"));
        String taxBefore = nz(existing.get("tax_num"));
        Object beginPayBefore = existing.get("begin_need_pay");
        Object beginGetBefore = existing.get("begin_need_get");
        Object advanceBefore = existing.get("advance_in");

        StringBuilder sql = new StringBuilder("UPDATE jsh_supplier SET ");
        List<Object> args = new ArrayList<Object>();
        boolean first = true;
        if (patch.containsKey("name")) {
            sql.append("supplier=?");
            args.add(patch.getString("name"));
            first = false;
        }
        if (patch.containsKey("contacts")) {
            if (!first) {
                sql.append(", ");
            }
            sql.append("contacts=?");
            args.add(patch.getString("contacts"));
            first = false;
        }
        if (patch.containsKey("phone")) {
            if (!first) {
                sql.append(", ");
            }
            sql.append("phone_num=?");
            args.add(patch.getString("phone"));
            first = false;
        }
        if (patch.containsKey("address")) {
            if (!first) {
                sql.append(", ");
            }
            sql.append("address=?");
            args.add(patch.getString("address"));
            first = false;
        }
        if (patch.containsKey("remark")) {
            if (!first) {
                sql.append(", ");
            }
            sql.append("description=?");
            args.add(patch.getString("remark"));
        }
        sql.append(" WHERE id=? AND tenant_id=? AND type=? AND IFNULL(delete_flag,'0')<>'1'");
        args.add(partnerId);
        args.add(actor.getTenantId());
        args.add(partnerType);
        int updated = jdbcTemplate.update(sql.toString(), args.toArray());
        if (updated != 1) {
            throw new BusinessRunTimeException(500, "更新写入失败");
        }

        Map<String, Object> saved = loadPartnerRow(actor.getTenantId(), partnerId);
        if (saved == null) {
            throw new BusinessRunTimeException(500, "更新后未能读回记录");
        }
        if (!bankBefore.equals(nz(saved.get("bank_name")))
                || !acctBefore.equals(nz(saved.get("account_number")))
                || !taxBefore.equals(nz(saved.get("tax_num")))
                || !eqDecimal(beginPayBefore, saved.get("begin_need_pay"))
                || !eqDecimal(beginGetBefore, saved.get("begin_need_get"))
                || !eqDecimal(advanceBefore, saved.get("advance_in"))) {
            throw new BusinessRunTimeException(500, "敏感字段被意外改动，已中止");
        }

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("partnerId", partnerId);
        out.put("fieldDiffs", diffs);
        out.put("row", saved);
        return out;
    }

    private Map<String, Object> alreadyConsumedView(AierpWecomBindingService.BoundContext ctx,
                                                    Map<String, Object> req) {
        Object resultId = req.get("result_partner_id");
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("nature", "REAL_ERP");
        data.put("op", req.get("op_type"));
        data.put("status", "CONSUMED");
        data.put("requestId", req.get("id"));
        data.put("partnerId", resultId);
        data.put("type", req.get("partner_type"));
        data.put("idempotentReplay", true);
        data.put("posted", false);
        data.put("stockUnchanged", true);
        data.put("boundErpLoginName", ctx.user.getLoginName());
        data.put("tenantId", ctx.user.getTenantId());
        data.put("hint", "该确认已处理过，未重复建档/修改。");
        if (resultId != null) {
            Map<String, Object> saved = loadPartnerRow(ctx.user.getTenantId(),
                    ((Number) resultId).longValue());
            if (saved != null) {
                data.put("name", nz(saved.get("supplier")));
                data.put("contacts", nz(saved.get("contacts")));
                data.put("phone", phoneOf(saved));
            }
        }
        return data;
    }

    private void cacheChallengeInRedis(String challengeId, Long requestId,
                                       AierpWecomBindingService.BoundContext ctx,
                                       long bindingVersion, String payloadHash, String phrase) {
        try {
            JSONObject cache = new JSONObject(true);
            cache.put("requestId", requestId);
            cache.put("challengeId", challengeId);
            cache.put("botId", ctx.botId);
            cache.put("wecomUserId", ctx.wecomUserId);
            cache.put("erpUserId", ctx.user.getId());
            cache.put("tenantId", ctx.user.getTenantId());
            cache.put("bindingId", ((Number) ctx.binding.get("id")).longValue());
            cache.put("bindingVersion", bindingVersion);
            cache.put("payloadHash", payloadHash);
            cache.put("phrase", phrase);
            String json = cache.toJSONString();
            redisService.storageKeyWithTime(redisKeyChallenge(challengeId), json, REQUEST_TTL_SEC);
            redisService.storageKeyWithTime(redisKeyRequest(requestId), json, REQUEST_TTL_SEC);
        } catch (Exception ignore) {
            // Redis is a mirror; DB row remains authoritative.
        }
    }

    private void evictChallengeRedis(String challengeId, long requestId) {
        try {
            if (challengeId != null && !challengeId.isEmpty()) {
                redisService.deleteObject(redisKeyChallenge(challengeId));
            }
            redisService.deleteObject(redisKeyRequest(requestId));
        } catch (Exception ignore) {
            // best-effort
        }
    }

    private static String redisKeyChallenge(String challengeId) {
        return "aierp:master:partner:challenge:" + challengeId;
    }

    private static String redisKeyRequest(long requestId) {
        return "aierp:master:partner:request:" + requestId;
    }

    private void supersedePriorPending(AierpWecomBindingService.BoundContext ctx,
                                       String op, String partnerType, Long partnerId) {
        if ("CREATE".equals(op)) {
            jdbcTemplate.update(
                    "UPDATE aierp_master_partner_request SET status='SUPERSEDED' "
                            + "WHERE channel=? AND bot_id=? AND wecom_user_id=? AND erp_user_id=? "
                            + "AND op_type='CREATE' AND partner_type=? AND status='PENDING'",
                    CHANNEL, ctx.botId, ctx.wecomUserId, ctx.user.getId(), partnerType);
        } else if (partnerId != null) {
            jdbcTemplate.update(
                    "UPDATE aierp_master_partner_request SET status='SUPERSEDED' "
                            + "WHERE channel=? AND bot_id=? AND wecom_user_id=? AND erp_user_id=? "
                            + "AND op_type='UPDATE' AND partner_id=? AND status='PENDING'",
                    CHANNEL, ctx.botId, ctx.wecomUserId, ctx.user.getId(), partnerId);
        }
    }

    private void grantCustomerPermission(User actor, long customerId) {
        String ubKey = "[" + customerId + "]";
        appendUserCustomer(actor.getId(), ubKey);
        if (actor.getTenantId() != null && !actor.getId().equals(actor.getTenantId())) {
            appendUserCustomer(actor.getTenantId(), ubKey);
        }
    }

    private void appendUserCustomer(Long userId, String ubKey) {
        List<Map<String, Object>> ubList = jdbcTemplate.queryForList(
                "SELECT id, `value` FROM jsh_user_business WHERE type='UserCustomer' AND key_id=? "
                        + "AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                String.valueOf(userId));
        if (ubList.isEmpty()) {
            jdbcTemplate.update(
                    "INSERT INTO jsh_user_business (type, key_id, `value`, delete_flag) VALUES ('UserCustomer',?,?, '0')",
                    String.valueOf(userId), ubKey);
        } else {
            String value = ubList.get(0).get("value") == null ? "" : String.valueOf(ubList.get(0).get("value"));
            if (!value.contains(ubKey)) {
                jdbcTemplate.update(
                        "UPDATE jsh_user_business SET `value`=? WHERE id=?",
                        value + ubKey, ubList.get(0).get("id"));
            }
        }
    }

    private void assertCustomerVisible(User user, long partnerId) {
        // If tenant has customerFlag-style restriction, require UserCustomer contains id.
        // When no UserCustomer row exists for this user, treat as unrestricted (native empty list UX varies);
        // if a row exists, require membership — matches "不能给所有用户全局权限" for newly created.
        List<Map<String, Object>> ubList = jdbcTemplate.queryForList(
                "SELECT `value` FROM jsh_user_business WHERE type='UserCustomer' AND key_id=? "
                        + "AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                String.valueOf(user.getId()));
        if (ubList.isEmpty()) {
            return;
        }
        String value = ubList.get(0).get("value") == null ? "" : String.valueOf(ubList.get(0).get("value"));
        if (!value.contains("[" + partnerId + "]")) {
            throw new BusinessRunTimeException(403, "当前用户无权修改该客户");
        }
    }

    private void assertPartnerPermission(User user, String partnerType, String op) {
        long funId = "供应商".equals(partnerType) ? FUN_PURCHASE : FUN_SERVICE;
        String action = ("CREATE".equals(op) ? "新建" : "修改") + partnerType;
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
                if (value.contains("[" + funId + "]")) {
                    hasFun = true;
                    break;
                }
            }
            if (hasFun) {
                break;
            }
        }
        if (!hasFun) {
            throw new BusinessRunTimeException(403, "当前角色无权" + action);
        }
    }

    private List<Long> roleIds(User user) {
        List<String> values = jdbcTemplate.query(
                "SELECT `value` FROM jsh_user_business WHERE type='UserRole' AND key_id=? "
                        + "AND IFNULL(delete_flag,'0')<>'1'",
                (rs, i) -> rs.getString(1), String.valueOf(user.getId()));
        List<Long> ids = new ArrayList<Long>();
        for (String value : values) {
            if (value == null) {
                continue;
            }
            Matcher m = Pattern.compile("\\[(\\d+)\\]").matcher(value);
            while (m.find()) {
                ids.add(Long.valueOf(m.group(1)));
            }
        }
        return ids;
    }

    private void assertNameAvailable(long tenantId, String name, String type, Long excludeId) {
        List<Object> args = new ArrayList<Object>();
        String sql = "SELECT id FROM jsh_supplier WHERE tenant_id=? AND type=? AND supplier=? "
                + "AND IFNULL(delete_flag,'0')<>'1'";
        args.add(tenantId);
        args.add(type);
        args.add(name);
        if (excludeId != null) {
            sql += " AND id<>?";
            args.add(excludeId);
        }
        sql += " LIMIT 1";
        List<Map<String, Object>> hits = jdbcTemplate.queryForList(sql, args.toArray());
        if (!hits.isEmpty()) {
            throw new BusinessRunTimeException(409, "同类型名称已存在：" + name);
        }
    }

    private Map<String, Object> loadPartnerRow(long tenantId, long id) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, supplier, contacts, telephone, phone_num, address, description, type, enabled, "
                        + "bank_name, account_number, tax_num, begin_need_pay, begin_need_get, advance_in, "
                        + "creator, tenant_id, delete_flag "
                        + "FROM jsh_supplier WHERE id=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                id, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private JSONObject normalizeFields(JSONObject body, String op) {
        JSONObject src = body;
        if (body != null && body.get("fields") instanceof Map) {
            src = new JSONObject(true);
            src.putAll(body.getJSONObject("fields"));
        }
        if (src == null) {
            src = new JSONObject(true);
        }
        rejectSensitiveKeys(src);
        JSONObject out = new JSONObject(true);
        for (String key : WHITELIST) {
            if (!src.containsKey(key) && !"name".equals(key)) {
                // alias: supplier -> name, description -> remark
                continue;
            }
            String raw;
            if (src.containsKey(key)) {
                raw = trimToNull(src.getString(key));
            } else {
                raw = null;
            }
            if (raw == null && "name".equals(key)) {
                raw = trimToNull(src.getString("supplier"));
            }
            if (raw == null && "remark".equals(key)) {
                raw = trimToNull(src.getString("description"));
            }
            if (raw == null) {
                if ("CREATE".equals(op) && "name".equals(key)) {
                    throw new BusinessRunTimeException(400, "名称必填");
                }
                continue;
            }
            if ("name".equals(key)) {
                if (raw.length() > NAME_MAX) {
                    throw new BusinessRunTimeException(400, "名称过长");
                }
                out.put("name", raw);
            } else if ("phone".equals(key)) {
                if (!PHONE_OK.matcher(raw).matches()) {
                    throw new BusinessRunTimeException(400, "电话格式无效");
                }
                out.put("phone", raw);
            } else if ("remark".equals(key)) {
                if (raw.length() > REMARK_MAX) {
                    throw new BusinessRunTimeException(400, "备注过长（最多" + REMARK_MAX + "字）");
                }
                out.put("remark", raw);
            } else if ("contacts".equals(key)) {
                if (raw.length() > 64) {
                    throw new BusinessRunTimeException(400, "联系人过长");
                }
                out.put("contacts", raw);
            } else if ("address".equals(key)) {
                if (raw.length() > 200) {
                    throw new BusinessRunTimeException(400, "地址过长");
                }
                out.put("address", raw);
            }
        }
        if ("CREATE".equals(op) && trimToNull(out.getString("name")) == null) {
            throw new BusinessRunTimeException(400, "名称必填");
        }
        if ("UPDATE".equals(op) && out.isEmpty()) {
            throw new BusinessRunTimeException(400, "更新至少需要一个白名单字段");
        }
        // CREATE: ensure optional keys present as empty string for stable digest / DB null-safe
        if ("CREATE".equals(op)) {
            if (!out.containsKey("contacts")) {
                out.put("contacts", "");
            }
            if (!out.containsKey("phone")) {
                out.put("phone", "");
            }
            if (!out.containsKey("address")) {
                out.put("address", "");
            }
            if (!out.containsKey("remark")) {
                out.put("remark", "");
            }
        }
        return out;
    }

    private void rejectSensitiveKeys(JSONObject obj) {
        if (obj == null) {
            return;
        }
        for (String banned : FORBIDDEN) {
            if (obj.containsKey(banned) && obj.get(banned) != null
                    && String.valueOf(obj.get(banned)).trim().length() > 0) {
                throw new BusinessRunTimeException(400, "禁止经聊天写入敏感字段：" + banned);
            }
        }
        if (obj.get("fields") instanceof Map) {
            rejectSensitiveKeys(obj.getJSONObject("fields"));
        }
    }

    private List<Map<String, Object>> buildDiffs(Map<String, Object> existing, JSONObject patch) {
        List<Map<String, Object>> diffs = new ArrayList<Map<String, Object>>();
        addDiff(diffs, "name", nz(existing.get("supplier")), patch.getString("name"));
        addDiff(diffs, "contacts", nz(existing.get("contacts")), patch.getString("contacts"));
        addDiff(diffs, "phone", phoneOf(existing), patch.getString("phone"));
        addDiff(diffs, "address", nz(existing.get("address")), patch.getString("address"));
        addDiff(diffs, "remark", nz(existing.get("description")), patch.getString("remark"));
        return diffs;
    }

    private void addDiff(List<Map<String, Object>> diffs, String field, String oldVal, String newVal) {
        if (newVal == null) {
            return;
        }
        String o = oldVal == null ? "" : oldVal;
        if (o.equals(newVal)) {
            return;
        }
        Map<String, Object> d = new LinkedHashMap<String, Object>();
        d.put("field", field);
        d.put("oldValue", o);
        d.put("newValue", newVal);
        diffs.add(d);
    }

    private String buildSummary(String op, String partnerType, JSONObject fields,
                                Map<String, Object> existing, List<Map<String, Object>> diffs) {
        if ("CREATE".equals(op)) {
            return partnerType + "｜名称 " + fields.getString("name")
                    + "｜联系人 " + emptyDash(fields.getString("contacts"))
                    + "｜电话 " + emptyDash(fields.getString("phone"))
                    + "｜地址 " + emptyDash(fields.getString("address"));
        }
        StringBuilder sb = new StringBuilder();
        sb.append("修改").append(partnerType).append("「")
                .append(existing == null ? "?" : nz(existing.get("supplier"))).append("」：");
        for (int i = 0; i < diffs.size(); i++) {
            Map<String, Object> d = diffs.get(i);
            if (i > 0) {
                sb.append("；");
            }
            sb.append(d.get("field")).append(" ")
                    .append(emptyDash(String.valueOf(d.get("oldValue"))))
                    .append("→")
                    .append(emptyDash(String.valueOf(d.get("newValue"))));
        }
        return sb.toString();
    }

    private String digestExisting(Map<String, Object> row) {
        JSONObject snap = new JSONObject(true);
        snap.put("id", row.get("id"));
        snap.put("type", row.get("type"));
        snap.put("name", nz(row.get("supplier")));
        snap.put("contacts", nz(row.get("contacts")));
        snap.put("phone", phoneOf(row));
        snap.put("address", nz(row.get("address")));
        snap.put("remark", nz(row.get("description")));
        snap.put("bank_name", nz(row.get("bank_name")));
        snap.put("account_number", nz(row.get("account_number")));
        snap.put("tax_num", nz(row.get("tax_num")));
        snap.put("begin_need_pay", String.valueOf(row.get("begin_need_pay")));
        snap.put("begin_need_get", String.valueOf(row.get("begin_need_get")));
        snap.put("advance_in", String.valueOf(row.get("advance_in")));
        return sha256Hex(snap.toJSONString());
    }

    private String stablePayloadJson(String op, String partnerType, Long partnerId,
                                     JSONObject fields, String recordDigest) {
        // Canonical key order so prepare hash == commit recompute after DB round-trip.
        JSONObject canonFields = new JSONObject(true);
        if (fields != null) {
            for (String key : WHITELIST) {
                if (fields.containsKey(key)) {
                    canonFields.put(key, fields.get(key));
                }
            }
        }
        JSONObject o = new JSONObject(true);
        o.put("op", op);
        o.put("type", partnerType);
        if (partnerId != null) {
            o.put("partnerId", partnerId);
        }
        if (recordDigest != null && !recordDigest.isEmpty()) {
            o.put("recordDigest", recordDigest);
        }
        o.put("fields", canonFields);
        return o.toJSONString();
    }

    private static ParsedConfirm parseConfirmPhrase(String rawText) {
        Matcher m1 = CONFIRM_CREATE.matcher(rawText);
        if (m1.matches()) {
            ParsedConfirm p = new ParsedConfirm();
            p.op = "CREATE";
            p.requestId = Long.parseLong(m1.group(1));
            p.phrase = "确认建档" + p.requestId;
            return p;
        }
        Matcher m2 = CONFIRM_UPDATE.matcher(rawText);
        if (m2.matches()) {
            ParsedConfirm p = new ParsedConfirm();
            p.op = "UPDATE";
            p.requestId = Long.parseLong(m2.group(1));
            p.phrase = "确认修改" + p.requestId;
            return p;
        }
        throw new BusinessRunTimeException(400, "不是有效的主数据确认指令，请回复「确认建档{申请号}」或「确认修改{申请号}」");
    }

    private static long requirePartnerId(JSONObject body) {
        if (body == null || body.get("partnerId") == null) {
            throw new BusinessRunTimeException(400, "修改须指定 partnerId（ERP 主键）");
        }
        try {
            return Long.parseLong(String.valueOf(body.get("partnerId")).trim());
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "partnerId 无效");
        }
    }

    private static String normalizeOp(String raw) {
        String s = trimToNull(raw);
        if (s == null) {
            throw new BusinessRunTimeException(400, "缺少 op（CREATE|UPDATE）");
        }
        if ("建档".equals(s) || "新增".equals(s)) {
            return "CREATE";
        }
        if ("修改".equals(s)) {
            return "UPDATE";
        }
        String u = s.toUpperCase(Locale.ROOT);
        if ("CREATE".equals(u) || "ADD".equals(u) || "NEW".equals(u)) {
            return "CREATE";
        }
        if ("UPDATE".equals(u) || "EDIT".equals(u) || "MODIFY".equals(u)) {
            return "UPDATE";
        }
        throw new BusinessRunTimeException(400, "op 仅支持 CREATE 或 UPDATE");
    }

    private static String normalizePartnerType(String raw) {
        String s = trimToNull(raw);
        if (s == null) {
            throw new BusinessRunTimeException(400, "缺少 type（供应商|客户）");
        }
        if ("供应商".equals(s) || "SUPPLIER".equalsIgnoreCase(s) || "VENDOR".equalsIgnoreCase(s)) {
            return "供应商";
        }
        if ("客户".equals(s) || "CUSTOMER".equalsIgnoreCase(s) || "CLIENT".equalsIgnoreCase(s)) {
            return "客户";
        }
        throw new BusinessRunTimeException(400, "type 仅支持 供应商 或 客户");
    }

    private static long bindingVersionOf(Map<String, Object> binding) {
        long v = binding.get("binding_version") == null ? 1L
                : ((Number) binding.get("binding_version")).longValue();
        return v < 1L ? 1L : v;
    }

    private static boolean isEnabled(Object enabled) {
        if (enabled == null) {
            return true;
        }
        if (enabled instanceof Boolean) {
            return (Boolean) enabled;
        }
        if (enabled instanceof Number) {
            return ((Number) enabled).intValue() != 0;
        }
        String s = String.valueOf(enabled);
        return !"0".equals(s) && !"false".equalsIgnoreCase(s);
    }

    private static boolean eqDecimal(Object a, Object b) {
        if (a == null && b == null) {
            return true;
        }
        if (a == null || b == null) {
            return String.valueOf(a).equals(String.valueOf(b));
        }
        try {
            return new java.math.BigDecimal(String.valueOf(a))
                    .compareTo(new java.math.BigDecimal(String.valueOf(b))) == 0;
        } catch (Exception ex) {
            return String.valueOf(a).equals(String.valueOf(b));
        }
    }

    /** Prefer 联系电话 phone_num; fall back to telephone for legacy rows. */
    private static String phoneOf(Map<String, Object> row) {
        if (row == null) {
            return "";
        }
        String phoneNum = nz(row.get("phone_num"));
        if (!phoneNum.isEmpty()) {
            return phoneNum;
        }
        return nz(row.get("telephone"));
    }

    private static String firstNonEmpty(String a, String b) {
        String x = trimToNull(a);
        if (x != null) {
            return x;
        }
        return trimToNull(b);
    }

    private static String nz(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }

    private static String emptyDash(String s) {
        return (s == null || s.isEmpty()) ? "-" : s;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static String safeMsg(Exception ex) {
        String m = ex.getMessage();
        if (m == null || m.isEmpty()) {
            return ex.getClass().getSimpleName();
        }
        return m.length() > 120 ? m.substring(0, 120) : m;
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

    private static String sha256Hex(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] dig = md.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(dig.length * 2);
            for (byte b : dig) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception ex) {
            throw new BusinessRunTimeException(500, "摘要计算失败");
        }
    }

    private static final class ParsedConfirm {
        String op;
        long requestId;
        String phrase;
    }
}
