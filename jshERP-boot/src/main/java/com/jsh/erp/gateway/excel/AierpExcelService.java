package com.jsh.erp.gateway.excel;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import com.jsh.erp.service.UserService;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DataValidation;
import org.apache.poi.ss.usermodel.DataValidationConstraint;
import org.apache.poi.ss.usermodel.DataValidationHelper;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.util.IOUtils;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Real XLSX in and out. Preview never posts. Confirm calls the merged ERP gateway.
 */
@Service
public class AierpExcelService {

    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ROWS = 200;
    private static final Pattern DEPOT_ID = Pattern.compile("\\d+");
    private static final String[] PURCHASE_HEADERS = {
            "业务单号", "业务日期", "供应商名称", "物料编码", "物料名称", "入库仓库", "入库数量", "单位", "单价(元)", "业务备注"
    };
    private static final String[] MIX_HEADERS = {
            "配制单号", "日期", "成品编码", "成品名称", "产出数量", "单位", "原料编码", "原料名称", "领用数量", "单位", "备注"
    };
    private static final String[] SERVICE_HEADERS = {
            "服务单号", "服务日期", "客户名称", "服务项目", "药水编码", "药水名称", "耗用数量", "单位", "出库仓库", "备注"
    };
    private static final String[] INITIAL_HEADERS = {
            "物料编码", "物料名称", "物料类别", "单位", "仓库", "期初库存", "安全库存", "参考成本单价(元)", "默认供应商", "库存估值(元)"
    };
    private static final String[] SALE_HEADERS = {
            "业务单号", "业务日期", "客户名称", "物料编码", "物料名称", "出库仓库", "销售数量", "单位", "售价(元)", "备注"
    };

    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private UserService userService;
    @Resource
    private AierpGatewayService gatewayService;

    public byte[] template(String scene, JSONObject fill, HttpServletRequest request) throws Exception {
        return templateAs(requireUser(), scene, fill);
    }

    /**
     * AIERP-017A: generate xlsx for an explicit ERP actor (WeCom delegated identity).
     * Does not post inventory. SALE/INITIAL templates are download-only (cannot confirm).
     */
    public byte[] templateAs(User user, String scene, JSONObject fill) throws Exception {
        if (user == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "当前会话没有租户身份");
        }
        if (user.getStatus() == null || user.getStatus().byteValue() != 0) {
            throw new BusinessRunTimeException(403, "用户已停用，拒绝生成模板");
        }
        String normalized = scene == null ? "" : scene.trim().toUpperCase(Locale.ROOT);
        JSONArray fillRows = fill == null ? null : fill.getJSONArray("rows");
        if (fillRows != null && fillRows.size() > MAX_ROWS) {
            throw new BusinessRunTimeException(400, "预填行数超过 " + MAX_ROWS);
        }
        fillRows = ensureTemplateKeys(normalized, fillRows);
        assertFillAuthorized(user, normalized, fillRows);
        XSSFWorkbook book = new XSSFWorkbook();
        Sheet help = book.createSheet("使用说明");
        writeHelpSheet(help, normalized);
        if ("PURCHASE".equals(normalized) || "PACK".equals(normalized)) {
            writeSheet(book, "02采购入库", PURCHASE_HEADERS, fillRows,
                    "PURCHASE".equals(normalized) ? "PURCHASE" : normalized, user);
        }
        if ("MIX".equals(normalized) || "PACK".equals(normalized)) {
            writeSheet(book, "03药水配制", MIX_HEADERS, fillRows, "MIX", user);
        }
        if ("SERVICE".equals(normalized) || "PACK".equals(normalized)) {
            writeSheet(book, "04服务耗料", SERVICE_HEADERS, fillRows, "SERVICE", user);
        }
        if ("INITIAL".equals(normalized) || "PACK".equals(normalized)) {
            Sheet sheet = writeSheet(book, "01物料期初", INITIAL_HEADERS, null, "INITIAL", user);
            text(sheet, 1, 0, "仅模板，不支持经 AI 网关确认过账");
        }
        if ("SALE".equals(normalized) || "PACK".equals(normalized)) {
            Sheet sheet = writeSheet(book, "05销售出库", SALE_HEADERS, null, "SALE", user);
            text(sheet, 1, 0, "仅模板，不支持经 AI 网关确认过账");
        }
        if (book.getNumberOfSheets() == 1) {
            book.close();
            throw new BusinessRunTimeException(400, "scene 只能是 PURCHASE、MIX、SERVICE、INITIAL、SALE、PACK");
        }
        return bytes(book);
    }

    public Map<String, Object> preview(MultipartFile file, String scene, HttpServletRequest request) throws Exception {
        User user = requireUser();
        if (file == null || file.isEmpty()) {
            throw new BusinessRunTimeException(400, "请上传 xlsx 文件");
        }
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename();
        return previewAs(user, file.getBytes(), name, scene);
    }

    /**
     * AIERP-017A: preview xlsx bytes for an explicit ERP actor. Never posts / never calls confirm.
     */
    public Map<String, Object> previewAs(User user, byte[] raw, String fileName, String scene) throws Exception {
        if (user == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "当前会话没有租户身份");
        }
        if (raw == null || raw.length == 0) {
            throw new BusinessRunTimeException(400, "请上传 xlsx 文件");
        }
        if (raw.length > MAX_BYTES) {
            throw new BusinessRunTimeException(400, "文件超过 2MB");
        }
        String name = fileName == null ? "" : fileName.trim();
        if (!name.toLowerCase(Locale.ROOT).endsWith(".xlsx")) {
            throw new BusinessRunTimeException(400, "只接受 .xlsx，不接受 csv 或 xls");
        }
        assertSafeZip(raw);
        ZipSecureFile.setMinInflateRatio(0.01d);
        IOUtils.setByteArrayMaxOverride(MAX_BYTES);
        List<JSONObject> records = new ArrayList<JSONObject>();
        try (Workbook book = new XSSFWorkbook(new ByteArrayInputStream(raw))) {
            DataFormatter formatter = new DataFormatter();
            int rows = 0;
            for (int i = 0; i < book.getNumberOfSheets(); i++) {
                Sheet sheet = book.getSheetAt(i);
                String detected = detectScene(sheet.getSheetName());
                if (detected == null) {
                    continue;
                }
                if (scene != null && !scene.trim().isEmpty() && !detected.equalsIgnoreCase(scene.trim())) {
                    continue;
                }
                rows += readSheet(sheet, detected, formatter, records, user);
                if (rows > MAX_ROWS) {
                    throw new BusinessRunTimeException(400, "数据行超过 " + MAX_ROWS);
                }
            }
        }
        if (records.isEmpty()) {
            throw new BusinessRunTimeException(400, "没有识别到采购、配制或服务数据行（销售出库/期初仅模板，不可预览过账）");
        }
        String previewKey = "pv-" + UUID.randomUUID().toString().replace("-", "");
        JSONObject payload = new JSONObject();
        payload.put("records", records);
        jdbcTemplate.update(
                "INSERT INTO aierp_excel_preview (preview_key, tenant_id, user_id, file_name, payload_json, create_time) VALUES (?,?,?,?,?,NOW())",
                previewKey, user.getTenantId(), user.getId(), name, payload.toJSONString());
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("previewId", previewKey);
        data.put("status", "PREVIEWED");
        data.put("posted", false);
        data.put("nature", "REAL_ERP");
        data.put("stockUnchanged", true);
        data.put("records", records);
        data.put("summary", summary(records));
        String userSummary = buildUserSummaryZh(records);
        data.put("userSummaryZh", userSummary);
        data.put("hintZh", userSummary);
        return data;
    }

    /** Human-facing WeCom summary: no previewId / canConfirm / scene / row null. */
    private String buildUserSummaryZh(List<JSONObject> records) {
        LinkedHashMap<String, JSONObject> bills = new LinkedHashMap<String, JSONObject>();
        List<String> errors = new ArrayList<String>();
        int lineCount = 0;
        for (JSONObject record : records) {
            String bk = record.getString("businessKey");
            if (bk == null || bk.isEmpty()) {
                bk = "(缺单号)";
            }
            bills.put(bk, record);
            JSONArray sourceRows = record.getJSONArray("sourceRows");
            if (sourceRows != null) {
                lineCount += sourceRows.size();
            } else {
                lineCount++;
            }
            if (!record.getBooleanValue("canConfirm")) {
                String rowLabel = sourceRowLabel(record);
                JSONArray errs = record.getJSONArray("errors");
                String detail = joinPlain(errs);
                errors.add("第" + rowLabel + "行" + (detail.isEmpty() ? "数据有误" : "：" + detail));
            }
        }
        StringBuilder sb = new StringBuilder();
        if (!errors.isEmpty()) {
            sb.append("文件已收到，但还有 ").append(errors.size()).append(" 处需要修改：\n");
            for (int i = 0; i < Math.min(errors.size(), 5); i++) {
                sb.append("- ").append(errors.get(i)).append("\n");
            }
            sb.append("请改好后重新发回 Excel。库存未变化，也未创建采购单。");
            return sb.toString().trim();
        }
        sb.append("文件已核对：").append(bills.size()).append(" 张业务单 / ").append(lineCount).append(" 行明细。\n");
        int shown = 0;
        for (Map.Entry<String, JSONObject> e : bills.entrySet()) {
            if (shown >= 5) {
                sb.append("…其余单据已省略\n");
                break;
            }
            shown++;
            JSONObject record = e.getValue();
            JSONObject norm = record.getJSONObject("normalized");
            String scene = record.getString("scene");
            String sceneLabel = "PURCHASE".equals(scene) ? "采购单"
                    : ("MIX".equals(scene) ? "配制单" : ("SERVICE".equals(scene) ? "服务单" : "业务单"));
            sb.append(sceneLabel).append(" ").append(e.getKey());
            if (norm != null && norm.getString("organName") != null) {
                sb.append("｜").append(norm.getString("organName"));
            }
            sb.append("\n");
            if (norm != null && norm.getJSONArray("lines") != null) {
                JSONArray lines = norm.getJSONArray("lines");
                for (int i = 0; i < Math.min(lines.size(), 8); i++) {
                    JSONObject ln = lines.getJSONObject(i);
                    String qty = ln.getString("qty");
                    String unit = ln.getString("unit") == null ? "" : ln.getString("unit");
                    String price = ln.getString("unitPrice");
                    if (price == null) {
                        price = ln.getString("price");
                    }
                    String amount = "";
                    try {
                        if (qty != null && price != null && !price.isEmpty()) {
                            amount = "＝" + new BigDecimal(qty).multiply(new BigDecimal(price))
                                    .stripTrailingZeros().toPlainString() + " 元";
                        }
                    } catch (Exception ignore) {
                        amount = "";
                    }
                    sb.append("  ").append(ln.getString("barCode") == null ? "" : ln.getString("barCode"));
                    if (ln.getString("depotName") != null) {
                        sb.append("｜").append(ln.getString("depotName"));
                    }
                    sb.append("｜").append(qty == null ? "?" : qty).append(unit);
                    if (price != null && !price.isEmpty()) {
                        sb.append(" × ").append(price).append(" 元").append(amount);
                    }
                    sb.append("\n");
                }
            }
            if (norm != null && norm.getJSONObject("finished") != null) {
                JSONObject f = norm.getJSONObject("finished");
                sb.append("  成品 ").append(f.getString("barCode")).append("｜")
                        .append(f.getString("qty")).append(f.getString("unit") == null ? "" : f.getString("unit"))
                        .append("\n");
            }
        }
        sb.append("数据无误，尚未入库。");
        return sb.toString().trim();
    }

    private static String sourceRowLabel(JSONObject record) {
        JSONArray sourceRows = record.getJSONArray("sourceRows");
        if (sourceRows != null && !sourceRows.isEmpty() && sourceRows.get(0) != null) {
            return String.valueOf(sourceRows.get(0));
        }
        Object rowIndex = record.get("rowIndex");
        if (rowIndex != null) {
            return String.valueOf(rowIndex);
        }
        return "?";
    }

    private String joinPlain(JSONArray errors) {
        if (errors == null || errors.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < errors.size(); i++) {
            if (i > 0) {
                sb.append("；");
            }
            sb.append(String.valueOf(errors.get(i)));
        }
        return sb.toString();
    }

    public Map<String, Object> confirm(JSONObject body, HttpServletRequest request) throws Exception {
        User user = requireUser();
        String previewId = required(body, "previewId");
        String batchKey = required(body, "idempotencyBatchKey");
        List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                "SELECT result_json FROM aierp_excel_batch WHERE tenant_id=? AND user_id=? AND batch_key=?",
                user.getTenantId(), user.getId(), batchKey);
        if (!existing.isEmpty()) {
            JSONObject stored = JSON.parseObject(String.valueOf(existing.get(0).get("result_json")));
            stored.put("replayed", true);
            return stored;
        }
        List<Map<String, Object>> previews = jdbcTemplate.queryForList(
                "SELECT payload_json FROM aierp_excel_preview WHERE preview_key=? AND tenant_id=? AND user_id=?",
                previewId, user.getTenantId(), user.getId());
        if (previews.isEmpty()) {
            throw new BusinessRunTimeException(404, "预览不存在或不属于当前用户");
        }
        JSONObject payload = JSON.parseObject(String.valueOf(previews.get(0).get("payload_json")));
        JSONArray records = payload.getJSONArray("records");
        JSONArray selected = body.getJSONArray("selectedBusinessKeys");
        List<Map<String, Object>> results = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < records.size(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (selected != null && !selected.isEmpty() && !selected.contains(record.getString("businessKey"))) {
                continue;
            }
            results.add(postOne(record, request));
        }
        if (results.isEmpty()) {
            throw new BusinessRunTimeException(400, "没有可确认的业务单");
        }
        JSONObject stored = new JSONObject();
        stored.put("batchId", batchKey);
        stored.put("previewId", previewId);
        stored.put("replayed", false);
        stored.put("results", results);
        jdbcTemplate.update(
                "INSERT INTO aierp_excel_batch (batch_key, preview_key, tenant_id, user_id, result_json, create_time) VALUES (?,?,?,?,?,NOW())",
                batchKey, previewId, user.getTenantId(), user.getId(), stored.toJSONString());
        return stored;
    }

    public byte[] receipt(String batchId, HttpServletRequest request) throws Exception {
        User user = requireUser();
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT result_json FROM aierp_excel_batch WHERE batch_key=? AND tenant_id=? AND user_id=?",
                batchId, user.getTenantId(), user.getId());
        if (rows.isEmpty()) {
            throw new BusinessRunTimeException(404, "回执批次不存在");
        }
        JSONObject stored = JSON.parseObject(String.valueOf(rows.get(0).get("result_json")));
        XSSFWorkbook book = new XSSFWorkbook();
        Sheet sheet = book.createSheet("06解析回执");
        String[] headers = {"场景", "业务单号", "解析状态", "单据号", "说明 / 校验反馈", "处理建议"};
        Row head = sheet.createRow(2);
        for (int i = 0; i < headers.length; i++) {
            text(head, i, headers[i]);
        }
        JSONArray results = stored.getJSONArray("results");
        for (int i = 0; i < results.size(); i++) {
            JSONObject item = results.getJSONObject(i);
            Row row = sheet.createRow(3 + i);
            text(row, 0, item.getString("scene"));
            text(row, 1, item.getString("businessKey"));
            text(row, 2, item.getString("status"));
            text(row, 3, item.getString("billNumber"));
            text(row, 4, item.getString("error"));
            text(row, 5, "POSTED".equals(item.getString("status")) ? "已审核，可在 ERP 按单据号核对库存" : "未过账，修正后重新上传");
        }
        return bytes(book);
    }

    private Map<String, Object> postOne(JSONObject record, HttpServletRequest request) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("businessKey", record.getString("businessKey"));
        result.put("scene", record.getString("scene"));
        if (!record.getBooleanValue("canConfirm")) {
            result.put("status", "REJECTED");
            result.put("error", join(record.getJSONArray("errors")));
            return result;
        }
        if ("INITIAL".equals(record.getString("scene")) || "SALE".equals(record.getString("scene"))) {
            result.put("status", "REJECTED");
            result.put("error", "该工作表仅提供模板，不支持经 AI 网关确认");
            return result;
        }
        try {
            JSONObject normalized = record.getJSONObject("normalized");
            String idem = "xlsx:" + record.getString("scene") + ":" + record.getString("businessKey");
            normalized.put("idempotencyKey", idem);
            gatewayService.createDraft(record.getString("scene"), normalized, request);
            JSONObject confirmBody = new JSONObject();
            confirmBody.put("idempotencyKey", idem);
            Map<String, Object> posted = gatewayService.confirm(confirmBody, request);
            result.put("status", "POSTED");
            result.put("billNumber", posted.get("billNumber"));
            result.put("replayed", posted.get("replayed"));
            result.put("stockBefore", posted.get("stockBefore"));
            result.put("stockAfter", posted.get("stockAfter"));
            result.put("error", "");
        } catch (BusinessRunTimeException ex) {
            result.put("status", "ERP_FAILED");
            result.put("error", ex.getMessage());
        } catch (Exception ex) {
            result.put("status", "ERP_FAILED");
            result.put("error", ex.getMessage());
        }
        return result;
    }

    private int readSheet(Sheet sheet, String scene, DataFormatter formatter, List<JSONObject> records, User user) {
        Row header = sheet.getRow(2);
        if (header == null) {
            return 0;
        }
        List<String> headers = headerNames(header, formatter);
        Map<String, JSONObject> grouped = new LinkedHashMap<String, JSONObject>();
        int count = 0;
        for (int r = 3; r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            if (row == null || blankRow(row, formatter)) {
                continue;
            }
            count++;
            JSONObject parsed = parseRow(scene, row, headers, formatter, r + 1, user);
            String key = parsed.getString("businessKey");
            JSONObject group = grouped.get(key);
            if (group == null) {
                grouped.put(key, parsed);
            } else {
                mergeGroup(group, parsed);
            }
        }
        records.addAll(grouped.values());
        return count;
    }

    private JSONObject parseRow(String scene, Row row, List<String> headers, DataFormatter formatter, int rowNo, User user) {
        JSONObject record = new JSONObject(true);
        JSONArray errors = new JSONArray();
        JSONArray warnings = new JSONArray();
        JSONArray sourceRows = new JSONArray();
        sourceRows.add(rowNo);
        record.put("scene", scene);
        record.put("sourceSheet", row.getSheet().getSheetName());
        record.put("sourceRows", sourceRows);
        record.put("errors", errors);
        record.put("warnings", warnings);
        if ("INITIAL".equals(scene) || "SALE".equals(scene)) {
            record.put("businessKey", cell(row, headers, formatter, errors, "业务单号", "物料编码"));
            record.put("canConfirm", false);
            errors.add("仅模板，不支持经 AI 网关确认");
            return record;
        }
        JSONObject normalized = new JSONObject(true);
        if ("PURCHASE".equals(scene)) {
            String key = cell(row, headers, formatter, errors, "业务单号");
            record.put("businessKey", key);
            normalized.put("organName", cell(row, headers, formatter, errors, "供应商名称"));
            normalized.put("remark", optional(row, headers, formatter, errors, "业务备注"));
            JSONArray lines = new JSONArray();
            lines.add(line(row, headers, formatter, errors, "物料编码", "入库仓库", "入库数量", "单位", "单价(元)"));
            normalized.put("lines", lines);
        } else if ("MIX".equals(scene)) {
            record.put("businessKey", cell(row, headers, formatter, errors, "配制单号"));
            normalized.put("remark", optional(row, headers, formatter, errors, "备注"));
            warnings.add("配比为虚构软件测试数据，成品默认成品仓，原料默认原料仓");
            JSONObject finished = new JSONObject(true);
            finished.put("barCode", cell(row, headers, formatter, errors, "成品编码"));
            finished.put("depotName", "成品仓");
            finished.put("qty", cell(row, headers, formatter, errors, "产出数量"));
            finished.put("unit", unitAt(row, headers, formatter, errors, 0));
            normalized.put("finished", finished);
            JSONArray lines = new JSONArray();
            JSONObject component = new JSONObject(true);
            component.put("barCode", cell(row, headers, formatter, errors, "原料编码"));
            component.put("depotName", "原料仓");
            component.put("qty", cell(row, headers, formatter, errors, "领用数量"));
            component.put("unit", unitAt(row, headers, formatter, errors, 1));
            lines.add(component);
            normalized.put("lines", lines);
        } else if ("SERVICE".equals(scene)) {
            record.put("businessKey", cell(row, headers, formatter, errors, "服务单号"));
            normalized.put("organName", cell(row, headers, formatter, errors, "客户名称"));
            String serviceProject = optional(row, headers, formatter, errors, "服务项目");
            if (serviceProject != null && !serviceProject.trim().isEmpty()) {
                normalized.put("serviceProject", serviceProject.trim());
            }
            normalized.put("remark", optional(row, headers, formatter, errors, "备注"));
            JSONArray lines = new JSONArray();
            lines.add(line(row, headers, formatter, errors, "药水编码", "出库仓库", "耗用数量", "单位", null));
            normalized.put("lines", lines);
        }
        record.put("normalized", normalized);
        validateMaster(user, scene, normalized, errors);
        record.put("canConfirm", errors.isEmpty() && record.getString("businessKey") != null);
        return record;
    }

    private void mergeGroup(JSONObject group, JSONObject incoming) {
        JSONArray rows = group.getJSONArray("sourceRows");
        rows.addAll(incoming.getJSONArray("sourceRows"));
        JSONArray errors = group.getJSONArray("errors");
        errors.addAll(incoming.getJSONArray("errors"));
        if (!"MIX".equals(group.getString("scene"))) {
            JSONArray lines = group.getJSONObject("normalized").getJSONArray("lines");
            lines.addAll(incoming.getJSONObject("normalized").getJSONArray("lines"));
        } else {
            JSONObject left = group.getJSONObject("normalized").getJSONObject("finished");
            JSONObject right = incoming.getJSONObject("normalized").getJSONObject("finished");
            if (!left.getString("barCode").equals(right.getString("barCode")) || !left.getString("qty").equals(right.getString("qty"))) {
                errors.add("同一配制单号的成品或产出数量不一致");
            }
            group.getJSONObject("normalized").getJSONArray("lines").addAll(incoming.getJSONObject("normalized").getJSONArray("lines"));
        }
        group.put("canConfirm", errors.isEmpty());
    }

    private void validateMaster(User user, String scene, JSONObject normalized, JSONArray errors) {
        if ("INITIAL".equals(scene) || "SALE".equals(scene) || normalized == null) {
            return;
        }
        if ("PURCHASE".equals(scene) || "SERVICE".equals(scene)) {
            String type = "PURCHASE".equals(scene) ? "供应商" : "客户";
            String organ = normalized.getString("organName");
            List<Map<String, Object>> organs = jdbcTemplate.queryForList(
                    "SELECT id FROM jsh_supplier WHERE supplier=? AND type=? AND tenant_id=? AND enabled=b'1' "
                            + "AND IFNULL(delete_flag,'0')<>'1' ORDER BY id ASC LIMIT 1",
                    organ, type, user.getTenantId());
            if (organs == null || organs.isEmpty()) {
                errors.add("未找到当前租户下的" + type + ": " + organ);
            } else if ("SERVICE".equals(scene)) {
                // UserCustomer when customerFlag=1 — not tenant-only visibility.
                try {
                    long organId = ((Number) organs.get(0).get("id")).longValue();
                    gatewayService.assertCustomerVisible(user, organId, organ);
                } catch (BusinessRunTimeException ex) {
                    errors.add(ex.getMessage() == null ? ("无权使用客户: " + organ) : ex.getMessage());
                }
            }
        }
        if ("MIX".equals(scene)) {
            checkMaterial(user, normalized.getJSONObject("finished"), errors);
        }
        JSONArray lines = normalized.getJSONArray("lines");
        if (lines != null) {
            for (int i = 0; i < lines.size(); i++) {
                checkMaterial(user, lines.getJSONObject(i), errors);
            }
        }
    }

    private void checkMaterial(User user, JSONObject line, JSONArray errors) {
        if (line == null) {
            return;
        }
        String barCode = line.getString("barCode");
        List<Map<String, Object>> found = jdbcTemplate.queryForList(
                "SELECT me.commodity_unit commodityUnit, m.unit materialUnit FROM jsh_material_extend me "
                        + "JOIN jsh_material m ON m.id=me.material_id "
                        + "WHERE me.bar_code=? AND me.tenant_id=? AND IFNULL(me.delete_flag,'0')<>'1' AND IFNULL(m.delete_flag,'0')<>'1'",
                barCode, user.getTenantId());
        if (found.isEmpty()) {
            errors.add("物料不存在或不属于当前租户: " + barCode);
            return;
        }
        String expected = String.valueOf(found.get(0).get("commodityUnit"));
        if (expected == null || "null".equals(expected) || expected.isEmpty()) {
            expected = String.valueOf(found.get(0).get("materialUnit"));
        }
        if (!expected.equalsIgnoreCase(line.getString("unit"))) {
            errors.add("单位不匹配: " + barCode + " 需要 " + expected + " 实际 " + line.getString("unit"));
        }
        String depotName = line.getString("depotName");
        if (depotName == null || depotName.trim().isEmpty()) {
            errors.add("缺少仓库 depotName");
            return;
        }
        depotName = depotName.trim();
        Integer depots = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_depot WHERE name=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, depotName, user.getTenantId());
        if (depots == null || depots == 0) {
            errors.add("仓库不存在或不属于当前租户: " + depotName);
            return;
        }
        if (!depotAllowedForUser(user, depotName)) {
            errors.add("无权使用仓库: " + depotName);
        }
    }

    /**
     * Prefill rows for templateAs must pass material/unit/depot UserDepot checks (no inventing).
     */
    private void assertFillAuthorized(User user, String scene, JSONArray rows) {
        if (rows == null || rows.isEmpty()) {
            return;
        }
        if ("SALE".equals(scene) || "INITIAL".equals(scene)) {
            throw new BusinessRunTimeException(400, scene + " 场景不支持预填业务行");
        }
        JSONArray errors = new JSONArray();
        for (int i = 0; i < rows.size(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (row == null) {
                continue;
            }
            if ("MIX".equals(scene)) {
                String finished = row.getString("finishedCode");
                if (finished != null && !finished.trim().isEmpty()) {
                    JSONObject fin = new JSONObject(true);
                    fin.put("barCode", finished.trim());
                    fin.put("unit", row.getString("finishedUnit"));
                    String finDepot = row.getString("finishedDepotName");
                    fin.put("depotName", finDepot != null && !finDepot.trim().isEmpty() ? finDepot.trim() : "成品仓");
                    checkMaterial(user, fin, errors);
                }
                if (row.getString("barCode") != null && !row.getString("barCode").trim().isEmpty()) {
                    JSONObject component = new JSONObject(true);
                    component.put("barCode", row.getString("barCode").trim());
                    component.put("unit", row.getString("unit"));
                    String dep = row.getString("depotName");
                    component.put("depotName", dep != null && !dep.trim().isEmpty() ? dep.trim() : "原料仓");
                    checkMaterial(user, component, errors);
                }
                continue;
            }
            if (row.getString("barCode") != null && !row.getString("barCode").trim().isEmpty()) {
                if ("PURCHASE".equals(scene) || "PACK".equals(scene) || "SERVICE".equals(scene)) {
                    if ("PURCHASE".equals(scene) || "PACK".equals(scene)) {
                        if (row.getString("organName") == null || row.getString("organName").trim().isEmpty()) {
                            errors.add("预填采购行缺少供应商 organName");
                        } else {
                            assertSupplierExists(user, row.getString("organName").trim(), errors);
                        }
                    }
                }
                checkMaterial(user, row, errors);
            }
        }
        if (!errors.isEmpty()) {
            throw new BusinessRunTimeException(403, "预填校验失败: " + errors.getString(0)
                    + (errors.size() > 1 ? "（共 " + errors.size() + " 项）" : ""));
        }
    }

    private void assertSupplierExists(User user, String organName, JSONArray errors) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_supplier WHERE supplier=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, organName, user.getTenantId());
        if (n == null || n == 0) {
            errors.add("供应商不存在或不属于当前租户: " + organName);
        }
    }

    private boolean depotAllowedForUser(User user, String depotName) {
        if (depotName == null || depotName.trim().isEmpty()) {
            return false;
        }
        List<Map<String, Object>> depots = jdbcTemplate.queryForList(
                "SELECT id FROM jsh_depot WHERE name=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1' LIMIT 1",
                depotName.trim(), user.getTenantId());
        if (depots.isEmpty()) {
            return false;
        }
        long depotId = ((Number) depots.get(0).get("id")).longValue();
        List<Long> allowed = allowedDepotIds(user);
        return allowed.contains(depotId);
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
            ids.add(Long.valueOf(matcher.group()));
        }
        return ids;
    }

    private JSONObject line(Row row, List<String> headers, DataFormatter formatter, JSONArray errors,
                            String codeHeader, String depotHeader, String qtyHeader, String unitHeader, String priceHeader) {
        JSONObject line = new JSONObject(true);
        line.put("barCode", cell(row, headers, formatter, errors, codeHeader));
        line.put("depotName", cell(row, headers, formatter, errors, depotHeader));
        line.put("qty", cell(row, headers, formatter, errors, qtyHeader));
        line.put("unit", cell(row, headers, formatter, errors, unitHeader));
        if (priceHeader != null) {
            String price = optional(row, headers, formatter, errors, priceHeader);
            if (price != null && !price.isEmpty()) {
                line.put("unitPrice", price);
            }
        }
        return line;
    }

    private String unitAt(Row row, List<String> headers, DataFormatter formatter, JSONArray errors, int occurrence) {
        int seen = 0;
        for (int i = 0; i < headers.size(); i++) {
            if ("单位".equals(headers.get(i))) {
                if (seen == occurrence) {
                    return read(row.getCell(i), formatter, errors);
                }
                seen++;
            }
        }
        errors.add("缺少单位");
        return null;
    }

    private List<String> headerNames(Row header, DataFormatter formatter) {
        List<String> names = new ArrayList<String>();
        for (int c = 0; c < header.getLastCellNum(); c++) {
            String name = read(header.getCell(c), formatter, new JSONArray());
            if (name == null) {
                names.add("");
                continue;
            }
            // Keep parser compatible if templates ever add * / （必填） markers.
            name = name.replace(" ", "").replace("*", "")
                    .replace("（必填）", "").replace("(必填)", "")
                    .replace("（选填）", "").replace("(选填)", "");
            names.add(name);
        }
        return names;
    }

    private int column(List<String> headers, String name) {
        String wanted = name.replace(" ", "");
        for (int i = 0; i < headers.size(); i++) {
            if (wanted.equals(headers.get(i))) {
                return i;
            }
        }
        return -1;
    }

    private String cell(Row row, List<String> headers, DataFormatter formatter, JSONArray errors, String... names) {
        for (String name : names) {
            int idx = column(headers, name);
            if (idx >= 0) {
                String value = read(row.getCell(idx), formatter, errors);
                if (value == null || value.isEmpty()) {
                    errors.add("缺少 " + name);
                    return null;
                }
                return value;
            }
        }
        errors.add("缺少列 " + names[0]);
        return null;
    }

    private String optional(Row row, List<String> headers, DataFormatter formatter, JSONArray errors, String name) {
        int idx = column(headers, name);
        if (idx < 0) {
            return "";
        }
        String value = read(row.getCell(idx), formatter, errors);
        return value == null ? "" : value;
    }

    private String read(Cell cell, DataFormatter formatter, JSONArray errors) {
        if (cell == null || cell.getCellTypeEnum() == CellType.BLANK) {
            return "";
        }
        if (cell.getCellTypeEnum() == CellType.FORMULA) {
            errors.add("公式不能作为业务输入");
            return "";
        }
        if (cell.getCellTypeEnum() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
            return new java.text.SimpleDateFormat("yyyy-MM-dd").format(cell.getDateCellValue());
        }
        if (cell.getCellTypeEnum() == CellType.NUMERIC) {
            try {
                return new BigDecimal(formatter.formatCellValue(cell).replace(",", "")).stripTrailingZeros().toPlainString();
            } catch (Exception ex) {
                return formatter.formatCellValue(cell).trim();
            }
        }
        return formatter.formatCellValue(cell).trim();
    }

    private boolean blankRow(Row row, DataFormatter formatter) {
        for (int c = 0; c < row.getLastCellNum(); c++) {
            Cell cell = row.getCell(c);
            if (cell != null && cell.getCellTypeEnum() != CellType.BLANK && !formatter.formatCellValue(cell).trim().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    private String detectScene(String sheetName) {
        if (sheetName.contains("采购")) {
            return "PURCHASE";
        }
        if (sheetName.contains("配制")) {
            return "MIX";
        }
        if (sheetName.contains("服务")) {
            return "SERVICE";
        }
        if (sheetName.contains("期初")) {
            return "INITIAL";
        }
        if (sheetName.contains("销售")) {
            return "SALE";
        }
        return null;
    }

    private void writeHelpSheet(Sheet help, String scene) {
        text(help, 0, 0, "AI-ERP 企微业务模板（与 jshERP 原生 .xls 导入格式不同，请用本模板）");
        text(help, 1, 0, "第3行是表头（勿改列名），第4行起填数据。红色表头=必填，灰色表头=选填。");
        text(help, 2, 0, "同一「业务单号/配制单号/服务单号」多行 = 同一张单的多条明细；换单号即新单。");
        text(help, 3, 0, "已预填唯一单号与当天日期，请补齐供应商/物料/数量等；勿编造无权仓库或供应商。");
        text(help, 4, 0, "不要使用公式或宏。上传后只做核对预览，确认入库前库存不变。");
        text(help, 5, 0, "示例（请勿当作真实业务粘贴）：采购单号 CG-20261021-DEMO｜原料仓｜RM-A001｜10 L。");
        text(help, 6, 0, "销售出库/物料期初当前仅提供模板，不能经本流程确认过账。");
        help.setColumnWidth(0, 18000);
    }

    private JSONArray ensureTemplateKeys(String scene, JSONArray fillRows) {
        String today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String prefix = "PURCHASE".equals(scene) || "PACK".equals(scene) ? "CG"
                : ("MIX".equals(scene) ? "PZ" : ("SERVICE".equals(scene) ? "FW" : "YW"));
        if (fillRows == null || fillRows.isEmpty()) {
            if (!"PURCHASE".equals(scene) && !"MIX".equals(scene) && !"SERVICE".equals(scene) && !"PACK".equals(scene)) {
                return fillRows;
            }
            JSONArray starter = new JSONArray();
            JSONObject row = new JSONObject(true);
            row.put("businessKey", newBusinessKey(prefix));
            row.put("date", today);
            starter.add(row);
            return starter;
        }
        for (int i = 0; i < fillRows.size(); i++) {
            JSONObject row = fillRows.getJSONObject(i);
            if (row == null) {
                continue;
            }
            if (row.getString("businessKey") == null || row.getString("businessKey").trim().isEmpty()) {
                row.put("businessKey", newBusinessKey(prefix));
            }
            if (row.getString("date") == null || row.getString("date").trim().isEmpty()) {
                row.put("date", today);
            }
        }
        return fillRows;
    }

    private static String newBusinessKey(String prefix) {
        String stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        String rand = UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase(Locale.ROOT);
        return prefix + "-" + stamp + "-" + rand;
    }

    private Sheet writeSheet(XSSFWorkbook book, String name, String[] headers, JSONArray rows, String scene, User user) {
        Sheet sheet = book.createSheet(name);
        CellStyle titleStyle = book.createCellStyle();
        Font titleFont = book.createFont();
        titleFont.setBold(true);
        titleFont.setFontHeightInPoints((short) 14);
        titleStyle.setFont(titleFont);

        CellStyle requiredHead = headStyle(book, true);
        CellStyle optionalHead = headStyle(book, false);
        CellStyle guideStyle = book.createCellStyle();
        Font guideFont = book.createFont();
        guideFont.setColor(IndexedColors.GREY_50_PERCENT.getIndex());
        guideStyle.setFont(guideFont);

        Row title = sheet.createRow(0);
        Cell titleCell = title.createCell(0);
        titleCell.setCellValue(name);
        titleCell.setCellStyle(titleStyle);

        Row guide = sheet.createRow(1);
        Cell guideCell = guide.createCell(0);
        guideCell.setCellValue(guideText(scene));
        guideCell.setCellStyle(guideStyle);

        boolean[] required = requiredFlags(scene, headers.length);
        Row head = sheet.createRow(2);
        for (int i = 0; i < headers.length; i++) {
            Cell cell = head.createCell(i);
            cell.setCellValue(headers[i]);
            cell.setCellStyle(required[i] ? requiredHead : optionalHead);
            sheet.setColumnWidth(i, columnWidth(headers[i]));
        }

        if (rows != null) {
            for (int i = 0; i < rows.size(); i++) {
                JSONObject row = rows.getJSONObject(i);
                Row excel = sheet.createRow(3 + i);
                fillDataRow(excel, row, scene);
            }
        }

        sheet.createFreezePane(0, 3);
        sheet.setAutoFilter(new CellRangeAddress(2, Math.max(2, sheet.getLastRowNum()), 0, headers.length - 1));
        addDropdowns(sheet, scene, headers, user);
        return sheet;
    }

    private void fillDataRow(Row excel, JSONObject row, String scene) {
        if ("PURCHASE".equals(scene) || "PACK".equals(scene)) {
            text(excel, 0, row.getString("businessKey"));
            text(excel, 1, row.getString("date"));
            text(excel, 2, row.getString("organName"));
            text(excel, 3, row.getString("barCode"));
            text(excel, 4, row.getString("name"));
            text(excel, 5, row.getString("depotName"));
            text(excel, 6, row.getString("qty"));
            text(excel, 7, row.getString("unit"));
            text(excel, 8, row.getString("price"));
            text(excel, 9, row.getString("remark"));
        } else if ("MIX".equals(scene)) {
            text(excel, 0, row.getString("businessKey"));
            text(excel, 1, row.getString("date"));
            text(excel, 2, row.getString("finishedCode"));
            text(excel, 3, row.getString("finishedName"));
            text(excel, 4, row.getString("finishedQty"));
            text(excel, 5, row.getString("finishedUnit"));
            text(excel, 6, row.getString("barCode"));
            text(excel, 7, row.getString("name"));
            text(excel, 8, row.getString("qty"));
            text(excel, 9, row.getString("unit"));
            text(excel, 10, row.getString("remark"));
        } else if ("SERVICE".equals(scene)) {
            text(excel, 0, row.getString("businessKey"));
            text(excel, 1, row.getString("date"));
            text(excel, 2, row.getString("organName"));
            text(excel, 3, row.getString("serviceName"));
            text(excel, 4, row.getString("barCode"));
            text(excel, 5, row.getString("name"));
            text(excel, 6, row.getString("qty"));
            text(excel, 7, row.getString("unit"));
            text(excel, 8, row.getString("depotName"));
            text(excel, 9, row.getString("remark"));
        }
    }

    private static String guideText(String scene) {
        if ("PURCHASE".equals(scene) || "PACK".equals(scene)) {
            return "红色必填：业务单号、业务日期、供应商、物料编码、入库仓库、入库数量、单位。同单号多行=同一张采购单。勿用公式。";
        }
        if ("MIX".equals(scene)) {
            return "红色必填：配制单号、日期、成品编码、产出数量、原料编码、领用数量与单位。配比为演示数据。勿用公式。";
        }
        if ("SERVICE".equals(scene)) {
            return "红色必填：服务单号、服务日期、客户、药水编码、耗用数量、单位、出库仓库。勿用公式。";
        }
        return "第3行表头，第4行起填写。红色=必填，灰色=选填。不要使用公式。";
    }

    private static boolean[] requiredFlags(String scene, int len) {
        boolean[] flags = new boolean[len];
        if ("PURCHASE".equals(scene) || "PACK".equals(scene)) {
            // 业务单号 日期 供应商 编码 名称 仓库 数量 单位 单价 备注
            int[] req = {0, 1, 2, 3, 5, 6, 7};
            for (int i : req) {
                if (i < len) {
                    flags[i] = true;
                }
            }
        } else if ("MIX".equals(scene)) {
            int[] req = {0, 1, 2, 4, 5, 6, 8, 9};
            for (int i : req) {
                if (i < len) {
                    flags[i] = true;
                }
            }
        } else if ("SERVICE".equals(scene)) {
            int[] req = {0, 1, 2, 4, 6, 7, 8};
            for (int i : req) {
                if (i < len) {
                    flags[i] = true;
                }
            }
        } else {
            for (int i = 0; i < len; i++) {
                flags[i] = true;
            }
        }
        return flags;
    }

    private CellStyle headStyle(XSSFWorkbook book, boolean required) {
        CellStyle style = book.createCellStyle();
        Font font = book.createFont();
        font.setBold(true);
        if (required) {
            font.setColor(IndexedColors.RED.getIndex());
        } else {
            font.setColor(IndexedColors.GREY_50_PERCENT.getIndex());
        }
        style.setFont(font);
        style.setFillForegroundColor(IndexedColors.LIGHT_YELLOW.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setBorderBottom(BorderStyle.THIN);
        style.setAlignment(HorizontalAlignment.CENTER);
        return style;
    }

    private static int columnWidth(String header) {
        if (header == null) {
            return 3500;
        }
        if (header.contains("备注") || header.contains("名称") || header.contains("供应商") || header.contains("客户")) {
            return 4500;
        }
        if (header.contains("单号") || header.contains("编码")) {
            return 4200;
        }
        return 3400;
    }

    private void addDropdowns(Sheet sheet, String scene, String[] headers, User user) {
        DataValidationHelper helper = sheet.getDataValidationHelper();
        String[] units = new String[]{"L", "kg", "g", "个", "瓶", "箱", "桶"};
        List<String> depots = listDepotNames(user);
        for (int i = 0; i < headers.length; i++) {
            String h = headers[i];
            if ("单位".equals(h)) {
                addListValidation(helper, sheet, i, units);
            } else if (("入库仓库".equals(h) || "出库仓库".equals(h) || "仓库".equals(h)) && !depots.isEmpty()) {
                addListValidation(helper, sheet, i, depots.toArray(new String[0]));
            }
        }
    }

    private void addListValidation(DataValidationHelper helper, Sheet sheet, int col, String[] values) {
        if (values == null || values.length == 0) {
            return;
        }
        // Excel list constraint length limit — keep short bounded lists only.
        int max = Math.min(values.length, 40);
        String[] clipped = new String[max];
        System.arraycopy(values, 0, clipped, 0, max);
        DataValidationConstraint constraint = helper.createExplicitListConstraint(clipped);
        CellRangeAddressList addr = new CellRangeAddressList(3, 200, col, col);
        DataValidation validation = helper.createValidation(constraint, addr);
        validation.setSuppressDropDownArrow(false);
        validation.setShowErrorBox(true);
        sheet.addValidationData(validation);
    }

    private List<String> listDepotNames(User user) {
        List<String> names = new ArrayList<String>();
        if (user == null || user.getTenantId() == null) {
            return names;
        }
        try {
            List<Long> allowed = allowedDepotIds(user);
            if (allowed.isEmpty()) {
                return names;
            }
            StringBuilder in = new StringBuilder();
            for (int i = 0; i < allowed.size(); i++) {
                if (i > 0) {
                    in.append(",");
                }
                in.append(allowed.get(i));
            }
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT name FROM jsh_depot WHERE tenant_id=? AND id IN (" + in
                            + ") AND IFNULL(delete_flag,'0')<>'1' ORDER BY name LIMIT 40",
                    user.getTenantId());
            for (Map<String, Object> row : rows) {
                if (row.get("name") != null) {
                    names.add(String.valueOf(row.get("name")));
                }
            }
        } catch (Exception ignore) {
            // dropdown is best-effort
        }
        return names;
    }

    private void text(Sheet sheet, int rowIndex, int col, String value) {
        Row row = sheet.getRow(rowIndex);
        if (row == null) {
            row = sheet.createRow(rowIndex);
        }
        text(row, col, value);
    }

    private void text(Row row, int col, String value) {
        String safe = value == null ? "" : value;
        if (safe.startsWith("=") || safe.startsWith("+") || safe.startsWith("-") || safe.startsWith("@")) {
            safe = "'" + safe;
        }
        row.createCell(col).setCellValue(safe);
    }

    private void assertSafeZip(byte[] raw) throws Exception {
        int entries = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(raw), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries++;
                if (entries > 80) {
                    throw new BusinessRunTimeException(400, "xlsx 内部文件过多");
                }
                String entryName = entry.getName().toLowerCase(Locale.ROOT);
                if (entryName.contains("vbaproject") || entryName.endsWith(".bin") && entryName.contains("macro")) {
                    throw new BusinessRunTimeException(400, "拒绝包含宏的工作簿");
                }
            }
        }
    }

    private Map<String, Object> summary(List<JSONObject> records) {
        int ready = 0;
        for (JSONObject record : records) {
            if (record.getBooleanValue("canConfirm")) {
                ready++;
            }
        }
        Map<String, Object> summary = new LinkedHashMap<String, Object>();
        summary.put("records", records.size());
        summary.put("confirmable", ready);
        summary.put("posted", false);
        return summary;
    }

    private String join(JSONArray errors) {
        if (errors == null || errors.isEmpty()) {
            return "不能确认";
        }
        return errors.toJSONString();
    }

    private String required(JSONObject body, String field) {
        if (body == null || body.getString(field) == null || body.getString(field).trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少字段 " + field);
        }
        return body.getString(field).trim();
    }

    private User requireUser() throws Exception {
        User user = userService.getCurrentUser();
        if (user == null || user.getTenantId() == null) {
            throw new BusinessRunTimeException(403, "当前会话没有租户身份");
        }
        return user;
    }

    private byte[] bytes(XSSFWorkbook book) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        book.write(out);
        book.close();
        return out.toByteArray();
    }
}
