package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import com.itextpdf.text.Document;
import com.itextpdf.text.Element;
import com.itextpdf.text.Font;
import com.itextpdf.text.PageSize;
import com.itextpdf.text.Paragraph;
import com.itextpdf.text.pdf.BaseFont;
import com.itextpdf.text.pdf.PdfPCell;
import com.itextpdf.text.pdf.PdfPTable;
import com.itextpdf.text.pdf.PdfWriter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AIERP-015B/015C: business receipt text + PDF from real CONFIRMED native bills.
 * 015C adds trusted WeCom HMAC find/file (never invent PDF; never re-post stock).
 */
@Service
public class AierpWecomReceiptService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern DEPOT_ID = Pattern.compile("\\[(\\d+)\\]");
    private static final Pattern SAFE_BILL = Pattern.compile("^[A-Za-z0-9\\-]{3,64}$");
    private static final Pattern SAFE_RECEIPT_ID = Pattern.compile("^[a-fA-F0-9]{16,64}$");
    private static final long MAX_PDF_BYTES = 5L * 1024 * 1024;
    private static final int RECENT_CANDIDATE_LIMIT = 8;

    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private AierpWecomBindingService bindingService;

    @Value("${aierp.receipt.storage-dir:/opt/jshERP/receipts}")
    private String storageDir;

    public Map<String, Object> enrichConfirmResult(User user, AierpGatewayService.WecomDraftOwner owner,
                                                   Map<String, Object> confirmed) throws Exception {
        if (confirmed == null || confirmed.get("billNumber") == null
                || !"CONFIRMED".equals(String.valueOf(confirmed.get("status")))) {
            return confirmed;
        }
        String billNumber = String.valueOf(confirmed.get("billNumber"));
        Map<String, Object> receipt = ensureReceipt(user, owner, confirmed);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.putAll(confirmed);
        out.put("receiptId", receipt.get("receipt_id"));
        out.put("receiptText", receipt.get("text_body"));
        out.put("receiptStatus", "RECEIPT_TEXT_READY");
        out.put("pdfStatus", receipt.get("pdf_status"));
        out.put("deliveryStatus", receipt.get("delivery_status"));
        out.put("hint", String.valueOf(receipt.get("text_body")));
        putDisplayFacts(out, receipt);
        return out;
    }

    /** Expose receipt_json line/stock fields so WeCom renderer can format cleanly. */
    private void putDisplayFacts(Map<String, Object> out, Map<String, Object> receipt) {
        try {
            JSONObject facts = JSON.parseObject(String.valueOf(receipt.get("receipt_json")));
            if (facts == null) {
                return;
            }
            if (out.get("partnerName") == null && facts.get("partnerName") != null) {
                out.put("partnerName", facts.get("partnerName"));
            }
            if (out.get("lines") == null && facts.get("lines") != null) {
                out.put("lines", facts.get("lines"));
            }
            if (out.get("stockBefore") == null && facts.get("stockBefore") != null) {
                out.put("stockBefore", facts.get("stockBefore"));
            }
            if (out.get("stockAfter") == null && facts.get("stockAfter") != null) {
                out.put("stockAfter", facts.get("stockAfter"));
            }
        } catch (Exception ignored) {
            // display-only
        }
    }

    public Map<String, Object> ensureReceipt(User user, AierpGatewayService.WecomDraftOwner owner,
                                             Map<String, Object> confirmed) throws Exception {
        String billNumber = String.valueOf(confirmed.get("billNumber"));
        List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                "SELECT * FROM aierp_gateway_receipt WHERE tenant_id=? AND bill_number=?",
                user.getTenantId(), billNumber);
        if (!existing.isEmpty()) {
            Map<String, Object> row = existing.get(0);
            // Retry PDF once if prior generation failed (e.g. missing CJK font in container).
            if ("PDF_FAILED".equals(String.valueOf(row.get("pdf_status")))
                    || "NONE".equals(String.valueOf(row.get("pdf_status")))) {
                tryRetryPdf(user, row, confirmed);
                List<Map<String, Object>> refreshed = jdbcTemplate.queryForList(
                        "SELECT * FROM aierp_gateway_receipt WHERE tenant_id=? AND bill_number=?",
                        user.getTenantId(), billNumber);
                if (!refreshed.isEmpty()) {
                    return refreshed.get(0);
                }
            }
            return row;
        }
        Map<String, Object> facts = buildFacts(user, confirmed);
        String text = renderText(facts);
        String receiptId = randomToken(16);
        String now = TS.format(LocalDateTime.now());
        Long draftId = confirmed.get("draftId") != null
                ? Long.parseLong(String.valueOf(confirmed.get("draftId")))
                : parseDraftIdFromBill(billNumber);
        Long depotHeadId = confirmed.get("depotHeadId") == null ? null
                : Long.parseLong(String.valueOf(confirmed.get("depotHeadId")));
        Long bindingVersion = owner == null ? null : owner.bindingVersion;
        String wecomUserId = owner == null ? null : owner.wecomUserId;

        String pdfStatus = "NONE";
        String pdfSha = null;
        String pdfRef = null;
        String delivery = "TEXT_ONLY";
        try {
            byte[] pdf = renderPdf(facts);
            File dir = new File(storageDir);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new BusinessRunTimeException(500, "无法创建回执存储目录");
            }
            String fileName = "采购入库业务回执_" + billNumber + ".pdf";
            File out = new File(dir, receiptId + "_" + fileName);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(pdf);
            }
            pdfSha = sha256Hex(pdf);
            pdfRef = out.getAbsolutePath();
            pdfStatus = "PDF_GENERATED";
            delivery = "PDF_DELIVERY_NOT_VERIFIED";
        } catch (Exception ex) {
            pdfStatus = "PDF_FAILED";
            delivery = "TEXT_ONLY";
            facts.put("pdfError", String.valueOf(ex.getMessage()));
        }

        jdbcTemplate.update(
                "INSERT INTO aierp_gateway_receipt (receipt_id, tenant_id, actor_user_id, draft_id, bill_number, "
                        + "depot_head_id, binding_version, wecom_user_id, receipt_json, text_body, pdf_sha256, "
                        + "pdf_storage_ref, pdf_status, delivery_status, created_at, updated_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                receiptId, user.getTenantId(), user.getId(), draftId, billNumber, depotHeadId,
                bindingVersion, wecomUserId, JSON.toJSONString(facts), text, pdfSha, pdfRef,
                pdfStatus, delivery, now, now);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM aierp_gateway_receipt WHERE receipt_id=?", receiptId);
        return rows.get(0);
    }

    public byte[] loadPdfBytes(User user, String receiptId) {
        if (user == null || user.getId() == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "请先登录 ERP");
        }
        // Re-check live user + tenant (revoked/disabled sessions must not keep reading PDFs).
        bindingService.assertSessionUserLive(user);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM aierp_gateway_receipt WHERE receipt_id=? AND tenant_id=? AND actor_user_id=?",
                receiptId, user.getTenantId(), user.getId());
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, "回执不存在或无权访问");
        }
        Map<String, Object> receipt = rows.get(0);
        assertReceiptBillStillVisible(user, receipt);
        return readPdfSecure(receipt);
    }

    /**
     * AIERP-015C: list authorized receipts for trusted WeCom sender (HMAC adapter only).
     * Does not invent bills; does not post stock.
     */
    public Map<String, Object> findForWecom(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        String billNumber = sanitizeBillNumber(body == null ? null : body.getString("billNumber"));
        String receiptId = sanitizeReceiptId(body == null ? null : body.getString("receiptId"));
        List<Map<String, Object>> rows = queryAuthorizedReceipts(ctx, billNumber, receiptId);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("count", rows.size());
        out.put("ambiguous", rows.size() > 1 && billNumber == null && receiptId == null);
        List<Map<String, Object>> candidates = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> row : rows) {
            candidates.add(summarizeCandidate(row));
        }
        out.put("candidates", candidates);
        if (rows.size() == 1) {
            out.put("receiptId", rows.get(0).get("receipt_id"));
            out.put("billNumber", rows.get(0).get("bill_number"));
            out.put("pdfStatus", rows.get(0).get("pdf_status"));
            out.put("deliveryStatus", rows.get(0).get("delivery_status"));
        }
        if (rows.isEmpty()) {
            out.put("userSummaryZh", "暂未找到可访问的已审核采购入库回执。");
        } else if (rows.size() > 1 && billNumber == null && receiptId == null) {
            StringBuilder sb = new StringBuilder("找到多张可访问的已审核回执，请回复其中一张单号：\n");
            for (Map<String, Object> c : candidates) {
                sb.append("- ").append(c.get("billNumber"));
                if (c.get("summaryLine") != null) {
                    sb.append(" · ").append(c.get("summaryLine"));
                }
                sb.append("\n");
            }
            out.put("userSummaryZh", sb.toString().trim());
        } else {
            out.put("userSummaryZh", buildUserSummaryZh(rows.get(0), false));
        }
        return out;
    }

    /**
     * AIERP-015C: load authorized receipt PDF as base64 for WeCom MEDIA send.
     * Marks handoff only; PDF_SENT_VERIFIED stays for client-open UAT.
     */
    public Map<String, Object> fileForWecom(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        String billNumber = sanitizeBillNumber(body == null ? null : body.getString("billNumber"));
        String receiptId = sanitizeReceiptId(body == null ? null : body.getString("receiptId"));
        List<Map<String, Object>> rows = queryAuthorizedReceipts(ctx, billNumber, receiptId);
        if (rows.isEmpty()) {
            Map<String, Object> miss = new LinkedHashMap<String, Object>();
            miss.put("found", false);
            miss.put("userSummaryZh", "暂未找到可访问的已审核采购入库回执。");
            miss.put("deliveryStatus", "PDF_DELIVERY_NOT_VERIFIED");
            return miss;
        }
        if (rows.size() > 1 && billNumber == null && receiptId == null) {
            Map<String, Object> amb = findForWecom(body);
            amb.put("found", false);
            amb.put("needChoice", true);
            return amb;
        }
        Map<String, Object> receipt = rows.get(0);
        if (!"PDF_GENERATED".equals(String.valueOf(receipt.get("pdf_status")))) {
            throw new BusinessRunTimeException(404, "该回执 PDF 尚未生成，请登录 ERP 查看文本回执");
        }
        // Refresh layout from stored facts (no re-post); keeps Demo PDF format current.
        receipt = refreshPdfLayout(receipt);
        byte[] pdf = readPdfSecure(receipt);
        String fileName = "采购入库业务回执_" + receipt.get("bill_number") + ".pdf";
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("found", true);
        out.put("receiptId", receipt.get("receipt_id"));
        out.put("billNumber", receipt.get("bill_number"));
        out.put("mime", "application/pdf");
        out.put("fileName", fileName);
        out.put("fileBase64", Base64.getEncoder().encodeToString(pdf));
        out.put("pdfSha256", receipt.get("pdf_sha256"));
        out.put("byteLength", pdf.length);
        out.put("pdfStatus", receipt.get("pdf_status"));
        // Adapter handoff ≠ client verified open
        out.put("deliveryStatus", "PDF_DELIVERY_NOT_VERIFIED");
        out.put("userSummaryZh", buildUserSummaryZh(receipt, true));
        putDisplayFacts(out, receipt);
        jdbcTemplate.update(
                "UPDATE aierp_gateway_receipt SET delivery_status='PDF_ADAPTER_HANDED', updated_at=? WHERE id=?",
                TS.format(LocalDateTime.now()), receipt.get("id"));
        return out;
    }

    /**
     * Rebuild PDF bytes from receipt_json using current renderer (stock table, clean decimals).
     * Never posts inventory; only rewrites the stored PDF file + hash.
     */
    private Map<String, Object> refreshPdfLayout(Map<String, Object> row) {
        try {
            JSONObject factsJson = JSON.parseObject(String.valueOf(row.get("receipt_json")));
            if (factsJson == null) {
                return row;
            }
            Map<String, Object> facts = normalizeFacts(factsJson);
            byte[] pdf = renderPdf(facts);
            String text = renderText(facts);
            File dir = new File(storageDir);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new BusinessRunTimeException(500, "无法创建回执存储目录");
            }
            Path root = dir.getCanonicalFile().toPath().normalize();
            Path file;
            Object ref = row.get("pdf_storage_ref");
            if (ref != null && !String.valueOf(ref).trim().isEmpty()) {
                Path candidate = new File(String.valueOf(ref)).getCanonicalFile().toPath().normalize();
                if (candidate.startsWith(root)) {
                    file = candidate;
                } else {
                    file = root.resolve(row.get("receipt_id") + "_采购入库业务回执_" + row.get("bill_number") + ".pdf");
                }
            } else {
                file = root.resolve(row.get("receipt_id") + "_采购入库业务回执_" + row.get("bill_number") + ".pdf");
            }
            Files.createDirectories(file.getParent());
            Files.write(file, pdf);
            String sha = sha256Hex(pdf);
            String now = TS.format(LocalDateTime.now());
            jdbcTemplate.update(
                    "UPDATE aierp_gateway_receipt SET pdf_sha256=?, pdf_storage_ref=?, text_body=?, "
                            + "pdf_status='PDF_GENERATED', updated_at=? WHERE id=?",
                    sha, file.toAbsolutePath().toString(), text, now, row.get("id"));
            row.put("pdf_sha256", sha);
            row.put("pdf_storage_ref", file.toAbsolutePath().toString());
            row.put("text_body", text);
            row.put("pdf_status", "PDF_GENERATED");
            return row;
        } catch (Exception ex) {
            return row;
        }
    }

    private static Map<String, Object> normalizeFacts(JSONObject src) {
        Map<String, Object> facts = new LinkedHashMap<String, Object>();
        for (String key : src.keySet()) {
            if ("lines".equals(key)) {
                continue;
            }
            facts.put(key, src.get(key));
        }
        List<Map<String, Object>> lineList = new ArrayList<Map<String, Object>>();
        JSONArray lines = src.getJSONArray("lines");
        if (lines != null) {
            for (int i = 0; i < lines.size(); i++) {
                JSONObject line = lines.getJSONObject(i);
                if (line == null) {
                    continue;
                }
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                for (String k : line.keySet()) {
                    row.put(k, line.get(k));
                }
                lineList.add(row);
            }
        }
        facts.put("lines", lineList);
        return facts;
    }

    private List<Map<String, Object>> queryAuthorizedReceipts(
            AierpWecomBindingService.BoundContext ctx, String billNumber, String receiptId) {
        User user = ctx.user;
        long liveVersion = ctx.binding.get("binding_version") == null
                ? 0L : ((Number) ctx.binding.get("binding_version")).longValue();
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM aierp_gateway_receipt WHERE tenant_id=? AND actor_user_id=? "
                        + "AND wecom_user_id=? AND binding_version=? AND pdf_status='PDF_GENERATED'");
        List<Object> args = new ArrayList<Object>();
        args.add(user.getTenantId());
        args.add(user.getId());
        args.add(ctx.wecomUserId);
        args.add(liveVersion);
        if (receiptId != null) {
            sql.append(" AND receipt_id=?");
            args.add(receiptId);
        }
        if (billNumber != null) {
            sql.append(" AND bill_number=?");
            args.add(billNumber);
        }
        sql.append(" ORDER BY created_at DESC, id DESC LIMIT ").append(RECENT_CANDIDATE_LIMIT);
        List<Map<String, Object>> raw = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        List<Map<String, Object>> visible = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> row : raw) {
            try {
                assertReceiptBillStillVisible(user, row);
                assertNativeBillConfirmed(user, row);
                visible.add(row);
            } catch (BusinessRunTimeException ex) {
                // skip unauthorized / revoked depot / unapproved
            }
        }
        return visible;
    }

    private void assertNativeBillConfirmed(User user, Map<String, Object> receipt) {
        List<Map<String, Object>> heads = jdbcTemplate.queryForList(
                "SELECT id, status FROM jsh_depot_head WHERE number=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                receipt.get("bill_number"), user.getTenantId());
        if (heads.isEmpty() || !"1".equals(String.valueOf(heads.get(0).get("status")))) {
            throw new BusinessRunTimeException(403, "原生单据未审核或不可用");
        }
    }

    private byte[] readPdfSecure(Map<String, Object> receipt) {
        Object ref = receipt.get("pdf_storage_ref");
        if (ref == null || String.valueOf(ref).trim().isEmpty()) {
            throw new BusinessRunTimeException(404, "回执 PDF 尚未生成");
        }
        try {
            Path root = new File(storageDir).getCanonicalFile().toPath().normalize();
            Path file = new File(String.valueOf(ref)).getCanonicalFile().toPath().normalize();
            if (!file.startsWith(root)) {
                throw new BusinessRunTimeException(403, "非法回执路径");
            }
            if (!Files.isRegularFile(file)) {
                throw new BusinessRunTimeException(404, "回执 PDF 文件不存在");
            }
            long size = Files.size(file);
            if (size <= 0 || size > MAX_PDF_BYTES) {
                throw new BusinessRunTimeException(500, "回执 PDF 大小异常");
            }
            byte[] bytes = Files.readAllBytes(file);
            String expected = receipt.get("pdf_sha256") == null ? null : String.valueOf(receipt.get("pdf_sha256")).trim();
            if (expected != null && !expected.isEmpty()) {
                String actual = sha256Hex(bytes);
                if (!expected.equalsIgnoreCase(actual)) {
                    throw new BusinessRunTimeException(500, "回执文件校验失败");
                }
            }
            return bytes;
        } catch (BusinessRunTimeException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BusinessRunTimeException(500, "读取回执 PDF 失败");
        }
    }

    private Map<String, Object> summarizeCandidate(Map<String, Object> row) {
        Map<String, Object> c = new LinkedHashMap<String, Object>();
        c.put("receiptId", row.get("receipt_id"));
        c.put("billNumber", row.get("bill_number"));
        c.put("pdfStatus", row.get("pdf_status"));
        c.put("createdAt", row.get("created_at") == null ? null : String.valueOf(row.get("created_at")));
        c.put("summaryLine", extractSummaryLine(row));
        return c;
    }

    private String extractSummaryLine(Map<String, Object> row) {
        try {
            JSONObject facts = JSON.parseObject(String.valueOf(row.get("receipt_json")));
            if (facts == null) {
                return null;
            }
            JSONArray lines = facts.getJSONArray("lines");
            if (lines == null || lines.isEmpty()) {
                return null;
            }
            JSONObject line = lines.getJSONObject(0);
            StringBuilder sb = new StringBuilder();
            if (line.get("material_name") != null) {
                sb.append(line.get("material_name"));
            }
            if (line.get("oper_number") != null) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(line.get("oper_number"));
            }
            if (line.get("material_unit") != null) {
                sb.append(line.get("material_unit"));
            }
            if (line.get("all_price") != null) {
                sb.append(" ¥").append(line.get("all_price"));
            }
            return sb.length() == 0 ? null : sb.toString();
        } catch (Exception ex) {
            return null;
        }
    }

    private String buildUserSummaryZh(Map<String, Object> row, boolean withFileHint) {
        String bill = String.valueOf(row.get("bill_number"));
        String line = extractSummaryLine(row);
        StringBuilder sb = new StringBuilder();
        sb.append("已为你找到采购单 ").append(bill);
        if (line != null) {
            sb.append("，").append(line);
        }
        sb.append("，已审核。");
        if (withFileHint) {
            sb.append("\n《采购入库业务回执》见附件（非发票）。");
        }
        return sb.toString();
    }

    private static String sanitizeBillNumber(String raw) {
        if (raw == null) {
            return null;
        }
        String t = raw.trim();
        if (t.isEmpty()) {
            return null;
        }
        if (!SAFE_BILL.matcher(t).matches()) {
            throw new BusinessRunTimeException(400, "单号格式无效");
        }
        return t.toUpperCase();
    }

    private static String sanitizeReceiptId(String raw) {
        if (raw == null) {
            return null;
        }
        String t = raw.trim();
        if (t.isEmpty()) {
            return null;
        }
        if (!SAFE_RECEIPT_ID.matcher(t).matches()) {
            throw new BusinessRunTimeException(400, "回执编号格式无效");
        }
        return t.toLowerCase();
    }

    /**
     * Follow 012A/013: every line depot on the native bill must still be in the actor's UserDepot.
     */
    private void assertReceiptBillStillVisible(User user, Map<String, Object> receipt) {
        Long headerId = null;
        if (receipt.get("depot_head_id") != null) {
            headerId = ((Number) receipt.get("depot_head_id")).longValue();
        }
        if (headerId == null && receipt.get("bill_number") != null) {
            List<Map<String, Object>> heads = jdbcTemplate.queryForList(
                    "SELECT id FROM jsh_depot_head WHERE number=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                    receipt.get("bill_number"), user.getTenantId());
            if (!heads.isEmpty()) {
                headerId = ((Number) heads.get(0).get("id")).longValue();
            }
        }
        if (headerId == null) {
            throw new BusinessRunTimeException(403, "回执关联单据不可用，拒绝下载");
        }
        List<Map<String, Object>> headTenant = jdbcTemplate.queryForList(
                "SELECT id, tenant_id FROM jsh_depot_head WHERE id=? AND IFNULL(delete_flag,'0')<>'1'",
                headerId);
        if (headTenant.isEmpty()
                || !user.getTenantId().equals(((Number) headTenant.get(0).get("tenant_id")).longValue())) {
            throw new BusinessRunTimeException(403, "无权访问其他租户回执");
        }
        List<Long> depots = allowedDepotIds(user);
        if (depots.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户无仓库权限，拒绝下载回执");
        }
        Integer totalLines = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_depot_item di WHERE di.header_id=? AND IFNULL(di.delete_flag,'0')<>'1'",
                Integer.class, headerId);
        if (totalLines == null || totalLines < 1) {
            throw new BusinessRunTimeException(404, "单据没有有效明细");
        }
        StringBuilder in = new StringBuilder();
        List<Object> args = new ArrayList<Object>();
        args.add(headerId);
        for (int i = 0; i < depots.size(); i++) {
            if (i > 0) {
                in.append(',');
            }
            in.append('?');
            args.add(depots.get(i));
        }
        Integer allowedLines = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_depot_item di WHERE di.header_id=? AND IFNULL(di.delete_flag,'0')<>'1' "
                        + "AND di.depot_id IN (" + in + ")",
                Integer.class, args.toArray());
        if (allowedLines == null || allowedLines.intValue() != totalLines.intValue()) {
            throw new BusinessRunTimeException(403, "仓库权限已变更，无权继续下载该回执");
        }
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

    private Map<String, Object> buildFacts(User user, Map<String, Object> confirmed) {
        String billNumber = String.valueOf(confirmed.get("billNumber"));
        List<Map<String, Object>> heads = jdbcTemplate.queryForList(
                "SELECT h.id, h.number, h.type, h.sub_type, h.status, h.oper_time, h.create_time, h.creator, "
                        + "h.organ_id, h.total_price, h.discount_last_money, u.login_name AS creator_login, "
                        + "s.supplier AS organ_name "
                        + "FROM jsh_depot_head h "
                        + "LEFT JOIN jsh_user u ON u.id=h.creator "
                        + "LEFT JOIN jsh_supplier s ON s.id=h.organ_id "
                        + "WHERE h.number=? AND h.tenant_id=? AND IFNULL(h.delete_flag,'0')<>'1'",
                billNumber, user.getTenantId());
        if (heads.isEmpty() || !"1".equals(String.valueOf(heads.get(0).get("status")))) {
            throw new BusinessRunTimeException(500, "原生单据未审核成功，拒绝生成入库回执");
        }
        Map<String, Object> head = heads.get(0);
        List<Map<String, Object>> lines = jdbcTemplate.queryForList(
                "SELECT i.material_id, i.depot_id, i.oper_number, i.unit_price, i.all_price, i.material_unit, "
                        + "m.name AS material_name, me.bar_code, d.name AS depot_name "
                        + "FROM jsh_depot_item i "
                        + "LEFT JOIN jsh_material m ON m.id=i.material_id "
                        + "LEFT JOIN jsh_material_extend me ON me.id=i.material_extend_id "
                        + "LEFT JOIN jsh_depot d ON d.id=i.depot_id "
                        + "WHERE i.header_id=? AND IFNULL(i.delete_flag,'0')<>'1'",
                head.get("id"));
        Map<String, Object> facts = new LinkedHashMap<String, Object>();
        facts.put("title", "采购入库业务回执");
        facts.put("disclaimer", "此文件仅作业务记录，不作为税务发票或付款证明。");
        facts.put("billNumber", billNumber);
        facts.put("billStatus", "已审核");
        facts.put("operTime", String.valueOf(head.get("oper_time")));
        facts.put("creatorLogin", head.get("creator_login"));
        facts.put("partnerName", head.get("organ_name"));
        facts.put("actorLogin", user.getLoginName());
        facts.put("lines", lines);
        facts.put("stockBefore", confirmed.get("stockBefore"));
        facts.put("stockAfter", confirmed.get("stockAfter"));
        facts.put("confirmTime", confirmed.get("confirmTime"));
        facts.put("replayed", confirmed.get("replayed"));
        return facts;
    }

    private String renderText(Map<String, Object> facts) {
        StringBuilder sb = new StringBuilder();
        sb.append("采购入库已完成（已审核）\n");
        sb.append("原生单号：").append(facts.get("billNumber")).append("\n");
        sb.append("供应商：").append(nullToDash(facts.get("partnerName"))).append("\n");
        sb.append("操作人：").append(nullToDash(facts.get("creatorLogin"))).append("\n");
        sb.append("处理时间：").append(fmtTime(facts.get("operTime"))).append("\n");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> lines = (List<Map<String, Object>>) facts.get("lines");
        if (lines != null) {
            for (Map<String, Object> line : lines) {
                sb.append("- ").append(nullToDash(line.get("material_name")))
                        .append("（").append(nullToDash(line.get("bar_code"))).append("）")
                        .append(" ").append(fmtQty(line.get("oper_number")))
                        .append(" ").append(nullToDash(line.get("material_unit")))
                        .append(" → ").append(nullToDash(line.get("depot_name")));
                if (line.get("all_price") != null) {
                    sb.append(" 金额 ").append(fmtMoney(line.get("all_price")));
                }
                sb.append("\n");
            }
        }
        List<String[]> stockRows = stockChangeRows(facts.get("stockBefore"), facts.get("stockAfter"));
        if (!stockRows.isEmpty()) {
            sb.append("库存变化明细：\n");
            for (String[] r : stockRows) {
                sb.append("- ").append(r[0]).append("@").append(r[1])
                        .append("  ").append(r[2]).append(" → ").append(r[3])
                        .append("（").append(r[4]).append("）\n");
            }
        }
        sb.append("《采购入库业务回执》已生成（非发票）。");
        return sb.toString();
    }

    private byte[] renderPdf(Map<String, Object> facts) throws Exception {
        BaseFont bf = loadChineseFont();
        Font titleFont = new Font(bf, 16, Font.BOLD);
        Font sectionFont = new Font(bf, 11, Font.BOLD);
        Font bodyFont = new Font(bf, 11, Font.NORMAL);
        Font smallFont = new Font(bf, 9, Font.NORMAL);
        Document doc = new Document(PageSize.A4, 48, 48, 48, 48);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PdfWriter.getInstance(doc, baos);
        doc.open();
        Paragraph title = new Paragraph(String.valueOf(facts.get("title")), titleFont);
        title.setAlignment(Element.ALIGN_CENTER);
        doc.add(title);
        Paragraph disc = new Paragraph(String.valueOf(facts.get("disclaimer")), smallFont);
        disc.setAlignment(Element.ALIGN_CENTER);
        disc.setSpacingAfter(12);
        doc.add(disc);

        PdfPTable meta = new PdfPTable(2);
        meta.setWidthPercentage(100);
        addCell(meta, "原生单号", bodyFont);
        addCell(meta, String.valueOf(facts.get("billNumber")), bodyFont);
        addCell(meta, "状态", bodyFont);
        addCell(meta, String.valueOf(facts.get("billStatus")), bodyFont);
        addCell(meta, "供应商", bodyFont);
        addCell(meta, nullToDash(facts.get("partnerName")), bodyFont);
        addCell(meta, "操作人", bodyFont);
        addCell(meta, nullToDash(facts.get("creatorLogin")), bodyFont);
        addCell(meta, "业务时间", bodyFont);
        addCell(meta, fmtTime(facts.get("operTime")), bodyFont);
        doc.add(meta);
        doc.add(new Paragraph(" ", bodyFont));

        Paragraph lineTitle = new Paragraph("物料明细", sectionFont);
        lineTitle.setSpacingAfter(6);
        doc.add(lineTitle);
        PdfPTable table = new PdfPTable(new float[]{3, 2, 2, 1.2f, 2, 2});
        table.setWidthPercentage(100);
        for (String h : new String[]{"物料", "编码", "数量", "单位", "仓库", "金额"}) {
            addHeaderCell(table, h, bodyFont);
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> lines = (List<Map<String, Object>>) facts.get("lines");
        if (lines != null) {
            for (Map<String, Object> line : lines) {
                addCell(table, nullToDash(line.get("material_name")), smallFont);
                addCell(table, nullToDash(line.get("bar_code")), smallFont);
                addCell(table, fmtQty(line.get("oper_number")), smallFont);
                addCell(table, nullToDash(line.get("material_unit")), smallFont);
                addCell(table, nullToDash(line.get("depot_name")), smallFont);
                addCell(table, fmtMoney(line.get("all_price")), smallFont);
            }
        }
        doc.add(table);

        List<String[]> stockRows = stockChangeRows(facts.get("stockBefore"), facts.get("stockAfter"));
        if (!stockRows.isEmpty()) {
            doc.add(new Paragraph(" ", bodyFont));
            Paragraph stockTitle = new Paragraph("库存变化明细", sectionFont);
            stockTitle.setSpacingAfter(6);
            doc.add(stockTitle);
            PdfPTable stock = new PdfPTable(new float[]{2.2f, 2, 2, 2, 2});
            stock.setWidthPercentage(100);
            for (String h : new String[]{"编码", "仓库", "入库前", "入库后", "变动"}) {
                addHeaderCell(stock, h, bodyFont);
            }
            for (String[] r : stockRows) {
                addCell(stock, r[0], smallFont);
                addCell(stock, r[1], smallFont);
                addCell(stock, r[2], smallFont);
                addCell(stock, r[3], smallFont);
                addCell(stock, r[4], smallFont);
            }
            doc.add(stock);
        }
        doc.close();
        return baos.toByteArray();
    }

    private static void addCell(PdfPTable table, String text, Font font) {
        PdfPCell cell = new PdfPCell(new Paragraph(text == null ? "-" : text, font));
        cell.setPadding(5);
        table.addCell(cell);
    }

    private static void addHeaderCell(PdfPTable table, String text, Font font) {
        PdfPCell cell = new PdfPCell(new Paragraph(text == null ? "-" : text, font));
        cell.setPadding(5);
        cell.setGrayFill(0.92f);
        table.addCell(cell);
    }

    /** Parse stockBefore/stockAfter maps keyed as barCode@depotName into table rows. */
    private static List<String[]> stockChangeRows(Object beforeObj, Object afterObj) {
        List<String[]> rows = new ArrayList<String[]>();
        Map<String, BigDecimal> before = toDecimalMap(beforeObj);
        Map<String, BigDecimal> after = toDecimalMap(afterObj);
        if (before.isEmpty() && after.isEmpty()) {
            return rows;
        }
        LinkedHashMap<String, Boolean> keys = new LinkedHashMap<String, Boolean>();
        for (String k : before.keySet()) {
            keys.put(k, Boolean.TRUE);
        }
        for (String k : after.keySet()) {
            keys.put(k, Boolean.TRUE);
        }
        for (String key : keys.keySet()) {
            String bar = key;
            String depot = "-";
            int at = key.indexOf('@');
            if (at > 0) {
                bar = key.substring(0, at);
                depot = key.substring(at + 1);
            }
            BigDecimal b = before.get(key);
            BigDecimal a = after.get(key);
            BigDecimal delta = null;
            if (b != null && a != null) {
                delta = a.subtract(b);
            } else if (a != null) {
                delta = a;
            } else if (b != null) {
                delta = b.negate();
            }
            rows.add(new String[]{
                    nullToDash(bar),
                    nullToDash(depot),
                    fmtQty(b),
                    fmtQty(a),
                    fmtSignedQty(delta)
            });
        }
        return rows;
    }

    private static Map<String, BigDecimal> toDecimalMap(Object obj) {
        Map<String, BigDecimal> out = new LinkedHashMap<String, BigDecimal>();
        if (obj == null) {
            return out;
        }
        if (obj instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<Object, Object> map = (Map<Object, Object>) obj;
            for (Map.Entry<Object, Object> e : map.entrySet()) {
                if (e.getKey() == null) {
                    continue;
                }
                out.put(String.valueOf(e.getKey()), toBigDecimal(e.getValue()));
            }
            return out;
        }
        try {
            JSONObject json = obj instanceof JSONObject ? (JSONObject) obj : JSON.parseObject(String.valueOf(obj));
            if (json == null) {
                return out;
            }
            for (String key : json.keySet()) {
                out.put(key, toBigDecimal(json.get(key)));
            }
        } catch (Exception ignored) {
            // ignore
        }
        return out;
    }

    private static BigDecimal toBigDecimal(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof BigDecimal) {
            return (BigDecimal) v;
        }
        if (v instanceof Number) {
            return new BigDecimal(v.toString());
        }
        try {
            return new BigDecimal(String.valueOf(v).trim());
        } catch (Exception ex) {
            return null;
        }
    }

    private static String fmtQty(Object v) {
        BigDecimal n = toBigDecimal(v);
        if (n == null) {
            return "-";
        }
        return n.stripTrailingZeros().toPlainString();
    }

    private static String fmtSignedQty(Object v) {
        BigDecimal n = toBigDecimal(v);
        if (n == null) {
            return "-";
        }
        String s = n.stripTrailingZeros().toPlainString();
        if (n.compareTo(BigDecimal.ZERO) > 0 && !s.startsWith("+")) {
            return "+" + s;
        }
        return s;
    }

    private static String fmtMoney(Object v) {
        BigDecimal n = toBigDecimal(v);
        if (n == null) {
            return "-";
        }
        return n.setScale(2, BigDecimal.ROUND_HALF_UP).stripTrailingZeros().toPlainString();
    }

    private static String fmtTime(Object v) {
        if (v == null) {
            return "-";
        }
        String s = String.valueOf(v).trim().replace('T', ' ');
        if (s.length() > 19) {
            s = s.substring(0, 19);
        }
        return s;
    }

    private void tryRetryPdf(User user, Map<String, Object> row, Map<String, Object> confirmed) {
        try {
            Map<String, Object> facts = buildFacts(user, confirmed);
            byte[] pdf = renderPdf(facts);
            File dir = new File(storageDir);
            if (!dir.exists()) {
                dir.mkdirs();
            }
            String billNumber = String.valueOf(row.get("bill_number"));
            String receiptId = String.valueOf(row.get("receipt_id"));
            File out = new File(dir, receiptId + "_采购入库业务回执_" + billNumber + ".pdf");
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(pdf);
            }
            jdbcTemplate.update(
                    "UPDATE aierp_gateway_receipt SET pdf_sha256=?, pdf_storage_ref=?, pdf_status='PDF_GENERATED', "
                            + "delivery_status='PDF_DELIVERY_NOT_VERIFIED', updated_at=? WHERE id=?",
                    sha256Hex(pdf), out.getAbsolutePath(), TS.format(LocalDateTime.now()), row.get("id"));
        } catch (Exception ignored) {
            // keep TEXT_ONLY
        }
    }

    private static BaseFont loadChineseFont() throws Exception {
        String[] candidates = {
                "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc,0",
                "/usr/share/fonts/truetype/wqy/wqy-microhei.ttf",
                "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc,0",
                "C:/Windows/Fonts/simsun.ttc,0",
                "C:/Windows/Fonts/simhei.ttf",
                "C:/Windows/Fonts/msyh.ttc,0"
        };
        for (String path : candidates) {
            try {
                return BaseFont.createFont(path, BaseFont.IDENTITY_H, BaseFont.EMBEDDED);
            } catch (Exception ignored) {
                // try next
            }
        }
        throw new BusinessRunTimeException(500, "未找到可用中文字体，无法生成 PDF");
    }

    private static Long parseDraftIdFromBill(String billNumber) {
        if (billNumber == null) {
            return null;
        }
        int idx = billNumber.lastIndexOf('-');
        if (idx < 0 || idx == billNumber.length() - 1) {
            return null;
        }
        try {
            return Long.parseLong(billNumber.substring(idx + 1));
        } catch (Exception ex) {
            return null;
        }
    }

    private static String nullToDash(Object v) {
        return v == null ? "-" : String.valueOf(v);
    }

    private static String sha256Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] dig = md.digest(data);
        StringBuilder sb = new StringBuilder(dig.length * 2);
        for (byte b : dig) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
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
}
