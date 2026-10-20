package com.jsh.erp.gateway.assistant;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.AierpGatewayService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Local rule demo. This class never calls draft confirm or excel confirm.
 */
@Service
public class AierpAssistantService {

    private static final Pattern QTY = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(升|L|l)?");
    private final Map<String, String> conversations = new ConcurrentHashMap<String, String>();

    @Resource
    private AierpGatewayService gatewayService;

    public Map<String, Object> turn(JSONObject body, HttpServletRequest request) throws Exception {
        String message = body == null ? "" : String.valueOf(body.getString("message"));
        String conversationId = body != null && body.getString("conversationId") != null
                ? body.getString("conversationId") : "conv-" + UUID.randomUUID().toString().replace("-", "");
        conversations.putIfAbsent(conversationId, "RULE_DEMO");
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("conversationId", conversationId);
        data.put("mode", "RULE_DEMO");
        data.put("intent", "guide");
        JSONArray actions = new JSONArray();
        data.put("suggestedActions", actions);
        if (message.contains("confirm") || message.contains("跳过确认") || message.contains("直接过账") || message.contains("直接入库") || message.contains("直接帮我")) {
            data.put("intent", "needs_user_confirm");
            data.put("reply", "本地规则演示：我不能代替你确认过账。请在页面上核对草稿后再点击确认。");
            return data;
        }
        if (mentionsStock(message)) {
            return stockTurn(data, message, request);
        }
        if (message.contains("摘要") || message.contains("最近单据") || message.contains("今天")) {
            Map<String, Object> summary = gatewayService.summary(request);
            data.put("intent", "report.summary");
            data.put("facts", summary);
            data.put("reply", "本地规则演示：已读取真实经营摘要。已确认单据 " + summary.get("confirmedCount") + " 张。这些数字来自 ERP，不是模型生成。");
            return data;
        }
        if (message.contains("模板") || message.contains("采购表") || message.toLowerCase().contains("excel")) {
            String sceneName = "PURCHASE";
            if (message.contains("配制") || message.contains("药水")) {
                sceneName = "MIX";
            } else if (message.contains("服务") || message.contains("耗料")) {
                sceneName = "SERVICE";
            }
            data.put("intent", "excel.template");
            JSONObject action = new JSONObject();
            action.put("type", "excel.template");
            action.put("label", "下载" + sceneName + "模板");
            action.put("payload", scene(sceneName));
            actions.add(action);
            data.put("reply", "本地规则演示（RULE_DEMO）：请点击页面上的下载按钮获取真实 xlsx。我不会代替你确认过账。");
            return data;
        }
        if (message.contains("配制") || message.contains("组装")) {
            data.put("intent", "mix.explain");
            data.put("reply", "配制会减少原料并增加成品。配比是虚构测试数据。请用 Excel 预览后由你确认，我不会直接审核组装单。");
            return data;
        }
        if (message.contains("入库") || message.contains("采购")) {
            return draftTurn(data, message, request, actions);
        }
        data.put("reply", "本地规则演示。可以查库存、看摘要，或说明采购数量。任何过账都要你在页面确认。");
        return data;
    }

    private Map<String, Object> stockTurn(Map<String, Object> data, String message, HttpServletRequest request) throws Exception {
        String barCode = barCodeOf(message);
        String depotName = message.contains("成品") || barCode.startsWith("FG-") ? "成品仓" : "原料仓";
        JSONObject query = new JSONObject();
        query.put("barCode", barCode);
        query.put("depotName", depotName);
        try {
            Map<String, Object> stock = gatewayService.stockQuery(query, request);
            data.put("intent", "stock.query");
            data.put("facts", stock);
            data.put("reply", "本地规则演示： " + depotName + " " + stock.get("materialName") + " 当前库存 " + stock.get("currentStock") + " " + stock.get("unit") + "。这是 ERP 实时库存。");
        } catch (BusinessRunTimeException ex) {
            data.put("intent", "stock.query");
            data.put("errors", list(ex.getMessage()));
            data.put("reply", "没有查到库存：" + ex.getMessage());
        }
        return data;
    }

    private Map<String, Object> draftTurn(Map<String, Object> data, String message, HttpServletRequest request, JSONArray actions) throws Exception {
        String barCode = barCodeOf(message);
        BigDecimal qty = qtyOf(message);
        JSONObject draft = new JSONObject();
        draft.put("idempotencyKey", "assistant:" + barCode + ":" + qty.toPlainString());
        draft.put("organName", "华东化工");
        draft.put("remark", "助手生成的待确认草稿");
        JSONArray lines = new JSONArray();
        JSONObject line = new JSONObject();
        line.put("barCode", barCode);
        line.put("depotName", "原料仓");
        line.put("qty", qty.toPlainString());
        line.put("unit", "L");
        line.put("unitPrice", "20");
        lines.add(line);
        draft.put("lines", lines);
        try {
            Map<String, Object> created = gatewayService.createDraft("PURCHASE", draft, request);
            data.put("intent", "purchase.createDraft");
            data.put("facts", created);
            JSONObject action = new JSONObject();
            action.put("type", "needs_user_confirm");
            action.put("label", "请在页面确认后才会审核");
            action.put("payload", draft.getString("idempotencyKey"));
            actions.add(action);
            data.put("reply", "本地规则演示：已生成采购草稿，库存没有变化。请你在页面确认后才会审核。");
        } catch (BusinessRunTimeException ex) {
            data.put("intent", "purchase.createDraft");
            data.put("errors", list(ex.getMessage()));
            data.put("reply", "草稿没有创建：" + ex.getMessage());
        }
        return data;
    }

    private boolean mentionsStock(String message) {
        return message.contains("库存") || message.contains("还有多少") || message.contains("表面活性剂")
                || message.contains("络合剂") || message.contains("纯水") || message.contains("清洗液");
    }

    private String barCodeOf(String message) {
        if (message.contains("RM-B002") || message.contains("络合剂")) return "RM-B002";
        if (message.contains("RM-C003") || message.contains("纯水")) return "RM-C003";
        if (message.contains("FG-102") || message.contains("除胶")) return "FG-102";
        if (message.contains("FG-101") || message.contains("清洗液")) return "FG-101";
        if (message.contains("NO-SUCH") || message.contains("未知物料")) return "NO-SUCH";
        Matcher coded = Pattern.compile("RM-[A-Z0-9]+|FG-\\d+").matcher(message);
        if (coded.find()) return coded.group();
        return "RM-A001";
    }

    private BigDecimal qtyOf(String message) {
        Matcher matcher = QTY.matcher(message);
        if (matcher.find()) {
            return new BigDecimal(matcher.group(1));
        }
        return new BigDecimal("2");
    }

    private JSONArray list(String message) {
        JSONArray errors = new JSONArray();
        errors.add(message);
        return errors;
    }

    private JSONObject scene(String scene) {
        JSONObject payload = new JSONObject();
        payload.put("scene", scene);
        payload.put("status", "READY");
        return payload;
    }
}
