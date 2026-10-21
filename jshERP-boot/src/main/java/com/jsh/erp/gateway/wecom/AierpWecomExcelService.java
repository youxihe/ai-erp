package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.excel.AierpExcelService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * AIERP-017A: WeCom delegated Excel template download + preview (no confirm / no stock change).
 */
@Service
public class AierpWecomExcelService {

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpExcelService excelService;

    public Map<String, Object> template(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        String scene = body == null ? null : body.getString("scene");
        if (scene == null || scene.trim().isEmpty()) {
            scene = "PURCHASE";
        }
        scene = scene.trim().toUpperCase(Locale.ROOT);
        JSONObject fill = null;
        if (body != null) {
            if (body.getJSONObject("fill") != null) {
                fill = body.getJSONObject("fill");
            } else if (body.getJSONArray("rows") != null) {
                fill = new JSONObject();
                fill.put("rows", body.getJSONArray("rows"));
            }
        }
        byte[] bytes = excelService.templateAs(ctx.user, scene, fill);
        String fileName = fileNameFor(scene);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("nature", "REAL_ERP");
        data.put("scene", scene);
        data.put("fileName", fileName);
        data.put("contentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        data.put("byteLength", bytes.length);
        data.put("fileBase64", Base64.getEncoder().encodeToString(bytes));
        data.put("posted", false);
        data.put("confirmSupported", isConfirmableScene(scene));
        data.put("boundErpLoginName", ctx.user.getLoginName());
        data.put("summary", "已生成 " + fileName + "（" + bytes.length + " 字节）。"
                + (isConfirmableScene(scene)
                ? "请下载填写后在本对话发回 xlsx；本阶段仅预览，不会入库。"
                : "该场景当前仅提供模板，不支持预览确认过账（销售出库/期初）。"));
        data.put("hint", data.get("summary"));
        return data;
    }

    public Map<String, Object> preview(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        if (body == null || body.getString("fileBase64") == null || body.getString("fileBase64").trim().isEmpty()) {
            throw new BusinessRunTimeException(400, "缺少 fileBase64");
        }
        String fileName = body.getString("fileName");
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "upload.xlsx";
        }
        fileName = fileName.trim();
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(body.getString("fileBase64").trim());
        } catch (Exception ex) {
            throw new BusinessRunTimeException(400, "fileBase64 无效");
        }
        String scene = body.getString("scene");
        Map<String, Object> preview = excelService.previewAs(ctx.user, raw, fileName, scene);
        preview.put("boundErpLoginName", ctx.user.getLoginName());
        preview.put("wecomUserIdMasked", mask(ctx.wecomUserId));
        preview.put("messageMsgId", body.getString("messageMsgId"));
        preview.put("fileSha256", body.getString("fileSha256"));
        if (preview.get("summary") instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> sum = (Map<String, Object>) preview.get("summary");
            sum.put("posted", false);
            sum.put("stockUnchanged", true);
        }
        return preview;
    }

    private static boolean isConfirmableScene(String scene) {
        return "PURCHASE".equals(scene) || "MIX".equals(scene) || "SERVICE".equals(scene) || "PACK".equals(scene);
    }

    private static String fileNameFor(String scene) {
        if ("MIX".equals(scene)) {
            return "配制生产模板.xlsx";
        }
        if ("SERVICE".equals(scene)) {
            return "服务耗料模板.xlsx";
        }
        if ("SALE".equals(scene)) {
            return "销售出库模板（仅模板不可过账）.xlsx";
        }
        if ("INITIAL".equals(scene)) {
            return "物料期初模板（仅模板不可过账）.xlsx";
        }
        if ("PACK".equals(scene)) {
            return "进销存演示模板包.xlsx";
        }
        return "采购入库模板.xlsx";
    }

    private static String mask(String wecomUserId) {
        if (wecomUserId == null || wecomUserId.length() < 4) {
            return "***";
        }
        return wecomUserId.substring(0, 2) + "***";
    }
}
