package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.exception.BusinessRunTimeException;
import com.jsh.erp.gateway.excel.AierpExcelService;
import com.jsh.erp.service.RedisService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * AIERP-017A: WeCom delegated Excel template download + preview (no confirm / no stock change).
 * Tracks an open file-workflow so purchase prepare cannot invent drafts from filenames.
 */
@Service
public class AierpWecomExcelService {

    private static final String WF_PREFIX = "aierp:excel-wf:";
    private static final long WF_TTL_SECONDS = 6L * 60L * 60L;

    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpExcelService excelService;
    @Resource
    private RedisService redisService;

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
        // Display name only — never parse qty from basename (e.g. ---100L---).
        Map<String, Object> preview = excelService.previewAs(ctx.user, raw, fileName, scene);
        preview.put("boundErpLoginName", ctx.user.getLoginName());
        preview.put("wecomUserIdMasked", mask(ctx.wecomUserId));
        preview.put("messageMsgId", body.getString("messageMsgId"));
        preview.put("fileSha256", body.getString("fileSha256"));
        preview.put("fileNameDisplayOnly", fileName);
        preview.put("qtySource", "XLSX_CELLS");
        if (preview.get("summary") instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> sum = (Map<String, Object>) preview.get("summary");
            sum.put("posted", false);
            sum.put("stockUnchanged", true);
        }
        boolean openWorkflow = body.getBooleanValue("openWorkflow") || body.get("openWorkflow") == null;
        if (openWorkflow && preview.get("previewId") != null) {
            putWorkflow(ctx, "PREVIEWED", String.valueOf(preview.get("previewId")),
                    body.getString("fileSha256"), body.getString("messageMsgId"), null,
                    preview.get("userSummaryZh") == null ? null : String.valueOf(preview.get("userSummaryZh")));
        }
        return preview;
    }

    public Map<String, Object> workflowStatus(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        if (body != null && body.getString("status") != null) {
            putWorkflow(ctx, body.getString("status").trim().toUpperCase(Locale.ROOT),
                    body.getString("previewId"), body.getString("fileSha256"),
                    body.getString("messageMsgId"), body.getString("reason"),
                    body.getString("userSummaryZh"));
        }
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null) {
            Map<String, Object> empty = new LinkedHashMap<String, Object>();
            empty.put("status", "NONE");
            empty.put("blocksPurchasePrepare", false);
            empty.put("hasValidPreview", false);
            return empty;
        }
        String status = String.valueOf(current.get("status"));
        current.put("blocksPurchasePrepare", blocksPrepare(status));
        current.put("hasValidPreview", "PREVIEWED".equals(status) && current.get("previewId") != null);
        return current;
    }

    public Map<String, Object> workflowCancel(JSONObject body) throws Exception {
        AierpWecomBindingService.BoundContext ctx = bindingService.resolveBoundContext(body);
        putWorkflow(ctx, "CANCELLED", null, null, body == null ? null : body.getString("messageMsgId"),
                "USER_CANCEL", null);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("status", "CANCELLED");
        data.put("blocksPurchasePrepare", false);
        data.put("hasValidPreview", false);
        data.put("hint", "Excel 文件流程已关闭，可重新口头采购。");
        return data;
    }

    /** Used by purchase prepare to reject file-derived guessed drafts. */
    public void assertNoOpenFileWorkflow(AierpWecomBindingService.BoundContext ctx) {
        Map<String, Object> current = getWorkflow(ctx);
        if (current == null) {
            return;
        }
        String status = String.valueOf(current.get("status"));
        if (blocksPrepare(status)) {
            throw new BusinessRunTimeException(409,
                    "当前有未关闭的 Excel 文件核对流程，不能用口头或文件名猜测创建采购草稿。"
                            + "请先按已核对的文件继续，或回复「取消文件」后再口头下单。");
        }
    }

    private void putWorkflow(AierpWecomBindingService.BoundContext ctx, String status, String previewId,
                             String fileSha256, String messageMsgId, String reason, String userSummaryZh) {
        Map<String, Object> wf = new LinkedHashMap<String, Object>();
        wf.put("status", status);
        wf.put("previewId", previewId);
        wf.put("fileSha256", fileSha256);
        wf.put("messageMsgId", messageMsgId);
        wf.put("reason", reason);
        if (userSummaryZh != null && !userSummaryZh.trim().isEmpty()) {
            wf.put("userSummaryZh", userSummaryZh.trim());
        }
        wf.put("erpUserId", ctx.user.getId());
        wf.put("tenantId", ctx.user.getTenantId());
        wf.put("wecomUserIdMasked", mask(ctx.wecomUserId));
        wf.put("bindingId", ctx.binding.get("id"));
        wf.put("bindingVersion", ctx.binding.get("binding_version"));
        wf.put("updatedAt", System.currentTimeMillis());
        String key = workflowKey(ctx);
        redisService.setCacheObject(key, JSON.toJSONString(wf));
        try {
            redisService.redisTemplate.expire(key, WF_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignore) {
            // best-effort TTL
        }
    }

    private Map<String, Object> getWorkflow(AierpWecomBindingService.BoundContext ctx) {
        Object raw = redisService.getCacheObject(workflowKey(ctx));
        if (raw == null) {
            return null;
        }
        try {
            Map<String, Object> wf = JSON.parseObject(String.valueOf(raw));
            // A WeCom sender can unbind/rebind to a different ERP user/tenant.
            // Never reuse a cached preview, supplier/price or file workflow across
            // actor changes or binding generations (including same-second rebind).
            if (wf == null
                    || !String.valueOf(ctx.user.getId()).equals(String.valueOf(wf.get("erpUserId")))
                    || !String.valueOf(ctx.user.getTenantId()).equals(String.valueOf(wf.get("tenantId")))
                    || !String.valueOf(ctx.binding.get("binding_version")).equals(String.valueOf(wf.get("bindingVersion")))
                    || wf.get("bindingId") == null
                    || !String.valueOf(ctx.binding.get("id")).equals(String.valueOf(wf.get("bindingId")))) {
                return null;
            }
            return wf;
        } catch (Exception ex) {
            return null;
        }
    }

    private static String workflowKey(AierpWecomBindingService.BoundContext ctx) {
        return WF_PREFIX + ctx.botId + ":" + ctx.wecomUserId;
    }

    private static boolean blocksPrepare(String status) {
        return "PENDING".equals(status) || "PREVIEWED".equals(status) || "FAILED".equals(status);
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
