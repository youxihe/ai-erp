package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.datasource.entities.User;
import com.jsh.erp.exception.BusinessRunTimeException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AIERP-013 read-only business queries under WeCom delegated identity.
 * Does not create drafts or post inventory.
 */
@Service
public class AierpWecomQueryService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final Pattern ID_IN_BRACKETS = Pattern.compile("\\[(\\d+)\\]");
    private static final long FUN_STOCK = 246L;
    private static final long FUN_PURCHASE = 33L;
    private static final long FUN_MIX = 232L;
    private static final long FUN_SERVICE = 202L;
    private static final int MAX_RANGE_DAYS = 90;
    private static final int DEFAULT_LIMIT = 10;
    private static final int MAX_LIMIT = 50;

    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private AierpWecomBindingService bindingService;

    public Map<String, Object> materialSearch(JSONObject body) throws Exception {
        User user = bindingService.resolveBoundActiveUser(body);
        assertFunction(user, FUN_STOCK, "物料查询");
        String query = trimToNull(body.getString("query"));
        String barCode = trimToNull(body.getString("barCode"));
        int limit = clampLimit(body.getInteger("limit"));
        List<Object> args = new ArrayList<Object>();
        StringBuilder sql = new StringBuilder();
        sql.append("SELECT m.id AS material_id, m.name AS material_name, e.bar_code AS bar_code, ");
        sql.append("IFNULL(NULLIF(e.commodity_unit,''), IFNULL(m.unit,'')) AS unit, ");
        sql.append("IFNULL(c.name,'') AS category_name, ");
        sql.append("CASE WHEN m.enabled IS NULL OR m.enabled=b'1' OR m.enabled=1 THEN 1 ELSE 0 END AS enabled ");
        sql.append("FROM jsh_material m ");
        sql.append("JOIN jsh_material_extend e ON e.material_id=m.id AND IFNULL(e.delete_flag,'0')<>'1' ");
        sql.append("LEFT JOIN jsh_material_category c ON c.id=m.category_id AND IFNULL(c.delete_flag,'0')<>'1' ");
        sql.append("WHERE m.tenant_id=? AND IFNULL(m.delete_flag,'0')<>'1' ");
        args.add(user.getTenantId());
        if (barCode != null) {
            sql.append("AND e.bar_code=? ");
            args.add(barCode);
        } else if (query != null) {
            sql.append("AND (m.name LIKE ? OR e.bar_code LIKE ?) ");
            args.add("%" + query + "%");
            args.add("%" + query + "%");
        }
        sql.append("ORDER BY CASE WHEN e.bar_code=? THEN 0 WHEN m.name=? THEN 1 ELSE 2 END, e.bar_code LIMIT ?");
        String exact = barCode != null ? barCode : (query != null ? query : "");
        args.add(exact);
        args.add(exact);
        args.add(limit);
        List<Map<String, Object>> raw = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : raw) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("materialName", r.get("material_name"));
            row.put("barCode", r.get("bar_code"));
            row.put("unit", r.get("unit"));
            row.put("categoryName", r.get("category_name"));
            row.put("enabled", toBool(r.get("enabled")));
            rows.add(row);
        }
        Map<String, Object> data = baseMeta(user);
        data.put("nature", "REAL_ERP");
        data.put("ambiguous", rows.size() > 1 && barCode == null);
        data.put("rowCount", rows.size());
        data.put("rows", rows);
        if (rows.isEmpty()) {
            data.put("hint", query == null && barCode == null
                    ? "请提供物料中文名或编码关键字"
                    : "未找到匹配物料，请换关键字或编码");
        } else if (rows.size() > 1 && barCode == null) {
            data.put("hint", "找到多个候选，请用精确编码（barCode）确认");
        }
        return data;
    }

    public Map<String, Object> partnerSearch(JSONObject body) throws Exception {
        User user = bindingService.resolveBoundActiveUser(body);
        String partnerType = normalizePartnerType(body.getString("partnerType"));
        if ("供应商".equals(partnerType)) {
            assertFunction(user, FUN_PURCHASE, "供应商查询");
        } else {
            assertFunction(user, FUN_SERVICE, "客户查询");
        }
        String query = trimToNull(body.getString("query"));
        int limit = clampLimit(body.getInteger("limit"));
        List<Object> args = new ArrayList<Object>();
        StringBuilder sql = new StringBuilder();
        // Intentionally omit phone/address/cost — only name + type + enabled for WeCom.
        sql.append("SELECT id, supplier AS partner_name, type AS partner_type, ");
        sql.append("CASE WHEN enabled IS NULL OR enabled=b'1' OR enabled=1 THEN 1 ELSE 0 END AS enabled ");
        sql.append("FROM jsh_supplier WHERE tenant_id=? AND type=? AND IFNULL(delete_flag,'0')<>'1' ");
        args.add(user.getTenantId());
        args.add(partnerType);
        if (query != null) {
            sql.append("AND supplier LIKE ? ");
            args.add("%" + query + "%");
        }
        sql.append("ORDER BY supplier LIMIT ?");
        args.add(limit);
        List<Map<String, Object>> raw = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : raw) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("partnerId", r.get("id"));
            row.put("partnerName", r.get("partner_name"));
            row.put("partnerType", r.get("partner_type"));
            row.put("enabled", toBool(r.get("enabled")));
            rows.add(row);
        }
        Map<String, Object> data = baseMeta(user);
        data.put("nature", "REAL_ERP");
        data.put("partnerType", partnerType);
        data.put("rowCount", rows.size());
        data.put("rows", rows);
        if (rows.isEmpty()) {
            data.put("hint", "未找到匹配的" + partnerType);
        }
        return data;
    }

    public Map<String, Object> billSearch(JSONObject body) throws Exception {
        User user = bindingService.resolveBoundActiveUser(body);
        BillKind kind = resolveBillKind(body.getString("billType"));
        assertFunction(user, kind.funId, kind.cnType + "单据查询");
        List<Long> depots = allowedDepotIds(user);
        if (depots.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有可查询的仓库权限");
        }
        DateRange range = resolveDateRange(body, 7);
        String statusFilter = normalizeStatus(body.getString("status"));
        String keyword = trimToNull(body.getString("query"));
        String partner = trimToNull(body.getString("partnerName"));
        int limit = clampLimit(body.getInteger("limit"));

        StringBuilder sql = new StringBuilder();
        List<Object> args = new ArrayList<Object>();
        sql.append("SELECT h.id, h.number, h.type, h.sub_type, h.status, h.total_price, h.oper_time, ");
        sql.append("IFNULL(s.supplier,'') AS partner_name ");
        sql.append("FROM jsh_depot_head h ");
        sql.append("LEFT JOIN jsh_supplier s ON s.id=h.organ_id ");
        sql.append("WHERE h.tenant_id=? AND IFNULL(h.delete_flag,'0')<>'1' ");
        sql.append("AND h.type=? AND h.sub_type=? ");
        sql.append("AND h.oper_time>=? AND h.oper_time<? ");
        args.add(user.getTenantId());
        args.add(kind.type);
        args.add(kind.subType);
        args.add(TS.format(range.from.atStartOfDay()));
        args.add(TS.format(range.to.plusDays(1).atStartOfDay()));
        if (statusFilter != null) {
            sql.append("AND h.status=? ");
            args.add(statusFilter);
        }
        if (keyword != null) {
            sql.append("AND h.number LIKE ? ");
            args.add("%" + keyword + "%");
        }
        if (partner != null) {
            sql.append("AND s.supplier LIKE ? ");
            args.add("%" + partner + "%");
        }
        sql.append("AND EXISTS (SELECT 1 FROM jsh_depot_item di WHERE di.header_id=h.id ");
        sql.append("AND IFNULL(di.delete_flag,'0')<>'1' AND di.depot_id IN (");
        appendIn(sql, args, depots);
        sql.append(")) ");
        sql.append("ORDER BY h.oper_time DESC, h.id DESC LIMIT ?");
        args.add(limit);

        List<Map<String, Object>> raw = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : raw) {
            rows.add(mapBillHead(r, kind));
        }
        Map<String, Object> data = baseMeta(user);
        data.put("nature", "REAL_ERP");
        data.put("billType", kind.code);
        data.put("billTypeLabel", kind.cnType);
        data.put("fromDate", DAY.format(range.from));
        data.put("toDate", DAY.format(range.to));
        data.put("rowCount", rows.size());
        data.put("rows", rows);
        if (rows.isEmpty()) {
            data.put("hint", "该条件在授权仓库下暂无" + kind.cnType + "单据");
        }
        return data;
    }

    public Map<String, Object> billDetail(JSONObject body) throws Exception {
        User user = bindingService.resolveBoundActiveUser(body);
        String number = trimToNull(body.getString("billNumber"));
        if (number == null) {
            number = trimToNull(body.getString("number"));
        }
        if (number == null) {
            throw new BusinessRunTimeException(400, "缺少单据编号 billNumber");
        }
        List<Map<String, Object>> heads = jdbcTemplate.queryForList(
                "SELECT h.id, h.number, h.type, h.sub_type, h.status, h.total_price, h.oper_time, h.tenant_id, "
                        + "IFNULL(s.supplier,'') AS partner_name "
                        + "FROM jsh_depot_head h LEFT JOIN jsh_supplier s ON s.id=h.organ_id "
                        + "WHERE h.number=? AND h.tenant_id=? AND IFNULL(h.delete_flag,'0')<>'1' LIMIT 1",
                number, user.getTenantId());
        if (heads.isEmpty()) {
            throw new BusinessRunTimeException(404, "单据不存在或不属于当前租户");
        }
        Map<String, Object> head = heads.get(0);
        BillKind kind = billKindOf(String.valueOf(head.get("type")), String.valueOf(head.get("sub_type")));
        if (kind == null) {
            throw new BusinessRunTimeException(403, "该单据类型不在企微只读查询范围（采购/组装/服务耗料）");
        }
        assertFunction(user, kind.funId, kind.cnType + "单据明细");
        List<Long> depots = allowedDepotIds(user);
        if (depots.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有可查询的仓库权限");
        }
        Long headerId = ((Number) head.get("id")).longValue();
        Integer visible = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM jsh_depot_item di WHERE di.header_id=? AND IFNULL(di.delete_flag,'0')<>'1' "
                        + "AND di.depot_id IN (" + placeholders(depots.size()) + ")",
                Integer.class, withLeading(headerId, depots));
        if (visible == null || visible < 1) {
            throw new BusinessRunTimeException(403, "当前用户无权查看该单据涉及的仓库明细");
        }
        StringBuilder lineSql = new StringBuilder();
        List<Object> lineArgs = new ArrayList<Object>();
        lineSql.append("SELECT IFNULL(me.bar_code,'') AS bar_code, IFNULL(m.name,'') AS material_name, ");
        lineSql.append("IFNULL(di.material_unit,'') AS unit, di.oper_number, di.unit_price, di.all_price, ");
        lineSql.append("IFNULL(d.name,'') AS depot_name, IFNULL(di.material_type,'') AS material_type ");
        lineSql.append("FROM jsh_depot_item di ");
        lineSql.append("LEFT JOIN jsh_material m ON m.id=di.material_id ");
        lineSql.append("LEFT JOIN jsh_material_extend me ON me.id=di.material_extend_id ");
        lineSql.append("LEFT JOIN jsh_depot d ON d.id=di.depot_id ");
        lineSql.append("WHERE di.header_id=? AND IFNULL(di.delete_flag,'0')<>'1' AND di.depot_id IN (");
        lineArgs.add(headerId);
        appendIn(lineSql, lineArgs, depots);
        lineSql.append(") ORDER BY di.id");
        List<Map<String, Object>> rawLines = jdbcTemplate.queryForList(lineSql.toString(), lineArgs.toArray());
        List<Map<String, Object>> lines = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : rawLines) {
            Map<String, Object> line = new LinkedHashMap<String, Object>();
            line.put("materialName", r.get("material_name"));
            line.put("barCode", r.get("bar_code"));
            line.put("unit", r.get("unit"));
            line.put("qty", r.get("oper_number"));
            line.put("unitPrice", r.get("unit_price"));
            line.put("amount", r.get("all_price"));
            line.put("depotName", r.get("depot_name"));
            if (r.get("material_type") != null && !String.valueOf(r.get("material_type")).isEmpty()) {
                line.put("materialType", r.get("material_type"));
            }
            lines.add(line);
        }
        Map<String, Object> data = baseMeta(user);
        data.put("nature", "REAL_ERP");
        data.put("bill", mapBillHead(head, kind));
        data.put("lineCount", lines.size());
        data.put("lines", lines);
        return data;
    }

    public Map<String, Object> reportQuery(JSONObject body) throws Exception {
        User user = bindingService.resolveBoundActiveUser(body);
        String report = trimToNull(body.getString("report"));
        if (report == null) {
            report = trimToNull(body.getString("reportType"));
        }
        if (report == null) {
            throw new BusinessRunTimeException(400, "缺少 report（purchase_in_summary | service_consume_by_customer）");
        }
        String key = report.trim().toLowerCase(Locale.ROOT).replace('-', '_');
        DateRange range = resolveDateRange(body, 7);
        List<Long> depots = allowedDepotIds(user);
        if (depots.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有可查询的仓库权限");
        }
        Map<String, Object> data = baseMeta(user);
        data.put("nature", "REAL_ERP");
        data.put("fromDate", DAY.format(range.from));
        data.put("toDate", DAY.format(range.to));
        data.put("statusFilter", "已审核(status=1)");
        if ("purchase_in_summary".equals(key) || "purchase_summary".equals(key)) {
            assertFunction(user, FUN_PURCHASE, "采购入库汇总");
            return purchaseInSummary(user, data, range, depots);
        }
        if ("service_consume_by_customer".equals(key) || "service_by_customer".equals(key)) {
            assertFunction(user, FUN_SERVICE, "服务耗料客户汇总");
            return serviceByCustomer(user, data, range, depots, trimToNull(body.getString("partnerName")));
        }
        throw new BusinessRunTimeException(400, "不支持的报表类型: " + report
                + "（支持 purchase_in_summary / service_consume_by_customer）");
    }

    private Map<String, Object> purchaseInSummary(User user, Map<String, Object> data, DateRange range, List<Long> depots) {
        StringBuilder sql = new StringBuilder();
        List<Object> args = new ArrayList<Object>();
        sql.append("SELECT COUNT(DISTINCT h.id) AS bill_count, ");
        sql.append("IFNULL(SUM(ABS(IFNULL(di.oper_number,0))),0) AS total_qty, ");
        sql.append("IFNULL(SUM(ABS(IFNULL(di.all_price,0))),0) AS total_amount ");
        sql.append("FROM jsh_depot_head h ");
        sql.append("JOIN jsh_depot_item di ON di.header_id=h.id AND IFNULL(di.delete_flag,'0')<>'1' ");
        sql.append("WHERE h.tenant_id=? AND IFNULL(h.delete_flag,'0')<>'1' ");
        sql.append("AND h.type='入库' AND h.sub_type='采购' AND h.status='1' ");
        sql.append("AND h.oper_time>=? AND h.oper_time<? ");
        sql.append("AND di.depot_id IN (");
        args.add(user.getTenantId());
        args.add(TS.format(range.from.atStartOfDay()));
        args.add(TS.format(range.to.plusDays(1).atStartOfDay()));
        appendIn(sql, args, depots);
        sql.append(")");
        Map<String, Object> agg = jdbcTemplate.queryForMap(sql.toString(), args.toArray());
        long billCount = ((Number) agg.get("bill_count")).longValue();
        BigDecimal qty = toDecimal(agg.get("total_qty"));
        BigDecimal amount = toDecimal(agg.get("total_amount")).setScale(2, RoundingMode.HALF_UP);
        Map<String, Object> totals = new LinkedHashMap<String, Object>();
        totals.put("billCount", billCount);
        totals.put("totalQty", qty);
        totals.put("totalAmount", amount);
        data.put("report", "purchase_in_summary");
        data.put("reportLabel", "采购入库汇总（已审核）");
        data.put("totals", totals);
        data.put("rows", Collections.singletonList(totals));
        data.put("rowCount", billCount > 0 ? 1 : 0);
        if (billCount == 0) {
            data.put("hint", "该区间暂无已审核的采购入库数据");
        }
        return data;
    }

    private Map<String, Object> serviceByCustomer(User user, Map<String, Object> data, DateRange range,
                                                 List<Long> depots, String partnerName) {
        StringBuilder sql = new StringBuilder();
        List<Object> args = new ArrayList<Object>();
        sql.append("SELECT IFNULL(s.supplier,'(无客户)') AS partner_name, ");
        sql.append("COUNT(DISTINCT h.id) AS bill_count, ");
        sql.append("IFNULL(SUM(ABS(IFNULL(di.oper_number,0))),0) AS total_qty, ");
        sql.append("IFNULL(SUM(ABS(IFNULL(di.all_price,0))),0) AS total_amount ");
        sql.append("FROM jsh_depot_head h ");
        sql.append("JOIN jsh_depot_item di ON di.header_id=h.id AND IFNULL(di.delete_flag,'0')<>'1' ");
        sql.append("LEFT JOIN jsh_supplier s ON s.id=h.organ_id ");
        sql.append("WHERE h.tenant_id=? AND IFNULL(h.delete_flag,'0')<>'1' ");
        sql.append("AND h.type='出库' AND h.sub_type='其它' AND h.status='1' ");
        sql.append("AND h.oper_time>=? AND h.oper_time<? ");
        sql.append("AND di.depot_id IN (");
        args.add(user.getTenantId());
        args.add(TS.format(range.from.atStartOfDay()));
        args.add(TS.format(range.to.plusDays(1).atStartOfDay()));
        appendIn(sql, args, depots);
        sql.append(") ");
        if (partnerName != null) {
            sql.append("AND s.supplier LIKE ? ");
            args.add("%" + partnerName + "%");
        }
        sql.append("GROUP BY IFNULL(s.supplier,'(无客户)') ORDER BY total_qty DESC LIMIT 20");
        List<Map<String, Object>> raw = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : raw) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("partnerName", r.get("partner_name"));
            row.put("billCount", r.get("bill_count"));
            row.put("totalQty", toDecimal(r.get("total_qty")));
            row.put("totalAmount", toDecimal(r.get("total_amount")).setScale(2, RoundingMode.HALF_UP));
            rows.add(row);
        }
        data.put("report", "service_consume_by_customer");
        data.put("reportLabel", "服务耗料按客户汇总（已审核）");
        data.put("rowCount", rows.size());
        data.put("rows", rows);
        if (rows.isEmpty()) {
            data.put("hint", "该区间暂无已审核的服务耗料数据");
        }
        return data;
    }

    private Map<String, Object> mapBillHead(Map<String, Object> r, BillKind kind) {
        Map<String, Object> row = new LinkedHashMap<String, Object>();
        row.put("billNumber", r.get("number"));
        row.put("billType", kind.code);
        row.put("billTypeLabel", kind.cnType);
        row.put("nativeType", r.get("type"));
        row.put("nativeSubType", r.get("sub_type"));
        row.put("status", String.valueOf(r.get("status")));
        row.put("statusLabel", statusLabel(String.valueOf(r.get("status"))));
        row.put("partnerName", r.get("partner_name"));
        row.put("operTime", String.valueOf(r.get("oper_time")));
        BigDecimal total = toDecimal(r.get("total_price"));
        // Purchase入库 total_price is stored negative in jshERP; expose absolute for chat readability.
        if (kind == BillKind.PURCHASE) {
            total = total.abs();
        }
        row.put("totalAmount", total.setScale(2, RoundingMode.HALF_UP));
        return row;
    }

    private static String statusLabel(String status) {
        if ("1".equals(status)) {
            return "已审核";
        }
        if ("0".equals(status)) {
            return "未审核";
        }
        return status == null ? "?" : status;
    }

    private static String normalizeStatus(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        String s = raw.trim().toLowerCase(Locale.ROOT);
        if ("1".equals(s) || s.contains("已审") || "approved".equals(s) || "confirmed".equals(s)) {
            return "1";
        }
        if ("0".equals(s) || s.contains("未审") || "draft".equals(s) || "pending".equals(s)) {
            return "0";
        }
        throw new BusinessRunTimeException(400, "status 仅支持 已审核/未审核（或 1/0）");
    }

    private static String normalizePartnerType(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少 partnerType（supplier|customer）");
        }
        String s = raw.trim().toLowerCase(Locale.ROOT);
        if ("supplier".equals(s) || "供应商".equals(raw.trim())) {
            return "供应商";
        }
        if ("customer".equals(s) || "客户".equals(raw.trim())) {
            return "客户";
        }
        throw new BusinessRunTimeException(400, "partnerType 仅支持 supplier|customer");
    }

    private static BillKind resolveBillKind(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少 billType（purchase|mix|service）");
        }
        String s = raw.trim().toLowerCase(Locale.ROOT);
        if ("purchase".equals(s) || "采购".equals(raw.trim()) || "采购入库".equals(raw.trim())) {
            return BillKind.PURCHASE;
        }
        if ("mix".equals(s) || "组装".equals(raw.trim()) || "配制".equals(raw.trim()) || "组装单".equals(raw.trim())) {
            return BillKind.MIX;
        }
        if ("service".equals(s) || "服务".equals(raw.trim()) || "耗料".equals(raw.trim()) || "服务耗料".equals(raw.trim())) {
            return BillKind.SERVICE;
        }
        throw new BusinessRunTimeException(400, "billType 仅支持 purchase|mix|service");
    }

    private static BillKind billKindOf(String type, String subType) {
        for (BillKind k : BillKind.values()) {
            if (k.type.equals(type) && k.subType.equals(subType)) {
                return k;
            }
        }
        return null;
    }

    private DateRange resolveDateRange(JSONObject body, int defaultDays) {
        LocalDate today = LocalDate.now();
        LocalDate to = parseDay(body.getString("toDate"), today);
        LocalDate from = parseDay(body.getString("fromDate"), to.minusDays(defaultDays - 1L));
        if (from.isAfter(to)) {
            throw new BusinessRunTimeException(400, "fromDate 不能晚于 toDate");
        }
        long days = ChronoUnit.DAYS.between(from, to) + 1;
        if (days > MAX_RANGE_DAYS) {
            throw new BusinessRunTimeException(400, "查询日期跨度不能超过 " + MAX_RANGE_DAYS + " 天");
        }
        Integer daysBack = body.getInteger("days");
        if (daysBack != null && body.getString("fromDate") == null && body.getString("toDate") == null) {
            if (daysBack < 1 || daysBack > MAX_RANGE_DAYS) {
                throw new BusinessRunTimeException(400, "days 须在 1.." + MAX_RANGE_DAYS);
            }
            to = today;
            from = today.minusDays(daysBack - 1L);
        }
        return new DateRange(from, to);
    }

    private static LocalDate parseDay(String raw, LocalDate fallback) {
        if (raw == null || raw.trim().isEmpty()) {
            return fallback;
        }
        try {
            return LocalDate.parse(raw.trim().substring(0, Math.min(10, raw.trim().length())));
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "日期格式无效，请用 yyyy-MM-dd");
        }
    }

    private void assertFunction(User user, long funId, String action) {
        List<Long> roles = roleIds(user);
        if (roles.isEmpty()) {
            throw new BusinessRunTimeException(403, "当前用户没有业务角色，拒绝" + action);
        }
        boolean hasFun = false;
        for (Long roleId : roles) {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT `value` FROM jsh_user_business WHERE type='RoleFunctions' AND key_id=? AND IFNULL(delete_flag,'0')<>'1'",
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
            throw new BusinessRunTimeException(403, "当前角色无权" + action + "，功能 " + funId);
        }
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
            Matcher matcher = ID_IN_BRACKETS.matcher(value);
            while (matcher.find()) {
                ids.add(Long.valueOf(matcher.group(1)));
            }
        }
        return ids;
    }

    private List<Long> allowedDepotIds(User user) {
        List<String> values = jdbcTemplate.query(
                "SELECT `value` FROM jsh_user_business WHERE type='UserDepot' AND key_id=? AND IFNULL(delete_flag,'0')<>'1'",
                (rs, i) -> rs.getString(1), String.valueOf(user.getId()));
        List<Long> ids = new ArrayList<Long>();
        if (values.isEmpty() || values.get(0) == null) {
            return ids;
        }
        Matcher matcher = ID_IN_BRACKETS.matcher(values.get(0));
        while (matcher.find()) {
            ids.add(Long.valueOf(matcher.group(1)));
        }
        return ids;
    }

    private static Map<String, Object> baseMeta(User user) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("boundErpLoginName", user.getLoginName());
        data.put("tenantId", user.getTenantId());
        data.put("asOf", TS.format(LocalDateTime.now()));
        return data;
    }

    private static int clampLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1) {
            return 1;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static boolean toBool(Object v) {
        if (v instanceof Boolean) {
            return (Boolean) v;
        }
        if (v instanceof Number) {
            return ((Number) v).intValue() != 0;
        }
        return "1".equals(String.valueOf(v));
    }

    private static BigDecimal toDecimal(Object v) {
        if (v == null) {
            return BigDecimal.ZERO;
        }
        if (v instanceof BigDecimal) {
            return (BigDecimal) v;
        }
        return new BigDecimal(String.valueOf(v));
    }

    private static void appendIn(StringBuilder sql, List<Object> args, List<Long> ids) {
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) {
                sql.append(',');
            }
            sql.append('?');
            args.add(ids.get(i));
        }
    }

    private static String placeholders(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append('?');
        }
        return sb.toString();
    }

    private static Object[] withLeading(Object first, List<Long> rest) {
        Object[] arr = new Object[rest.size() + 1];
        arr[0] = first;
        for (int i = 0; i < rest.size(); i++) {
            arr[i + 1] = rest.get(i);
        }
        return arr;
    }

    private enum BillKind {
        PURCHASE("purchase", "采购入库", "入库", "采购", FUN_PURCHASE),
        MIX("mix", "组装配制", "其它", "组装单", FUN_MIX),
        SERVICE("service", "服务耗料", "出库", "其它", FUN_SERVICE);

        final String code;
        final String cnType;
        final String type;
        final String subType;
        final long funId;

        BillKind(String code, String cnType, String type, String subType, long funId) {
            this.code = code;
            this.cnType = cnType;
            this.type = type;
            this.subType = subType;
            this.funId = funId;
        }
    }

    private static final class DateRange {
        final LocalDate from;
        final LocalDate to;

        DateRange(LocalDate from, LocalDate to) {
            this.from = from;
            this.to = to;
        }
    }
}
