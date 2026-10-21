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
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AIERP-015B: business receipt text + optional PDF from real CONFIRMED native bills.
 * Never invent bill numbers / stock; never label as invoice.
 */
@Service
public class AierpWecomReceiptService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern DEPOT_ID = Pattern.compile("\\[(\\d+)\\]");

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
        return out;
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

        Object ref = receipt.get("pdf_storage_ref");
        if (ref == null) {
            throw new BusinessRunTimeException(404, "回执 PDF 尚未生成");
        }
        try {
            return Files.readAllBytes(new File(String.valueOf(ref)).toPath());
        } catch (BusinessRunTimeException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BusinessRunTimeException(500, "读取回执 PDF 失败");
        }
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
        sb.append("处理时间：").append(nullToDash(facts.get("operTime"))).append("\n");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> lines = (List<Map<String, Object>>) facts.get("lines");
        if (lines != null) {
            for (Map<String, Object> line : lines) {
                sb.append("- ").append(nullToDash(line.get("material_name")))
                        .append("（").append(nullToDash(line.get("bar_code"))).append("）")
                        .append(" ").append(nullToDash(line.get("oper_number")))
                        .append(" ").append(nullToDash(line.get("material_unit")))
                        .append(" → ").append(nullToDash(line.get("depot_name")));
                if (line.get("all_price") != null) {
                    sb.append(" 金额 ").append(line.get("all_price"));
                }
                sb.append("\n");
            }
        }
        Object before = facts.get("stockBefore");
        Object after = facts.get("stockAfter");
        if (before != null && after != null) {
            sb.append("库存变化：").append(JSON.toJSONString(before))
                    .append(" → ").append(JSON.toJSONString(after)).append("\n");
        }
        sb.append("《采购入库业务回执》已生成（非发票）。");
        return sb.toString();
    }

    private byte[] renderPdf(Map<String, Object> facts) throws Exception {
        BaseFont bf = loadChineseFont();
        Font titleFont = new Font(bf, 16, Font.BOLD);
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
        addCell(meta, nullToDash(facts.get("operTime")), bodyFont);
        doc.add(meta);
        doc.add(new Paragraph(" ", bodyFont));

        PdfPTable table = new PdfPTable(new float[]{3, 2, 2, 2, 2, 2});
        table.setWidthPercentage(100);
        for (String h : new String[]{"物料", "编码", "数量", "单位", "仓库", "金额"}) {
            addCell(table, h, bodyFont);
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> lines = (List<Map<String, Object>>) facts.get("lines");
        if (lines != null) {
            for (Map<String, Object> line : lines) {
                addCell(table, nullToDash(line.get("material_name")), smallFont);
                addCell(table, nullToDash(line.get("bar_code")), smallFont);
                addCell(table, nullToDash(line.get("oper_number")), smallFont);
                addCell(table, nullToDash(line.get("material_unit")), smallFont);
                addCell(table, nullToDash(line.get("depot_name")), smallFont);
                addCell(table, nullToDash(line.get("all_price")), smallFont);
            }
        }
        doc.add(table);
        if (facts.get("stockBefore") != null) {
            doc.add(new Paragraph("库存变化：" + JSON.toJSONString(facts.get("stockBefore"))
                    + " → " + JSON.toJSONString(facts.get("stockAfter")), smallFont));
        }
        doc.close();
        return baos.toByteArray();
    }

    private static void addCell(PdfPTable table, String text, Font font) {
        PdfPCell cell = new PdfPCell(new Paragraph(text == null ? "-" : text, font));
        cell.setPadding(4);
        table.addCell(cell);
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
