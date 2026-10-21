package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import com.jsh.erp.service.UserService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * WeCom ↔ ERP binding + delegated read-only stock. Identity of WeCom user must
 * come from the signed adapter call (OpenClaw trusted ctx), never from the LLM.
 */
@Service
public class AierpWecomBindingService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String CHANNEL = "wecom";
    private static final long CODE_TTL_SEC = 300L;
    private static final int MAX_ISSUE_PER_USER_PER_HOUR = 10;

    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    @Lazy
    private UserService userService;
    @Resource
    @Lazy
    private AierpGatewayService gatewayService;
    @Resource
    private PlatformTransactionManager transactionManager;

    @Value("${aierp.wecom.default-bot-id:}")
    private String defaultBotId;

    private final ConcurrentHashMap<String, AtomicInteger> issueWindow = new ConcurrentHashMap<String, AtomicInteger>();
    private volatile long issueWindowStartMs = System.currentTimeMillis();

    public Map<String, Object> issueBindCode(JSONObject body) {
        String wecomUserId = requiredTrusted(body, "wecomUserId");
        String botId = firstNonEmpty(body.getString("botId"), defaultBotId, "default");
        rateLimitIssue(wecomUserId);
        String code = generateCode();
        String hash = sha256(code);
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime exp = now.plusSeconds(CODE_TTL_SEC);
        jdbcTemplate.update(
                "INSERT INTO aierp_wecom_bind_code (code_hash, channel, bot_id, wecom_user_id, status, expires_at, created_at) VALUES (?,?,?,?, 'PENDING', ?, ?)",
                hash, CHANNEL, botId, wecomUserId, TS.format(exp), TS.format(now));
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("bindCode", code);
        data.put("expiresInSec", CODE_TTL_SEC);
        data.put("channel", CHANNEL);
        data.put("botId", botId);
        data.put("hint", "请在已登录的 ERP 工作台输入此绑定码（5 分钟内有效，一次性）");
        return data;
    }

    public Map<String, Object> claimBindCode(JSONObject body, HttpServletRequest request) throws Exception {
        final User user = userService.getCurrentUser();
        if (user == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "请先登录 ERP 再绑定企业微信");
        }
        final String code = requiredTrusted(body, "bindCode").toUpperCase();
        if (!code.matches("^[A-Z0-9]{8}$")) {
            throw new BusinessRunTimeException(400, "绑定码格式无效");
        }
        final String hash = sha256(code);
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(status -> {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT id, wecom_user_id, bot_id, status, expires_at FROM aierp_wecom_bind_code WHERE code_hash=? FOR UPDATE",
                    hash);
            if (rows.isEmpty()) {
                throw new BusinessRunTimeException(404, "绑定码不存在或已失效");
            }
            Map<String, Object> row = rows.get(0);
            if (!"PENDING".equals(String.valueOf(row.get("status")))) {
                throw new BusinessRunTimeException(409, "绑定码已使用，不能重复消费");
            }
            LocalDateTime exp = LocalDateTime.parse(String.valueOf(row.get("expires_at")).replace(' ', 'T').substring(0, 19));
            if (LocalDateTime.now().isAfter(exp)) {
                jdbcTemplate.update("UPDATE aierp_wecom_bind_code SET status='EXPIRED' WHERE id=?", row.get("id"));
                throw new BusinessRunTimeException(410, "绑定码已过期，请在企微重新申请");
            }
            String wecomUserId = String.valueOf(row.get("wecom_user_id"));
            String botId = String.valueOf(row.get("bot_id"));
            LocalDateTime now = LocalDateTime.now();
            int updated = jdbcTemplate.update(
                    "UPDATE aierp_wecom_bind_code SET status='CONSUMED', consumed_at=? WHERE id=? AND status='PENDING'",
                    TS.format(now), row.get("id"));
            if (updated != 1) {
                throw new BusinessRunTimeException(409, "绑定码消费冲突，请重试");
            }
            List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                    "SELECT id FROM aierp_wecom_binding WHERE channel=? AND bot_id=? AND wecom_user_id=?",
                    CHANNEL, botId, wecomUserId);
            if (existing.isEmpty()) {
                jdbcTemplate.update(
                        "INSERT INTO aierp_wecom_binding (channel, bot_id, wecom_user_id, tenant_id, erp_user_id, erp_login_name, status, bound_at, updated_at) VALUES (?,?,?,?,?,?, 'ACTIVE', ?, ?)",
                        CHANNEL, botId, wecomUserId, user.getTenantId(), user.getId(), user.getLoginName(),
                        TS.format(now), TS.format(now));
            } else {
                jdbcTemplate.update(
                        "UPDATE aierp_wecom_binding SET tenant_id=?, erp_user_id=?, erp_login_name=?, status='ACTIVE', bound_at=?, unbound_at=NULL, updated_at=? WHERE channel=? AND bot_id=? AND wecom_user_id=?",
                        user.getTenantId(), user.getId(), user.getLoginName(), TS.format(now), TS.format(now),
                        CHANNEL, botId, wecomUserId);
            }
            Map<String, Object> data = new LinkedHashMap<String, Object>();
            data.put("status", "ACTIVE");
            data.put("wecomUserIdMasked", mask(wecomUserId));
            data.put("erpLoginName", user.getLoginName());
            data.put("tenantId", user.getTenantId());
            data.put("boundAt", TS.format(now));
            return data;
        });
    }

    public Map<String, Object> bindingStatus(JSONObject body) throws Exception {
        String wecomUserId = requiredTrusted(body, "wecomUserId");
        String botId = firstNonEmpty(body.getString("botId"), defaultBotId, "default");
        Map<String, Object> binding = findActiveBinding(botId, wecomUserId);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        if (binding == null) {
            data.put("bound", false);
            data.put("status", "UNBOUND");
            data.put("hint", "请先发送「绑定ERP」获取绑定码，并在已登录的 ERP 工作台完成绑定");
            return data;
        }
        data.put("bound", true);
        data.put("status", "ACTIVE");
        data.put("erpLoginName", binding.get("erp_login_name"));
        data.put("tenantId", binding.get("tenant_id"));
        data.put("wecomUserIdMasked", mask(wecomUserId));
        data.put("boundAt", String.valueOf(binding.get("bound_at")));
        return data;
    }

    public Map<String, Object> unbind(JSONObject body) {
        String wecomUserId = requiredTrusted(body, "wecomUserId");
        String botId = firstNonEmpty(body.getString("botId"), defaultBotId, "default");
        LocalDateTime now = LocalDateTime.now();
        int n = jdbcTemplate.update(
                "UPDATE aierp_wecom_binding SET status='UNBOUND', unbound_at=?, updated_at=? WHERE channel=? AND bot_id=? AND wecom_user_id=? AND status='ACTIVE'",
                TS.format(now), TS.format(now), CHANNEL, botId, wecomUserId);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("unbound", n > 0);
        data.put("status", "UNBOUND");
        return data;
    }

    public Map<String, Object> stockQueryDelegated(JSONObject body) throws Exception {
        User user = resolveBoundActiveUser(body);
        JSONObject query = new JSONObject();
        if (body.getString("barCode") != null) {
            query.put("barCode", body.getString("barCode"));
        }
        if (body.getString("depotName") != null) {
            query.put("depotName", body.getString("depotName"));
        }
        if (body.getString("query") != null) {
            query.put("query", body.getString("query"));
        }
        if (body.getString("materialName") != null) {
            query.put("materialName", body.getString("materialName"));
        }
        Map<String, Object> result = gatewayService.stockQueryAs(user, query);
        result.put("boundErpLoginName", user.getLoginName());
        result.put("asOf", TS.format(LocalDateTime.now()));
        return result;
    }

    /**
     * Resolve WeCom trusted identity → active ERP user. Rejects spoofed identity fields.
     * Used by stock (012A) and draft prepare/status/cancel (015A). No HTTP session.
     */
    public User resolveBoundActiveUser(JSONObject body) throws Exception {
        String wecomUserId = requiredTrusted(body, "wecomUserId");
        String botId = firstNonEmpty(body.getString("botId"), defaultBotId, "default");
        if (body.containsKey("erpUserId") || body.containsKey("tenantId") || body.containsKey("token")
                || body.containsKey("X-Access-Token") || body.containsKey("accessToken")) {
            throw new BusinessRunTimeException(400, "拒绝客户端伪造身份字段");
        }
        Map<String, Object> binding = findActiveBinding(botId, wecomUserId);
        if (binding == null) {
            throw new BusinessRunTimeException(401, "尚未绑定 ERP，请先发送「绑定ERP」");
        }
        long erpUserId = ((Number) binding.get("erp_user_id")).longValue();
        long boundTenantId = ((Number) binding.get("tenant_id")).longValue();
        User user = loadUserById(erpUserId);
        assertActiveUserAndTenant(user, boundTenantId);
        return user;
    }

    private Map<String, Object> findActiveBinding(String botId, String wecomUserId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM aierp_wecom_binding WHERE channel=? AND bot_id=? AND wecom_user_id=? AND status='ACTIVE' LIMIT 1",
                CHANNEL, botId, wecomUserId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private User loadUserById(long erpUserId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, login_name, tenant_id, status FROM jsh_user WHERE id=? AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                erpUserId);
        if (rows.isEmpty()) {
            return null;
        }
        Map<String, Object> row = rows.get(0);
        User user = new User();
        user.setId(((Number) row.get("id")).longValue());
        user.setLoginName(String.valueOf(row.get("login_name")));
        if (row.get("tenant_id") != null) {
            user.setTenantId(((Number) row.get("tenant_id")).longValue());
        }
        if (row.get("status") != null) {
            user.setStatus(((Number) row.get("status")).byteValue());
        }
        return user;
    }

    /**
     * Real-time authz: disabled users / disabled or expired tenants cannot use a stale binding.
     * Bound tenantId is only for cross-check — never elevates identity.
     */
    void assertActiveUserAndTenant(User user, long boundTenantId) {
        if (user == null || user.getId() == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "绑定的 ERP 用户无效，请重新绑定");
        }
        if (!user.getTenantId().equals(boundTenantId)) {
            throw new BusinessRunTimeException(403, "绑定租户与 ERP 用户租户不一致，请重新绑定");
        }
        if (user.getStatus() == null || user.getStatus().byteValue() != 0) {
            throw new BusinessRunTimeException(403, "ERP 用户已禁用，无法查询库存");
        }
        List<Map<String, Object>> tenants = jdbcTemplate.queryForList(
                "SELECT tenant_id, enabled, expire_time FROM jsh_tenant WHERE tenant_id=? LIMIT 1",
                user.getTenantId());
        if (tenants.isEmpty()) {
            throw new BusinessRunTimeException(403, "ERP 租户不存在，无法查询库存");
        }
        Map<String, Object> tenant = tenants.get(0);
        // Mirror UserService.validateUser: reject only when enabled is present and false.
        if (tenant.get("enabled") != null && !isTenantEnabledFlag(tenant.get("enabled"))) {
            throw new BusinessRunTimeException(403, "ERP 租户已停用，无法查询库存");
        }
        Object expire = tenant.get("expire_time");
        if (expire != null) {
            java.sql.Timestamp expTs;
            if (expire instanceof java.sql.Timestamp) {
                expTs = (java.sql.Timestamp) expire;
            } else if (expire instanceof java.util.Date) {
                expTs = new java.sql.Timestamp(((java.util.Date) expire).getTime());
            } else {
                expTs = java.sql.Timestamp.valueOf(String.valueOf(expire).replace('T', ' ').substring(0, 19));
            }
            if (expTs.getTime() < System.currentTimeMillis()) {
                throw new BusinessRunTimeException(403, "ERP 租户已过期，无法查询库存");
            }
        }
    }

    /** MySQL BIT(1) may arrive as Boolean, Number, or byte[]. */
    private static boolean isTenantEnabledFlag(Object enabled) {
        if (enabled instanceof Boolean) {
            return (Boolean) enabled;
        }
        if (enabled instanceof Number) {
            return ((Number) enabled).intValue() != 0;
        }
        if (enabled instanceof byte[]) {
            byte[] bits = (byte[]) enabled;
            return bits.length > 0 && bits[0] != 0;
        }
        String s = String.valueOf(enabled).trim().toLowerCase();
        return !"0".equals(s) && !"false".equals(s) && !"b'0'".equals(s);
    }

    private void rateLimitIssue(String wecomUserId) {
        long now = System.currentTimeMillis();
        if (now - issueWindowStartMs > 3_600_000L) {
            issueWindow.clear();
            issueWindowStartMs = now;
        }
        AtomicInteger counter = issueWindow.computeIfAbsent(wecomUserId, k -> new AtomicInteger(0));
        if (counter.incrementAndGet() > MAX_ISSUE_PER_USER_PER_HOUR) {
            throw new BusinessRunTimeException(429, "绑定码申请过于频繁，请稍后再试");
        }
    }

    private static String generateCode() {
        final String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder(8);
        for (int i = 0; i < 8; i++) {
            sb.append(alphabet.charAt(RANDOM.nextInt(alphabet.length())));
        }
        return sb.toString();
    }

    private static String sha256(String value) {
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

    private static String requiredTrusted(JSONObject body, String field) {
        if (body == null || body.getString(field) == null || body.getString(field).trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少字段 " + field);
        }
        return body.getString(field).trim();
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) {
            return "";
        }
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) {
                return v.trim();
            }
        }
        return "";
    }

    private static String mask(String id) {
        if (id == null || id.length() < 4) {
            return "***";
        }
        return id.substring(0, 2) + "***" + id.substring(id.length() - 2);
    }
}
