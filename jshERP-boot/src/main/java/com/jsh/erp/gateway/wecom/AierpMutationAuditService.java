package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.gateway.AierpGatewayService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AIERP-022A: append-only mutation audit + versioned receipt PDF hooks.
 * Reusable by PURCHASE / MIX / SERVICE now; partner / material / batch later.
 * Never posts inventory; failures here must not roll back native ERP success.
 */
@Service
public class AierpMutationAuditService {

    public static final String ACTION_PURCHASE_IN = "PURCHASE_IN";
    public static final String ACTION_MIX = "MIX";
    public static final String ACTION_SERVICE_CONSUME = "SERVICE_CONSUME";
    public static final String ACTION_PARTNER_CREATE = "PARTNER_CREATE";
    public static final String ACTION_PARTNER_UPDATE = "PARTNER_UPDATE";
    public static final String ACTION_MATERIAL_CREATE = "MATERIAL_CREATE";
    public static final String ACTION_MATERIAL_UPDATE = "MATERIAL_UPDATE";
    public static final String ACTION_DRAFT_CANCEL = "DRAFT_CANCEL";
    public static final String ACTION_BATCH_PURCHASE = "BATCH_PURCHASE";
    public static final String ACTION_PDF_LAYOUT = "PDF_LAYOUT";

    public static final String STATUS_COMMITTED = "COMMITTED";
    public static final String STATUS_POSTED = "POSTED";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_REJECTED = "REJECTED";
    public static final String STATUS_REPLAY_NOOP = "REPLAY_NOOP";
    public static final String STATUS_PDF_GENERATED = "PDF_GENERATED";
    public static final String STATUS_PDF_FAILED = "PDF_FAILED";

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();

    @Resource
    private JdbcTemplate jdbcTemplate;

    /** Append-only audit row. Best-effort: swallows storage errors so PDF/audit never re-posts stock. */
    public String recordEvent(AuditEvent event) {
        if (event == null || event.tenantId == null || event.action == null || event.status == null) {
            return null;
        }
        String eventId = event.eventId != null ? event.eventId : randomToken(16);
        String now = TS.format(LocalDateTime.now());
        try {
            jdbcTemplate.update(
                    "INSERT INTO aierp_gateway_audit_event ("
                            + "event_id, tenant_id, actor_user_id, bot_id, wecom_user_id, binding_id, binding_version, "
                            + "trace_id, message_msg_id, action, status, natural_key, native_bill, draft_id, receipt_id, "
                            + "canonical_hash, before_json, after_json, detail_json, pdf_layout_version, pdf_sha256, "
                            + "delivery_status, created_at) "
                            + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    eventId,
                    event.tenantId,
                    event.actorUserId,
                    nullToNull(event.botId),
                    nullToNull(event.wecomUserId),
                    event.bindingId,
                    event.bindingVersion,
                    nullToNull(event.traceId),
                    nullToNull(event.messageMsgId),
                    event.action,
                    event.status,
                    nullToNull(event.naturalKey),
                    nullToNull(event.nativeBill),
                    event.draftId,
                    nullToNull(event.receiptId),
                    nullToNull(event.canonicalHash),
                    toJson(event.before),
                    toJson(event.after),
                    toJson(event.detail),
                    event.pdfLayoutVersion,
                    nullToNull(event.pdfSha256),
                    nullToNull(event.deliveryStatus),
                    now);
            return eventId;
        } catch (Exception ignored) {
            // Schema may not be applied yet in older demos; never fail the business write.
            return null;
        }
    }

    /** Record a successful native bill confirmation (or REPLAY_NOOP). */
    public void recordBillMutation(User user, AierpGatewayService.WecomDraftOwner owner,
                                   String action, String status, Map<String, Object> confirmed,
                                   String receiptId, Integer layoutVersion, String pdfSha) {
        if (user == null || confirmed == null) {
            return;
        }
        AuditEvent e = new AuditEvent();
        e.tenantId = user.getTenantId();
        e.actorUserId = user.getId();
        if (owner != null) {
            e.botId = owner.botId;
            e.wecomUserId = owner.wecomUserId;
            e.bindingId = owner.bindingId;
            e.bindingVersion = owner.bindingVersion;
        }
        e.action = action;
        e.status = status;
        e.nativeBill = str(confirmed.get("billNumber"));
        e.naturalKey = e.nativeBill;
        if (confirmed.get("draftId") != null) {
            try {
                e.draftId = Long.parseLong(String.valueOf(confirmed.get("draftId")));
            } catch (Exception ignored) {
                // optional
            }
        }
        e.receiptId = receiptId;
        e.pdfLayoutVersion = layoutVersion;
        e.pdfSha256 = pdfSha;
        e.before = confirmed.get("stockBefore");
        e.after = confirmed.get("stockAfter");
        Map<String, Object> detail = new LinkedHashMap<String, Object>();
        detail.put("bizType", confirmed.get("bizType"));
        detail.put("replayed", confirmed.get("replayed"));
        detail.put("posted", confirmed.get("posted"));
        detail.put("stockUnchanged", confirmed.get("stockUnchanged"));
        e.detail = detail;
        e.deliveryStatus = str(confirmed.get("deliveryStatus"));
        recordEvent(e);
    }

    /**
     * Append a PDF version row. Unique (receipt_id, layout_version) — never updates existing.
     * @return true if inserted; false if already present or table missing
     */
    public boolean recordPdfVersion(String receiptId, int layoutVersion, String sha256,
                                    String storageRef, String fileName, long byteLength) {
        if (receiptId == null || sha256 == null || storageRef == null) {
            return false;
        }
        String now = TS.format(LocalDateTime.now());
        try {
            int n = jdbcTemplate.update(
                    "INSERT IGNORE INTO aierp_gateway_receipt_pdf_version "
                            + "(receipt_id, layout_version, pdf_sha256, pdf_storage_ref, file_name, byte_length, created_at) "
                            + "VALUES (?,?,?,?,?,?,?)",
                    receiptId, layoutVersion, sha256, storageRef,
                    fileName == null ? "receipt.pdf" : fileName, byteLength, now);
            return n > 0;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Hook for future partner/material/batch writers — same append-only contract. */
    public String recordMasterdataMutation(User user, AierpGatewayService.WecomDraftOwner owner,
                                           String action, String status, String naturalKey,
                                           Object before, Object after, Map<String, Object> detail) {
        AuditEvent e = new AuditEvent();
        if (user != null) {
            e.tenantId = user.getTenantId();
            e.actorUserId = user.getId();
        }
        if (owner != null) {
            e.botId = owner.botId;
            e.wecomUserId = owner.wecomUserId;
            e.bindingId = owner.bindingId;
            e.bindingVersion = owner.bindingVersion;
        }
        e.action = action;
        e.status = status;
        e.naturalKey = naturalKey;
        e.before = before;
        e.after = after;
        e.detail = detail;
        return recordEvent(e);
    }

    public static String actionForReceiptKind(String receiptKind) {
        if ("MIX".equals(receiptKind)) {
            return ACTION_MIX;
        }
        if ("SERVICE".equals(receiptKind)) {
            return ACTION_SERVICE_CONSUME;
        }
        return ACTION_PURCHASE_IN;
    }

    private static String toJson(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof String) {
            return (String) o;
        }
        try {
            return JSON.toJSONString(o);
        } catch (Exception ex) {
            return null;
        }
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static String nullToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
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

    /** Mutable builder-style DTO for audit append. */
    public static class AuditEvent {
        public String eventId;
        public Long tenantId;
        public Long actorUserId;
        public String botId;
        public String wecomUserId;
        public Long bindingId;
        public Long bindingVersion;
        public String traceId;
        public String messageMsgId;
        public String action;
        public String status;
        public String naturalKey;
        public String nativeBill;
        public Long draftId;
        public String receiptId;
        public String canonicalHash;
        public Object before;
        public Object after;
        public Object detail;
        public Integer pdfLayoutVersion;
        public String pdfSha256;
        public String deliveryStatus;
    }
}
