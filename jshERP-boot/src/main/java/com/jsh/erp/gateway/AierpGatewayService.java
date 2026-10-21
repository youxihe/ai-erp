package com.jsh.erp.gateway;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.Depot;
import com.jsh.erp.datasource.entities.Material;
import com.jsh.erp.datasource.entities.MaterialExtend;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.service.DepotHeadService;
import com.jsh.erp.service.DepotItemService;
import com.jsh.erp.service.DepotService;
import com.jsh.erp.service.MaterialExtendService;
import com.jsh.erp.service.MaterialService;
import com.jsh.erp.service.UserService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class AierpGatewayService {

    private static final Pattern DEPOT_ID = Pattern.compile("\\[(\\d+)\\]");
    private static final Pattern CONFIRM_PURCHASE = Pattern.compile(
            "^\\s*确认\\s*采购\\s*[#＃]?\\s*(\\d+)\\s*$");
    private static final Pattern CONFIRM_SIMPLE = Pattern.compile("^\\s*确认\\s*$");
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final long FUN_STOCK = 246L;
    private static final long FUN_PURCHASE = 33L;
    private static final long FUN_MIX = 232L;
    private static final long FUN_SERVICE = 202L;
    private static final String BTN_ADD = "1";
    private static final String BTN_AUDIT = "7";
    private static final long CHALLENGE_TTL_SEC = 420L;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    static final String LOCK_PROBE_REMARK = "AIERP-003 lock-probe";

    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private UserService userService;
    @Resource
    private DepotService depotService;
    @Resource
    private MaterialService materialService;
    @Resource
    private MaterialExtendService materialExtendService;
    @Resource
    private DepotItemService depotItemService;
    @Resource
    private DepotHeadService depotHeadService;
    @Resource
    private PlatformTransactionManager transactionManager;

    public Map<String, Object> stockQuery(JSONObject body, HttpServletRequest request) throws Exception {
        return stockQueryAs(currentUser(), body);
    }

    /**
     * Read-only stock for an explicit ERP user (WeCom delegated identity).
     * Does not use X-Access-Token; caller must already authorize the User.
     */
    public Map<String, Object> stockQueryAs(User user, JSONObject body) throws Exception {
        if (user == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "当前会话没有租户身份");
        }
        assertFunction(user, FUN_STOCK, null, "库存查询");
        String barCode = body == null ? null : trimToNull(body.getString("barCode"));
        String depotName = body == null ? null : trimToNull(body.getString("depotName"));
        String keyword = body == null ? null : firstNonEmpty(
                trimToNull(body.getString("query")),
                trimToNull(body.getString("materialName")));
        if (barCode == null && keyword != null) {
            barCode = resolveBarCodeByKeyword(user, keyword);
        }
        if (barCode == null) {
            // Return all visible stocks for demo materials / keyword miss guidance
            return stockListAs(user, keyword);
        }
        if (depotName == null) {
            return stockAcrossDepots(user, barCode);
        }
        ResolvedLine line = resolveLine(user, barCode, depotName, BigDecimal.ONE, unitOf(barCode), false);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("barCode", line.barCode);
        data.put("materialName", line.materialName);
        data.put("depotId", line.depotId);
        data.put("depotName", line.depotName);
        data.put("unit", line.unit);
        data.put("currentStock", line.stock);
        data.put("tenantId", user.getTenantId());
        data.put("loginName", user.getLoginName());
        data.put("rows", Collections.singletonList(copyStockRow(line)));
        return data;
    }

    private Map<String, Object> stockAcrossDepots(User user, String barCode) throws Exception {
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        MaterialExtend ext = materialExtendService.getInfoByBarCode(barCode);
        if (ext == null) {
            throw new BusinessRunTimeException(404, "未找到物料编码: " + barCode);
        }
        Material material = materialService.getMaterial(ext.getMaterialId());
        if (material == null || material.getTenantId() == null || !material.getTenantId().equals(user.getTenantId())) {
            throw new BusinessRunTimeException(404, "物料不存在或不属于当前租户");
        }
        for (Long depotId : allowedDepotIds(user)) {
            Depot depot = depotService.getDepot(depotId);
            if (depot == null || depot.getTenantId() == null || !depot.getTenantId().equals(user.getTenantId())) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("barCode", barCode);
            row.put("materialName", material.getName());
            row.put("depotId", depotId);
            row.put("depotName", depot.getName());
            row.put("unit", unitOf(barCode));
            row.put("currentStock", depotItemService.getCurrentStockByParam(depotId, material.getId()));
            rows.add(row);
        }
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有可查询的仓库权限");
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("barCode", barCode);
        data.put("materialName", material.getName());
        data.put("unit", unitOf(barCode));
        data.put("tenantId", user.getTenantId());
        data.put("loginName", user.getLoginName());
        data.put("rows", rows);
        data.put("currentStock", rows.get(0).get("currentStock"));
        data.put("depotName", rows.get(0).get("depotName"));
        return data;
    }

    private Map<String, Object> stockListAs(User user, String keyword) throws Exception {
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        List<Map<String, Object>> materials = jdbcTemplate.queryForList(
                "SELECT m.id AS material_id, m.name AS material_name, e.bar_code AS bar_code " +
                        "FROM jsh_material m JOIN jsh_material_extend e ON e.material_id=m.id " +
                        "WHERE m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' AND IFNULL(e.delete_flag,'0')<>'1' " +
                        (keyword == null ? "" : "AND (m.name LIKE ? OR e.bar_code LIKE ?) ") +
                        "ORDER BY e.bar_code LIMIT 40",
                keyword == null
                        ? new Object[]{user.getTenantId()}
                        : new Object[]{user.getTenantId(), "%" + keyword + "%", "%" + keyword + "%"});
        for (Long depotId : allowedDepotIds(user)) {
            Depot depot = depotService.getDepot(depotId);
            if (depot == null || depot.getTenantId() == null || !depot.getTenantId().equals(user.getTenantId())) {
                continue;
            }
            for (Map<String, Object> mat : materials) {
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                String code = String.valueOf(mat.get("bar_code"));
                row.put("barCode", code);
                row.put("materialName", mat.get("material_name"));
                row.put("depotId", depotId);
                row.put("depotName", depot.getName());
                row.put("unit", unitOf(code));
                row.put("currentStock", depotItemService.getCurrentStockByParam(depotId, ((Number) mat.get("material_id")).longValue()));
                rows.add(row);
            }
        }
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, keyword == null
                    ? "当前用户没有可查询的库存"
                    : "未识别物料「" + keyword + "」，请补充中文名称或编码");
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("loginName", user.getLoginName());
        data.put("tenantId", user.getTenantId());
        data.put("rows", rows);
        return data;
    }

    private String resolveBarCodeByKeyword(User user, String keyword) {
        List<String> codes = jdbcTemplate.query(
                "SELECT e.bar_code FROM jsh_material m JOIN jsh_material_extend e ON e.material_id=m.id " +
                        "WHERE m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' AND IFNULL(e.delete_flag,'0')<>'1' " +
                        "AND (m.name LIKE ? OR e.bar_code LIKE ?) ORDER BY CASE WHEN m.name=? THEN 0 WHEN e.bar_code=? THEN 1 ELSE 2 END, e.bar_code LIMIT 2",
                (rs, i) -> rs.getString(1),
                user.getTenantId(), "%" + keyword + "%", "%" + keyword + "%", keyword, keyword);
        if (codes.isEmpty()) {
            return null;
        }
        if (codes.size() > 1 && !codes.get(0).equalsIgnoreCase(keyword) && !keywordEqualsMaterial(user, keyword, codes.get(0))) {
            // Ambiguous: let stockListAs return candidates
            return null;
        }
        return codes.get(0);
    }

    private boolean keywordEqualsMaterial(User user, String keyword, String barCode) {
        List<String> names = jdbcTemplate.query(
                "SELECT m.name FROM jsh_material m JOIN jsh_material_extend e ON e.material_id=m.id " +
                        "WHERE m.tenant_id=? AND e.bar_code=? AND IFNULL(m.delete_flag,'0')<>'1' LIMIT 1",
                (rs, i) -> rs.getString(1), user.getTenantId(), barCode);
        return !names.isEmpty() && keyword.equals(names.get(0));
    }

    private static Map<String, Object> copyStockRow(ResolvedLine line) {
        Map<String, Object> row = new LinkedHashMap<String, Object>();
        row.put("barCode", line.barCode);
        row.put("materialName", line.materialName);
        row.put("depotId", line.depotId);
        row.put("depotName", line.depotName);
        row.put("unit", line.unit);
        row.put("currentStock", line.stock);
        return row;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String t = value.trim();
        return t.isEmpty() ? null : t;
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) {
            return null;
        }
        for (String v : values) {
            if (v != null && !v.isEmpty()) {
                return v;
            }
        }
        return null;
    }

    public Map<String, Object> createDraft(String bizType, JSONObject body, HttpServletRequest request) throws Exception {
        return createDraftAs(currentUser(), bizType, body, null);
    }

    /** Session-free draft create for an explicit ERP user (optional WeCom channel owner). */
    public Map<String, Object> createDraftAs(User user, String bizType, JSONObject body) throws Exception {
        return createDraftAs(user, bizType, body, null);
    }

    /**
     * Create a gateway DRAFT for an explicit ERP user (WeCom delegated actor).
     * When wecomOwner is set, draft is bound to that WeCom sender + binding_version generation.
     * Does not use HTTP session / RequestContextHolder. Does not post inventory.
     */
    public Map<String, Object> createDraftAs(User user, String bizType, JSONObject body, WecomDraftOwner wecomOwner) throws Exception {
        if (user == null || user.getId() == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 用户身份");
        }
        assertFunction(user, functionOf(bizType), BTN_ADD, bizType);
        String key = required(body, "idempotencyKey");
        JSONObject normalized = normalize(bizType, body, user);
        String payload = normalized.toJSONString();
        String payloadHash = sha256Hex(payload);
        List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                "SELECT id, status, payload_json, bill_number, biz_type, channel, bot_id, wecom_user_id, binding_id, "
                        + "binding_bound_at, binding_version, draft_version, payload_hash "
                        + "FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND idempotency_key=?",
                user.getTenantId(), user.getId(), key);
        if (!existing.isEmpty()) {
            Map<String, Object> row = existing.get(0);
            assertWecomOwnerMatches(row, wecomOwner);
            if (!payload.equals(String.valueOf(row.get("payload_json")))) {
                throw new BusinessRunTimeException(409, "幂等键已存在且内容不同，拒绝覆盖");
            }
            Map<String, Object> replay = draftFlags(draftView(row, true), row);
            if (wecomOwner != null && "DRAFT".equals(String.valueOf(row.get("status")))) {
                attachOrRefreshChallenge(user, wecomOwner, row, payloadHash, replay);
            }
            return replay;
        }
        try {
            if (wecomOwner == null) {
                jdbcTemplate.update(
                        "INSERT INTO aierp_gateway_draft (idempotency_key, tenant_id, user_id, biz_type, status, draft_version, "
                                + "payload_json, payload_hash, create_time) VALUES (?,?,?,?, 'DRAFT', 1, ?, ?, NOW())",
                        key, user.getTenantId(), user.getId(), bizType, payload, payloadHash);
            } else {
                jdbcTemplate.update(
                        "INSERT INTO aierp_gateway_draft (idempotency_key, tenant_id, user_id, channel, bot_id, wecom_user_id, "
                                + "binding_id, binding_bound_at, binding_version, biz_type, status, draft_version, "
                                + "payload_json, payload_hash, create_time) "
                                + "VALUES (?,?,?,?,?,?,?,?,?,?, 'DRAFT', 1, ?, ?, NOW())",
                        key, user.getTenantId(), user.getId(),
                        wecomOwner.channel, wecomOwner.botId, wecomOwner.wecomUserId,
                        wecomOwner.bindingId, wecomOwner.bindingBoundAt, wecomOwner.bindingVersion,
                        bizType, payload, payloadHash);
            }
        } catch (DuplicateKeyException ex) {
            List<Map<String, Object>> raced = jdbcTemplate.queryForList(
                    "SELECT id, status, payload_json, bill_number, biz_type, channel, bot_id, wecom_user_id, binding_id, "
                            + "binding_bound_at, binding_version, draft_version, payload_hash "
                            + "FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND idempotency_key=?",
                    user.getTenantId(), user.getId(), key);
            if (raced.isEmpty()) {
                throw ex;
            }
            assertWecomOwnerMatches(raced.get(0), wecomOwner);
            if (!payload.equals(String.valueOf(raced.get(0).get("payload_json")))) {
                throw new BusinessRunTimeException(409, "幂等键已存在且内容不同，拒绝覆盖");
            }
            Map<String, Object> racedView = draftFlags(draftView(raced.get(0), true), raced.get(0));
            if (wecomOwner != null && "DRAFT".equals(String.valueOf(raced.get(0).get("status")))) {
                attachOrRefreshChallenge(user, wecomOwner, raced.get(0), payloadHash, racedView);
            }
            return racedView;
        }
        List<Map<String, Object>> created = jdbcTemplate.queryForList(
                "SELECT id, status, payload_json, bill_number, biz_type, channel, bot_id, wecom_user_id, binding_id, "
                        + "binding_bound_at, binding_version, draft_version, payload_hash "
                        + "FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND idempotency_key=?",
                user.getTenantId(), user.getId(), key);
        Map<String, Object> view = draftFlags(draftView(created.get(0), false), created.get(0));
        view.put("nature", "REAL_ERP");
        if (wecomOwner != null) {
            attachOrRefreshChallenge(user, wecomOwner, created.get(0), payloadHash, view);
        }
        return view;
    }

    /** Cancel DRAFT owned by ERP user + WeCom channel owner (when provided). */
    public Map<String, Object> cancelDraftAs(User user, long draftId, WecomDraftOwner wecomOwner) {
        if (user == null || user.getId() == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 用户身份");
        }
        Map<String, Object> row = requireOwnedDraftRow(user, draftId, wecomOwner);
        String status = String.valueOf(row.get("status"));
        if ("CONFIRMED".equals(status)) {
            throw new BusinessRunTimeException(409, "草稿已过账，不能取消");
        }
        if ("CANCELLED".equals(status)) {
            Map<String, Object> already = new LinkedHashMap<String, Object>();
            already.put("draftId", draftId);
            already.put("status", "CANCELLED");
            already.put("cancelled", true);
            already.put("replayed", true);
            already.put("posted", false);
            already.put("stockUnchanged", true);
            already.put("nature", "REAL_ERP");
            return already;
        }
        int n = jdbcTemplate.update(
                "UPDATE aierp_gateway_draft SET status='CANCELLED' WHERE id=? AND tenant_id=? AND user_id=? "
                        + "AND status IN ('DRAFT','AWAITING_CONFIRM')",
                draftId, user.getTenantId(), user.getId());
        if (n != 1) {
            throw new BusinessRunTimeException(409, "草稿状态已变化，无法取消");
        }
        jdbcTemplate.update(
                "UPDATE aierp_gateway_confirm_challenge SET status='CANCELLED' WHERE draft_id=? AND status='PENDING'",
                draftId);
        Map<String, Object> view = new LinkedHashMap<String, Object>();
        view.put("draftId", draftId);
        view.put("status", "CANCELLED");
        view.put("cancelled", true);
        view.put("posted", false);
        view.put("stockUnchanged", true);
        view.put("nature", "REAL_ERP");
        return view;
    }

    public Map<String, Object> cancelDraftAs(User user, long draftId) {
        return cancelDraftAs(user, draftId, null);
    }

    /** Read draft owned by ERP user + WeCom channel owner (when provided). */
    public Map<String, Object> draftStatusAs(User user, long draftId, WecomDraftOwner wecomOwner) {
        if (user == null || user.getId() == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 用户身份");
        }
        Map<String, Object> row = requireOwnedDraftRow(user, draftId, wecomOwner);
        Map<String, Object> view = draftFlags(draftView(row, false), row);
        view.put("bizType", row.get("biz_type"));
        view.put("createTime", String.valueOf(row.get("create_time")));
        view.put("nature", "REAL_ERP");
        return view;
    }

    public Map<String, Object> draftStatusAs(User user, long draftId) {
        return draftStatusAs(user, draftId, null);
    }

    private Map<String, Object> requireOwnedDraftRow(User user, long draftId, WecomDraftOwner wecomOwner) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, status, payload_json, bill_number, depot_head_id, biz_type, create_time, confirm_time, "
                        + "channel, bot_id, wecom_user_id, binding_id, binding_bound_at, binding_version, "
                        + "draft_version, payload_hash "
                        + "FROM aierp_gateway_draft WHERE id=? AND tenant_id=? AND user_id=?",
                draftId, user.getTenantId(), user.getId());
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, "草稿不存在或不属于当前绑定用户");
        }
        Map<String, Object> row = rows.get(0);
        assertWecomOwnerMatches(row, wecomOwner);
        return row;
    }

    private void assertWecomOwnerMatches(Map<String, Object> row, WecomDraftOwner wecomOwner) {
        if (wecomOwner == null) {
            return;
        }
        // WeCom callers must only see drafts created for their exact sender + binding_version generation.
        if (row.get("wecom_user_id") == null || row.get("bot_id") == null || row.get("binding_id") == null) {
            throw new BusinessRunTimeException(403, "该草稿不属于当前企微绑定会话");
        }
        if (!wecomOwner.wecomUserId.equals(String.valueOf(row.get("wecom_user_id")))
                || !wecomOwner.botId.equals(String.valueOf(row.get("bot_id")))
                || wecomOwner.bindingId != ((Number) row.get("binding_id")).longValue()) {
            throw new BusinessRunTimeException(403, "无权访问其他企微身份的草稿");
        }
        long rowVersion = row.get("binding_version") == null ? 0L : ((Number) row.get("binding_version")).longValue();
        if (rowVersion < 1L) {
            // Legacy 015A drafts only have bound_at; reject if current generation advanced past legacy.
            throw new BusinessRunTimeException(403, "绑定已更新，原企微草稿不可再访问，请重新创建");
        }
        if (wecomOwner.bindingVersion != rowVersion) {
            throw new BusinessRunTimeException(403, "绑定已更新，原企微草稿不可再访问，请重新创建");
        }
    }

    private static Map<String, Object> draftFlags(Map<String, Object> view, Map<String, Object> row) {
        boolean confirmed = "CONFIRMED".equals(String.valueOf(row.get("status")));
        view.put("posted", confirmed);
        view.put("stockUnchanged", !confirmed);
        view.put("nature", "REAL_ERP");
        return view;
    }

    /** Immutable WeCom ownership snapshot stored on drafts. */
    public static final class WecomDraftOwner {
        public final String channel;
        public final String botId;
        public final String wecomUserId;
        public final long bindingId;
        public final long bindingVersion;
        public final String bindingBoundAt;

        public WecomDraftOwner(String channel, String botId, String wecomUserId, long bindingId,
                               long bindingVersion, String bindingBoundAt) {
            this.channel = channel;
            this.botId = botId;
            this.wecomUserId = wecomUserId;
            this.bindingId = bindingId;
            this.bindingVersion = bindingVersion;
            this.bindingBoundAt = bindingBoundAt;
        }
    }

    /** Proof from a trusted WeCom inbound event (before_dispatch), never from LLM tool args alone. */
    public static final class ConfirmEventProof {
        public final String rawText;
        public final String messageMsgId;
        public final boolean groupChat;
        public final String source; // WECOM_BEFORE_DISPATCH | ERP_SESSION_UI

        public ConfirmEventProof(String rawText, String messageMsgId, boolean groupChat, String source) {
            this.rawText = rawText;
            this.messageMsgId = messageMsgId;
            this.groupChat = groupChat;
            this.source = source;
        }
    }

    public Map<String, Object> confirm(JSONObject body, HttpServletRequest request) throws Exception {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                TransactionTemplate tx = new TransactionTemplate(transactionManager);
                return tx.execute(status -> {
                    try {
                        return confirmInTx(body, request);
                    } catch (RuntimeException ex) {
                        throw ex;
                    } catch (Exception ex) {
                        throw new BusinessRunTimeException(500, ex.getMessage());
                    }
                });
            } catch (RuntimeException ex) {
                last = ex;
                if (attempt < 3 && isDeadlock(ex)) {
                    continue;
                }
                throw ex;
            }
        }
        throw last == null ? new BusinessRunTimeException(500, "库存锁重试失败") : last;
    }

    private Map<String, Object> confirmInTx(JSONObject body, HttpServletRequest request) throws Exception {
        User user = currentUser();
        String key = required(body, "idempotencyKey");
        List<Map<String, Object>> locked = jdbcTemplate.queryForList(
                "SELECT id, status, biz_type, payload_json, bill_number, depot_head_id FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND idempotency_key=? FOR UPDATE",
                user.getTenantId(), user.getId(), key);
        if (locked.isEmpty()) {
            throw new BusinessRunTimeException(404, "草稿不存在或不属于当前用户");
        }
        Map<String, Object> row = locked.get(0);
        return confirmLockedRowAs(user, row, request);
    }

    /**
     * AIERP-015B: confirm a WeCom-owned draft with trusted inbound proof (or ERP session UI).
     * Uses explicit actor for native post — no fabricated Redis session.
     */
    public Map<String, Object> confirmAs(User user, WecomDraftOwner owner, long draftId,
                                         ConfirmEventProof proof) throws Exception {
        if (user == null || user.getId() == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 用户身份");
        }
        if (owner == null) {
            throw new BusinessRunTimeException(403, "缺少企微草稿所有权");
        }
        if (proof == null || proof.rawText == null || proof.rawText.trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少可信确认原文");
        }
        if (proof.groupChat) {
            throw new BusinessRunTimeException(403, "禁止在群聊中确认采购");
        }
        if (!"WECOM_BEFORE_DISPATCH".equals(proof.source) && !"ERP_SESSION_UI".equals(proof.source)) {
            throw new BusinessRunTimeException(403, "确认来源不可信");
        }
        RuntimeException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                TransactionTemplate tx = new TransactionTemplate(transactionManager);
                return tx.execute(status -> {
                    try {
                        return confirmAsInTx(user, owner, draftId, proof);
                    } catch (RuntimeException ex) {
                        throw ex;
                    } catch (Exception ex) {
                        throw new BusinessRunTimeException(500, ex.getMessage());
                    }
                });
            } catch (RuntimeException ex) {
                last = ex;
                if (attempt < 3 && isDeadlock(ex)) {
                    continue;
                }
                throw ex;
            }
        }
        throw last == null ? new BusinessRunTimeException(500, "库存锁重试失败") : last;
    }

    private Map<String, Object> confirmAsInTx(User user, WecomDraftOwner owner, long draftId,
                                              ConfirmEventProof proof) throws Exception {
        // Message-id idempotency: same WeCom event must not double-post.
        if (proof.messageMsgId != null && !proof.messageMsgId.trim().isEmpty()) {
            List<Map<String, Object>> byMsg = jdbcTemplate.queryForList(
                    "SELECT draft_id, status FROM aierp_gateway_confirm_challenge WHERE consume_message_id=? LIMIT 1",
                    proof.messageMsgId.trim());
            if (!byMsg.isEmpty() && "CONSUMED".equals(String.valueOf(byMsg.get(0).get("status")))) {
                long priorDraft = ((Number) byMsg.get(0).get("draft_id")).longValue();
                Map<String, Object> prior = requireOwnedDraftRow(user, priorDraft, owner);
                if ("CONFIRMED".equals(String.valueOf(prior.get("status")))) {
                    Map<String, Object> replay = confirmView(prior, user, true);
                    replay.put("posted", true);
                    replay.put("stockUnchanged", true);
                    replay.put("nature", "REAL_ERP");
                    return replay;
                }
            }
        }

        List<Map<String, Object>> locked = jdbcTemplate.queryForList(
                "SELECT id, status, biz_type, payload_json, bill_number, depot_head_id, channel, bot_id, wecom_user_id, "
                        + "binding_id, binding_bound_at, binding_version, draft_version, payload_hash "
                        + "FROM aierp_gateway_draft WHERE id=? AND tenant_id=? AND user_id=? FOR UPDATE",
                draftId, user.getTenantId(), user.getId());
        if (locked.isEmpty()) {
            throw new BusinessRunTimeException(404, "草稿不存在或不属于当前绑定用户");
        }
        Map<String, Object> row = locked.get(0);
        assertWecomOwnerMatches(row, owner);

        if ("CONFIRMED".equals(String.valueOf(row.get("status")))) {
            Map<String, Object> replay = confirmView(row, user, true);
            replay.put("posted", true);
            replay.put("stockUnchanged", true);
            replay.put("nature", "REAL_ERP");
            return replay;
        }
        if ("CANCELLED".equals(String.valueOf(row.get("status")))) {
            throw new BusinessRunTimeException(409, "草稿已取消，不能确认");
        }
        if (!"DRAFT".equals(String.valueOf(row.get("status")))
                && !"AWAITING_CONFIRM".equals(String.valueOf(row.get("status")))) {
            throw new BusinessRunTimeException(409, "草稿状态不可确认: " + row.get("status"));
        }

        ParsedConfirmIntent intent = parseConfirmIntent(proof.rawText.trim());
        if (!intent.confirm) {
            throw new BusinessRunTimeException(400, "不是有效的确认指令，请回复「确认采购" + draftId + "」");
        }
        if (intent.draftId != null && intent.draftId.longValue() != draftId) {
            throw new BusinessRunTimeException(400, "确认的草稿号与请求不一致");
        }
        if (intent.draftId == null) {
            int awaiting = countAwaitingOwnedDrafts(user, owner);
            if (awaiting != 1) {
                throw new BusinessRunTimeException(400,
                        "存在多个待确认草稿，请回复「确认采购" + draftId + "」指定草稿号");
            }
        }

        consumeChallengeOrThrow(user, owner, row, proof);

        return confirmLockedRowAs(user, row, null);
    }

    private Map<String, Object> confirmLockedRowAs(User user, Map<String, Object> row,
                                                   HttpServletRequest request) throws Exception {
        String bizType = String.valueOf(row.get("biz_type"));
        assertFunction(user, functionOf(bizType), BTN_AUDIT, bizType);
        if ("CONFIRMED".equals(String.valueOf(row.get("status")))) {
            Map<String, Object> replay = confirmView(row, user, true);
            replay.put("posted", true);
            replay.put("stockUnchanged", true);
            replay.put("nature", "REAL_ERP");
            return replay;
        }
        JSONObject payload = JSON.parseObject(String.valueOf(row.get("payload_json")));
        reassertAccess(user, payload, bizType);
        reassertParties(user, payload, bizType);
        List<String> stockLocks = lockStockKeys(user, payload, bizType);
        assertOutboundStock(user, bizType, payload, stockLocks);
        String number = "GW-" + bizType + "-" + ((Number) row.get("id")).longValue();
        Map<String, BigDecimal> before = snapshot(payload, bizType);
        Long headId = postNativeBillAs(user, bizType, number, payload);
        jdbcTemplate.update(
                "UPDATE aierp_gateway_draft SET status='CONFIRMED', bill_number=?, depot_head_id=?, confirm_time=NOW() WHERE id=?",
                number, headId, ((Number) row.get("id")).longValue());
        row.put("status", "CONFIRMED");
        row.put("bill_number", number);
        row.put("depot_head_id", headId);
        Map<String, Object> view = confirmView(row, user, false);
        view.put("stockLocks", stockLocks);
        view.put("stockBefore", before);
        view.put("stockAfter", snapshot(payload, bizType));
        view.put("posted", true);
        view.put("stockUnchanged", false);
        view.put("nature", "REAL_ERP");
        view.put("confirmTime", TS.format(LocalDateTime.now()));
        return view;
    }

    /** Resolve draftId from trusted confirm text for the owner (null draftId ⇒ single awaiting). */
    public long resolveConfirmDraftId(User user, WecomDraftOwner owner, String rawText) {
        ParsedConfirmIntent intent = parseConfirmIntent(rawText == null ? "" : rawText.trim());
        if (!intent.confirm) {
            throw new BusinessRunTimeException(400, "不是有效的确认指令");
        }
        if (intent.draftId != null) {
            return intent.draftId;
        }
        List<Map<String, Object>> rows = listAwaitingOwnedDrafts(user, owner);
        if (rows.size() != 1) {
            throw new BusinessRunTimeException(400, "存在多个或没有待确认草稿，请回复「确认采购{草稿号}」");
        }
        return ((Number) rows.get(0).get("id")).longValue();
    }

    public List<Map<String, Object>> listAwaitingOwnedDrafts(User user, WecomDraftOwner owner) {
        return jdbcTemplate.queryForList(
                "SELECT id, status, biz_type, create_time FROM aierp_gateway_draft "
                        + "WHERE tenant_id=? AND user_id=? AND channel=? AND bot_id=? AND wecom_user_id=? "
                        + "AND binding_id=? AND binding_version=? AND status IN ('DRAFT','AWAITING_CONFIRM') "
                        + "ORDER BY id ASC",
                user.getTenantId(), user.getId(), owner.channel, owner.botId, owner.wecomUserId,
                owner.bindingId, owner.bindingVersion);
    }

    private int countAwaitingOwnedDrafts(User user, WecomDraftOwner owner) {
        return listAwaitingOwnedDrafts(user, owner).size();
    }

    public Map<String, Object> summary(HttpServletRequest request) throws Exception {
        User user = currentUser();
        assertFunction(user, FUN_STOCK, null, "库存查询");
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("loginName", user.getLoginName());
        data.put("userId", user.getId());
        data.put("tenantId", user.getTenantId());
        data.put("draftCount", countStatus(user, "DRAFT"));
        data.put("confirmedCount", countStatus(user, "CONFIRMED"));
        data.put("recentBills", jdbcTemplate.queryForList(
                "SELECT biz_type, bill_number, confirm_time FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND status='CONFIRMED' ORDER BY id DESC LIMIT 8",
                user.getTenantId(), user.getId()));
        List<String> codes = jdbcTemplate.queryForList(
                "SELECT bar_code FROM jsh_material_extend WHERE tenant_id=? AND IFNULL(delete_flag,'0')<>'1' AND bar_code IN ('RM-A001','RM-B002','RM-C003','FG-101','FG-102')",
                String.class, user.getTenantId());
        List<Map<String, Object>> stocks = new ArrayList<Map<String, Object>>();
        for (Long depotId : allowedDepotIds(user)) {
            Depot depot = depotService.getDepot(depotId);
            if (depot == null || depot.getTenantId() == null || !depot.getTenantId().equals(user.getTenantId())) {
                continue;
            }
            for (String code : codes) {
                MaterialExtend ext = materialExtendService.getInfoByBarCode(code);
                if (ext == null) {
                    continue;
                }
                Material material = materialService.getMaterial(ext.getMaterialId());
                if (material == null || material.getTenantId() == null || !material.getTenantId().equals(user.getTenantId())) {
                    continue;
                }
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                row.put("barCode", code);
                row.put("depotName", depot.getName());
                row.put("currentStock", depotItemService.getCurrentStockByParam(depotId, material.getId()));
                stocks.add(row);
            }
        }
        data.put("stocks", stocks);
        data.put("nature", "REAL_ERP");
        return data;
    }

    private Long postNativeBill(String bizType, String number, JSONObject payload, HttpServletRequest request) throws Exception {
        return postNativeBillAs(currentUser(), bizType, number, payload);
    }

    /**
     * Native create + audit with explicit actor. No getCurrentUser / fabricated session.
     */
    private Long postNativeBillAs(User actor, String bizType, String number, JSONObject payload) throws Exception {
        if (actor == null || actor.getId() == null || actor.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "缺少受控 ERP 用户身份，无法过账");
        }
        JSONObject info = new JSONObject();
        info.put("operTime", LocalDateTime.now().format(TS));
        info.put("number", number);
        info.put("remark", payload.getString("remark"));
        info.put("status", "0");
        JSONArray rows = new JSONArray();
        if ("PURCHASE".equals(bizType)) {
            info.put("type", "入库");
            info.put("subType", "采购");
            info.put("organId", payload.getLong("organId"));
            info.put("accountId", payload.getLong("accountId"));
            BigDecimal total = sumAmount(payload.getJSONArray("lines"));
            info.put("totalPrice", total.negate());
            info.put("changeAmount", BigDecimal.ZERO);
            info.put("payType", "记账");
            info.put("debt", total);
            info.put("discount", 0);
            info.put("discountMoney", 0);
            info.put("discountLastMoney", total);
            info.put("otherMoney", 0);
            info.put("deposit", 0);
            rows.addAll(payload.getJSONArray("lines"));
        } else if ("MIX".equals(bizType)) {
            info.put("type", "其它");
            info.put("subType", "组装单");
            info.put("totalPrice", 0);
            JSONObject finished = payload.getJSONObject("finished");
            finished.put("mType", "组合件");
            rows.add(finished);
            for (int i = 0; i < payload.getJSONArray("lines").size(); i++) {
                JSONObject line = payload.getJSONArray("lines").getJSONObject(i);
                line.put("mType", "普通子件");
                rows.add(line);
            }
        } else if ("SERVICE".equals(bizType)) {
            info.put("type", "出库");
            info.put("subType", "其它");
            info.put("organId", payload.getLong("organId"));
            BigDecimal total = sumAmount(payload.getJSONArray("lines"));
            info.put("totalPrice", total);
            rows.addAll(payload.getJSONArray("lines"));
        } else {
            throw new BusinessRunTimeException(400, "未知业务类型");
        }
        depotHeadService.addDepotHeadAndDetailAs(actor, info.toJSONString(), rows.toJSONString(), null);
        Long headId = requireOwnUnapprovedHead(actor, number);
        // Verify creator is the bound actor before audit.
        List<Map<String, Object>> created = jdbcTemplate.queryForList(
                "SELECT id, creator, tenant_id, status FROM jsh_depot_head WHERE id=? AND number=? AND IFNULL(delete_flag,'0')<>'1'",
                headId, number);
        if (created.size() != 1
                || !actor.getId().equals(((Number) created.get(0).get("creator")).longValue())
                || !actor.getTenantId().equals(((Number) created.get(0).get("tenant_id")).longValue())) {
            throw new BusinessRunTimeException(500, "原生单据创建人/租户与绑定用户不一致，拒绝审核");
        }
        depotHeadService.batchSetStatusAs(actor, "1", String.valueOf(headId));
        List<Map<String, Object>> audited = jdbcTemplate.queryForList(
                "SELECT id, tenant_id, status, creator FROM jsh_depot_head WHERE id=? AND number=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                headId, number, actor.getTenantId());
        if (audited.size() != 1 || !"1".equals(String.valueOf(audited.get(0).get("status")))) {
            throw new BusinessRunTimeException(500, "审核后单据不属于当前租户或状态异常: " + number);
        }
        if (!actor.getId().equals(((Number) audited.get(0).get("creator")).longValue())) {
            throw new BusinessRunTimeException(500, "审核后单据创建人与绑定用户不一致: " + number);
        }
        return headId;
    }

    private JSONObject normalize(String bizType, JSONObject body, User user) throws Exception {
        JSONObject out = new JSONObject(true);
        out.put("idempotencyKey", required(body, "idempotencyKey"));
        out.put("remark", body.getString("remark") == null ? "" : body.getString("remark").trim());
        if ("MIX".equals(bizType)) {
            JSONObject finishedIn = body.getJSONObject("finished");
            if (finishedIn == null) {
                throw new BusinessRunTimeException(400, "组装单缺少成品行");
            }
            ResolvedLine finished = resolveLine(user, required(finishedIn, "barCode"), required(finishedIn, "depotName"),
                    decimal(finishedIn, "qty"), required(finishedIn, "unit"), false);
            JSONArray components = new JSONArray();
            JSONArray rawLines = body.getJSONArray("lines");
            if (rawLines == null || rawLines.isEmpty()) {
                throw new BusinessRunTimeException(400, "组装单缺少原料行");
            }
            for (int i = 0; i < rawLines.size(); i++) {
                JSONObject line = rawLines.getJSONObject(i);
                components.add(toRow(resolveLine(user, required(line, "barCode"), required(line, "depotName"),
                        decimal(line, "qty"), required(line, "unit"), true)));
            }
            out.put("finished", toRow(finished));
            out.put("lines", components);
            return out;
        }
        String organType = "PURCHASE".equals(bizType) ? "供应商" : "客户";
        if (!"PURCHASE".equals(bizType) && !"SERVICE".equals(bizType)) {
            throw new BusinessRunTimeException(400, "未知业务类型");
        }
        String organName = required(body, "organName");
        Long organId = resolveOrgan(user, organName, organType);
        out.put("organId", organId);
        out.put("organName", organName);
        if ("PURCHASE".equals(bizType)) {
            out.put("accountId", defaultAccountId(user));
        }
        JSONArray rawLines = body.getJSONArray("lines");
        if (rawLines == null || rawLines.isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少明细行");
        }
        JSONArray lines = new JSONArray();
        for (int i = 0; i < rawLines.size(); i++) {
            JSONObject line = rawLines.getJSONObject(i);
            ResolvedLine resolved = resolveLine(user, required(line, "barCode"), required(line, "depotName"),
                    decimal(line, "qty"), required(line, "unit"), "SERVICE".equals(bizType));
            if (line.get("unitPrice") != null) {
                resolved.unitPrice = decimal(line, "unitPrice");
            }
            lines.add(toRow(resolved));
        }
        out.put("lines", lines);
        return out;
    }

    private void reassertAccess(User user, JSONObject payload, String bizType) throws Exception {
        List<Long> allowed = allowedDepotIds(user);
        if ("MIX".equals(bizType)) {
            checkStoredLine(user, payload.getJSONObject("finished"), allowed);
        }
        JSONArray lines = payload.getJSONArray("lines");
        if (lines == null) {
            throw new BusinessRunTimeException(400, "草稿缺少明细");
        }
        for (int i = 0; i < lines.size(); i++) {
            checkStoredLine(user, lines.getJSONObject(i), allowed);
        }
    }

    private void checkStoredLine(User user, JSONObject line, List<Long> allowed) throws Exception {
        if (line == null) {
            throw new BusinessRunTimeException(400, "草稿行缺失");
        }
        Long depotId = line.getLong("depotId");
        if (depotId == null || !allowed.contains(depotId)) {
            throw new BusinessRunTimeException(403, "当前用户无权使用仓库: " + line.getString("depotName"));
        }
        Depot depot = depotService.getDepot(depotId);
        if (depot == null || depot.getTenantId() == null || !depot.getTenantId().equals(user.getTenantId())) {
            throw new BusinessRunTimeException(400, "仓库不存在或不属于当前租户: " + line.getString("depotName"));
        }
        Material material = materialService.getMaterial(line.getLong("materialId"));
        if (material == null || material.getTenantId() == null || !material.getTenantId().equals(user.getTenantId())) {
            throw new BusinessRunTimeException(400, "物料不存在或不属于当前租户: " + line.getString("barCode"));
        }
    }

    private long functionOf(String bizType) {
        if ("PURCHASE".equals(bizType)) {
            return FUN_PURCHASE;
        }
        if ("MIX".equals(bizType)) {
            return FUN_MIX;
        }
        if ("SERVICE".equals(bizType)) {
            return FUN_SERVICE;
        }
        throw new BusinessRunTimeException(400, "未知业务类型");
    }

    private void assertFunction(User user, long funId, String button, String action) {
        List<Long> roles = roleIds(user);
        if (roles.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有业务角色，拒绝" + action);
        }
        boolean hasFun = false;
        boolean hasBtn = false;
        for (Long roleId : roles) {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT `value`, btn_str FROM jsh_user_business WHERE type='RoleFunctions' AND key_id=? AND IFNULL(delete_flag,'0')<>'1'",
                    String.valueOf(roleId));
            for (Map<String, Object> row : rows) {
                String value = row.get("value") == null ? "" : String.valueOf(row.get("value"));
                if (value.contains("[" + funId + "]")) {
                    hasFun = true;
                }
                if (button != null && hasButton(row.get("btn_str"), funId, button)) {
                    hasBtn = true;
                }
            }
        }
        if (!hasFun || (button != null && !hasBtn)) {
            throw new BusinessRunTimeException(403, "当前角色无权" + action + "，功能 " + funId + (button == null ? "" : " 按钮 " + button));
        }
    }

    private boolean hasButton(Object btnStr, long funId, String button) {
        if (btnStr == null || String.valueOf(btnStr).trim().isEmpty()) {
            return false;
        }
        JSONArray arr = JSON.parseArray(String.valueOf(btnStr));
        if (arr == null) {
            return false;
        }
        for (int i = 0; i < arr.size(); i++) {
            JSONObject item = arr.getJSONObject(i);
            if (item.getLong("funId") != null && item.getLong("funId") == funId) {
                String buttons = item.getString("btnStr");
                if (buttons == null) {
                    return false;
                }
                for (String one : buttons.split(",")) {
                    if (button.equals(one.trim())) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private List<Long> roleIds(User user) {
        List<String> values = jdbcTemplate.query(
                "SELECT `value` FROM jsh_user_business WHERE type='UserRole' AND key_id=? AND IFNULL(delete_flag,'0')<>'1'",
                (rs, i) -> rs.getString(1), String.valueOf(user.getId()));
        List<Long> ids = new ArrayList<Long>();
        for (String value : values) {
            if (value == null) {
                continue;
            }
            Matcher matcher = DEPOT_ID.matcher(value);
            while (matcher.find()) {
                ids.add(Long.valueOf(matcher.group(1)));
            }
        }
        return ids;
    }

    private void reassertParties(User user, JSONObject payload, String bizType) {
        if ("PURCHASE".equals(bizType) || "SERVICE".equals(bizType)) {
            String organType = "PURCHASE".equals(bizType) ? "供应商" : "客户";
            Long organId = payload.getLong("organId");
            Integer n = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM jsh_supplier WHERE id=? AND tenant_id=? AND type=? AND enabled=b'1' AND IFNULL(delete_flag,'0')<>'1'",
                    Integer.class, organId, user.getTenantId(), organType);
            if (n == null || n != 1) {
                throw new BusinessRunTimeException(400, "确认时" + organType + "不可用或不属于当前租户");
            }
        }
        if ("PURCHASE".equals(bizType)) {
            Long accountId = payload.getLong("accountId");
            Integer n = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM jsh_account WHERE id=? AND tenant_id=? AND enabled=b'1' AND IFNULL(delete_flag,'0')<>'1'",
                    Integer.class, accountId, user.getTenantId());
            if (n == null || n != 1) {
                throw new BusinessRunTimeException(400, "确认时结算账户不可用或不属于当前租户");
            }
        }
    }

    private List<String> lockStockKeys(User user, JSONObject payload, String bizType) {
        if (!org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new BusinessRunTimeException(500, "库存锁不在事务中");
        }
        List<long[]> keys = stockKeys(bizType, payload);
        List<String> names = new ArrayList<String>();
        for (int i = 0; i < keys.size(); i++) {
            long depotId = keys.get(i)[0];
            long materialId = keys.get(i)[1];
            jdbcTemplate.update(
                    "INSERT IGNORE INTO aierp_stock_guard (tenant_id, depot_id, material_id) VALUES (?,?,?)",
                    user.getTenantId(), depotId, materialId);
            Integer locked = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM aierp_stock_guard WHERE tenant_id=? AND depot_id=? AND material_id=? FOR UPDATE",
                    Integer.class, user.getTenantId(), depotId, materialId);
            if (locked == null || locked.intValue() != 1) {
                throw new BusinessRunTimeException(500, "库存行锁失败");
            }
            names.add("aierp:" + user.getTenantId() + ":" + depotId + ":" + materialId);
            if (i == 0 && keys.size() > 1 && LOCK_PROBE_REMARK.equals(payload.getString("remark"))) {
                throw new BusinessRunTimeException(409, "库存锁探针：第一把行锁后主动失败");
            }
            jdbcTemplate.query(
                    "SELECT id FROM jsh_material_current_stock WHERE tenant_id=? AND depot_id=? AND material_id=? AND IFNULL(delete_flag,'0')<>'1' ORDER BY id FOR UPDATE",
                    rs -> {
                        while (rs.next()) {
                            rs.getLong(1);
                        }
                        return null;
                    },
                    user.getTenantId(), depotId, materialId);
        }
        return names;
    }

    private List<long[]> stockKeys(String bizType, JSONObject payload) {
        List<long[]> keys = new ArrayList<long[]>();
        if ("MIX".equals(bizType)) {
            addStockKey(keys, payload.getJSONObject("finished"));
        }
        JSONArray lines = payload.getJSONArray("lines");
        if (lines != null) {
            for (int i = 0; i < lines.size(); i++) {
                addStockKey(keys, lines.getJSONObject(i));
            }
        }
        Collections.sort(keys, (a, b) -> a[0] == b[0] ? Long.compare(a[1], b[1]) : Long.compare(a[0], b[0]));
        List<long[]> unique = new ArrayList<long[]>();
        String seen = "";
        for (long[] key : keys) {
            String mark = key[0] + ":" + key[1];
            if (mark.equals(seen)) {
                continue;
            }
            seen = mark;
            unique.add(key);
        }
        return unique;
    }

    private void addStockKey(List<long[]> keys, JSONObject line) {
        if (line == null || line.getLong("depotId") == null || line.getLong("materialId") == null) {
            throw new BusinessRunTimeException(400, "草稿行缺少仓库或物料，无法加锁");
        }
        keys.add(new long[]{line.getLong("depotId"), line.getLong("materialId")});
    }

    private Long requireOwnUnapprovedHead(User user, String number) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, tenant_id, status FROM jsh_depot_head WHERE number=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                number, user.getTenantId());
        if (rows.size() != 1) {
            throw new BusinessRunTimeException(409, "当前租户下单据号不唯一或不存在: " + number);
        }
        Map<String, Object> row = rows.get(0);
        long tenantId = ((Number) row.get("tenant_id")).longValue();
        if (tenantId != user.getTenantId()) {
            throw new BusinessRunTimeException(403, "拒绝审核其他租户单据: " + number);
        }
        if (!"0".equals(String.valueOf(row.get("status")))) {
            throw new BusinessRunTimeException(409, "单据不是未审核状态: " + number);
        }
        return ((Number) row.get("id")).longValue();
    }

    private boolean isDeadlock(Throwable ex) {
        Throwable cur = ex;
        while (cur != null) {
            if (cur instanceof SQLException && ((SQLException) cur).getErrorCode() == 1213) {
                return true;
            }
            String msg = cur.getMessage();
            if (msg != null && msg.toLowerCase().contains("deadlock")) {
                return true;
            }
            cur = cur.getCause();
        }
        return false;
    }

    private void assertOutboundStock(User user, String bizType, JSONObject payload, List<String> lockedNames) {
        if ("PURCHASE".equals(bizType)) {
            return;
        }
        JSONArray lines = payload.getJSONArray("lines");
        Map<String, BigDecimal> need = new LinkedHashMap<String, BigDecimal>();
        Map<String, Long[]> identity = new LinkedHashMap<String, Long[]>();
        for (int i = 0; i < lines.size(); i++) {
            JSONObject line = lines.getJSONObject(i);
            String key = line.getLong("depotId") + ":" + line.getLong("materialId");
            BigDecimal qty = line.getBigDecimal("operNumber");
            need.put(key, need.containsKey(key) ? need.get(key).add(qty) : qty);
            identity.put(key, new Long[]{line.getLong("depotId"), line.getLong("materialId")});
        }
        for (Map.Entry<String, BigDecimal> entry : need.entrySet()) {
            Long depotId = identity.get(entry.getKey())[0];
            Long materialId = identity.get(entry.getKey())[1];
            String name = "aierp:" + ":" + depotId + ":" + materialId;
            boolean locked = false;
            for (String item : lockedNames) {
                if (item.endsWith(":" + depotId + ":" + materialId)) {
                    locked = true;
                    name = item;
                }
            }
            if (!locked) {
                throw new BusinessRunTimeException(500, "出库前没有锁住 " + name);
            }
            BigDecimal stock = lockedStock(user.getTenantId(), depotId, materialId);
            if (stock.compareTo(entry.getValue()) < 0) {
                throw new BusinessRunTimeException(400, "库存不足，整单拒绝。仓库" + depotId + " 物料" + materialId
                        + " 可用 " + stock + " 需要 " + entry.getValue());
            }
        }
    }

    private BigDecimal lockedStock(Long tenantId, Long depotId, Long materialId) {
        BigDecimal stock = jdbcTemplate.query(
                "SELECT current_number FROM jsh_material_current_stock WHERE tenant_id=? AND depot_id=? AND material_id=? AND IFNULL(delete_flag,'0')<>'1' ORDER BY id FOR UPDATE",
                rs -> {
                    BigDecimal sum = BigDecimal.ZERO;
                    while (rs.next()) {
                        BigDecimal n = rs.getBigDecimal(1);
                        if (n != null) {
                            sum = sum.add(n);
                        }
                    }
                    return sum;
                },
                tenantId, depotId, materialId);
        return stock == null ? BigDecimal.ZERO : stock;
    }

    private ResolvedLine resolveLine(User user, String barCode, String depotName, BigDecimal qty, String unit, boolean outbound) throws Exception {
        if (qty.compareTo(BigDecimal.ZERO) <= 0) {
            throw new BusinessRunTimeException(400, "数量必须为正数: " + barCode);
        }
        MaterialExtend ext = materialExtendService.getInfoByBarCode(barCode.trim());
        if (ext == null || ext.getTenantId() == null || !ext.getTenantId().equals(user.getTenantId())) {
            throw new BusinessRunTimeException(400, "物料不存在或不属于当前租户: " + barCode);
        }
        Material material = materialService.getMaterial(ext.getMaterialId());
        if (material == null || material.getTenantId() == null || !material.getTenantId().equals(user.getTenantId())) {
            throw new BusinessRunTimeException(400, "物料不存在或不属于当前租户: " + barCode);
        }
        String expected = ext.getCommodityUnit() != null ? ext.getCommodityUnit() : material.getUnit();
        if (expected == null || !expected.trim().equalsIgnoreCase(unit.trim())) {
            throw new BusinessRunTimeException(400, "单位不匹配: " + barCode + " 需要 " + expected + " 实际 " + unit);
        }
        Depot depot = findDepot(user, depotName.trim());
        if (!allowedDepotIds(user).contains(depot.getId())) {
            throw new BusinessRunTimeException(403, "当前用户无权使用仓库: " + depotName);
        }
        ResolvedLine line = new ResolvedLine();
        line.barCode = ext.getBarCode();
        line.materialId = material.getId();
        line.materialName = material.getName();
        line.depotId = depot.getId();
        line.depotName = depot.getName();
        line.unit = expected;
        line.qty = qty;
        line.unitPrice = ext.getPurchaseDecimal() == null ? BigDecimal.ZERO : ext.getPurchaseDecimal();
        line.stock = depotItemService.getCurrentStockByParam(depot.getId(), material.getId());
        if (outbound && line.stock.compareTo(qty) < 0) {
            line.stockShort = true;
        }
        return line;
    }

    private Depot findDepot(User user, String depotName) throws Exception {
        Long id = depotService.getIdByName(depotName);
        if (id == null || id == 0L) {
            throw new BusinessRunTimeException(400, "仓库不存在: " + depotName);
        }
        Depot depot = depotService.getDepot(id);
        if (depot == null || depot.getTenantId() == null || !depot.getTenantId().equals(user.getTenantId())) {
            throw new BusinessRunTimeException(400, "仓库不存在或不属于当前租户: " + depotName);
        }
        return depot;
    }

    private Long resolveOrgan(User user, String name, String type) {
        List<Long> ids = jdbcTemplate.query(
                "SELECT id FROM jsh_supplier WHERE supplier=? AND type=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                (rs, i) -> rs.getLong(1), name, type, user.getTenantId());
        if (ids.isEmpty()) {
            throw new BusinessRunTimeException(400, "未找到当前租户下的" + type + ": " + name);
        }
        return ids.get(0);
    }

    private Long defaultAccountId(User user) {
        List<Long> ids = jdbcTemplate.query(
                "SELECT id FROM jsh_account WHERE tenant_id=? AND IFNULL(delete_flag,'0')<>'1' ORDER BY is_default DESC, id ASC LIMIT 1",
                (rs, i) -> rs.getLong(1), user.getTenantId());
        if (ids.isEmpty()) {
            throw new BusinessRunTimeException(400, "当前租户没有结算账户，无法采购入库");
        }
        return ids.get(0);
    }

    private List<Long> allowedDepotIds(User user) {
        List<String> values = jdbcTemplate.query(
                "SELECT `value` FROM jsh_user_business WHERE type='UserDepot' AND key_id=? AND IFNULL(delete_flag,'0')<>'1'",
                (rs, i) -> rs.getString(1), String.valueOf(user.getId()));
        List<Long> ids = new ArrayList<Long>();
        if (values.isEmpty() || values.get(0) == null) {
            return ids;
        }
        Matcher matcher = DEPOT_ID.matcher(values.get(0));
        while (matcher.find()) {
            ids.add(Long.valueOf(matcher.group(1)));
        }
        return ids;
    }

    private JSONObject toRow(ResolvedLine line) {
        JSONObject row = new JSONObject(true);
        row.put("depotId", String.valueOf(line.depotId));
        row.put("depotName", line.depotName);
        row.put("barCode", line.barCode);
        row.put("materialId", line.materialId);
        row.put("name", line.materialName);
        row.put("unit", line.unit);
        row.put("operNumber", line.qty);
        row.put("unitPrice", line.unitPrice);
        row.put("allPrice", line.unitPrice.multiply(line.qty).setScale(2, RoundingMode.HALF_UP));
        row.put("taxRate", 0);
        row.put("taxMoney", 0);
        row.put("taxLastMoney", row.getBigDecimal("allPrice"));
        return row;
    }

    private Map<String, BigDecimal> snapshot(JSONObject payload, String bizType) {
        Map<String, BigDecimal> map = new LinkedHashMap<String, BigDecimal>();
        if ("MIX".equals(bizType)) {
            putStock(map, payload.getJSONObject("finished"));
        }
        JSONArray lines = payload.getJSONArray("lines");
        if (lines != null) {
            for (int i = 0; i < lines.size(); i++) {
                putStock(map, lines.getJSONObject(i));
            }
        }
        return map;
    }

    private void putStock(Map<String, BigDecimal> map, JSONObject line) {
        String key = line.getString("barCode") + "@" + line.getString("depotName");
        map.put(key, depotItemService.getCurrentStockByParam(line.getLong("depotId"), line.getLong("materialId")));
    }

    private BigDecimal sumAmount(JSONArray lines) {
        BigDecimal total = BigDecimal.ZERO;
        for (int i = 0; i < lines.size(); i++) {
            total = total.add(lines.getJSONObject(i).getBigDecimal("allPrice"));
        }
        return total;
    }

    private int countStatus(User user, String status) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM aierp_gateway_draft WHERE tenant_id=? AND user_id=? AND status=?",
                Integer.class, user.getTenantId(), user.getId(), status);
        return n == null ? 0 : n;
    }

    private Map<String, Object> draftView(Map<String, Object> row, boolean replayed) {
        Map<String, Object> view = new LinkedHashMap<String, Object>();
        view.put("draftId", ((Number) row.get("id")).longValue());
        view.put("status", row.get("status"));
        view.put("replayed", replayed);
        view.put("billNumber", row.get("bill_number"));
        view.put("payload", JSON.parseObject(String.valueOf(row.get("payload_json"))));
        return view;
    }

    private Map<String, Object> confirmView(Map<String, Object> row, User user, boolean replayed) throws Exception {
        Map<String, Object> view = new LinkedHashMap<String, Object>();
        view.put("draftId", row.get("id"));
        view.put("status", row.get("status"));
        view.put("replayed", replayed);
        view.put("billNumber", row.get("bill_number"));
        view.put("depotHeadId", row.get("depot_head_id"));
        view.put("loginName", user.getLoginName());
        if (row.get("bill_number") != null) {
            List<Map<String, Object>> heads = jdbcTemplate.queryForList(
                    "SELECT number, type, sub_type, status, organ_id, creator, oper_time FROM jsh_depot_head WHERE number=? AND tenant_id=?",
                    row.get("bill_number"), user.getTenantId());
            view.put("nativeBill", heads.isEmpty() ? null : heads.get(0));
        }
        return view;
    }

    /**
     * ERP session UI confirm: user must own the draft; WeCom ownership reconstructed from draft row.
     */
    public Map<String, Object> confirmUiAs(User sessionUser, long draftId) throws Exception {
        Map<String, Object> row = requireOwnedDraftRow(sessionUser, draftId, null);
        if (row.get("wecom_user_id") == null || row.get("binding_id") == null || row.get("binding_version") == null) {
            // Non-WeCom draft: fall back to classic session confirm path via idempotency is not used here.
            throw new BusinessRunTimeException(400, "该草稿不是企微草稿，请使用原有确认入口");
        }
        WecomDraftOwner owner = new WecomDraftOwner(
                String.valueOf(row.get("channel") == null ? "wecom" : row.get("channel")),
                String.valueOf(row.get("bot_id")),
                String.valueOf(row.get("wecom_user_id")),
                ((Number) row.get("binding_id")).longValue(),
                ((Number) row.get("binding_version")).longValue(),
                row.get("binding_bound_at") == null ? null : String.valueOf(row.get("binding_bound_at")));
        ConfirmEventProof proof = new ConfirmEventProof(
                "确认采购" + draftId, null, false, "ERP_SESSION_UI");
        return confirmAs(sessionUser, owner, draftId, proof);
    }

    private User currentUser() throws Exception {
        User user = userService.getCurrentUser();
        if (user == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "当前会话没有租户身份");
        }
        return user;
    }

    private String required(JSONObject body, String field) {
        if (body == null || body.getString(field) == null || body.getString(field).trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少字段 " + field);
        }
        return body.getString(field).trim();
    }

    private BigDecimal decimal(JSONObject body, String field) {
        try {
            return new BigDecimal(required(body, field));
        } catch (BusinessRunTimeException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "字段不是数字: " + field);
        }
    }

    private String unitOf(String barCode) throws Exception {
        MaterialExtend ext = materialExtendService.getInfoByBarCode(barCode);
        if (ext == null || ext.getCommodityUnit() == null) {
            throw new BusinessRunTimeException(400, "物料不存在: " + barCode);
        }
        return ext.getCommodityUnit();
    }

    private void attachOrRefreshChallenge(User user, WecomDraftOwner owner, Map<String, Object> draftRow,
                                          String payloadHash, Map<String, Object> view) {
        long draftId = ((Number) draftRow.get("id")).longValue();
        int draftVersion = draftRow.get("draft_version") == null ? 1 : ((Number) draftRow.get("draft_version")).intValue();
        String phrase = "确认采购" + draftId;
        // Expire prior pending challenges for this draft.
        jdbcTemplate.update(
                "UPDATE aierp_gateway_confirm_challenge SET status='SUPERSEDED' WHERE draft_id=? AND status='PENDING'",
                draftId);
        String challengeId = randomToken(16);
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime exp = now.plusSeconds(CHALLENGE_TTL_SEC);
        jdbcTemplate.update(
                "INSERT INTO aierp_gateway_confirm_challenge (challenge_id, channel, bot_id, wecom_user_id, tenant_id, "
                        + "erp_user_id, binding_id, binding_version, draft_id, draft_version, payload_hash, "
                        + "expected_phrase, status, expires_at, created_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING', ?, ?)",
                challengeId, owner.channel, owner.botId, owner.wecomUserId, user.getTenantId(), user.getId(),
                owner.bindingId, owner.bindingVersion, draftId, draftVersion, payloadHash, phrase,
                TS.format(exp), TS.format(now));
        jdbcTemplate.update(
                "UPDATE aierp_gateway_draft SET status='AWAITING_CONFIRM', payload_hash=? WHERE id=? AND status IN ('DRAFT','AWAITING_CONFIRM')",
                payloadHash, draftId);
        view.put("status", "AWAITING_CONFIRM");
        view.put("draftVersion", draftVersion);
        Map<String, Object> challenge = new LinkedHashMap<String, Object>();
        challenge.put("expiresInSec", CHALLENGE_TTL_SEC);
        challenge.put("phrase", phrase);
        challenge.put("hint", "回复「" + phrase + "」提交入库；若仅有一个待确认草稿也可回复「确认」。");
        view.put("challenge", challenge);
        view.put("hint", "待确认、未入库。请回复「" + phrase + "」完成审核入库。");
    }

    private void consumeChallengeOrThrow(User user, WecomDraftOwner owner, Map<String, Object> draftRow,
                                         ConfirmEventProof proof) {
        long draftId = ((Number) draftRow.get("id")).longValue();
        int draftVersion = draftRow.get("draft_version") == null ? 1 : ((Number) draftRow.get("draft_version")).intValue();
        String payloadHash = draftRow.get("payload_hash") == null
                ? sha256Hex(String.valueOf(draftRow.get("payload_json")))
                : String.valueOf(draftRow.get("payload_hash"));
        List<Map<String, Object>> challenges = jdbcTemplate.queryForList(
                "SELECT id, challenge_id, payload_hash, draft_version, expected_phrase, expires_at, status "
                        + "FROM aierp_gateway_confirm_challenge WHERE draft_id=? AND channel=? AND bot_id=? "
                        + "AND wecom_user_id=? AND binding_version=? AND erp_user_id=? AND tenant_id=? "
                        + "AND status='PENDING' ORDER BY id DESC FOR UPDATE",
                draftId, owner.channel, owner.botId, owner.wecomUserId, owner.bindingVersion,
                user.getId(), user.getTenantId());
        if (challenges.isEmpty()) {
            throw new BusinessRunTimeException(409, "没有有效的确认挑战，请重新创建草稿");
        }
        Map<String, Object> ch = challenges.get(0);
        LocalDateTime exp = LocalDateTime.parse(String.valueOf(ch.get("expires_at")).replace(' ', 'T').substring(0, 19));
        if (LocalDateTime.now().isAfter(exp)) {
            jdbcTemplate.update("UPDATE aierp_gateway_confirm_challenge SET status='EXPIRED' WHERE id=?", ch.get("id"));
            throw new BusinessRunTimeException(410, "确认已过期，请重新创建采购草稿");
        }
        int chVersion = ((Number) ch.get("draft_version")).intValue();
        if (chVersion != draftVersion) {
            throw new BusinessRunTimeException(409, "草稿版本已变化，请重新确认");
        }
        if (!payloadHash.equals(String.valueOf(ch.get("payload_hash")))) {
            throw new BusinessRunTimeException(409, "草稿内容已变化，请重新确认");
        }
        String expected = String.valueOf(ch.get("expected_phrase"));
        ParsedConfirmIntent intent = parseConfirmIntent(proof.rawText.trim());
        if (!intent.confirm) {
            throw new BusinessRunTimeException(400, "确认原文不匹配，请回复「" + expected + "」");
        }
        if (intent.draftId != null && intent.draftId.longValue() != draftId) {
            throw new BusinessRunTimeException(400, "确认草稿号不匹配");
        }
        String msgId = proof.messageMsgId == null ? null : proof.messageMsgId.trim();
        int n = jdbcTemplate.update(
                "UPDATE aierp_gateway_confirm_challenge SET status='CONSUMED', consumed_at=NOW(), consume_message_id=? "
                        + "WHERE id=? AND status='PENDING'",
                msgId, ch.get("id"));
        if (n != 1) {
            throw new BusinessRunTimeException(409, "确认挑战已被消费，请勿重复提交");
        }
    }

    private static ParsedConfirmIntent parseConfirmIntent(String text) {
        ParsedConfirmIntent out = new ParsedConfirmIntent();
        if (text == null) {
            return out;
        }
        Matcher m = CONFIRM_PURCHASE.matcher(text);
        if (m.matches()) {
            out.confirm = true;
            out.draftId = Long.parseLong(m.group(1));
            return out;
        }
        if (CONFIRM_SIMPLE.matcher(text).matches()) {
            out.confirm = true;
            return out;
        }
        return out;
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

    private static String randomToken(int bytes) {
        byte[] buf = new byte[bytes];
        SECURE_RANDOM.nextBytes(buf);
        StringBuilder sb = new StringBuilder(bytes * 2);
        for (byte b : buf) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static final class ParsedConfirmIntent {
        private boolean confirm;
        private Long draftId;
    }

    private static class ResolvedLine {
        private String barCode;
        private Long materialId;
        private String materialName;
        private Long depotId;
        private String depotName;
        private String unit;
        private BigDecimal qty;
        private BigDecimal unitPrice;
        private BigDecimal stock;
        private boolean stockShort;
    }
}
