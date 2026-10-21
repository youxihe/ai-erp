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
 * WeCom adapter for AIERP-012A/013/015A/015B.
 * Adapter routes require HMAC; claim / confirm-ui require logged-in ERP session.
 * Confirm inbound must carry WECOM_BEFORE_DISPATCH proof (not LLM self-report).
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
    private AierpWecomConfirmService confirmService;
    @Resource
    private AierpWecomReceiptService receiptService;
    @Resource
    private com.jsh.erp.service.UserService userService;

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

    /** Trusted WeCom before_dispatch confirm (HMAC). */
    @PostMapping("/draft/confirm")
    public BaseResponseInfo draftConfirm(@RequestBody String raw, HttpServletRequest request) throws Exception {
        adapterAuth.verify(request, raw);
        return ok(confirmService.confirmFromTrustedInbound(parse(raw)));
    }

    /** ERP logged-in UI fallback confirm (session). */
    @PostMapping("/draft/confirm-ui")
    public BaseResponseInfo draftConfirmUi(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(confirmService.confirmUi(body, userService.getCurrentUser()));
    }

    /** Download own receipt PDF (session). */
    @PostMapping("/receipt/pdf")
    public void receiptPdf(@RequestBody JSONObject body, HttpServletRequest request,
                           javax.servlet.http.HttpServletResponse response) throws Exception {
        com.jsh.erp.datasource.entities.User user = userService.getCurrentUser();
        if (body == null || body.getString("receiptId") == null) {
            response.setStatus(400);
            return;
        }
        byte[] pdf = receiptService.loadPdfBytes(user, body.getString("receiptId").trim());
        response.setContentType("application/pdf");
        response.setHeader("Content-Disposition", "attachment; filename=\"receipt.pdf\"");
        response.getOutputStream().write(pdf);
        response.getOutputStream().flush();
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
