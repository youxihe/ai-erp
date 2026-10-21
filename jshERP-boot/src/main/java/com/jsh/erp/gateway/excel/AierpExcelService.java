package com.jsh.erp.gateway.excel;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import com.jsh.erp.service.UserService;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Real XLSX in and out. Preview never posts. Confirm calls the merged ERP gateway.
 */
@Service
public class AierpExcelService {

    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ROWS = 200;
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
        String normalized = scene == null ? "" : scene.trim().toUpperCase(Locale.ROOT);
        XSSFWorkbook book = new XSSFWorkbook();
        Sheet help = book.createSheet("使用说明");
        text(help, 0, 0, "AI-ERP 演示 Excel。第3行是表头，第4行起是数据。配比为虚构测试数据，不是化学工艺。");
        text(help, 1, 0, "上传只生成预览。库存变化只发生在用户确认之后。物料期初和销售出库仅供下载，不能经本网关确认。");
        if ("PURCHASE".equals(normalized) || "PACK".equals(normalized)) {
            writeSheet(book, "02采购入库", PURCHASE_HEADERS, fill == null ? null : fill.getJSONArray("rows"),
                    "PURCHASE".equals(normalized) ? "PURCHASE" : normalized);
        }
        if ("MIX".equals(normalized) || "PACK".equals(normalized)) {
            writeSheet(book, "03药水配制", MIX_HEADERS, fill == null ? null : fill.getJSONArray("rows"), "MIX");
        }
        if ("SERVICE".equals(normalized) || "PACK".equals(normalized)) {
            writeSheet(book, "04服务耗料", SERVICE_HEADERS, fill == null ? null : fill.getJSONArray("rows"), "SERVICE");
        }
        if ("INITIAL".equals(normalized) || "PACK".equals(normalized)) {
            Sheet sheet = writeSheet(book, "01物料期初", INITIAL_HEADERS, null, "INITIAL");
            text(sheet, 1, 0, "仅模板，不支持经 AI 网关确认过账");
        }
        if ("SALE".equals(normalized) || "PACK".equals(normalized)) {
            Sheet sheet = writeSheet(book, "05销售出库", SALE_HEADERS, null, "SALE");
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
        data.put("hintZh", buildPreviewHint(records));
        return data;
    }

    private String buildPreviewHint(List<JSONObject> records) {
        Map<String, Integer> byScene = new LinkedHashMap<String, Integer>();
        Map<String, Integer> bills = new LinkedHashMap<String, Integer>();
        int okRows = 0;
        int badRows = 0;
        List<String> errors = new ArrayList<String>();
        for (JSONObject record : records) {
            String scene = String.valueOf(record.getString("scene"));
            byScene.put(scene, byScene.containsKey(scene) ? byScene.get(scene) + 1 : 1);
            String bk = record.getString("businessKey");
            if (bk != null && !bk.isEmpty()) {
                bills.put(bk, bills.containsKey(bk) ? bills.get(bk) + 1 : 1);
            }
            if (record.getBooleanValue("canConfirm")) {
                okRows++;
            } else {
                badRows++;
                if (errors.size() < 5) {
                    JSONArray errs = record.getJSONArray("errors");
                    errors.add("行" + record.get("rowIndex") + ": " + join(errs));
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append("批量文件已解析（仅预览，库存与已审核单据未变化）。");
        sb.append("业务单约 ").append(bills.size()).append(" 张，明细 ").append(records.size()).append(" 行；");
        sb.append("可后续草稿候选 ").append(okRows).append(" 行，有问题 ").append(badRows).append(" 行。");
        if (!errors.isEmpty()) {
            sb.append(" 错误示例：").append(String.join("；", errors));
        }
        sb.append(" 本阶段不执行 excel.confirm，不会入库。销售出库/期初仅模板。");
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
            Integer organs = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM jsh_supplier WHERE supplier=? AND type=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                    Integer.class, organ, type, user.getTenantId());
            if (organs == null || organs == 0) {
                errors.add("未找到当前租户下的" + type + ": " + organ);
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
        Integer depots = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_depot WHERE name=? AND tenant_id=? AND IFNULL(delete_flag,'0')<>'1'",
                Integer.class, depotName, user.getTenantId());
        if (depots == null || depots == 0) {
            errors.add("仓库不存在或不属于当前租户: " + depotName);
        }
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
            names.add(name == null ? "" : name.replace(" ", ""));
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

    private Sheet writeSheet(XSSFWorkbook book, String name, String[] headers, JSONArray rows, String scene) {
        Sheet sheet = book.createSheet(name);
        text(sheet, 0, 0, name);
        text(sheet, 1, 0, "第3行表头，第4行开始填写。不要使用公式。");
        Row head = sheet.createRow(2);
        for (int i = 0; i < headers.length; i++) {
            text(head, i, headers[i]);
        }
        if (rows != null) {
            for (int i = 0; i < rows.size(); i++) {
                JSONObject row = rows.getJSONObject(i);
                Row excel = sheet.createRow(3 + i);
                if ("PURCHASE".equals(scene)) {
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
        }
        return sheet;
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
