package com.jsh.erp.gateway;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.utils.BaseResponseInfo;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

/**
 * Session-scoped business gateway. The caller is whoever owns X-Access-Token.
 */
@RestController
@RequestMapping("/aierp/v1")
public class AierpGatewayController {

    @Resource
    private AierpGatewayService aierpGatewayService;

    @PostMapping("/stock/query")
    public BaseResponseInfo stockQuery(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(aierpGatewayService.stockQuery(body, request));
    }

    @PostMapping("/purchase/draft")
    public BaseResponseInfo purchaseDraft(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(aierpGatewayService.createDraft("PURCHASE", body, request));
    }

    @PostMapping("/mix/draft")
    public BaseResponseInfo mixDraft(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(aierpGatewayService.createDraft("MIX", body, request));
    }

    @PostMapping("/service/draft")
    public BaseResponseInfo serviceDraft(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(aierpGatewayService.createDraft("SERVICE", body, request));
    }

    @PostMapping("/draft/confirm")
    public BaseResponseInfo confirm(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(aierpGatewayService.confirm(body, request));
    }

    @PostMapping("/report/summary")
    public BaseResponseInfo summary(@RequestBody(required = false) JSONObject body, HttpServletRequest request) throws Exception {
        return ok(aierpGatewayService.summary(request));
    }

    private BaseResponseInfo ok(Object data) {
        BaseResponseInfo res = new BaseResponseInfo();
        res.code = 200;
        res.data = data;
        return res;
    }
}
