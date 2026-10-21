package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.utils.BaseResponseInfo;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

/**
 * WeCom adapter for AIERP-012A/013/015A.
 * Adapter routes require HMAC; claim requires logged-in ERP session.
 * No WeCom confirm/posting route (015B).
 */
@RestController
@RequestMapping("/aierp/v1/wecom")
public class AierpWecomController {

    @Resource
    private AierpWecomAdapterAuth adapterAuth;
    @Resource
    private AierpWecomBindingService bindingService;
    @Resource
    private AierpWecomQueryService queryService;
    @Resource
    private AierpWecomDraftService draftService;
    @Resource
    private AierpWecomExcelService excelService;

    @PostMapping("/binding/issue")
    public BaseResponseInfo issue(@RequestBody String raw, HttpServletRequest request) {
        adapterAuth.verify(request, raw);
        return ok(bindingService.issueBindCode(parse(raw)));
    }

    @PostMapping("/binding/claim")
    public BaseResponseInfo claim(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(bindingService.claimBindCode(body, request));
    }

    @PostMapping("/binding/status")
    public BaseResponseInfo status(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(bindingService.bindingStatus(parse(raw)));
    }

    @PostMapping("/binding/unbind")
    public BaseResponseInfo unbind(@RequestBody String raw, HttpServletRequest request) {
        adapterAuth.verify(request, raw);
        return ok(bindingService.unbind(parse(raw)));
    }

    @PostMapping("/stock/query")
    public BaseResponseInfo stockQuery(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(bindingService.stockQueryDelegated(parse(raw)));
    }

    @PostMapping("/material/search")
    public BaseResponseInfo materialSearch(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(queryService.materialSearch(parse(raw)));
    }

    @PostMapping("/partner/search")
    public BaseResponseInfo partnerSearch(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(queryService.partnerSearch(parse(raw)));
    }

    @PostMapping("/bill/search")
    public BaseResponseInfo billSearch(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(queryService.billSearch(parse(raw)));
    }

    @PostMapping("/bill/detail")
    public BaseResponseInfo billDetail(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(queryService.billDetail(parse(raw)));
    }

    @PostMapping("/report/query")
    public BaseResponseInfo reportQuery(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(queryService.reportQuery(parse(raw)));
    }

    @PostMapping("/purchase/prepare")
    public BaseResponseInfo purchasePrepare(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(draftService.purchasePrepare(parse(raw)));
    }

    @PostMapping("/draft/status")
    public BaseResponseInfo draftStatus(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(draftService.draftStatus(parse(raw)));
    }

    @PostMapping("/draft/cancel")
    public BaseResponseInfo draftCancel(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(draftService.draftCancel(parse(raw)));
    }

    /** AIERP-017A: download xlsx template as base64 (no stock change). */
    @PostMapping("/excel/template")
    public BaseResponseInfo excelTemplate(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(excelService.template(parse(raw)));
    }

    /**
     * AIERP-017A: preview uploaded xlsx (base64) under trusted WeCom identity.
     * Never calls excel.confirm / never posts inventory.
     */
    @PostMapping("/excel/preview")
    public BaseResponseInfo excelPreview(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(excelService.preview(parse(raw)));
    }

    private static JSONObject parse(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONObject();
        }
        return JSON.parseObject(raw);
    }

    private BaseResponseInfo ok(Object data) {
        BaseResponseInfo res = new BaseResponseInfo();
        res.code = 200;
        res.data = data;
        return res;
    }
}
