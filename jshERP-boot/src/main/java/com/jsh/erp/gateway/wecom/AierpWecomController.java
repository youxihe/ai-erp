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
 * WeCom adapter + PC claim endpoints for AIERP-012A.
 * Adapter routes require HMAC; claim requires logged-in ERP session.
 */
@RestController
@RequestMapping("/aierp/v1/wecom")
public class AierpWecomController {

    @Resource
    private AierpWecomAdapterAuth adapterAuth;
    @Resource
    private AierpWecomBindingService bindingService;

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
